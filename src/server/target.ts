import { heightForWidth, preservesAspectRatio, scaleSize, widthForHeight, type Size } from "@/lib/shared/dimensions";
import type { UpscaleFields } from "@/lib/shared/schema";
import { PublicError } from "./errors";

/** Turn the request into exact target pixels, validating aspect consistency server-side. */
export function resolveTarget(original: Size, p: UpscaleFields): Size {
  const { width, height, lockAspect } = p;
  if (width === undefined && height === undefined) return scaleSize(original, p.scale);
  if (width !== undefined && height !== undefined) {
    if (lockAspect && !preservesAspectRatio(original, { width, height })) {
      throw new PublicError(
        "ASPECT_MISMATCH",
        "The requested width and height do not match the original aspect ratio, but the aspect ratio is locked.",
        422,
        [{ code: "ASPECT_MISMATCH", field: "height", message: "Height does not match the locked aspect ratio." }],
      );
    }
    return { width, height };
  }
  if (!lockAspect) {
    throw new PublicError("INVALID_PARAMETERS", "Both width and height are required when the aspect ratio is unlocked.", 422);
  }
  return width !== undefined
    ? { width, height: heightForWidth(original, width) }
    : { width: widthForHeight(original, height!), height: height! };
}
