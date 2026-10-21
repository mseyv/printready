import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { readExifResolution, setPngIccProfile } from "@/server/metadata";
import { rgbImage } from "../helpers/fixtures";

const dir = mkdtempSync(path.join(os.tmpdir(), "upscaler-meta-"));

describe("setPngIccProfile", () => {
  it("attaches a profile without changing pixel values", async () => {
    const p3 = (await sharp(await rgbImage(32, 16).withIccProfile("p3").png().toBuffer()).metadata()).icc!;
    const file = path.join(dir, "a.png");
    await rgbImage(32, 16).png().toFile(file);
    const before = await sharp(file).raw().toBuffer();

    await setPngIccProfile(file, p3);

    const meta = await sharp(file).metadata();
    expect(meta.icc?.equals(p3)).toBe(true);
    expect(meta.width).toBe(32);
    // keepIccProfile: read raw values without colour conversion
    expect((await sharp(file).keepIccProfile().raw().toBuffer()).equals(before)).toBe(true);
  });

  it("replaces existing colour chunks", async () => {
    const file = path.join(dir, "b.png");
    await rgbImage(8, 8).withIccProfile("p3").png().toFile(file);
    const srgb = (await sharp(await rgbImage(8, 8).withIccProfile("srgb").png().toBuffer()).metadata()).icc!;
    await setPngIccProfile(file, srgb);
    expect((await sharp(file).metadata()).icc?.equals(srgb)).toBe(true);
  });

  it("rejects non-PNG input", async () => {
    const file = path.join(dir, "c.png");
    writeFileSync(file, "not a png");
    await expect(setPngIccProfile(file, Buffer.from("x"))).rejects.toThrow();
  });
});

describe("readExifResolution", () => {
  it("reads DPI written by libvips into WebP EXIF", async () => {
    const buf = await rgbImage(8, 8).withDensity(300).webp().toBuffer();
    expect(readExifResolution((await sharp(buf).metadata()).exif)).toEqual({ x: 300, y: 300 });
  });

  it("returns null for missing or malformed EXIF", () => {
    expect(readExifResolution(undefined)).toBeNull();
    expect(readExifResolution(Buffer.from("Exif\0\0garbage"))).toBeNull();
    expect(readExifResolution(Buffer.from("Exif\0\0II*\0\xff\xff\xff\x7f", "latin1"))).toBeNull();
  });
});
