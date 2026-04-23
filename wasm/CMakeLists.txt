cmake_minimum_required(VERSION 3.15)
project(ZeroCompDSP LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(zerocomp_dsp
    src/wasm_exports.cpp
)

target_include_directories(zerocomp_dsp PRIVATE src)

if(EMSCRIPTEN)
    set_target_properties(zerocomp_dsp PROPERTIES
        SUFFIX ".wasm"
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/dist"
    )

    set(EXPORTED_FUNCTIONS
        # 初期化 / 解放
        "_dsp_init" "_dsp_destroy"
        # メモリ
        "_dsp_alloc_buffer" "_dsp_free_buffer" "_malloc" "_free"
        # ソース
        "_dsp_load_source" "_dsp_clear_source"
        # トランスポート
        "_dsp_set_playing" "_dsp_is_playing"
        "_dsp_set_loop" "_dsp_seek_normalised"
        "_dsp_consume_stopped_at_end"
        "_dsp_get_position" "_dsp_get_duration"
        # DSP パラメータ（ZeroComp 用）
        "_dsp_set_threshold_db" "_dsp_set_ratio"
        "_dsp_set_knee_db" "_dsp_set_attack_ms" "_dsp_set_release_ms"
        "_dsp_set_output_gain_db" "_dsp_set_auto_makeup"
        "_dsp_set_mode" "_dsp_set_metering_mode" "_dsp_set_bypass"
        # メイン処理 / メーター
        "_dsp_process_block" "_dsp_get_meter_data" "_dsp_reset_momentary"
    )
    list(JOIN EXPORTED_FUNCTIONS "," EXPORTED_FUNCTIONS_STR)

    target_link_options(zerocomp_dsp PRIVATE
        "-sSTANDALONE_WASM=1"
        "-sEXPORTED_FUNCTIONS=[${EXPORTED_FUNCTIONS_STR}]"
        "-sALLOW_MEMORY_GROWTH=1"
        "-sINITIAL_MEMORY=16777216"
        "-sSTACK_SIZE=131072"
        "-sWASM=1"
        "--no-entry"
        "-O3"
    )
endif()
