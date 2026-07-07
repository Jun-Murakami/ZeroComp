# ApplyJucePatch.cmake
# ------------------------------------------------------------------------------
# JUCE（submodule）への修正パッチを configure のたびに冪等適用する。
#
# 重要 — なぜ `git -C JUCE` を使わないか:
#   submodule の JUCE/.git は "gitdir: /home/jun/code/.../.git/modules/JUCE" という
#   ホスト絶対パスを指す。Docker ビルドではリポジトリは /work にマウントされるため、
#   この絶対パスはコンテナ内に存在せず `git -C JUCE ...` は「not a git repository」で
#   失敗していた（＝従来はパッチがビルドに入っていなかった）。
#   そこで「外側リポジトリ(=/work、コンテナ内でも .git が在る)の git」で
#   `git apply --directory=JUCE` する方式に変更。host/container どちらでも動く。
#
# 冪等性:
#   `git checkout -- .` による pristine 化は submodule git に依存するため使わない。
#   代わりに `git apply --reverse --check`（適用済みなら成功）で判定し、未適用のときのみ
#   apply する。git apply は原子的なので、当たらないパッチ(陳腐化等)はツリーを汚さず WARNING。
#   注意: パッチ内容を更新した場合、旧版が当たったままだと自動 revert はされない
#         （その時は JUCE submodule を手動で clean: `git -C JUCE checkout -- .` してから再 configure）。
#
# 適用パッチ（JUCE_PATCH_NAMES の順）:
#   1) juce-webview-linux-utf8.patch  : Linux WebView の非ASCII文字化け修正（＋LV2 HiDPI）
#   2) juce-webview-linux-ldpath.patch: WebView 子プロセスの LD_LIBRARY_PATH サニタイズ。
#      Ardour .run 等の自己完結バンドルが LD_LIBRARY_PATH を古い glib に向けるため、
#      子プロセスの WebKitGTK が undefined symbol で即死→UI真っ白。execve に
#      LD_LIBRARY_PATH を除いた環境を渡して system ライブラリでロードさせ解消。
#   3) juce-webview-linux-soname.patch: dlopen をバージョン付き SONAME (.so.0 等) に
#      フォールバック。upstream JUCE はバージョン無しの libfoo.so しか試さず、それは
#      -devel/-dev パッケージにしか入っていない（Fedora/Debian のパッケージ方針）。
#      そのため開発機でしか WebView が動かず、一般ユーザー環境では UI 真っ白になる。
#   4) juce-webview-linux-childlog.patch: 環境変数 JUCE_WEBVIEW_CHILD_LOG にパスが
#      あれば WebView 子プロセスの stdout/stderr をそのファイルへ dup2 する
#      （プラグイン側の DiagnosticLog が設定）。dlopen 失敗も stderr へ出力する。
#      注意: soname パッチが追加した行を文脈に含むため、この順序でのみ適用可能。
#
# 単一ソース: 親 ../patches にマスターがあれば、まずローカル patches/ へ上書き同期。
# 使い方: add_subdirectory(JUCE) の「前」で include すること。
# ------------------------------------------------------------------------------

set(JUCE_DIR_NAME     "JUCE")
set(JUCE_DIR          "${CMAKE_CURRENT_SOURCE_DIR}/${JUCE_DIR_NAME}")
set(JUCE_PATCH_NAMES
    "juce-webview-linux-utf8.patch"
    "juce-webview-linux-ldpath.patch"
    "juce-webview-linux-soname.patch"
    "juce-webview-linux-childlog.patch")

# 1) 大元(親 ../patches)があればローカル patches/ へ上書き同期（host のみ。container では ../patches
#    が無いので skip、ローカル patches/ はリポジトリと一緒にマウントされている）。
file(MAKE_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/patches")
foreach(_patch IN LISTS JUCE_PATCH_NAMES)
    set(_master "${CMAKE_CURRENT_SOURCE_DIR}/../patches/${_patch}")
    if(EXISTS "${_master}")
        configure_file("${_master}" "${CMAKE_CURRENT_SOURCE_DIR}/patches/${_patch}" COPYONLY)
        message(STATUS "juce patch: synced from master (${_patch})")
    endif()
endforeach()

# 2) 外側リポジトリの git で submodule 配下へ apply（冪等: reverse-check で適用済みを skip）
#    重要: 適用失敗・パッチ欠落は FATAL_ERROR でビルドを止める。以前は WARNING で続行して
#    いたため「パッチ無しのバイナリが黙って出荷される」事故が起きた（v3.0.9-beta:
#    .gitattributes の LF 正規化でパッチが壊れ、childlog パッチ欠落のまま配布）。
#    失敗時はまずパッチファイルの改行を確認: `file patches/*.patch` が CRLF を含むこと
#    （LF のみなら .gitattributes の `patches/*.patch -text` が効いていない状態で
#    checkout された劣化コピー。git で正しいバイトを取り直すこと）。
#
#    自動リカバリ（下記 _juce_apply_all の失敗時）:
#      パッチ内容を更新したのに JUCE 作業ツリーに旧版が焼き込まれたまま（＝手動 clean
#      忘れ）だと、reverse-check も forward も当たらず FATAL になる。これを避けるため、
#      forward 失敗が出たら「全パッチが触る JUCE ファイルだけ」を `git checkout HEAD --`
#      で pristine に戻し、全パッチをフレッシュ再適用する。単一ファイルを複数パッチが
#      触る（utf8 と ldpath/soname/childlog が同じ *_linux.cpp を触る）ため、ファイル
#      単位の部分リトライではなく「触るファイル群を丸ごと作り直す」方式にしている。
#      注意: submodule の JUCE/.git は host 絶対パスの gitdir を指すため、Docker では
#      `git -C JUCE` が使えないことがある。その場合 checkout はベストエフォートで失敗し、
#      再適用も失敗 → 手動 clean 手順を添えて FATAL（従来同様だがメッセージが明確になる）。

# 与えられたパッチ列を順に適用する。reverse-check で適用済みは skip、未適用は forward。
# forward が一つでも失敗したら即 break し ${_ok_var} を FALSE にして返す。
function(_juce_apply_all _ok_var)
    set(_all_ok TRUE)
    foreach(_patch IN LISTS JUCE_PATCH_NAMES)
        set(_local "${CMAKE_CURRENT_SOURCE_DIR}/patches/${_patch}")
        execute_process(
            COMMAND "${GIT_EXECUTABLE}" apply --directory=${JUCE_DIR_NAME} -p1 --reverse --check "${_local}"
            WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
            RESULT_VARIABLE _rev ERROR_QUIET OUTPUT_QUIET)
        if(_rev EQUAL 0)
            message(STATUS "juce patch: already applied ${_patch}")
        else()
            execute_process(
                COMMAND "${GIT_EXECUTABLE}" apply --directory=${JUCE_DIR_NAME} -p1 "${_local}"
                WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
                RESULT_VARIABLE _app ERROR_VARIABLE _err)
            if(_app EQUAL 0)
                message(STATUS "juce patch: applied ${_patch}")
            else()
                message(STATUS "juce patch: could not apply ${_patch}\n${_err}")
                set(${_ok_var} FALSE PARENT_SCOPE)
                return()
            endif()
        endif()
    endforeach()
    set(${_ok_var} ${_all_ok} PARENT_SCOPE)
endfunction()

if(IS_DIRECTORY "${JUCE_DIR}")
    find_package(Git QUIET)
    if(NOT Git_FOUND)
        message(FATAL_ERROR "juce patch: Git not found — patches cannot be applied")
    endif()

    # 事前チェック（パッチ欠落は即 FATAL）＋ パッチが触る JUCE ファイル集合を収集（リカバリ用）
    set(_touched_files "")
    foreach(_patch IN LISTS JUCE_PATCH_NAMES)
        set(_local "${CMAKE_CURRENT_SOURCE_DIR}/patches/${_patch}")
        if(NOT EXISTS "${_local}")
            message(FATAL_ERROR "juce patch: MISSING patch file ${_patch}")
        endif()
        # 各パッチの `+++ b/<path>` 行から対象ファイルを抽出（末尾 CR / タブ以降を除去）
        file(STRINGS "${_local}" _plus_lines REGEX "^\\+\\+\\+ b/")
        foreach(_pl IN LISTS _plus_lines)
            string(REGEX REPLACE "^\\+\\+\\+ b/" "" _pf "${_pl}")
            string(REGEX REPLACE "[ \t\r].*$" "" _pf "${_pf}")
            if(_pf)
                list(APPEND _touched_files "${_pf}")
            endif()
        endforeach()
    endforeach()
    list(REMOVE_DUPLICATES _touched_files)

    # 第1パス（高速路）: そのまま適用を試みる
    _juce_apply_all(_pass_ok)

    # 第2パス（リカバリ）: 旧版焼き込み等で失敗したら、触るファイルを pristine に戻して再適用
    if(NOT _pass_ok)
        message(STATUS "juce patch: apply failed — restoring touched JUCE files to pristine and retrying: ${_touched_files}")
        execute_process(
            COMMAND "${GIT_EXECUTABLE}" checkout HEAD -- ${_touched_files}
            WORKING_DIRECTORY "${JUCE_DIR}"
            RESULT_VARIABLE _co ERROR_VARIABLE _coerr)
        if(NOT _co EQUAL 0)
            message(STATUS "juce patch: could not reset via submodule git (expected under Docker where JUCE/.git points at a host path)\n${_coerr}")
        endif()
        _juce_apply_all(_pass_ok)
    endif()

    if(NOT _pass_ok)
        message(FATAL_ERROR
            "juce patch: FAILED to apply all patches even after recovery — refusing to build without them.\n"
            "  1) パッチ改行を確認: `file patches/*.patch` に CRLF が含まれること（LF のみなら劣化コピー）\n"
            "  2) JUCE 作業ツリーを手動 clean して再 configure: `git -C JUCE checkout -- .`")
    endif()
endif()
