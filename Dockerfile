# syntax=docker/dockerfile:1.7
#
# Upscaler: Next.js standalone server + sharp/libvips + Real-ESRGAN ncnn-vulkan.
#
#   docker build -t upscaler .
#   docker run -p 3000:3000 -e DOWNLOAD_URL_SECRET=$(openssl rand -hex 32) upscaler          # CPU (lavapipe)
#   docker run ... --device /dev/dri --group-add $(getent group render | cut -d: -f3) upscaler  # Intel/AMD GPU
#   docker run ... --gpus all upscaler                                                         # NVIDIA GPU
#
# See compose.yaml and the "Docker" section of README.md.

ARG NODE_IMAGE=node:24-trixie-slim

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------------------------------------------------------------------------
# Real-ESRGAN ncnn-vulkan release (binary + models), pinned by checksum.
FROM debian:trixie-slim AS engine
ARG REALESRGAN_URL=https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-ubuntu.zip
ARG REALESRGAN_SHA256=e5aa6eb131234b87c0c51f82b89390f5e3e642b7b70f2b9bbe95b6a285a40c96
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl unzip \
 && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL --retry 3 -o /tmp/realesrgan.zip "$REALESRGAN_URL" \
 && echo "$REALESRGAN_SHA256  /tmp/realesrgan.zip" | sha256sum -c - \
 && unzip -q /tmp/realesrgan.zip -d /tmp/realesrgan \
 && mkdir -p /opt/realesrgan \
 && install -m 0755 /tmp/realesrgan/realesrgan-ncnn-vulkan /opt/realesrgan/ \
 && cp -r /tmp/realesrgan/models /opt/realesrgan/ \
 && chmod -R a+rX /opt/realesrgan

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime

# Vulkan loader + Mesa drivers (Intel, AMD, and lavapipe as a CPU fallback),
# OpenMP for the engine, tini as PID 1. NVIDIA drivers are injected at run time
# by the NVIDIA Container Toolkit.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libvulkan1 mesa-vulkan-drivers libgomp1 tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    UPSCALE_ENGINE=realesrgan-ncnn \
    REALESRGAN_BIN=/opt/realesrgan/realesrgan-ncnn-vulkan \
    REALESRGAN_MODELS_DIR=/opt/realesrgan/models \
    UPSCALE_TMP_DIR=/data/jobs \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility,graphics

COPY --from=engine /opt/realesrgan /opt/realesrgan
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
RUN mkdir -p /data/jobs && chown -R node:node /data

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/config').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
