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
if(IS_DIRECTORY "${JUCE_DIR}")
    find_package(Git QUIET)
    if(NOT Git_FOUND)
        message(FATAL_ERROR "juce patch: Git not found — patches cannot be applied")
    endif()
    foreach(_patch IN LISTS JUCE_PATCH_NAMES)
        set(_local "${CMAKE_CURRENT_SOURCE_DIR}/patches/${_patch}")
        if(NOT EXISTS "${_local}")
            message(FATAL_ERROR "juce patch: MISSING patch file ${_patch}")
        endif()
        # 適用済みか？（逆パッチが綺麗に当たれば適用済み）
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
                message(FATAL_ERROR "juce patch: FAILED to apply ${_patch} — refusing to build "
                                    "without it (check patch line endings / JUCE tree state)\n${_err}")
            endif()
        endif()
    endforeach()
endif()
