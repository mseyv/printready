import { existsSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createRealEsrganNcnnEngine } from "@/server/engines/realesrgan-ncnn";
import { rgbImage } from "../helpers/fixtures";

/**
 * Runs the real Real-ESRGAN ncnn-vulkan binary when installed (scripts/setup-realesrgan.sh).
 * Skipped otherwise, e.g. in CI without a GPU.
 */
const bin = process.env.REALESRGAN_BIN ?? path.resolve("engines/realesrgan/realesrgan-ncnn-vulkan");
const available = existsSync(bin);

describe.skipIf(!available)("Real-ESRGAN ncnn-vulkan (real inference)", () => {
  it("reports configuration problems clearly", () => {
    expect(createRealEsrganNcnnEngine({ binPath: "/nonexistent", model: "realesrgan-x4plus", gpu: "auto", tile: 0 }).capabilities).toMatchObject({
      configured: false,
    });
    expect(createRealEsrganNcnnEngine({ binPath: bin, model: "no-such-model", gpu: "auto", tile: 0 }).capabilities.configured).toBe(false);
  });

  it.each([
    ["realesr-animevideov3", 2],
    ["realesrgan-x4plus", 4],
  ] as const)("%s produces an exact ×%i RGB PNG with progress", async (model, scale) => {
    const engine = createRealEsrganNcnnEngine({ binPath: bin, model, gpu: "auto", tile: 0 });
    expect(engine.capabilities.configured).toBe(true);
    const dir = mkdtempSync(path.join(os.tmpdir(), "upscaler-esrgan-"));
    const input = path.join(dir, "in.png");
    const output = path.join(dir, "out.png");
    await rgbImage(48, 32).png().toFile(input);
    const progress: number[] = [];
    await engine.upscale({ inputPath: input, outputPath: output, scale, signal: new AbortController().signal, onProgress: (p) => progress.push(p) });
    expect(await sharp(output).metadata()).toMatchObject({ width: 48 * scale, height: 32 * scale, format: "png" });
    expect(progress.length).toBeGreaterThan(0);
  }, 180_000);

  it("is killed on abort", async () => {
    const engine = createRealEsrganNcnnEngine({ binPath: bin, model: "realesrgan-x4plus", gpu: "auto", tile: 0 });
    const dir = mkdtempSync(path.join(os.tmpdir(), "upscaler-esrgan-"));
    await rgbImage(256, 256).png().toFile(path.join(dir, "in.png"));
    const ac = new AbortController();
    setTimeout(() => ac.abort(new Error("stop")), 300);
    await expect(
      engine.upscale({ inputPath: path.join(dir, "in.png"), outputPath: path.join(dir, "out.png"), scale: 4, signal: ac.signal }),
    ).rejects.toThrow("stop");
  }, 60_000);
});
