#!/bin/zsh

# ZeroComp macOS Release Build Script (zsh)
# - WebUI のビルド → JUCE (Xcode) で VST3/AU/Standalone をビルド
# - コード署名（Hardened Runtime）→ Notary Tool でノータライズ → ステープル
# - Windows 用スクリプト(build_windows_release.ps1)の体裁に合わせて段階表示・要約を出力

set -e
set -u
set -o pipefail

#============================================
#  出力用の装飾関数（PowerShell版に近い体裁）
#============================================
color_cyan="\033[36m"
color_yellow="\033[33m"
color_green="\033[32m"
color_red="\033[31m"
color_gray="\033[90m"
color_reset="\033[0m"

echo_header() {
    echo ""
    echo -e "${color_cyan}============================================${color_reset}"
    echo -e "${color_cyan}   $1${color_reset}"
    echo -e "${color_cyan}============================================${color_reset}"
    echo ""
}

echo_step() {
    echo -e "${color_yellow}► $1${color_reset}"
}

echo_success() {
    echo -e "${color_green}✓ $1${color_reset}"
}

echo_error() {
    echo -e "${color_red}✗ $1${color_reset}" 1>&2
}

#============================================
#  設定と前提
#============================================
# - バージョンはリポジトリ直下の VERSION から取得
# - 署名には Developer ID Application 証明書が必要
# - ノータライズには notarytool の資格情報が必要
#   (優先1) App Store Connect API キー: APPLE_API_KEY_PATH / APPLE_API_KEY_ID(/APPLE_API_KEY) / APPLE_API_ISSUER
#           例) xcrun notarytool submit ... --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER" --wait
#   (優先2) Keychain プロファイル: NOTARYTOOL_PROFILE
#   (優先3) Apple ID 直指定: APPLE_ID / APP_PASSWORD / TEAM_ID
#
# 必須環境変数:
#   CODESIGN_IDENTITY : 例) "Developer ID Application: Your Name (TEAMID)"
#   どれか一つ:
#     (A) APPLE_API_KEY_PATH / APPLE_API_KEY_ID(/APPLE_API_KEY) / APPLE_API_ISSUER
#     (B) NOTARYTOOL_PROFILE
#     (C) APPLE_ID / APP_PASSWORD / TEAM_ID
#
# 任意環境変数:
#   ENTITLEMENTS_PATH : 付与する entitlements の .plist パス
#   CODESIGN_DEEP     : "1" で --deep を付与
#   SKIP_WEBUI        : "1" で WebUI ビルドをスキップ

CONFIGURATION="Release"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --config|-c)
            CONFIGURATION="${2:-Release}"
            shift 2
            ;;
        --skip-webui)
            export SKIP_WEBUI="1"
            shift 1
            ;;
        *)
            echo_error "Unknown argument: $1"
            exit 1
            ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="${SCRIPT_DIR}"
VERSION_FILE="${ROOT_DIR}/VERSION"

if [[ ! -f "${VERSION_FILE}" ]]; then
    echo_error "VERSION file not found: ${VERSION_FILE}"
    exit 1
fi

VERSION="$(cat "${VERSION_FILE}" | tr -d '\r' | tr -d '\n')"
BUILD_DATE="$(date +%Y-%m-%d)"

# Load .env file if present (KEY=VALUE format, one per line)
ENV_FILE="${ROOT_DIR}/.env"
if [[ -f "${ENV_FILE}" ]]; then
    echo -e "${color_gray}Loading environment variables from .env ...${color_reset}"
    while IFS= read -r line || [[ -n "$line" ]]; do
        line="${line## }"          # trim leading
        line="${line%% }"          # trim trailing
        [[ -z "$line" || "$line" == \#* ]] && continue
        key="${line%%=*}"
        value="${line#*=}"
        value="${value#\"}" ; value="${value%\"}"   # strip surrounding quotes
        value="${value#\'}" ; value="${value%\'}"
        if [[ -z "${(P)key:-}" ]]; then
            export "$key=$value"
        fi
    done < "${ENV_FILE}"
fi

echo_header "ZeroComp ${VERSION} Build Script (macOS zsh)"

# ディレクトリ設定
WEBUI_DIR="${ROOT_DIR}/webui"
BUILD_DIR="${ROOT_DIR}/build"
OUTPUT_DIR="${ROOT_DIR}/releases/${VERSION}/macOS"
AAX_SDK_PATH="${ROOT_DIR}/aax-sdk"

# Check AAX SDK
echo_step "Checking AAX SDK..."
if [[ -f "${AAX_SDK_PATH}/Interfaces/AAX.h" ]]; then
    echo_success "AAX SDK found - AAX will be built"
    BUILD_AAX=1
    
    # Build AAX Library (Universal Binary)
    echo_step "Building AAX Library (Universal Binary)..."
    AAX_LIBRARY_BUILD_DIR="${AAX_SDK_PATH}/Libs/AAXLibrary/build"
    
    # Clean existing build
    if [[ -d "${AAX_LIBRARY_BUILD_DIR}" ]]; then
        echo "  Cleaning existing AAX Library build..." 
        rm -rf "${AAX_LIBRARY_BUILD_DIR}"
    fi
    
    mkdir -p "${AAX_LIBRARY_BUILD_DIR}"
    cd "${AAX_LIBRARY_BUILD_DIR}"
    
    # Directory for Universal Binary
    AAX_LIB_DIR="${AAX_SDK_PATH}/Libs/x86_64_arm64/Release"
    
    echo "  Configuring AAX Library with CMake (Universal Binary)..."
    cmake .. -G Xcode \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_OSX_ARCHITECTURES="x86_64;arm64"
    if [[ $? -ne 0 ]]; then
        echo_error "Failed to configure AAX Library"
        exit 1
    fi
    
    echo "  Building AAX Library (Release, Universal Binary)..."
    cmake --build . --config Release -- -parallelizeTargets
    if [[ $? -ne 0 ]]; then
        echo_error "Failed to build AAX Library"
        exit 1
    fi
    
    # Copy library to expected location
    BUILT_LIB="${AAX_LIBRARY_BUILD_DIR}/Release/libAAXLibrary.a"
    if [[ -f "${BUILT_LIB}" ]]; then
        mkdir -p "${AAX_LIB_DIR}"
        cp "${BUILT_LIB}" "${AAX_LIB_DIR}/"
        
        # Verify Universal Binary
        echo "  Checking architecture of built library..."
        lipo -info "${AAX_LIB_DIR}/libAAXLibrary.a"
        
        echo_success "AAX Library build completed (Universal Binary)"
    else
        echo_error "AAX Library build output not found"
        exit 1
    fi
    
    cd "${ROOT_DIR}"
else
    echo -e "${color_yellow}AAX SDK not found: ${AAX_SDK_PATH} - AAX will be skipped${color_reset}"
    BUILD_AAX=0
fi

echo_step "Creating output directories..."
mkdir -p "${OUTPUT_DIR}"
echo_success "Output directories created"

#============================================
# Step 1: WebUI を本番ビルド
#============================================
echo_header "Step 1: Building WebUI for production"

if [[ "${SKIP_WEBUI:-0}" != "1" ]]; then
    if [[ ! -d "${WEBUI_DIR}" ]]; then
        echo_error "WebUI directory not found: ${WEBUI_DIR}"
        exit 1
    fi

    # Remove previous build artifacts
    UI_PUBLIC_DIR="${ROOT_DIR}/plugin/ui/public"
    if [[ -d "${UI_PUBLIC_DIR}" ]]; then
        echo_step "Removing previous WebUI output..."
        rm -rf "${UI_PUBLIC_DIR}"
        echo_success "Cleanup completed"
    fi

    pushd "${WEBUI_DIR}" >/dev/null

    # Install dependencies (first time only)
    if [[ ! -d node_modules ]]; then
        echo_step "Installing npm dependencies..."
        npm install --no-audit --no-fund
    fi

    # Build
    echo_step "Building WebUI..."
    npm run build
    echo_success "WebUI build completed"

    popd >/dev/null

    if [[ ! -f "${ROOT_DIR}/plugin/ui/public/index.html" ]]; then
        echo_error "WebUI build output not found (plugin/ui/public/index.html)"
        exit 1
    fi
else
    echo_step "Skipping WebUI build due to SKIP_WEBUI=1"
fi

echo -e "${color_gray}Output: ${ROOT_DIR}/plugin/ui/public${color_reset}"

#============================================
# Step 2: CMake (Xcode) で VST3/AU/Standalone (+ AAX) をビルド
#============================================
if [[ ${BUILD_AAX} -eq 1 ]]; then
    echo_header "Step 2: Building Plugins (VST3/AU/Standalone/AAX)"
else
    echo_header "Step 2: Building Plugins (VST3/AU/Standalone)"
fi

# Clean existing artifacts (detect permission issues early)
EXISTING_ARTIFACTS_DIR="${BUILD_DIR}/plugin/ZeroComp_artefacts/${CONFIGURATION}"
if [[ -d "${EXISTING_ARTIFACTS_DIR}" ]]; then
    echo_step "Removing existing plugin artifacts..."
    if rm -rf "${EXISTING_ARTIFACTS_DIR}"; then
        echo_success "Old artifacts removed"
    else
        echo_error "Failed to remove old artifacts. Please check ownership and permissions."
        exit 1
    fi
fi

# CMake configuration (Universal Binary)
echo_step "CMake configuration (${CONFIGURATION}, Universal Binary)..."
cmake -S "${ROOT_DIR}" -B "${BUILD_DIR}" \
    -G Xcode \
    -DCMAKE_BUILD_TYPE="${CONFIGURATION}" \
    -DCMAKE_OSX_ARCHITECTURES="x86_64;arm64"

echo_step "Executing build..."
if [[ ${BUILD_AAX} -eq 1 ]]; then
    cmake --build "${BUILD_DIR}" --config "${CONFIGURATION}" --target ZeroComp_VST3 ZeroComp_AU ZeroComp_Standalone ZeroComp_AAX
else
    cmake --build "${BUILD_DIR}" --config "${CONFIGURATION}" --target ZeroComp_VST3 ZeroComp_AU ZeroComp_Standalone
fi
echo_success "Plugin build completed"

# Artifact paths
ARTIFACTS_DIR="${BUILD_DIR}/plugin/ZeroComp_artefacts/${CONFIGURATION}"

# Verify Universal Binary
echo_step "Checking architecture of built plugins..."
if [[ -f "${ARTIFACTS_DIR}/VST3/ZeroComp.vst3/Contents/MacOS/ZeroComp" ]]; then
    echo "  VST3:"
    lipo -info "${ARTIFACTS_DIR}/VST3/ZeroComp.vst3/Contents/MacOS/ZeroComp"
fi
if [[ -f "${ARTIFACTS_DIR}/AU/ZeroComp.component/Contents/MacOS/ZeroComp" ]]; then
    echo "  AU:"
    lipo -info "${ARTIFACTS_DIR}/AU/ZeroComp.component/Contents/MacOS/ZeroComp"
fi
if [[ -f "${ARTIFACTS_DIR}/Standalone/ZeroComp.app/Contents/MacOS/ZeroComp" ]]; then
    echo "  Standalone:"
    lipo -info "${ARTIFACTS_DIR}/Standalone/ZeroComp.app/Contents/MacOS/ZeroComp"
fi
if [[ ${BUILD_AAX} -eq 1 ]] && [[ -f "${ARTIFACTS_DIR}/AAX/ZeroComp.aaxplugin/Contents/MacOS/ZeroComp" ]]; then
    echo "  AAX:"
    lipo -info "${ARTIFACTS_DIR}/AAX/ZeroComp.aaxplugin/Contents/MacOS/ZeroComp"
fi
echo_success "Architecture verification completed"
SRC_VST3="${ARTIFACTS_DIR}/VST3/ZeroComp.vst3"
SRC_AU="${ARTIFACTS_DIR}/AU/ZeroComp.component"
SRC_APP="${ARTIFACTS_DIR}/Standalone/ZeroComp.app"

if [[ ! -d "${SRC_VST3}" ]]; then echo_error "VST3 not found: ${SRC_VST3}"; exit 1; fi
if [[ ! -d "${SRC_AU}" ]]; then echo_error "AU not found: ${SRC_AU}"; exit 1; fi
if [[ ! -d "${SRC_APP}" ]]; then echo_error "Standalone not found: ${SRC_APP}"; exit 1; fi

# AAX check
if [[ ${BUILD_AAX} -eq 1 ]]; then
    SRC_AAX="${ARTIFACTS_DIR}/AAX/ZeroComp.aaxplugin"
    if [[ ! -d "${SRC_AAX}" ]]; then echo_error "AAX not found: ${SRC_AAX}"; exit 1; fi
fi

echo_step "Collecting artifacts..."
DEST_VST3="${OUTPUT_DIR}/ZeroComp.vst3"
DEST_AU="${OUTPUT_DIR}/ZeroComp.component"
DEST_APP="${OUTPUT_DIR}/ZeroComp.app"

rm -rf "${DEST_VST3}" "${DEST_AU}" "${DEST_APP}"
cp -R "${SRC_VST3}" "${DEST_VST3}"
cp -R "${SRC_AU}" "${DEST_AU}"
cp -R "${SRC_APP}" "${DEST_APP}"

if [[ ${BUILD_AAX} -eq 1 ]]; then
    DEST_AAX="${OUTPUT_DIR}/ZeroComp.aaxplugin"
    rm -rf "${DEST_AAX}"
    cp -R "${SRC_AAX}" "${DEST_AAX}"
fi

echo_success "Artifacts copied successfully"

#============================================
# Step 3: コード署名（Hardened Runtime）
#============================================
echo_header "Step 3: Code Signing"

# Auto-detect CODESIGN_IDENTITY if not set (Developer ID Application priority, filter by CODESIGN_TEAM_ID)
if [[ -z "${CODESIGN_IDENTITY:-}" ]]; then
    echo_step "CODESIGN_IDENTITY not set, attempting auto-detection..."
    if [[ -n "${CODESIGN_TEAM_ID:-}" ]]; then
        CODESIGN_IDENTITY=$(security find-identity -v -p codesigning 2>/dev/null | awk -v team="${CODESIGN_TEAM_ID}" -F '"' '/Developer ID Application:/ && $0 ~ team {print $2; exit}') || true
    fi
    if [[ -z "${CODESIGN_IDENTITY:-}" ]]; then
        CODESIGN_IDENTITY=$(security find-identity -v -p codesigning 2>/dev/null | awk -F '"' '/Developer ID Application:/ {print $2; exit}') || true
    fi
    if [[ -n "${CODESIGN_IDENTITY:-}" ]]; then
        echo_success "Auto-selected signing ID: ${CODESIGN_IDENTITY}"
    else
        echo_error "CODESIGN_IDENTITY is not set. Example: \"Developer ID Application: Your Name (TEAMID)\""
        echo -e "${color_gray}Available signing IDs:${color_reset}"
        security find-identity -v -p codesigning || true
        exit 1
    fi
fi

sign_bundle() {
    local bundle_path="$1"
    local entitlements_args=()
    local deep_args=()

    # Apply Hardened Runtime (--options runtime). Add entitlements if needed.
    if [[ -n "${ENTITLEMENTS_PATH:-}" && -f "${ENTITLEMENTS_PATH}" ]]; then
        entitlements_args=(--entitlements "${ENTITLEMENTS_PATH}")
    fi
    if [[ "${CODESIGN_DEEP:-0}" == "1" ]]; then
        deep_args=(--deep)
    fi

    # Sign the executable inside the bundle first (if it exists)
    local main_binary="${bundle_path}/Contents/MacOS/$(basename "${bundle_path}" .app | sed 's/\\.vst3$//' | sed 's/\\.component$//')"
    if [[ -f "${main_binary}" ]]; then
        codesign --force --timestamp --options runtime "${entitlements_args[@]}" "${deep_args[@]}" --sign "${CODESIGN_IDENTITY}" "${main_binary}"
    fi

    # Sign the bundle
    codesign --force --timestamp --options runtime "${entitlements_args[@]}" "${deep_args[@]}" --sign "${CODESIGN_IDENTITY}" "${bundle_path}"

    # Verify (deep/strict)
    codesign --verify --deep --strict --verbose=2 "${bundle_path}"
}

echo_step "Signing VST3..."
sign_bundle "${DEST_VST3}"
echo_success "VST3 signing OK"

echo_step "Signing AU..."
sign_bundle "${DEST_AU}"
echo_success "AU signing OK"

echo_step "Signing Standalone..."
sign_bundle "${DEST_APP}"
echo_success "Standalone signing OK"

if [[ ${BUILD_AAX} -eq 1 ]]; then
    echo_step "Signing AAX..."
    sign_bundle "${DEST_AAX}"
    echo_success "AAX signing OK (unsigned developer build)"
fi

#============================================
# Step 3.5: AAX PACE 署名（wraptool sign, 任意）
#============================================
if [[ ${BUILD_AAX} -eq 1 ]]; then
    echo_header "Step 3.5: PACE Eden 署名 (AAX macOS)"

    # PACE アカウント情報と WCGUID は .env (または環境変数) から取得。
    # Windows 側 build_windows.ps1 と揃えた変数名セット:
    #   PACE_USERNAME     : iLok アカウント名
    #   PACE_PASSWORD     : iLok パスワード
    #   PACE_ORGANIZATION : PACE Central Web で発行された WCGUID (プラグインごとに固有)
    # 旧スクリプト互換のため PACE_WCGUID が設定されていて PACE_ORGANIZATION が未設定なら
    # それを採用する。
    PACE_ORGANIZATION_EFFECTIVE="${PACE_ORGANIZATION:-${PACE_WCGUID:-}}"

    # Guess wraptool location (can be overridden)
    WRAPTOOL_PATH_CANDIDATES=()
    if [[ -n "${WRAPTOOL_PATH:-}" ]]; then
        WRAPTOOL_PATH_CANDIDATES+=("${WRAPTOOL_PATH}")
    fi
    WRAPTOOL_PATH_CANDIDATES+=(
        "/Applications/PACEAntiPiracy/Eden/Fusion/Versions/5/bin/wraptool"
        "/Applications/PACE Anti-Piracy/Eden/Fusion/Versions/5/bin/wraptool"
        "/Applications/PACEAntiPiracy/Eden/Fusion/Versions/5/wraptool"
        "/Applications/PACE Anti-Piracy/Eden/Fusion/Versions/5/wraptool"
        "/usr/local/bin/wraptool"
        "/opt/local/bin/wraptool"
    )

    FOUND_WRAPTOOL=""
    for p in "${WRAPTOOL_PATH_CANDIDATES[@]}"; do
        if [[ -x "$p" ]]; then
            FOUND_WRAPTOOL="$p"
            break
        fi
    done

    # 必須環境変数チェック（Windows 側と同じセット）
    MISSING_PACE_VARS=()
    [[ -z "${PACE_USERNAME:-}" ]]              && MISSING_PACE_VARS+=("PACE_USERNAME")
    [[ -z "${PACE_PASSWORD:-}" ]]              && MISSING_PACE_VARS+=("PACE_PASSWORD")
    [[ -z "${PACE_ORGANIZATION_EFFECTIVE}" ]]  && MISSING_PACE_VARS+=("PACE_ORGANIZATION")

    if [[ -z "${FOUND_WRAPTOOL}" ]]; then
        echo -e "${color_yellow}wraptool not found. Skipping AAX PACE signing.${color_reset}"
        echo -e "${color_gray}Please set WRAPTOOL_PATH environment variable.${color_reset}"
    elif (( ${#MISSING_PACE_VARS[@]} > 0 )); then
        echo -e "${color_yellow}Missing PACE credentials: ${MISSING_PACE_VARS[*]}. Skipping AAX PACE signing.${color_reset}"
        echo -e "${color_gray}Set them in .env (project root) or export them in your shell.${color_reset}"
    else
        echo_step "Using wraptool to apply iLok signing to AAX..."

        # Build signing arguments
        WRAP_ARGS=(
            sign
            --verbose
            --account "${PACE_USERNAME}"
            --password "${PACE_PASSWORD}"
            --wcguid "${PACE_ORGANIZATION_EFFECTIVE}"
            --signid "${CODESIGN_IDENTITY}"
            --dsigharden
            --dsig1-compat on
            --in "${DEST_AAX}"
            --out "${DEST_AAX}"
        )

        # パスワードをログに出さないよう、コマンドダンプは抑制する
        echo -e "${color_gray}wraptool command: ${FOUND_WRAPTOOL} sign --verbose --account ${PACE_USERNAME} --password *** --wcguid ${PACE_ORGANIZATION_EFFECTIVE} --signid ${CODESIGN_IDENTITY} --dsigharden --dsig1-compat on --in ${DEST_AAX} --out ${DEST_AAX}${color_reset}"
        if ! "${FOUND_WRAPTOOL}" "${WRAP_ARGS[@]}"; then
            echo -e "${color_yellow}Warning: AAX PACE signing failed (continuing with unsigned version).${color_reset}"
        else
            echo_success "AAX PACE signing completed"
        fi
    fi
fi

#============================================
# Step 4: ドキュメントとバージョン情報の生成
#============================================
echo_header "Step 4: Creating documentation and version info"

# Architecture detection (from VST3 executable)
ARCH="universal"  # Built as Universal Binary
if [[ -f "${DEST_VST3}/Contents/MacOS/ZeroComp" ]]; then
    INFO="$(lipo -info "${DEST_VST3}/Contents/MacOS/ZeroComp" 2>/dev/null || true)"
    if echo "$INFO" | grep -q "x86_64" && echo "$INFO" | grep -q "arm64"; then
        ARCH="universal"
        echo "  Verified: Universal Binary (x86_64 + arm64) confirmed"
    elif echo "$INFO" | grep -q "arm64"; then
        ARCH="arm64"
    elif echo "$INFO" | grep -q "x86_64"; then
        ARCH="x86_64"
    fi
fi


# 英語README（Windows版と同じ体裁）
AAX_SECTION_EN=""
if [[ ${BUILD_AAX} -eq 1 ]]; then
    AAX_SECTION_EN="4. For AAX Plugin (Pro Tools):
   Copy the entire ZeroComp.aaxplugin folder to the following location:
   /Library/Application Support/Avid/Audio/Plug-Ins/

Note about AAX Plugin:
- This is an unsigned developer build
- It will not work in regular Pro Tools
- Pro Tools Developer Edition is required (free, requires Avid account):
  https://developer.avid.com

"
fi

cat > "${OUTPUT_DIR}/ReadMe.txt" <<EOF
ZeroComp ${VERSION} - macOS Installation Guide
====================================================

Installation Steps
-------------------
1. Close your DAW before proceeding.

2. For VST3 Plugin:
   Copy the entire ZeroComp.vst3 folder to the following location:
   ~/Library/Audio/Plug-Ins/VST3/

3. For Audio Unit (AU):
   Copy the entire ZeroComp.component folder to the following location:
   ~/Library/Audio/Plug-Ins/Components/

4. For Standalone Application:
   Copy ZeroComp.app to any preferred location, for example:
   /Applications/ or your Desktop.

${AAX_SECTION_EN}5. If macOS shows security warnings:
   Right-click the plugin and select "Open"
   Or go to System Preferences > Security & Privacy > General
   and click "Open Anyway"

6. Launch your DAW and rescan for plugins.
EOF

# フォーマットリストを構築
if [[ ${BUILD_AAX} -eq 1 ]]; then
    FORMATS='["VST3", "AU", "Standalone", "AAX"]'
    AAX_SIGNING='"unsigned_developer"'
else
    FORMATS='["VST3", "AU", "Standalone"]'
    AAX_SIGNING='"N/A"'
fi

cat > "${OUTPUT_DIR}/version.json" <<VERSION_JSON
{
  "name": "ZeroComp",
  "version": "${VERSION}",
  "build_date": "${BUILD_DATE}",
  "platform": "macOS",
  "architecture": "${ARCH}",
  "formats": ${FORMATS},
  "webui": "embedded",
  "build_type": "${CONFIGURATION}",
  "aax_signing": ${AAX_SIGNING}
}
VERSION_JSON

echo_success "ReadMe.txt and version.json created"

#============================================
# Step 5: コンポーネント PKG 生成（VST3/AU/AAX/Standalone）
#============================================
echo_header "Step 5: Creating component PKGs"

PKG_WORK_DIR="${OUTPUT_DIR}/pkgwork"
mkdir -p "${PKG_WORK_DIR}"

# Base ID (can be overridden by environment variable)
PKG_ID_BASE="${PKG_ID_BASE:-com.bucketrelay.zerocomp}"

# VST3
echo_step "Creating VST3 component PKG..."
PKGROOT_VST3="${PKG_WORK_DIR}/root_vst3"
rm -rf "${PKGROOT_VST3}" && mkdir -p "${PKGROOT_VST3}/Library/Audio/Plug-Ins/VST3"
cp -R "${DEST_VST3}" "${PKGROOT_VST3}/Library/Audio/Plug-Ins/VST3/"
PKG_VST3="${PKG_WORK_DIR}/ZeroComp_VST3.pkg"
pkgbuild \
    --root "${PKGROOT_VST3}" \
    --identifier "${PKG_ID_BASE}.vst3" \
    --version "${VERSION}" \
    --install-location "/" \
    --ownership recommended \
    "${PKG_VST3}"
echo_success "VST3 PKG creation completed"

# AU
echo_step "Creating AU component PKG..."
PKGROOT_AU="${PKG_WORK_DIR}/root_au"
rm -rf "${PKGROOT_AU}" && mkdir -p "${PKGROOT_AU}/Library/Audio/Plug-Ins/Components"
cp -R "${DEST_AU}" "${PKGROOT_AU}/Library/Audio/Plug-Ins/Components/"
PKG_AU="${PKG_WORK_DIR}/ZeroComp_AU.pkg"
pkgbuild \
    --root "${PKGROOT_AU}" \
    --identifier "${PKG_ID_BASE}.au" \
    --version "${VERSION}" \
    --install-location "/" \
    --ownership recommended \
    "${PKG_AU}"
echo_success "AU PKG creation completed"

# Standalone (using --component, /Applications as default. Supports installer location changes)
echo_step "Creating Standalone component PKG..."
PKG_APP="${PKG_WORK_DIR}/ZeroComp_Standalone.pkg"
pkgbuild \
    --component "${DEST_APP}" \
    --identifier "${PKG_ID_BASE}.app" \
    --version "${VERSION}" \
    --install-location "/Applications" \
    "${PKG_APP}"
echo_success "Standalone PKG creation completed"

# AAX (only if exists)
PKG_AAX=""
if [[ ${BUILD_AAX} -eq 1 ]]; then
    echo_step "Creating AAX component PKG..."
    PKGROOT_AAX="${PKG_WORK_DIR}/root_aax"
    rm -rf "${PKGROOT_AAX}" && mkdir -p "${PKGROOT_AAX}/Library/Application Support/Avid/Audio/Plug-Ins"
    cp -R "${DEST_AAX}" "${PKGROOT_AAX}/Library/Application Support/Avid/Audio/Plug-Ins/"
    PKG_AAX="${PKG_WORK_DIR}/ZeroComp_AAX.pkg"
    pkgbuild \
        --root "${PKGROOT_AAX}" \
        --identifier "${PKG_ID_BASE}.aax" \
        --version "${VERSION}" \
        --install-location "/" \
        --ownership recommended \
        "${PKG_AAX}"
    echo_success "AAX PKG creation completed"
fi

#============================================
# Step 6: Distribution を組み立て、製品 PKG を署名
#============================================
echo_header "Step 6: Building signed product PKG"

DIST_XML="${PKG_WORK_DIR}/Distribution.xml"
RESOURCES_DIR="${PKG_WORK_DIR}/resources"
# LICENSE をリソースに同梱（存在すれば）
mkdir -p "${RESOURCES_DIR}"
if [[ -f "${ROOT_DIR}/LICENSE" ]]; then
    cp "${ROOT_DIR}/LICENSE" "${RESOURCES_DIR}/LICENSE.txt"
    LICENSE_ENTRY="  <license file=\"LICENSE.txt\"/>"
else
    LICENSE_ENTRY=""
fi
{
    echo "<?xml version=\"1.0\" encoding=\"utf-8\"?>"
    echo "<installer-gui-script minSpecVersion=\"1\">"
    echo "  <title>ZeroComp ${VERSION}</title>"
    # カスタムインストールパネルをデフォルト表示
    echo "  <options customize=\"always\" allow-external-scripts=\"no\"/>"
    # ドメイン選択（自分のみ/このMacのすべてのユーザ）を有効化
    echo "  <domains enable_currentUserHome=\"true\" enable_localSystem=\"true\"/>"
    # ライセンス表示（存在時のみ）
    if [[ -n \"${LICENSE_ENTRY}\" ]]; then
        echo "${LICENSE_ENTRY}"
    fi
    echo "  <choices-outline>"
    echo "    <line choice=\"choice_vst3\"/>"
    echo "    <line choice=\"choice_au\"/>"
    echo "    <line choice=\"choice_app\"/>"
    if [[ ${BUILD_AAX} -eq 1 ]]; then
        echo "    <line choice=\"choice_aax\"/>"
    fi
    echo "  </choices-outline>"
    echo "  <choice id=\"choice_vst3\" title=\"VST3 Plugin\" enabled=\"true\" selected=\"true\">"
    echo "    <pkg-ref id=\"${PKG_ID_BASE}.vst3\"/>"
    echo "  </choice>"
    echo "  <choice id=\"choice_au\" title=\"Audio Unit (AU)\" enabled=\"true\" selected=\"true\">"
    echo "    <pkg-ref id=\"${PKG_ID_BASE}.au\"/>"
    echo "  </choice>"
    echo "  <choice id=\"choice_app\" title=\"Standalone Application\" enabled=\"true\" selected=\"true\">"
    echo "    <pkg-ref id=\"${PKG_ID_BASE}.app\"/>"
    echo "  </choice>"
    if [[ ${BUILD_AAX} -eq 1 ]]; then
        echo "  <choice id=\"choice_aax\" title=\"AAX (Pro Tools)\" enabled=\"true\" selected=\"true\">"
        echo "    <pkg-ref id=\"${PKG_ID_BASE}.aax\"/>"
        echo "  </choice>"
    fi
    echo "  <pkg-ref id=\"${PKG_ID_BASE}.vst3\">ZeroComp_VST3.pkg</pkg-ref>"
    echo "  <pkg-ref id=\"${PKG_ID_BASE}.au\">ZeroComp_AU.pkg</pkg-ref>"
    echo "  <pkg-ref id=\"${PKG_ID_BASE}.app\">ZeroComp_Standalone.pkg</pkg-ref>"
    if [[ ${BUILD_AAX} -eq 1 ]]; then
        echo "  <pkg-ref id=\"${PKG_ID_BASE}.aax\">ZeroComp_AAX.pkg</pkg-ref>"
    fi
    echo "</installer-gui-script>"
} > "${DIST_XML}"

# Auto-detect Developer ID Installer certificate (if not specified)
if [[ -z "${INSTALLER_IDENTITY:-}" ]]; then
    echo_step "INSTALLER_IDENTITY not set, attempting auto-detection..."
    # Current environment doesn't support -p installer, so filter from all identities
    INSTALLER_IDENTITY=$(security find-identity -v 2>/dev/null | awk -F '"' '/Developer ID Installer:/ {print $2; exit}') || true
    # If still not found, also show codesigning policy output for reference
    if [[ -n "${INSTALLER_IDENTITY:-}" ]]; then
        echo_success "Auto-selected installer signing ID: ${INSTALLER_IDENTITY}"
    else
        echo_error "Developer ID Installer certificate not found. Please set INSTALLER_IDENTITY environment variable."
        echo "  --- security find-identity -v (all) ---"
        security find-identity -v || true
        echo "  --- security find-identity -v -p codesigning (reference) ---"
        security find-identity -v -p codesigning || true
        echo "  Hint: Make sure the certificate and private key pair is in the 'login' keychain and unlocked."
        exit 1
    fi
fi

PRODUCT_PKG_PATH="${OUTPUT_DIR}/../ZeroComp_${VERSION}_macOS.pkg"
echo_step "Creating product PKG with productbuild..."
productbuild \
    --distribution "${DIST_XML}" \
    --package-path "${PKG_WORK_DIR}" \
    --resources "${RESOURCES_DIR}" \
    --sign "${INSTALLER_IDENTITY}" \
    "${PRODUCT_PKG_PATH}"
echo_success "Product PKG creation and signing completed: ${PRODUCT_PKG_PATH}"

#============================================
# Step 7: PKG をノータライズ → ステープル
#============================================
echo_header "Step 7: Notarization and Stapling for PKG"

API_KEY_ID_EFFECTIVE="${APPLE_API_KEY_ID:-}"
if [[ -z "${API_KEY_ID_EFFECTIVE}" && -n "${APPLE_API_KEY:-}" ]]; then
    API_KEY_ID_EFFECTIVE="${APPLE_API_KEY}"
fi

if [[ -n "${APPLE_API_KEY_PATH:-}" && -n "${API_KEY_ID_EFFECTIVE}" && -n "${APPLE_API_ISSUER:-}" ]]; then
    echo_step "Submitting to notarytool (App Store Connect API key)..."
    xcrun notarytool submit "${PRODUCT_PKG_PATH}" \
        --key "${APPLE_API_KEY_PATH}" \
        --key-id "${API_KEY_ID_EFFECTIVE}" \
        --issuer "${APPLE_API_ISSUER}" \
        --wait
elif [[ -n "${NOTARYTOOL_PROFILE:-}" ]]; then
    echo_step "Submitting to notarytool (profile: ${NOTARYTOOL_PROFILE})..."
    xcrun notarytool submit "${PRODUCT_PKG_PATH}" --keychain-profile "${NOTARYTOOL_PROFILE}" --wait
elif [[ -n "${APPLE_ID:-}" && -n "${APP_PASSWORD:-}" && -n "${TEAM_ID:-}" ]]; then
    echo_step "Submitting to notarytool (Apple ID direct)..."
    xcrun notarytool submit "${PRODUCT_PKG_PATH}" --apple-id "${APPLE_ID}" --password "${APP_PASSWORD}" --team-id "${TEAM_ID}" --wait
else
    echo_error "Notarization credentials not set. Please set API key (APPLE_API_KEY_PATH/ID/ISSUER) or NOTARYTOOL_PROFILE or APPLE_ID/APP_PASSWORD/TEAM_ID."
    exit 1
fi

echo_success "PKG notarization completed"

echo_step "Stapling PKG..."
xcrun stapler staple "${PRODUCT_PKG_PATH}"
echo_success "PKG stapling completed"

#============================================
# Step 8: 互換用 ZIP の作成（オプション）
#============================================
echo_header "Step 8: Creating ZIP (optional)"

if [[ ${BUILD_AAX} -eq 1 ]]; then
    ZIP_NAME="ZeroComp_${VERSION}_macOS_VST3_AU_AAX_Standalone.zip"
else
    ZIP_NAME="ZeroComp_${VERSION}_macOS_VST3_AU_Standalone.zip"
fi
ZIP_PATH="${OUTPUT_DIR}/../${ZIP_NAME}"

echo_step "Creating ZIP..."
(
    cd "${OUTPUT_DIR}"
    rm -f "${ZIP_PATH}"
    if [[ ${BUILD_AAX} -eq 1 ]]; then
        /usr/bin/zip -r -y "${ZIP_PATH}" \
            "$(basename "${DEST_VST3}")" \
            "$(basename "${DEST_AU}")" \
            "$(basename "${DEST_APP}")" \
            "$(basename "${DEST_AAX}")" \
            ReadMe.txt version.json >/dev/null
    else
        /usr/bin/zip -r -y "${ZIP_PATH}" \
            "$(basename "${DEST_VST3}")" \
            "$(basename "${DEST_AU}")" \
            "$(basename "${DEST_APP}")" \
            ReadMe.txt version.json >/dev/null
    fi
)
echo_success "ZIP creation completed: ${ZIP_PATH}"

# 最終サマリー
PRODUCT_SIZE_MB=$(python3 -c 'import os,sys;print(round(os.path.getsize(sys.argv[1])/1024/1024,2))' "${PRODUCT_PKG_PATH}") || PRODUCT_SIZE_MB="-"
ZIP_SIZE_MB=$(python3 -c 'import os,sys;print(round(os.path.getsize(sys.argv[1])/1024/1024,2))' "${ZIP_PATH}") || ZIP_SIZE_MB="-"

echo_header "Build completed successfully!"
echo -e "PKG: ${PRODUCT_PKG_PATH} (${PRODUCT_SIZE_MB} MB)"
echo -e "ZIP: ${ZIP_PATH} (${ZIP_SIZE_MB} MB)"
echo ""
echo -e "${color_cyan}The package includes (component choices):${color_reset}"
echo -e "${color_green}[✓] VST3 (固定先: /Library/Audio/Plug-Ins/VST3)${color_reset}"
echo -e "${color_green}[✓] AU (固定先: /Library/Audio/Plug-Ins/Components)${color_reset}"
echo -e "${color_green}[✓] Standalone (既定: /Applications、場所変更可)${color_reset}"
if [[ ${BUILD_AAX} -eq 1 ]]; then
    echo -e "${color_green}[✓] AAX (固定先: /Library/Application Support/Avid/Audio/Plug-Ins)${color_reset}"
fi
echo -e "${color_green}[✓] Installer signed (Developer ID Installer)${color_reset}"
echo -e "${color_green}[✓] Notarized and stapled (PKG)${color_reset}"
echo -e "${color_green}[✓] Bundles code-signed (Hardened Runtime)${color_reset}"
if [[ ${BUILD_AAX} -eq 1 ]]; then
    echo -e "${color_green}[✓] AAX PACE signed (if wraptool available)${color_reset}"
fi
echo -e "${color_yellow}[ ] Upload to distribution platform${color_reset}"
echo -e "${color_yellow}[ ] Share with beta testers${color_reset}"

exit 0
