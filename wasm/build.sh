#!/bin/bash
# Emscripten で ZeroComp DSP を WASM にビルドする。
# 前提: emsdk がインストール済みかつアクティベート済み
#   source /path/to/emsdk/emsdk_env.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="${SCRIPT_DIR}/build"
DIST_DIR="${SCRIPT_DIR}/dist"
WEB_PUBLIC_WASM="${SCRIPT_DIR}/../webui/public-web/wasm"

mkdir -p "${BUILD_DIR}"
cd "${BUILD_DIR}"

emcmake cmake "${SCRIPT_DIR}" -DCMAKE_BUILD_TYPE=Release
emmake make -j$(nproc 2>/dev/null || echo 4)

mkdir -p "${DIST_DIR}"
cp -f "${BUILD_DIR}/dist/zerocomp_dsp.wasm" "${DIST_DIR}/"

# WebUI の public-web/wasm/ にもコピー（開発・本番ともここから配信される）
mkdir -p "${WEB_PUBLIC_WASM}"
cp -f "${BUILD_DIR}/dist/zerocomp_dsp.wasm" "${WEB_PUBLIC_WASM}/"

echo ""
echo "Build complete."
echo "  WASM: ${DIST_DIR}/zerocomp_dsp.wasm"
echo "  Also copied to: ${WEB_PUBLIC_WASM}/"
