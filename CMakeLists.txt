# ZeroComp - ゼロレイテンシー・ブロードキャスト用リミッター
# JUCE + WebView（Vite/React/MUI）構成

cmake_minimum_required(VERSION 3.22)

# macOS の最小対応バージョンを明示
if(APPLE)
    set(ZEROCOMP_MIN_MACOS "10.15")
    if(NOT CMAKE_OSX_DEPLOYMENT_TARGET)
        set(CMAKE_OSX_DEPLOYMENT_TARGET "${ZEROCOMP_MIN_MACOS}" CACHE STRING "Minimum supported macOS version" FORCE)
    elseif(CMAKE_OSX_DEPLOYMENT_TARGET VERSION_GREATER ZEROCOMP_MIN_MACOS)
        message(STATUS "Overriding CMAKE_OSX_DEPLOYMENT_TARGET (${CMAKE_OSX_DEPLOYMENT_TARGET}) -> ${ZEROCOMP_MIN_MACOS}")
        set(CMAKE_OSX_DEPLOYMENT_TARGET "${ZEROCOMP_MIN_MACOS}" CACHE STRING "Minimum supported macOS version" FORCE)
    endif()
    message(STATUS "macOS deployment target: ${CMAKE_OSX_DEPLOYMENT_TARGET}")
endif()

# バージョン情報を読み込む
include(${CMAKE_SOURCE_DIR}/cmake/Version.cmake)

# プロジェクト定義
project(ZeroComp VERSION ${PROJECT_VERSION})

# C++17標準を使用
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# JUCEをサブモジュールから追加
add_subdirectory(JUCE)

# AAX SDK の設定（存在する場合のみ有効）
set(AAX_SDK_PATH "${CMAKE_SOURCE_DIR}/aax-sdk" CACHE PATH "Path to AAX SDK")
if(EXISTS "${AAX_SDK_PATH}/Interfaces/AAX.h")
    message(STATUS "AAX SDK found at: ${AAX_SDK_PATH}")
    juce_set_aax_sdk_path("${AAX_SDK_PATH}")

    if(WIN32)
        if(CMAKE_SIZEOF_VOID_P EQUAL 8)
            set(AAX_LIBRARY_PATH "${AAX_SDK_PATH}/Libs/Release/AAXLibrary.lib")
        else()
            set(AAX_LIBRARY_PATH "${AAX_SDK_PATH}/Libs/Release/AAXLibrary_x86.lib")
        endif()
    elseif(APPLE)
        if(CMAKE_OSX_ARCHITECTURES STREQUAL "arm64")
            set(AAX_LIBRARY_PATH "${AAX_SDK_PATH}/Libs/arm64/Release/libAAXLibrary.a")
        elseif(CMAKE_OSX_ARCHITECTURES STREQUAL "x86_64")
            set(AAX_LIBRARY_PATH "${AAX_SDK_PATH}/Libs/x86_64/Release/libAAXLibrary.a")
        else()
            set(AAX_LIBRARY_PATH "${AAX_SDK_PATH}/Libs/x86_64_arm64/Release/libAAXLibrary.a")
            if(NOT EXISTS "${AAX_LIBRARY_PATH}")
                if(CMAKE_HOST_SYSTEM_PROCESSOR STREQUAL "arm64")
                    set(AAX_LIBRARY_PATH "${AAX_SDK_PATH}/Libs/arm64/Release/libAAXLibrary.a")
                else()
                    set(AAX_LIBRARY_PATH "${AAX_SDK_PATH}/Libs/x86_64/Release/libAAXLibrary.a")
                endif()
            endif()
        endif()
    endif()

    if(EXISTS "${AAX_LIBRARY_PATH}")
        message(STATUS "AAX Library found at: ${AAX_LIBRARY_PATH}")
        set(BUILD_AAX ON)
    else()
        message(WARNING "AAX Library not found at: ${AAX_LIBRARY_PATH} - AAX format will be disabled")
        set(BUILD_AAX OFF)
    endif()
else()
    message(STATUS "AAX SDK not found at: ${AAX_SDK_PATH} - AAX format will be disabled")
    set(BUILD_AAX OFF)
endif()

# 共有設定: 子ディレクトリへ渡すソースルート
set(ZEROCOMP_SRC_DIR "${CMAKE_SOURCE_DIR}/plugin/src")

# プラグイン定義は plugin/CMakeLists.txt に分離
add_subdirectory(plugin)

# カスタムターゲット: WebUIのビルド
add_custom_target(webui_build
    COMMAND npm run build
    WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}/webui
    COMMENT "Building WebUI with Vite..."
)

add_custom_target(webui_dev
    COMMAND npm run dev
    WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}/webui
    COMMENT "Starting WebUI development server..."
)

add_custom_target(webui_install
    COMMAND npm install
    WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}/webui
    COMMENT "Installing WebUI dependencies..."
)

# WebView2 静的リンク切替オプション（既定: ON = 静的リンク）
option(ZEROCOMP_WEBVIEW2_STATIC_LINKING "Link WebView2 statically on Windows" ON)

if(WIN32)
    message(STATUS "Configuring WebView2 for Windows...")
    if(ZEROCOMP_WEBVIEW2_STATIC_LINKING)
        message(STATUS "  WebView2: Static linking enabled")
    else()
        message(STATUS "  WebView2: Dynamic linking enabled")
    endif()
endif()

message(STATUS "")
message(STATUS "ZeroComp Configuration:")
message(STATUS "  Version: ${PROJECT_VERSION}")
message(STATUS "  Build Type: ${CMAKE_BUILD_TYPE}")
message(STATUS "  C++ Standard: ${CMAKE_CXX_STANDARD}")
message(STATUS "  Source Directory: ${CMAKE_SOURCE_DIR}")
message(STATUS "  Binary Directory: ${CMAKE_BINARY_DIR}")
if(BUILD_AAX)
    message(STATUS "  AAX SDK: ${AAX_SDK_PATH}")
    message(STATUS "  AAX Build: Enabled")
else()
    message(STATUS "  AAX Build: Disabled (AAX SDK not found)")
endif()
message(STATUS "")
message(STATUS "Available targets:")
message(STATUS "  ZeroComp          - Build the main plugin")
message(STATUS "  webui_install      - Install WebUI dependencies")
message(STATUS "  webui_dev          - Start WebUI development server")
message(STATUS "  webui_build        - Build WebUI for production")
message(STATUS "")
