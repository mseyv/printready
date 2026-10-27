/**
 * AI enhancement options: model, face restoration and tiling. Shared by the client
 * (choices and hints) and the server (validation), so they can never disagree.
 */

export const MODEL_IDS = [
  "realesrgan-x4plus",
  "realesrgan-x4plus-anime",
  "realesr-general-x4v3",
  "realesr-animevideov3",
] as const;
export type ModelId = (typeof MODEL_IDS)[number];

export interface ModelInfo {
  id: ModelId;
  label: string;
  hint: string;
}

export const MODEL_INFO: Record<ModelId, ModelInfo> = {
  "realesrgan-x4plus": {
    id: "realesrgan-x4plus",
    label: "RealESRGAN x4plus",
    hint: "Photos and natural textures",
  },
  "realesrgan-x4plus-anime": {
    id: "realesrgan-x4plus-anime",
    label: "RealESRGAN x4plus Anime 6B",
    hint: "Artwork, anime and illustrations",
  },
  "realesr-general-x4v3": {
    id: "realesr-general-x4v3",
    label: "Real-ESR General x4v3",
    hint: "Universal, lightweight",
  },
  "realesr-animevideov3": {
    id: "realesr-animevideov3",
    label: "Real-ESR AnimeVideo v3",
    hint: "Fast, flat-colour illustrations",
  },
};

export const FACE_ENHANCERS = ["gfpgan", "codeformer"] as const;
export type FaceEnhancer = (typeof FACE_ENHANCERS)[number];

export const FACE_ENHANCER_LABEL: Record<FaceEnhancer, string> = {
  gfpgan: "GFPGAN",
  codeformer: "CodeFormer",
};

/** Tile sizes offered in the UI (px). Smaller tiles use less GPU memory but run slower. */
export const TILE_SIZES = [256, 400, 512, 1024] as const;
export type TileSize = (typeof TILE_SIZES)[number];
export const DEFAULT_TILE_SIZE: TileSize = 512;

/** One model as offered by the configured engine. */
export interface EngineModel {
  id: ModelId;
  /** Scales the model produces natively, ascending (e.g. [4] for RealESRGAN_x4plus). */
  nativeScales: number[];
  available: boolean;
  /** Human-readable reason when not available. */
  reason?: string;
}

export interface EnhanceOptions {
  model: ModelId;
  /** Face restoration model, or null to skip face restoration. */
  faceEnhance: FaceEnhancer | null;
  /** Tile size in px, or null to let the engine decide. */
  tileSize: TileSize | null;
}
