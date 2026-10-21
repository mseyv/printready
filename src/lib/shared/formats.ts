/**
 * Image format capabilities. Shared by the client (UI hints) and the server
 * (validation + encoding decisions), so they can never disagree.
 */

export const INPUT_FORMATS = ["jpeg", "png", "webp", "tiff"] as const;
export type InputFormat = (typeof INPUT_FORMATS)[number];

export const OUTPUT_FORMATS = ["png", "jpeg", "webp", "tiff"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

/** How the requested DPI ends up in the file. */
export type DpiStorage =
  /** Native resolution field (PNG pHYs, JPEG JFIF density, TIFF X/YResolution). */
  | "native"
  /** EXIF XResolution/YResolution only — WebP has no native field; app support varies. */
  | "exif";

export interface OutputFormatInfo {
  id: OutputFormat;
  label: string;
  mime: string;
  extension: string;
  lossy: boolean;
  alpha: boolean;
  dpi: DpiStorage;
  /** Largest width or height the encoder accepts. */
  maxSide: number;
  /** Can a browser display this format inline (used for result previews)? */
  browserPreview: boolean;
}

export const OUTPUT_FORMAT_INFO: Record<OutputFormat, OutputFormatInfo> = {
  png: {
    id: "png",
    label: "PNG",
    mime: "image/png",
    extension: "png",
    lossy: false,
    alpha: true,
    dpi: "native",
    maxSide: 65_535,
    browserPreview: true,
  },
  jpeg: {
    id: "jpeg",
    label: "JPEG",
    mime: "image/jpeg",
    extension: "jpg",
    lossy: true,
    alpha: false,
    dpi: "native",
    maxSide: 65_535,
    browserPreview: true,
  },
  webp: {
    id: "webp",
    label: "WebP",
    mime: "image/webp",
    extension: "webp",
    lossy: true,
    alpha: true,
    dpi: "exif",
    maxSide: 16_383,
    browserPreview: true,
  },
  tiff: {
    id: "tiff",
    label: "TIFF",
    mime: "image/tiff",
    extension: "tif",
    lossy: false,
    alpha: true,
    dpi: "native",
    maxSide: 4_294_967_295,
    browserPreview: false,
  },
};

export const INPUT_FORMAT_LABEL: Record<InputFormat, string> = {
  jpeg: "JPEG",
  png: "PNG",
  webp: "WebP",
  tiff: "TIFF",
};

/** Accept attribute for the file picker. Signatures are still checked on both sides. */
export const ACCEPT_ATTRIBUTE =
  "image/jpeg,image/png,image/webp,image/tiff,.jpg,.jpeg,.png,.webp,.tif,.tiff";

/**
 * Identify an image by its leading bytes ("magic numbers").
 * Extensions and MIME types are client-controlled and never trusted.
 */
export function sniffImageFormat(bytes: Uint8Array): InputFormat | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return "png";
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // WEBP
  ) {
    return "webp";
  }
  if (b.length >= 4) {
    const le = b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00; // II*\0
    const be = b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a; // MM\0*
    if (le || be) return "tiff";
  }
  return null;
}

/** Number of leading bytes `sniffImageFormat` needs. */
export const SNIFF_BYTES = 16;
