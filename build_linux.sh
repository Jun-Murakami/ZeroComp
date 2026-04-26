#!/usr/bin/env bash
# Linux 用ビルドスクリプト（VST3 / LV2 / CLAP / Standalone）
# 動作確認: WSL2 Ubuntu 24.04 + JUCE 8.0.12
#
# 使い方:
#   bash build_linux.sh             # Release ビルド + zip パッケージ生成
#   bash build_linux.sh Debug       # Debug ビルド（zip は生成しない）
#   BUILD_DIR=build-linux-dbg bash build_linux.sh Debug
#
# 必要パッケージ:
#   build-essential pkg-config cmake ninja-build git
#   libasound2-dev libjack-jackd2-dev libcurl4-openssl-dev
#   libfreetype-dev libfontconfig1-dev
#   libx11-dev libxcomposite-dev libxcursor-dev libxext-dev
#   libxinerama-dev libxrandr-dev libxrender-dev
#   libwebkit2gtk-4.1-dev libglu1-mesa-dev mesa-common-dev libgtk-3-dev

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

CONFIG="${1:-Release}"
BUILD_DIR="${BUILD_DIR:-build-linux}"

# CMakeLists.txt の project(...) からターゲット名を自動取得
TARGET=$(awk -F'[() ]+' '/^project\(/{print $2; exit}' CMakeLists.txt)
if [[ -z "${TARGET:-}" ]]; then
    echo "ERROR: project() not found in CMakeLists.txt" >&2
    exit 1
fi

echo "=== Configure: ${TARGET} (${CONFIG}) -> ${BUILD_DIR}/ ==="
cmake -S . -B "$BUILD_DIR" -G Ninja -DCMAKE_BUILD_TYPE="$CONFIG"

echo
echo "=== Build: ${TARGET}_VST3 / _LV2 / _CLAP / _Standalone ==="
cmake --build "$BUILD_DIR" \
    --target "${TARGET}_VST3" "${TARGET}_LV2" "${TARGET}_CLAP" "${TARGET}_Standalone" \
    --parallel "$(nproc)"

ARTEFACTS="$BUILD_DIR/plugin/${TARGET}_artefacts/${CONFIG}"

# JUCE は COPY_PLUGIN_AFTER_BUILD で VST3/LV2 を ~/.vst3, ~/.lv2 に自動コピーする。
# CLAP は clap-juce-extensions 側がコピーしないので明示的にインストール。
if [[ -f "$ARTEFACTS/CLAP/${TARGET}.clap" ]]; then
    mkdir -p "$HOME/.clap"
    cp -f "$ARTEFACTS/CLAP/${TARGET}.clap" "$HOME/.clap/"
fi

echo
echo "=== Artifacts ==="
[[ -f "$ARTEFACTS/VST3/${TARGET}.vst3/Contents/x86_64-linux/${TARGET}.so" ]] && \
    ls -lh "$ARTEFACTS/VST3/${TARGET}.vst3/Contents/x86_64-linux/${TARGET}.so"
[[ -f "$ARTEFACTS/LV2/${TARGET}.lv2/lib${TARGET}.so" ]] && \
    ls -lh "$ARTEFACTS/LV2/${TARGET}.lv2/lib${TARGET}.so"
[[ -f "$ARTEFACTS/CLAP/${TARGET}.clap" ]] && \
    ls -lh "$ARTEFACTS/CLAP/${TARGET}.clap"
[[ -f "$ARTEFACTS/Standalone/${TARGET}" ]] && \
    ls -lh "$ARTEFACTS/Standalone/${TARGET}"

echo
echo "=== Installed ==="
[[ -d "$HOME/.vst3/${TARGET}.vst3" ]] && echo "  ~/.vst3/${TARGET}.vst3"
[[ -d "$HOME/.lv2/${TARGET}.lv2" ]]   && echo "  ~/.lv2/${TARGET}.lv2"
[[ -f "$HOME/.clap/${TARGET}.clap" ]] && echo "  ~/.clap/${TARGET}.clap"

# Release のときだけ Zip パッケージを releases/<VERSION>/ に生成
# build_windows.ps1 の出力規則に合わせて TARGET_VERSION_Linux_VST3_LV2_CLAP_Standalone.zip
if [[ "$CONFIG" == "Release" ]]; then
    if [[ -f VERSION ]]; then
        VERSION="$(tr -d '[:space:]' < VERSION)"
    else
        VERSION="unknown"
    fi
    RELEASE_DIR="releases/${VERSION}"
    ZIP_NAME="${TARGET}_${VERSION}_Linux_VST3_LV2_CLAP_Standalone.zip"
    ZIP_PATH="${RELEASE_DIR}/${ZIP_NAME}"
    mkdir -p "$RELEASE_DIR"
    rm -f "$ZIP_PATH"

    # 含めるフォーマットを動的に収集（欠けているものはスキップ）
    INCLUDES=()
    for d in VST3 LV2 CLAP Standalone; do
        [[ -e "$ARTEFACTS/$d" ]] && INCLUDES+=("$d")
    done

    if (( ${#INCLUDES[@]} > 0 )); then
        # cmake -E tar はクロスプラットフォームで zip を作れる（zip パッケージ非依存）
        ZIP_PATH_ABS="$(realpath -m "$ZIP_PATH")"
        ( cd "$ARTEFACTS" && cmake -E tar cf "$ZIP_PATH_ABS" --format=zip "${INCLUDES[@]}" >/dev/null )
        echo
        echo "=== Release Zip ==="
        ls -lh "$ZIP_PATH"
    fi
fi

echo
echo "=== Run Standalone (WSLg) ==="
echo "  $ARTEFACTS/Standalone/${TARGET}"
echo
echo "  WebView が真っ黒/真っ白になる場合は環境変数で DMABUF レンダラーを無効化:"
echo "    WEBKIT_DISABLE_DMABUF_RENDERER=1 $ARTEFACTS/Standalone/${TARGET}"
