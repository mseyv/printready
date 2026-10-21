# PrintReady

AI image upscaling web service. Users upload a JPEG, PNG, WebP or TIFF image, then choose ×2/×4 or exact pixel dimensions and a print DPI. They can compare before and after, then download a file whose pixel size and DPI metadata are verified.

- **Stack:** Next.js 16 (App Router), TypeScript, Tailwind CSS 4, shadcn/ui (Base UI), Zod, sharp/libvips
- **AI engines:** [Real-ESRGAN ncnn-vulkan](https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan) (local GPU) or Replicate's [`nightmareai/real-esrgan`](https://replicate.com/nightmareai/real-esrgan) (hosted), behind one `UpscaleEngine` interface. With no engine configured the API returns `503 ENGINE_NOT_CONFIGURED`. It never fakes a result.

## Quick start

```bash
npm install
npm run setup:engine          # downloads Real-ESRGAN ncnn-vulkan + models into ./engines (Linux/macOS)
cp .env.example .env.local    # then set UPSCALE_ENGINE and paths (printed by setup:engine)
npm run dev                   # http://localhost:3000
```

Production: `npm run build && npm start`, or use [Docker](#docker). Either way, run it behind a reverse proxy (see [Security](#security)).

## Docker

The image bundles the Next.js standalone server, sharp/libvips, Real-ESRGAN ncnn-vulkan (v0.2.5.0, all models, pinned by SHA-256) and Mesa Vulkan drivers. It runs as the non-root `node` user and works with a read-only root filesystem. It is about 820 MB, mostly the Vulkan drivers and models.

```bash
echo "DOWNLOAD_URL_SECRET=$(openssl rand -hex 32)" > .env

# CPU only (Mesa lavapipe) — works on any host, ~4× slower than an iGPU
docker compose up -d --build

# Intel / AMD GPU
echo "RENDER_GID=$(getent group render | cut -d: -f3)" >> .env
docker compose -f compose.yaml -f compose.gpu-dri.yaml up -d --build

# NVIDIA GPU (needs the NVIDIA Container Toolkit on the host)
docker compose -f compose.yaml -f compose.gpu-nvidia.yaml up -d --build
```

The app listens on `http://localhost:3000` (change it with `PRINTREADY_PORT`). Settings come from `.env` (see `compose.yaml` and the table below). Job files go in the `printready-jobs` volume at `/data`. They are deleted automatically, and the volume is wiped on start. A healthcheck polls `/api/config`.

Without compose:

```bash
docker build -t printready .
docker run -d -p 3000:3000 -e DOWNLOAD_URL_SECRET=$(openssl rand -hex 32) \
  --device /dev/dri --group-add "$(getent group render | cut -d: -f3)" \
  --read-only --tmpfs /tmp -v printready-jobs:/data --cap-drop ALL printready
```

Measured on this host (Intel UHD, Alder Lake-N), with a 200×120 source → ×4 using `realesrgan-x4plus`: about 11 s on the iGPU and about 41 s in CPU-only mode. In production, put the container behind a reverse proxy (TLS, `TRUST_PROXY_HOPS=1`).

## How processing works

```
upload ─► signature sniff ─► probe (oriented size, limits) ─► queue job (202)
                                                                │
   decode once: EXIF orientation · 8-bit RGB(A) · keep RGB ICC / convert CMYK→sRGB
   split alpha ─► AI pass (native ×2/×4) on RGB ─► verify AI output = source × scale
   Lanczos resample to exact target (custom sizes / ×2 via a ×4-only model)
   alpha upscaled with Lanczos and re-joined · ICC re-attached without pixel conversion
   encode PNG/JPEG/WebP/TIFF + DPI ─► read file back: size, DPI, alpha, ICC ─► ready
```

- **AI inference is separate from metadata and export.** Engines only turn an RGB PNG into an RGB PNG at exactly ×N. Orientation, colour, alpha, exact size, encoding and DPI are all handled in `src/server/pipeline.ts`.
- **Custom dimensions** use the smallest native AI scale that covers the request, then a Lanczos resample. Above ×4 per axis the request is rejected; it is never silently capped. With the aspect ratio unlocked the image is stretched to the requested size. The UI warns about this, and nothing is ever cropped.
- **DPI** is written as follows and read back after encoding:

  | Format | Where DPI is stored | Transparency |
  |---|---|---|
  | PNG | `pHYs` chunk | kept |
  | JPEG | JFIF APP0 density **and** EXIF X/YResolution | flattened onto white (warned) |
  | TIFF | X/YResolution + ResolutionUnit=inch (LZW) | kept |
  | WebP | EXIF X/YResolution only (WebP has no native field; some apps ignore it) | kept |

- **Colour:** RGB sources keep their embedded ICC profile, and pixel values are not converted. CMYK sources, and greyscale sources with a profile, are converted to sRGB; the job reports this. 16-bit sources are processed at 8 bits per channel.
- **Metadata privacy:** source EXIF (camera, GPS) is not copied. Only resolution tags are written.
- **Progress:** the ncnn engine reports real per-tile percentages. Replicate and the other stages show an indeterminate bar. Upload progress is real (XHR).

## API

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/config` | Engine capabilities and limits (no secrets). |
| `POST` | `/api/upscale` | multipart: `image`, `scale` (2\|4), `width?`, `height?`, `lockAspect` (true\|false), `dpi`, `format` (png\|jpeg\|webp\|tiff), `quality?` (1–100). Optional `Idempotency-Key` header. → `202 { job, pollInterval }` |
| `GET` | `/api/upscale/:jobId` | `status`: queued \| processing \| completed \| failed, plus `stage`, `progress`, `output` metadata and signed `downloadUrl`/`previewUrl`. `410` once expired. |
| `GET` | `/api/upscale/:jobId/download?exp&sig` | The file, with `Content-Disposition: attachment; filename=…_upscaled-2x_3840x2160_300dpi.png` |
| `GET` | `/api/upscale/:jobId/preview?exp&sig` | Inline rendition for the comparison view (a WebP for TIFF output). |
| `DELETE` | `/api/upscale/:jobId` | Cancel and delete files immediately. |
| `POST` | `/api/inspect` | Dimensions and a preview for TIFF, which browsers can't decode. The file is deleted before the response. |

Errors are `{ error: { code, message, issues? } }` with appropriate status codes (400/413/415/422/429/503/507…). The server validates every parameter itself with Zod and `planUpscale`, the same function the UI uses for live feedback.

## Environment variables

See `.env.example` for the full list. The important ones:

| Variable | Default | Purpose |
|---|---|---|
| `UPSCALE_ENGINE` | `none` | `realesrgan-ncnn`, `replicate` or `none` |
| `REALESRGAN_BIN`, `REALESRGAN_MODELS_DIR` | – | Absolute paths printed by `npm run setup:engine` |
| `REALESRGAN_MODEL` | `realesrgan-x4plus` | `realesrgan-x4plus` (photos, native ×4), `realesrgan-x4plus-anime`, `realesr-animevideov3` (fast, native ×2/×4) |
| `REALESRGAN_GPU`, `REALESRGAN_TILE` | `auto`, `0` | GPU index; tile size (lower, e.g. `200`, for low-VRAM GPUs) |
| `REPLICATE_API_TOKEN` | – | Enables the hosted engine (server-side only) |
| `REPLICATE_MODEL_VERSION` | `f121d640…` | Pin of `nightmareai/real-esrgan`. Check it against the model page before deploying. |
| `DOWNLOAD_URL_SECRET` | random per process | **Required in production** (≥ 32 chars). Signs download URLs. |
| `MAX_UPLOAD_MB` / `MAX_INPUT_PIXELS` | 25 / 25 MP | Upload limits |
| `MAX_OUTPUT_SIDE` / `MAX_OUTPUT_PIXELS` | 16384 / 64 MP | Output limits |
| `MAX_AI_OUTPUT_PIXELS` | 100 MP | Cap on the raw AI pass (×2 with a ×4-only model creates a ×4 intermediate) |
| `JOB_TTL_MINUTES` / `JOB_TIMEOUT_SECONDS` | 30 / 900 | Retention after completion / per-job processing timeout |
| `MAX_CONCURRENT_JOBS` / `MAX_QUEUED_JOBS` | 1 / 20 | Queue capacity (`503` when full) |
| `UPSCALE_TMP_DIR` / `MIN_FREE_DISK_MB` | `$TMPDIR/printready-jobs` / 1024 | Private temp storage (`507` when low) |
| `RATE_LIMIT_UPLOADS_PER_MINUTE` / `RATE_LIMIT_REQUESTS_PER_MINUTE` | 10 / 240 | Per client IP |
| `TRUST_PROXY_HOPS` | 0 | Number of reverse proxies that append to `X-Forwarded-For` |

## Configuring the AI engine

### Option A: Real-ESRGAN ncnn-vulkan (local, recommended)

1. Requirements: a Vulkan driver and GPU (NVIDIA, AMD or Intel; Apple Silicon via MoltenVK in the macOS build). Without a GPU, a CPU Vulkan implementation such as Mesa lavapipe works, but very slowly.
2. `npm run setup:engine` installs v0.2.5.0 (binary and models, about 45 MB) into `./engines/realesrgan`.
3. Set `UPSCALE_ENGINE=realesrgan-ncnn`, `REALESRGAN_BIN` and `REALESRGAN_MODELS_DIR` in `.env.local`, then restart.
4. Limits and performance: VRAM is not the limit, because the binary tiles automatically; use `REALESRGAN_TILE` to cut memory use. Time grows linearly with source pixels × scale². `realesrgan-x4plus` is heavy: on this Intel UHD (Alder Lake-N) iGPU, a 256×160 source → ×4 took about 10 s. A discrete GPU is much faster. `realesr-animevideov3` is roughly 10–20× faster and suits illustrations. Size `JOB_TIMEOUT_SECONDS` and `MAX_INPUT_PIXELS` for your hardware.

### Option B: Replicate (hosted)

Set `UPSCALE_ENGINE=replicate` and `REPLICATE_API_TOKEN`. Images are uploaded to Replicate's file API, processed, downloaded, and the uploaded file is then deleted. The hosted model's GPU limits how big a source can be. `REPLICATE_MAX_INPUT_PIXELS` (default 2 MP) is a conservative guard, so tune it after checking the model's current limits. This adapter is covered only by tests with mocked fetch; it has not been run against the live service (no token was available).

### Adding another engine

Implement `UpscaleEngine` (`src/server/engines/types.ts`): declare `capabilities.nativeScales`, then write an RGB PNG of exactly `input × scale` to `outputPath`. Register it in `src/server/engines/index.ts`. The pipeline verifies the output size.

## Tests

```bash
npm test            # Vitest: 110 unit + integration tests
npm run test:e2e    # Playwright (desktop 1440px + Pixel 7) against `next dev`; uses local Chrome
                    # (set PW_CHANNEL="" and run `npx playwright install chromium` to use bundled Chromium)
npm run lint && npm run typecheck
```

- `tests/unit`: ×2/×4 math, manual edits, aspect lock and unlock, print size (3840×2160 at 300 DPI → 12.8 × 7.2 in, 32.51 × 18.29 cm), planning and limits, request schema, server-side target resolution, file signatures, filename sanitising, signed URLs, rate limiting, ICC injection, EXIF parsing.
- `tests/integration/pipeline.test.ts`: real sharp encode and decode. Covers exact dimensions, DPI read back for every format (including raw JFIF bytes), alpha preserved or flattened, EXIF orientation, ICC preservation, CMYK/greyscale/16-bit, EXIF stripping, and failure cases (corrupt or truncated files, engine errors, wrong-size output, timeout).
- `tests/integration/api.test.ts`: route handlers end to end. Covers upload → poll → download, validation errors, 503 when not configured, idempotency, tampered or foreign links, cancel, expiry (410), and TIFF inspect.
- `tests/integration/realesrgan.test.ts`: the **real** Real-ESRGAN binary (skipped when not installed).
- `tests/helpers/fake-engine.ts`: a deterministic Lanczos stand-in used **only in tests**, so the pipeline can be tested without a GPU.
- `e2e/`: UI flows (default ×2, ×4 switch, lock/unlock, custom indicator, DPI and print size, invalid files, limit errors) and responsive layout. When an engine is configured, it also runs real processing, the comparison slider and zoom, and download verification.

## Security

- Uploads: size checked before buffering, signatures sniffed (extension and MIME type ignored), decoded by libvips with pixel limits. Content is stored under server-generated names in `0700` per-job directories; nothing is executed.
- Job IDs are random 128-bit values. File URLs are HMAC-signed, bound to the job and to the file kind, and expire with the job. Files are deleted after `JOB_TTL_MINUTES`, on `DELETE`, and on startup (orphans).
- Responses never include filesystem paths, stack traces or engine stderr; details are logged server-side without filenames or image data. API keys stay on the server.
- Rate limiting is per client IP. Next.js does not expose the socket address to route handlers, so **run behind a reverse proxy that appends `X-Forwarded-For` and set `TRUST_PROXY_HOPS=1`**. Exposed directly, clients can spoof their IP, though the global queue cap still bounds load.

## Project structure

```
src/
  app/
    page.tsx, layout.tsx, globals.css
    api/config · api/inspect · api/upscale · api/upscale/[jobId]{,/download,/preview}
  components/
    ui/                     shadcn/ui primitives
    upscaler/               upscaler.tsx (layout), use-upscaler.ts (state, upload, polling),
                            dropzone, source-summary, factor-picker, output-dimensions, number-field,
                            dpi-settings, export-settings, processing-panel, compare-viewer, result-panel
  lib/
    shared/                 isomorphic: dimensions, plan (validation), formats, schema (Zod/API types), filename
    client/                 api client (XHR upload progress), source-image (header-only inspection)
  server/
    config.ts               env parsing (Zod)       jobs.ts       queue, timeouts, TTL cleanup, idempotency
    pipeline.ts             probe/process/verify    metadata.ts   PNG iCCP, JFIF density, EXIF resolution
    engines/                types, realesrgan-ncnn, replicate, index (selection)
    signing.ts, rate-limit.ts, http.ts, files.ts, errors.ts, target.ts
Dockerfile · compose.yaml · compose.gpu-dri.yaml · compose.gpu-nvidia.yaml
scripts/setup-realesrgan.sh
tests/ (unit, integration, helpers) · e2e/
```

## Known limitations

- **Single instance.** The queue, job state and rate limits live in process memory, and files sit on local disk. For several replicas, move the queue to Redis/BullMQ and storage to an object store with presigned URLs; `JobManager` is the seam for this. A restart drops in-flight jobs.
- Processing is 8 bits per channel. 16-bit sources are reduced. Multi-page TIFFs and animated WebPs use only the first frame (with a warning).
- Alpha channels are upscaled with Lanczos rather than AI. This is deliberate, to keep mask edges clean.
- Wide-gamut ICC profiles are preserved, but the model was trained on sRGB, so results on wide-gamut sources can differ slightly in tone.
- Large outputs are shown at full resolution in the comparison viewer. Very large results (more than about 50 MP) may be slow to load on low-memory phones.
- The Replicate adapter has not been run against the live API, and its default model version hash should be checked before use.
