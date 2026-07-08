# ApplyClapPatch.cmake
# ------------------------------------------------------------------------------
# JUCE 9 が CLAP を正式対応するまでの暫定運用。
# clap-juce-extensions（submodule）への修正パッチ（ファイル名は歴史的に windows-dpi だが、
# 現在は次の2つを束ねる）を configure のたびに冪等適用する。
#   1) Windows DPI 二重スケール修正（setScaleFactor を掛けずピアスケール一本化）
#   2) guiSetSize の Linux ゲート解除（Linux では枠リサイズを無効化＝guiCanResize=false に
#      するが、自前 WebUI ハンドルの request_resize 往復で来る set_size は honor させるため、
#      Linux のみ editor->isResizable() ゲートをスキップする）
#
# 重要 — なぜ submodule の git（checkout/apply）を使わないか（ApplyJucePatch.cmake と同方針）:
#   (a) gitfile の解決: コンテナ内でも相対 gitdir は解決できるが、
#   (b) 兄弟リポは reference clone のため .git/modules/*/objects/info/alternates が
#       「ホスト絶対パス」(例: /home/jun/code/MixCompare/.git/modules/...) を指す。
#       コンテナには自リポしかマウントされないので object が読めず、git 2.34 の
#       `checkout -- .` は object 読取失敗時に作業ツリーのファイルを削除したまま
#       rc=255 で失敗する（2026-07-05 に兄弟5リポ全部で発生・再現確認済み）。
#   そこで「外側リポの git」で `git apply --directory=clap-juce-extensions` する。
#   git apply は object DB を読まないため alternates に依存しない。
#
# 冪等性: `git apply --reverse --check`（成功＝適用済み）で判定し、未適用のときのみ apply。
#   注意: パッチ内容を更新した場合、旧版が当たったままだと自動 revert はされない
#         （その時はホストで `git -C clap-juce-extensions checkout -- .` してから再 configure）。
#
# 単一ソース: 親 ../patches にマスターがあれば、まずローカル patches/ へ上書き同期。
# 使い方: add_subdirectory(clap-juce-extensions ...) の「前」で include すること。
# ------------------------------------------------------------------------------

set(CJE_DIR_NAME     "clap-juce-extensions")
set(CJE_DIR          "${CMAKE_CURRENT_SOURCE_DIR}/${CJE_DIR_NAME}")
set(CJE_PATCH_NAME   "clap-juce-extensions-windows-dpi.patch")
set(CJE_PATCH_LOCAL  "${CMAKE_CURRENT_SOURCE_DIR}/patches/${CJE_PATCH_NAME}")
set(CJE_PATCH_MASTER "${CMAKE_CURRENT_SOURCE_DIR}/../patches/${CJE_PATCH_NAME}")

# 1) 大元(親 ../patches)があればローカル patches/ へ上書き同期（host のみ。container では
#    ../patches が無いので skip、ローカル patches/ はリポジトリと一緒にマウントされている）。
if(EXISTS "${CJE_PATCH_MASTER}")
    file(MAKE_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/patches")
    configure_file("${CJE_PATCH_MASTER}" "${CJE_PATCH_LOCAL}" COPYONLY)
    message(STATUS "clap patch: synced from master (${CJE_PATCH_MASTER})")
endif()

# 2) 外側リポジトリの git で submodule 配下へ apply（冪等: reverse-check で適用済みを skip）
if(EXISTS "${CJE_PATCH_LOCAL}" AND IS_DIRECTORY "${CJE_DIR}")
    find_package(Git QUIET)
    if(Git_FOUND)
        execute_process(
            COMMAND "${GIT_EXECUTABLE}" apply --directory=${CJE_DIR_NAME} -p1 --reverse --check "${CJE_PATCH_LOCAL}"
            WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
            RESULT_VARIABLE _cje_rev ERROR_QUIET OUTPUT_QUIET)
        if(_cje_rev EQUAL 0)
            message(STATUS "clap patch: already applied ${CJE_PATCH_NAME}")
        else()
            execute_process(
                COMMAND "${GIT_EXECUTABLE}" apply --directory=${CJE_DIR_NAME} -p1 "${CJE_PATCH_LOCAL}"
                WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
                RESULT_VARIABLE _cje_apply ERROR_VARIABLE _cje_err)
            if(_cje_apply EQUAL 0)
                message(STATUS "clap patch: applied ${CJE_PATCH_NAME}")
            else()
                message(FATAL_ERROR "clap patch: FAILED to apply ${CJE_PATCH_NAME} — refusing to "
                                    "build without it (check patch line endings / submodule state)\n${_cje_err}")
            endif()
        endif()
    else()
        message(FATAL_ERROR "clap patch: Git not found — patch cannot be applied")
    endif()
endif()
