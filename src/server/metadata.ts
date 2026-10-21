/**
 * Low-level metadata helpers that libvips/sharp do not expose directly.
 */
import { createReadStream, createWriteStream } from "node:fs";
import { open, rename } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Colour chunks that conflict with an embedded ICC profile. */
const COLOUR_CHUNKS = new Set(["iCCP", "sRGB", "gAMA", "cHRM", "cICP"]);

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "latin1");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

/**
 * Attach an ICC profile to a PNG *without* transforming pixel values.
 * The pixel data (IDAT onward) is streamed, so very large files are not loaded into memory.
 *
 * Used to carry the source's colour profile across AI inference, which works on
 * raw RGB values and returns an untagged PNG.
 */
export async function setPngIccProfile(file: string, icc: Buffer, name = "ICC profile"): Promise<void> {
  const fh = await open(file, "r");
  const head: Buffer[] = [];
  let idatOffset = -1;
  try {
    const sig = Buffer.alloc(8);
    await fh.read(sig, 0, 8, 0);
    if (!sig.equals(PNG_SIGNATURE)) throw new Error("not a PNG");

    let pos = 8;
    const header = Buffer.alloc(8);
    for (;;) {
      const { bytesRead } = await fh.read(header, 0, 8, pos);
      if (bytesRead < 8) throw new Error("truncated PNG");
      const length = header.readUInt32BE(0);
      const type = header.toString("latin1", 4, 8);
      if (type === "IDAT") {
        idatOffset = pos;
        break;
      }
      const chunk = Buffer.alloc(12 + length);
      await fh.read(chunk, 0, chunk.length, pos);
      if (!COLOUR_CHUNKS.has(type)) head.push(chunk);
      if (type === "IHDR") {
        const profileName = Buffer.from(name.replace(/[^\x20-\x7e]/g, "").slice(0, 79) || "ICC profile", "latin1");
        head.push(
          pngChunk("iCCP", Buffer.concat([profileName, Buffer.from([0, 0]), zlib.deflateSync(icc)])),
        );
      }
      pos += 12 + length;
    }
  } finally {
    await fh.close();
  }

  const tmp = `${file}.icc.tmp`;
  const out = createWriteStream(tmp);
  out.write(PNG_SIGNATURE);
  for (const chunk of head) out.write(chunk);
  await pipeline(createReadStream(file, { start: idatOffset }), out);
  await rename(tmp, file);
}

/**
 * Read X/Y resolution from a raw EXIF block (as returned by sharp's `metadata().exif`).
 * Returns DPI, converting from centimetres if ResolutionUnit says so.
 */
export function readExifResolution(exif: Buffer | undefined): { x: number; y: number } | null {
  if (!exif) return null;
  let base = 0;
  if (exif.toString("latin1", 0, 6) === "Exif\0\0") base = 6;
  if (exif.length < base + 8) return null;

  const order = exif.toString("latin1", base, base + 2);
  if (order !== "II" && order !== "MM") return null;
  const le = order === "II";
  const u16 = (o: number) => (le ? exif.readUInt16LE(base + o) : exif.readUInt16BE(base + o));
  const u32 = (o: number) => (le ? exif.readUInt32LE(base + o) : exif.readUInt32BE(base + o));

  try {
    const ifd = u32(4);
    const count = u16(ifd);
    let x: number | null = null;
    let y: number | null = null;
    let unit = 2;
    for (let i = 0; i < count; i++) {
      const entry = ifd + 2 + i * 12;
      const tag = u16(entry);
      const type = u16(entry + 2);
      if ((tag === 0x011a || tag === 0x011b) && type === 5) {
        const off = u32(entry + 8);
        const den = u32(off + 4);
        const value = den ? u32(off) / den : 0;
        if (tag === 0x011a) x = value;
        else y = value;
      } else if (tag === 0x0128 && type === 3) {
        unit = u16(entry + 8);
      }
    }
    if (x === null || y === null) return null;
    const factor = unit === 3 ? 2.54 : 1;
    return { x: x * factor, y: y * factor };
  } catch {
    return null; // malformed EXIF: treat as absent
  }
}

/**
 * Ensure a JPEG starts with a JFIF APP0 segment carrying `dpi`. libvips stores
 * JPEG resolution only in EXIF; some print workflows read only the JFIF density,
 * so both are written (JFIF first, then EXIF, as cameras and Photoshop do).
 */
export function withJfifDensity(jpeg: Buffer, dpi: number): Buffer {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error("not a JPEG");
  if (!Number.isInteger(dpi) || dpi < 1 || dpi > 0xffff) throw new Error("dpi out of JFIF range");
  let rest = jpeg.subarray(2);
  if (rest[0] === 0xff && rest[1] === 0xe0 && rest.toString("latin1", 4, 9) === "JFIF\0") {
    rest = rest.subarray(2 + rest.readUInt16BE(2));
  }
  const app0 = Buffer.alloc(18);
  app0.writeUInt16BE(0xffe0, 0);
  app0.writeUInt16BE(16, 2);
  app0.write("JFIF\0", 4, "latin1");
  app0[9] = 1; // version 1.02
  app0[10] = 2;
  app0[11] = 1; // units: dots per inch
  app0.writeUInt16BE(dpi, 12);
  app0.writeUInt16BE(dpi, 14);
  // thumbnail 0×0 (bytes 16–17 already zero)
  return Buffer.concat([jpeg.subarray(0, 2), app0, rest]);
}

/** Read the JFIF density (in DPI) if the JPEG has a JFIF header with inch/cm units. */
export function readJfifDensity(jpeg: Buffer): number | null {
  if (jpeg[2] !== 0xff || jpeg[3] !== 0xe0 || jpeg.toString("latin1", 6, 11) !== "JFIF\0") return null;
  const units = jpeg[13];
  const x = jpeg.readUInt16BE(14);
  if (units === 1) return x;
  if (units === 2) return x * 2.54;
  return null;
}
