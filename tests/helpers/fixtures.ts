import sharp from "sharp";

/** Opaque RGB test image with some structure (gradient + block). */
export function rgbImage(width: number, height: number) {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      data[i] = Math.round((x / width) * 255);
      data[i + 1] = Math.round((y / height) * 255);
      data[i + 2] = x < width / 2 ? 40 : 200;
    }
  }
  return sharp(data, { raw: { width, height, channels: 3 } });
}

/** RGBA image: left half fully transparent, right half opaque. */
export function rgbaImage(width: number, height: number) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data.set([200, 30, 30, x < width / 2 ? 0 : 255], i);
    }
  }
  return sharp(data, { raw: { width, height, channels: 4 } });
}

export const png = (w: number, h: number) => rgbImage(w, h).png().toBuffer();
export const jpeg = (w: number, h: number) => rgbImage(w, h).jpeg().toBuffer();
