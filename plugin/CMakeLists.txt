# ZeroComp プラグイン専用の CMake 設定
# - ここではプラグイン固有のターゲット定義・依存・定義のみを扱います
# - 共有のオプションや WebUI の補助ターゲットはルート側に置きます

if(NOT DEFINED ZEROCOMP_SRC_DIR)
    set(ZEROCOMP_SRC_DIR "${CMAKE_CURRENT_SOURCE_DIR}/src")
endif()

# WebView Files のソースディレクトリ
set(WEBVIEW_FILES_SOURCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/ui/public")

# JUCE のフロントエンドライブラリをコピー
file(COPY "${JUCE_MODULES_DIR}/juce_gui_extra/native/javascript/" DESTINATION "${WEBVIEW_FILES_SOURCE_DIR}/js/juce/")

# プラットフォーム別アイコン引数
set(ICON_ARGS)
set(ZEROCOMP_ICON_PNG "${CMAKE_SOURCE_DIR}/cmake/icon.png")
if(APPLE)
    list(APPEND ICON_ARGS
        ICON_BIG   "${ZEROCOMP_ICON_PNG}"
    )
endif()
if(WIN32)
    list(APPEND ICON_ARGS
        ICON_BIG   "${ZEROCOMP_ICON_PNG}"
        ICON_SMALL "${ZEROCOMP_ICON_PNG}"
    )
endif()

# AAX の自動コピー先をユーザー書き込み可能な場所に変更（開発時の権限エラー回避）
if(APPLE)
    set_property(GLOBAL PROPERTY JUCE_AAX_COPY_DIR "${CMAKE_BINARY_DIR}/AAX_Plugins")
endif()

# Linux ビルド時のみ LV2 を FORMATS に追加（既存の Windows/macOS リリース経路には影響させない）
set(ZEROCOMP_FORMATS AU VST3 Standalone AAX)
if(UNIX AND NOT APPLE)
    list(APPEND ZEROCOMP_FORMATS LV2)
endif()

# プラグイン定義（JUCE v8）
juce_add_plugin(ZeroComp
    VERSION ${PROJECT_VERSION}
    PRODUCT_NAME "ZeroComp"
    COMPANY_NAME "Jun Murakami"
    BUNDLE_ID "com.junmurakami.zerocomp"
    PLUGIN_MANUFACTURER_CODE Jmbc
    PLUGIN_CODE ZrCp
    FORMATS ${ZEROCOMP_FORMATS}
    LV2URI "https://junmurakami.com/plugins/zerocomp"
    PLUGIN_AU_MAIN_TYPE "aufx"
    VST3_CATEGORIES "Fx" "Dynamics"
    AAX_CATEGORY "AAX_ePlugInCategory_Dynamics"
    IS_SYNTH FALSE
    NEEDS_MIDI_INPUT FALSE
    NEEDS_MIDI_OUTPUT FALSE
    IS_MIDI_EFFECT FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS TRUE
    COPY_PLUGIN_AFTER_BUILD TRUE
    ${ICON_ARGS}

    # WebView 利用
    NEEDS_WEB_BROWSER TRUE
    NEEDS_WEBVIEW2 TRUE
)

juce_generate_juce_header(ZeroComp)

# Linux ビルド時のみ CLAP ターゲットを生成（clap-juce-extensions 経由）
if(UNIX AND NOT APPLE)
    clap_juce_extensions_plugin(TARGET ZeroComp
        CLAP_ID "com.junmurakami.zerocomp"
        CLAP_FEATURES audio-effect compressor)
endif()

# ソースファイル
target_sources(ZeroComp PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src/PluginEditor.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/src/PluginEditor.h
    ${CMAKE_CURRENT_SOURCE_DIR}/src/PluginProcessor.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/src/PluginProcessor.h
    ${CMAKE_CURRENT_SOURCE_DIR}/src/ParameterIDs.h
    ${CMAKE_CURRENT_SOURCE_DIR}/src/KeyEventForwarder.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/src/KeyEventForwarder.h
    ${CMAKE_CURRENT_SOURCE_DIR}/src/dsp/Compressor.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/src/dsp/Compressor.h
    ${CMAKE_CURRENT_SOURCE_DIR}/src/dsp/MomentaryProcessor.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/src/dsp/MomentaryProcessor.h
)

if(APPLE)
    target_sources(ZeroComp PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/src/KeyEventForwarder_mac.mm
    )
endif()

# バージョン情報ヘッダの生成
configure_file(
    ${CMAKE_CURRENT_SOURCE_DIR}/src/Version.h.in
    ${CMAKE_CURRENT_BINARY_DIR}/Version.h
    @ONLY
)

target_include_directories(ZeroComp PRIVATE
    ${ZEROCOMP_SRC_DIR}
    ${ZEROCOMP_SRC_DIR}/dsp
    ${CMAKE_CURRENT_BINARY_DIR}
)

target_include_directories(ZeroComp SYSTEM PUBLIC ${JUCE_MODULES_DIR})

target_link_libraries(ZeroComp
    PRIVATE
        juce::juce_audio_basics
        juce::juce_audio_devices
        juce::juce_audio_formats
        juce::juce_audio_processors
        juce::juce_audio_utils
        juce::juce_core
        juce::juce_data_structures
        juce::juce_dsp
        juce::juce_events
        juce::juce_graphics
        juce::juce_gui_basics
        juce::juce_gui_extra
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_lto_flags
        juce::juce_recommended_warning_flags
)

# macOS: ヘッダパッド確保（署名/wraptool 対策）
if(APPLE)
    if (TARGET ZeroComp)
        target_link_options(ZeroComp PRIVATE -Wl,-headerpad,578)
        target_link_libraries(ZeroComp PUBLIC "-framework ApplicationServices")
    endif()

    foreach(wrapperTarget IN ITEMS ZeroComp_VST3 ZeroComp_AU ZeroComp_Standalone ZeroComp_AAX)
        if (TARGET ${wrapperTarget})
            target_link_options(${wrapperTarget} PRIVATE -Wl,-headerpad,578)
            target_link_libraries(${wrapperTarget} PRIVATE "-framework ApplicationServices")
        endif()
    endforeach()
endif()

# 共通コンパイル定義（WebView 有効化）
target_compile_definitions(ZeroComp PUBLIC
    JUCE_WEB_BROWSER=1
    JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0
    JUCE_WIN_PER_MONITOR_DPI_AWARE=1
    $<$<OR:$<CONFIG:Debug>,$<CONFIG:RelWithDebInfo>>:JUCE_DEBUG=1>
    $<$<PLATFORM_ID:Windows>:JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1>

    JucePlugin_ManufacturerCode=0x4a6d6263
    JucePlugin_PluginCode=0x5a724370
    JucePlugin_IsSynth=0
    JucePlugin_WantsMidiInput=0
    JucePlugin_ProducesMidiOutput=0
    JucePlugin_IsMidiEffect=0
    JucePlugin_EditorRequiresKeyboardFocus=1
)

# Dev/Prod の読み分け
target_compile_definitions(ZeroComp PRIVATE
    $<$<CONFIG:Debug>:ZEROCOMP_DEV_MODE=1>
    $<$<CONFIG:Debug>:LOCAL_DEV_SERVER_ADDRESS="http://127.0.0.1:5173">
    $<$<NOT:$<CONFIG:Debug>>:ZEROCOMP_DEV_MODE=0>
)

# WebView 埋め込み用 ZIP の作成
set(WEBVIEW_FILES_ZIP_NAME "webview_files.zip")
set(TARGET_WEBVIEW_FILES_ZIP_PATH "${CMAKE_BINARY_DIR}/${WEBVIEW_FILES_ZIP_NAME}")
cmake_path(ABSOLUTE_PATH WEBVIEW_FILES_SOURCE_DIR NORMALIZE OUTPUT_VARIABLE PUBLIC_PATH )
cmake_path(GET PUBLIC_PATH PARENT_PATH WORKING_DIRECTORY)

if (NOT DEFINED ZEROCOMP_WEBVIEW_INITIAL_CLEAN_DONE OR NOT ZEROCOMP_WEBVIEW_INITIAL_CLEAN_DONE)
    if (EXISTS "${TARGET_WEBVIEW_FILES_ZIP_PATH}")
        file(REMOVE "${TARGET_WEBVIEW_FILES_ZIP_PATH}")
    endif()
    set(ZEROCOMP_WEBVIEW_INITIAL_CLEAN_DONE ON CACHE BOOL "Initial WebView zip clean executed" FORCE)
endif()

file(GLOB_RECURSE WEBVIEW_ASSETS CONFIGURE_DEPENDS
    "${WEBVIEW_FILES_SOURCE_DIR}/**/*")

add_custom_command(
    OUTPUT "${TARGET_WEBVIEW_FILES_ZIP_PATH}"
    COMMAND ${CMAKE_COMMAND} -E tar cvf
            "${TARGET_WEBVIEW_FILES_ZIP_PATH}"
            --format=zip
            "${PUBLIC_PATH}"
    DEPENDS ${WEBVIEW_ASSETS}
    WORKING_DIRECTORY "${WORKING_DIRECTORY}"
    COMMENT "Zipping WebView files (up-to-date aware)..."
    VERBATIM
)

add_custom_target(ZipWebViewFiles
    DEPENDS "${TARGET_WEBVIEW_FILES_ZIP_PATH}"
)

cmake_path(GET PUBLIC_PATH FILENAME ZIPPED_FILES_PREFIX)
target_compile_definitions(ZeroComp PRIVATE
    $<$<NOT:$<CONFIG:Debug>>:ZIPPED_FILES_PREFIX="${ZIPPED_FILES_PREFIX}/">
)

juce_add_binary_data(WebViewFiles
    HEADER_NAME WebViewFiles.h
    NAMESPACE webview_files
    SOURCES ${TARGET_WEBVIEW_FILES_ZIP_PATH}
)
add_dependencies(WebViewFiles ZipWebViewFiles)

target_link_libraries(ZeroComp PRIVATE
    $<$<NOT:$<OR:$<CONFIG:Debug>,$<CONFIG:RelWithDebInfo>>>:WebViewFiles>
)

# Windows 固有設定
if(WIN32)
    target_compile_definitions(ZeroComp PRIVATE
        NOMINMAX
        WIN32_LEAN_AND_MEAN
    )
    target_compile_options(ZeroComp PRIVATE
        /utf-8
    )
    target_link_libraries(ZeroComp PRIVATE Dbghelp)
endif()

if(MSVC)
    foreach(wrapperTarget IN ITEMS ZeroComp ZeroComp_VST3 ZeroComp_Standalone ZeroComp_AAX)
        if (TARGET ${wrapperTarget})
            target_compile_options(${wrapperTarget} PRIVATE
                $<$<CONFIG:Debug>:/Zi>
                $<$<CONFIG:Release>:/Zi>
                $<$<CONFIG:RelWithDebInfo>:/Zi>
                $<$<CONFIG:MinSizeRel>:/Zi>
            )
            target_link_options(${wrapperTarget} PRIVATE
                $<$<CONFIG:Debug>:/DEBUG:FULL>
                $<$<CONFIG:Release>:/DEBUG:FULL>
                $<$<CONFIG:RelWithDebInfo>:/DEBUG:FULL>
                $<$<CONFIG:MinSizeRel>:/DEBUG:FULL>
            )
        endif()
    endforeach()
endif()
