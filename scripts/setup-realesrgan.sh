#!/usr/bin/env bash
# Downloads the portable Real-ESRGAN ncnn-vulkan build (binary + models) into ./engines/realesrgan.
# Requires a Vulkan-capable GPU/driver (NVIDIA, AMD, Intel) or a CPU Vulkan implementation (lavapipe).
set -euo pipefail

VERSION="v0.2.5.0"
case "$(uname -s)" in
  Linux)  ASSET="realesrgan-ncnn-vulkan-20220424-ubuntu.zip" ;;
  Darwin) ASSET="realesrgan-ncnn-vulkan-20220424-macos.zip" ;;
  *) echo "Unsupported OS; download manually from https://github.com/xinntao/Real-ESRGAN/releases" >&2; exit 1 ;;
esac

DEST="$(cd "$(dirname "$0")/.." && pwd)/engines/realesrgan"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading $ASSET ..."
curl -fL --retry 3 -o "$TMP/realesrgan.zip" \
  "https://github.com/xinntao/Real-ESRGAN/releases/download/${VERSION}/${ASSET}"

mkdir -p "$TMP/extract"
unzip -q "$TMP/realesrgan.zip" -d "$TMP/extract"
mkdir -p "$DEST"
cp "$TMP/extract/realesrgan-ncnn-vulkan" "$DEST/"
cp -r "$TMP/extract/models" "$DEST/"
chmod +x "$DEST/realesrgan-ncnn-vulkan"

echo "Installed to $DEST"
echo "Set in .env.local:"
echo "  UPSCALE_ENGINE=realesrgan-ncnn"
echo "  REALESRGAN_BIN=$DEST/realesrgan-ncnn-vulkan"
echo "  REALESRGAN_MODELS_DIR=$DEST/models"
