// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jun Murakami
#pragma once

#include <JuceHeader.h>

namespace wvdiag
{

// 常時オンの軽量診断ログ（製品共通・パラメータ化版）。
// Linux で WebView UI が表示されない問題（真っ白/灰色）を現地調査するため、
//   - 起動時の環境情報（OS / ホスト / セッション種別 / 関連環境変数）
//   - Linux: WebKitGTK 系ライブラリの dlopen 可否と dlerror
//   - WebView 子プロセスの stdout/stderr 捕捉、noexec 対策、各種描画緩和策
// をテキストファイルへ記録・適用する。ログの場所（<product> は install() で渡す製品名）:
//   Linux:   ~/.config/<product>/Logs/
//   Windows: %APPDATA%/<product>/Logs/
//   macOS:   ~/Library/Logs/<product>/
// 個人情報やオーディオデータは記録しない。サイズは FileLogger により自動で刈り込む。
class DiagnosticLog final
{
public:
    // 冪等。プロセス内で最初の呼び出しがログを開設し、環境スナップショットを記録し、
    // Linux では WebView 起動用の緩和策（SIGPIPE 無視・DMABUF/合成無効化・子ログ・
    // noexec ヘルパー退避）を適用する。PluginProcessor のコンストラクタから、
    // エディタ生成（= WebView 起動）より前に呼ぶこと。
    static void install(const juce::String& productName, const juce::String& version);

    // タイムスタンプ付きで1行追記（スレッドセーフ）。install() 前の呼び出しは無視される。
    static void log(const juce::String& message);

    static juce::File getLogDirectory();
    static juce::File getLogFile();

    // WebView 子プロセス（--juce-gtkwebkitfork-child）の stdout/stderr の書き出し先。
    // juce-webview-linux-childlog.patch が環境変数 JUCE_WEBVIEW_CHILD_LOG を介して使用する。
    static juce::File getWebViewChildLogFile();

private:
    DiagnosticLog() = delete;
    ~DiagnosticLog() = delete;
};

} // namespace wvdiag
