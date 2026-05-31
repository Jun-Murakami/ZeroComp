# ApplyClapPatch.cmake
# ------------------------------------------------------------------------------
# JUCE 9 が CLAP を正式対応するまでの暫定運用。
# clap-juce-extensions（submodule）の Windows DPI 二重スケール修正パッチを、
# configure のたびに「submodule を pristine に戻してから現行パッチを当て直す」方式で適用する。
#
#  - 冪等        : 何度 configure しても結果は同じ
#  - 更新に追従   : パッチ内容が変わっても常に最新パッチの状態へ収束（旧パッチとの衝突なし）
#  - 単一ソース   : 親フォルダ ../patches にマスターがあれば、まずローカル patches/ へ上書き同期
#
# 注意: 適用前に submodule 作業ツリーを `git checkout -- .` で戻すため、
#       clap-juce-extensions 内の手動変更は configure 時に破棄される（変更はパッチへ一本化する方針）。
#
# 使い方: add_subdirectory(clap-juce-extensions ...) の「前」で include すること。
#   include(${CMAKE_CURRENT_SOURCE_DIR}/cmake/ApplyClapPatch.cmake)
# ------------------------------------------------------------------------------

set(CJE_DIR          "${CMAKE_CURRENT_SOURCE_DIR}/clap-juce-extensions")
set(CJE_PATCH_NAME   "clap-juce-extensions-windows-dpi.patch")
set(CJE_PATCH_LOCAL  "${CMAKE_CURRENT_SOURCE_DIR}/patches/${CJE_PATCH_NAME}")
set(CJE_PATCH_MASTER "${CMAKE_CURRENT_SOURCE_DIR}/../patches/${CJE_PATCH_NAME}")

# 1) 大元(親 ../patches)があればローカル patches/ へ上書き同期（全リポへ単一ソースを伝播）
#    configure_file は入力変更時に再 configure を誘発するため、マスター更新が自動で反映される。
if(EXISTS "${CJE_PATCH_MASTER}")
    file(MAKE_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/patches")
    configure_file("${CJE_PATCH_MASTER}" "${CJE_PATCH_LOCAL}" COPYONLY)
    message(STATUS "clap patch: synced from master (${CJE_PATCH_MASTER})")
endif()

# 2) ローカルパッチを submodule へ適用（pristine 化 → apply）
if(EXISTS "${CJE_PATCH_LOCAL}" AND IS_DIRECTORY "${CJE_DIR}")
    find_package(Git QUIET)
    if(Git_FOUND)
        execute_process(
            COMMAND "${GIT_EXECUTABLE}" -C "${CJE_DIR}" checkout -- .
            RESULT_VARIABLE _cje_reset ERROR_QUIET OUTPUT_QUIET)
        execute_process(
            COMMAND "${GIT_EXECUTABLE}" -C "${CJE_DIR}" apply "${CJE_PATCH_LOCAL}"
            RESULT_VARIABLE _cje_apply ERROR_VARIABLE _cje_err)
        if(_cje_apply EQUAL 0)
            message(STATUS "clap patch: applied ${CJE_PATCH_NAME}")
        else()
            message(WARNING "clap patch: FAILED to apply ${CJE_PATCH_NAME}\n${_cje_err}")
        endif()
    else()
        message(WARNING "clap patch: Git not found; skipped (要手動 git apply)")
    endif()
endif()
