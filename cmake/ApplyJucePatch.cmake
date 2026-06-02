# ApplyJucePatch.cmake
# ------------------------------------------------------------------------------
# JUCE（submodule）への修正パッチを、configure のたびに「submodule を pristine に
# 戻してから現行パッチを当て直す」方式で適用する。ApplyClapPatch.cmake と同じ運用。
#
# 適用パッチ:
#   1) Linux WebView の非ASCII文字化け修正
#      juce_WebBrowserComponent_linux.cpp の子プロセス間チャネル受信が
#      String(const char*, size_t)=CharPointer_ASCII で UTF-8 を Latin-1 誤デコードし、
#      日本語ファイル名・エラー文・JS<->C++ 引数が化ける。String::fromUTF8 へ変更して解消。
#
#  - 冪等        : 何度 configure しても結果は同じ
#  - 更新に追従   : パッチ内容が変わっても常に最新パッチの状態へ収束
#  - 単一ソース   : 親フォルダ ../patches にマスターがあれば、まずローカル patches/ へ上書き同期
#
# 注意: 適用前に submodule 作業ツリーを `git checkout -- .` で戻すため、
#       JUCE 内の手動変更は configure 時に破棄される（変更はパッチへ一本化する方針）。
#
# 使い方: add_subdirectory(JUCE) の「前」で include すること。
#   include(${CMAKE_CURRENT_SOURCE_DIR}/cmake/ApplyJucePatch.cmake)
# ------------------------------------------------------------------------------

set(JUCE_DIR          "${CMAKE_CURRENT_SOURCE_DIR}/JUCE")
set(JUCE_PATCH_NAME   "juce-webview-linux-utf8.patch")
set(JUCE_PATCH_LOCAL  "${CMAKE_CURRENT_SOURCE_DIR}/patches/${JUCE_PATCH_NAME}")
set(JUCE_PATCH_MASTER "${CMAKE_CURRENT_SOURCE_DIR}/../patches/${JUCE_PATCH_NAME}")

# 1) 大元(親 ../patches)があればローカル patches/ へ上書き同期（全リポへ単一ソースを伝播）
#    configure_file は入力変更時に再 configure を誘発するため、マスター更新が自動で反映される。
if(EXISTS "${JUCE_PATCH_MASTER}")
    file(MAKE_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/patches")
    configure_file("${JUCE_PATCH_MASTER}" "${JUCE_PATCH_LOCAL}" COPYONLY)
    message(STATUS "juce patch: synced from master (${JUCE_PATCH_MASTER})")
endif()

# 2) ローカルパッチを submodule へ適用（pristine 化 → apply）
if(EXISTS "${JUCE_PATCH_LOCAL}" AND IS_DIRECTORY "${JUCE_DIR}")
    find_package(Git QUIET)
    if(Git_FOUND)
        execute_process(
            COMMAND "${GIT_EXECUTABLE}" -C "${JUCE_DIR}" checkout -- .
            RESULT_VARIABLE _juce_reset ERROR_QUIET OUTPUT_QUIET)
        execute_process(
            COMMAND "${GIT_EXECUTABLE}" -C "${JUCE_DIR}" apply "${JUCE_PATCH_LOCAL}"
            RESULT_VARIABLE _juce_apply ERROR_VARIABLE _juce_err)
        if(_juce_apply EQUAL 0)
            message(STATUS "juce patch: applied ${JUCE_PATCH_NAME}")
        else()
            message(WARNING "juce patch: FAILED to apply ${JUCE_PATCH_NAME}\n${_juce_err}")
        endif()
    else()
        message(WARNING "juce patch: Git not found; skipped (要手動 git apply)")
    endif()
endif()
