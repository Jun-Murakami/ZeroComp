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
# 重要 — なぜ submodule の git（checkout/apply）を「適用」に使わないか（ApplyJucePatch.cmake と同方針）:
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
#
# 自動リカバリ（forward 失敗時、ApplyJucePatch.cmake と同方針）:
#   パッチが当たらない典型は「対象ファイルの改行が劣化した（例: Windows 同期で
#   clap-juce-extensions 作業ツリー全体が CRLF 化。パッチは LF なので context 不一致で
#   reverse も forward も当たらず FATAL）」または「旧版パッチが焼き込まれたまま」。
#   forward が失敗したら、パッチが触るファイルだけを submodule の HEAD から pristine に
#   戻して再適用する（2026-07-08 に ZeroComp で CRLF 化により再現・本リカバリで復旧確認）。
#   ただし上記 (b) の通り submodule git checkout は container で破壊的になりうるため、
#   `cat-file -e HEAD:<file>` で object DB が読める時のみ checkout する（読めない＝
#   container/reference-clone では checkout を skip し、手動 clean 手順を添えて FATAL）。
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

# reverse-check で適用済みなら skip、未適用なら forward。forward 失敗で _ok_var=FALSE。
function(_clap_apply _ok_var)
    execute_process(
        COMMAND "${GIT_EXECUTABLE}" apply --directory=${CJE_DIR_NAME} -p1 --reverse --check "${CJE_PATCH_LOCAL}"
        WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
        RESULT_VARIABLE _rev ERROR_QUIET OUTPUT_QUIET)
    if(_rev EQUAL 0)
        message(STATUS "clap patch: already applied ${CJE_PATCH_NAME}")
        set(${_ok_var} TRUE PARENT_SCOPE)
        return()
    endif()
    execute_process(
        COMMAND "${GIT_EXECUTABLE}" apply --directory=${CJE_DIR_NAME} -p1 "${CJE_PATCH_LOCAL}"
        WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
        RESULT_VARIABLE _app ERROR_VARIABLE _err)
    if(_app EQUAL 0)
        message(STATUS "clap patch: applied ${CJE_PATCH_NAME}")
        set(${_ok_var} TRUE PARENT_SCOPE)
    else()
        message(STATUS "clap patch: could not apply ${CJE_PATCH_NAME}\n${_err}")
        set(${_ok_var} FALSE PARENT_SCOPE)
    endif()
endfunction()

# 2) 外側リポジトリの git で submodule 配下へ apply（冪等 + forward 失敗時は自動リカバリ）
if(EXISTS "${CJE_PATCH_LOCAL}" AND IS_DIRECTORY "${CJE_DIR}")
    find_package(Git QUIET)
    if(NOT Git_FOUND)
        message(FATAL_ERROR "clap patch: Git not found — patch cannot be applied")
    endif()

    # パッチが触るファイル集合を収集（`+++ b/<path>` 行。末尾 CR / タブ以降を除去）。リカバリ用。
    set(_touched_files "")
    file(STRINGS "${CJE_PATCH_LOCAL}" _plus_lines REGEX "^\\+\\+\\+ b/")
    foreach(_pl IN LISTS _plus_lines)
        string(REGEX REPLACE "^\\+\\+\\+ b/" "" _pf "${_pl}")
        string(REGEX REPLACE "[ \t\r].*$" "" _pf "${_pf}")
        if(_pf)
            list(APPEND _touched_files "${_pf}")
        endif()
    endforeach()
    list(REMOVE_DUPLICATES _touched_files)

    # 第1パス（高速路）: そのまま適用を試みる
    _clap_apply(_pass_ok)

    # 第2パス（リカバリ）: 触るファイルを pristine に戻して再適用（object DB が読める時のみ）
    if(NOT _pass_ok AND _touched_files)
        # 破壊的回避: submodule の HEAD blob が読める時だけ checkout する（上記 (b) 参照）。
        set(_objects_ok TRUE)
        foreach(_pf IN LISTS _touched_files)
            execute_process(
                COMMAND "${GIT_EXECUTABLE}" cat-file -e "HEAD:${_pf}"
                WORKING_DIRECTORY "${CJE_DIR}"
                RESULT_VARIABLE _cf ERROR_QUIET OUTPUT_QUIET)
            if(NOT _cf EQUAL 0)
                set(_objects_ok FALSE)
            endif()
        endforeach()

        if(_objects_ok)
            message(STATUS "clap patch: apply failed — restoring touched files to pristine and retrying: ${_touched_files}")
            execute_process(
                COMMAND "${GIT_EXECUTABLE}" checkout HEAD -- ${_touched_files}
                WORKING_DIRECTORY "${CJE_DIR}"
                RESULT_VARIABLE _co ERROR_VARIABLE _coerr)
            if(NOT _co EQUAL 0)
                message(STATUS "clap patch: could not reset via submodule git\n${_coerr}")
            endif()
            _clap_apply(_pass_ok)
        else()
            message(STATUS "clap patch: submodule object DB not readable "
                           "(expected under Docker/reference-clone) — skipping destructive checkout")
        endif()
    endif()

    if(NOT _pass_ok)
        message(FATAL_ERROR
            "clap patch: FAILED to apply ${CJE_PATCH_NAME} even after recovery — refusing to "
            "build without it.\n"
            "  1) パッチと対象ファイルの改行を確認（パッチは LF。対象が CRLF 化していないか）\n"
            "  2) submodule 作業ツリーを手動 clean して再 configure: `git -C clap-juce-extensions checkout -- .`")
    endif()
endif()
