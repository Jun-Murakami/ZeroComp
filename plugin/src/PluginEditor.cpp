#include "PluginEditor.h"
#include "PluginProcessor.h"
#include "ParameterIDs.h"
#include "Version.h"
#include "KeyEventForwarder.h"

#include <unordered_map>
#include <cmath>

#if defined(JUCE_WINDOWS)
 #include <windows.h>
#endif

#if __has_include(<WebViewFiles.h>)
#include <WebViewFiles.h>
#endif

#ifndef LOCAL_DEV_SERVER_ADDRESS
#define LOCAL_DEV_SERVER_ADDRESS "http://127.0.0.1:5173"
#endif

namespace {

std::vector<std::byte> streamToVector(juce::InputStream& stream)
{
    const auto sizeInBytes = static_cast<size_t>(stream.getTotalLength());
    std::vector<std::byte> result(sizeInBytes);
    stream.setPosition(0);
    [[maybe_unused]] const auto bytesRead = stream.read(result.data(), result.size());
    jassert(static_cast<size_t>(bytesRead) == sizeInBytes);
    return result;
}

#if !ZEROCOMP_DEV_MODE && __has_include(<WebViewFiles.h>)
static const char* getMimeForExtension(const juce::String& extension)
{
    static const std::unordered_map<juce::String, const char*> mimeMap = {
        {{"htm"},   "text/html"},
        {{"html"},  "text/html"},
        {{"txt"},   "text/plain"},
        {{"jpg"},   "image/jpeg"},
        {{"jpeg"},  "image/jpeg"},
        {{"svg"},   "image/svg+xml"},
        {{"ico"},   "image/vnd.microsoft.icon"},
        {{"json"},  "application/json"},
        {{"png"},   "image/png"},
        {{"css"},   "text/css"},
        {{"map"},   "application/json"},
        {{"js"},    "text/javascript"},
        {{"woff2"}, "font/woff2"}};

    if (const auto it = mimeMap.find(extension.toLowerCase()); it != mimeMap.end())
        return it->second;

    jassertfalse;
    return "";
}

#ifndef ZIPPED_FILES_PREFIX
#error "You must provide the prefix of zipped web UI files' paths via ZIPPED_FILES_PREFIX compile definition"
#endif

std::vector<std::byte> getWebViewFileAsBytes(const juce::String& filepath)
{
    juce::MemoryInputStream zipStream{ webview_files::webview_files_zip,
                                       webview_files::webview_files_zipSize,
                                       false };
    juce::ZipFile zipFile{ zipStream };

    const auto fullPath = ZIPPED_FILES_PREFIX + filepath;
    if (auto* zipEntry = zipFile.getEntry(fullPath))
    {
        const std::unique_ptr<juce::InputStream> entryStream{ zipFile.createStreamForEntry(*zipEntry) };
        if (entryStream == nullptr) { jassertfalse; return {}; }
        return streamToVector(*entryStream);
    }
    return {};
}
#else
[[maybe_unused]] static std::vector<std::byte> getWebViewFileAsBytes(const juce::String& filepath)
{
    juce::ignoreUnused(filepath);
    return {};
}
#endif

#if defined(JUCE_WINDOWS)
// HWND 基準の DPI を取得し、スケール係数へ変換。
//  - Per-Monitor V2 に対応するため GetDpiForWindow を優先。
//  - 取得失敗時は GetDpiForMonitor にフォールバック。
static void queryWindowDpi(HWND hwnd, int& outDpi, double& outScale)
{
    outDpi = 0;
    outScale = 1.0;
    if (hwnd == nullptr) return;

    HMODULE user32 = ::GetModuleHandleW(L"user32.dll");
    if (user32 != nullptr)
    {
        using GetDpiForWindowFn = UINT (WINAPI*)(HWND);
        auto pGetDpiForWindow = reinterpret_cast<GetDpiForWindowFn>(::GetProcAddress(user32, "GetDpiForWindow"));
        if (pGetDpiForWindow != nullptr)
        {
            const UINT dpi = pGetDpiForWindow(hwnd);
            if (dpi != 0)
            {
                outDpi = static_cast<int>(dpi);
                outScale = static_cast<double>(dpi) / 96.0;
                return;
            }
        }
    }

    HMODULE shcore = ::LoadLibraryW(L"Shcore.dll");
    if (shcore != nullptr)
    {
        using GetDpiForMonitorFn = HRESULT (WINAPI*)(HMONITOR, int, UINT*, UINT*);
        auto pGetDpiForMonitor = reinterpret_cast<GetDpiForMonitorFn>(::GetProcAddress(shcore, "GetDpiForMonitor"));
        if (pGetDpiForMonitor != nullptr)
        {
            HMONITOR mon = ::MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            UINT dpiX = 0, dpiY = 0;
            if (SUCCEEDED(pGetDpiForMonitor(mon, 0 /*MDT_EFFECTIVE_DPI*/, &dpiX, &dpiY)))
            {
                outDpi = static_cast<int>(dpiX);
                outScale = static_cast<double>(dpiX) / 96.0;
            }
        }
        ::FreeLibrary(shcore);
    }
}
#endif

} // namespace

// WebView2/Chromium の起動前に追加のコマンドライン引数を渡すためのヘルパー。
//  環境変数 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS に `--force-device-scale-factor=1`
//  を注入し、WebView2 が独自に DPI スケーリングを適用するのを抑止する。
//  ProTools Windows は（AAX ラッパー時）DPI 非対応モードで動作することが多く、
//  スケーリングがかかると UI が本来の意図より大きく表示される問題を回避する。
//  注意: WebView2 のブラウザプロセス生成前（= WebBrowserComponent の構築前）に呼ぶ必要がある。
static juce::WebBrowserComponent::Options makeWebViewOptionsWithPreLaunchArgs(const juce::AudioProcessor& /*processor*/)
{
   #if defined(JUCE_WINDOWS)
    if (juce::PluginHostType().isProTools()
        && juce::PluginHostType::getPluginLoadedAs() == juce::AudioProcessor::WrapperType::wrapperType_AAX)
    {
        const char* kEnvName = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS";
        const char* kArg     = "--force-device-scale-factor=1";

        char*  existing = nullptr;
        size_t len = 0;
        if (_dupenv_s(&existing, &len, kEnvName) == 0 && existing != nullptr)
        {
            std::string combined(existing);
            free(existing);
            // 既に同じ指定があれば尊重、無ければ追記
            if (combined.find("--force-device-scale-factor") == std::string::npos)
            {
                if (! combined.empty()) combined += ' ';
                combined += kArg;
                _putenv_s(kEnvName, combined.c_str());
            }
        }
        else
        {
            _putenv_s(kEnvName, kArg);
        }
    }
   #endif
    return juce::WebBrowserComponent::Options{};
}


//==============================================================================

ZeroCompAudioProcessorEditor::ZeroCompAudioProcessorEditor(ZeroCompAudioProcessor& p)
    : AudioProcessorEditor(&p),
      audioProcessor(p),
      webThresholdRelay    { zc::id::THRESHOLD.getParamID() },
      webRatioRelay        { zc::id::RATIO.getParamID() },
      webKneeRelay         { zc::id::KNEE_DB.getParamID() },
      webAttackRelay       { zc::id::ATTACK_MS.getParamID() },
      webReleaseRelay      { zc::id::RELEASE_MS.getParamID() },
      webOutputGainRelay   { zc::id::OUTPUT_GAIN.getParamID() },
      webAutoMakeupRelay   { zc::id::AUTO_MAKEUP.getParamID() },
      webModeRelay         { zc::id::MODE.getParamID() },
      webMeteringModeRelay { zc::id::METERING_MODE.getParamID() },
      webDisplayModeRelay  { zc::id::DISPLAY_MODE.getParamID() },
      thresholdAttachment    { *p.getState().getParameter(zc::id::THRESHOLD.getParamID()),     webThresholdRelay,    nullptr },
      ratioAttachment        { *p.getState().getParameter(zc::id::RATIO.getParamID()),         webRatioRelay,        nullptr },
      kneeAttachment         { *p.getState().getParameter(zc::id::KNEE_DB.getParamID()),       webKneeRelay,         nullptr },
      attackAttachment       { *p.getState().getParameter(zc::id::ATTACK_MS.getParamID()),     webAttackRelay,       nullptr },
      releaseAttachment      { *p.getState().getParameter(zc::id::RELEASE_MS.getParamID()),    webReleaseRelay,      nullptr },
      outputGainAttachment   { *p.getState().getParameter(zc::id::OUTPUT_GAIN.getParamID()),   webOutputGainRelay,   nullptr },
      autoMakeupAttachment   { *p.getState().getParameter(zc::id::AUTO_MAKEUP.getParamID()),   webAutoMakeupRelay,   nullptr },
      modeAttachment         { *p.getState().getParameter(zc::id::MODE.getParamID()),          webModeRelay,         nullptr },
      meteringModeAttachment { *p.getState().getParameter(zc::id::METERING_MODE.getParamID()), webMeteringModeRelay, nullptr },
      displayModeAttachment  { *p.getState().getParameter(zc::id::DISPLAY_MODE.getParamID()),  webDisplayModeRelay,  nullptr },
      webView{
          // ProTools Windows 等、DPI 非対応ホストで WebView2 の自動スケーリングを抑止する
          makeWebViewOptionsWithPreLaunchArgs(p)
              .withBackend(juce::WebBrowserComponent::Options::Backend::webview2)
              .withWinWebView2Options(
                  juce::WebBrowserComponent::Options::WinWebView2{}
                      .withBackgroundColour(juce::Colour(0xFF606F77))
                      .withUserDataFolder(juce::File::getSpecialLocation(
                          juce::File::SpecialLocationType::tempDirectory)))
              .withWebViewLifetimeListener(&webViewLifetimeGuard)
              .withNativeIntegrationEnabled()
              .withInitialisationData("vendor", "ZeroComp")
              .withInitialisationData("pluginName", "ZeroComp")
              .withInitialisationData("pluginVersion", ZEROCOMP_VERSION_STRING)
              .withOptionsFrom(controlParameterIndexReceiver)
              .withOptionsFrom(webThresholdRelay)
              .withOptionsFrom(webRatioRelay)
              .withOptionsFrom(webKneeRelay)
              .withOptionsFrom(webAttackRelay)
              .withOptionsFrom(webReleaseRelay)
              .withOptionsFrom(webOutputGainRelay)
              .withOptionsFrom(webAutoMakeupRelay)
              .withOptionsFrom(webModeRelay)
              .withOptionsFrom(webMeteringModeRelay)
              .withOptionsFrom(webDisplayModeRelay)
              .withNativeFunction(
                  juce::Identifier{"system_action"},
                  [this](const juce::Array<juce::var>& args,
                         juce::WebBrowserComponent::NativeFunctionCompletion completion)
                  { handleSystemAction(args, std::move(completion)); })
              .withNativeFunction(
                  juce::Identifier{"window_action"},
                  [this](const juce::Array<juce::var>& args,
                         juce::WebBrowserComponent::NativeFunctionCompletion completion)
                  {
                      // setSize は constrainer を経由しないため、ここで自前クランプする
                      auto clampW = [](int w) { return juce::jlimit(kMinWidth,  kMaxWidth,  w); };
                      auto clampH = [](int h) { return juce::jlimit(kMinHeight, kMaxHeight, h); };

                      if (args.size() > 0)
                      {
                          const auto action = args[0].toString();
                          if (action == "resizeTo" && args.size() >= 3)
                          {
                              const int w = clampW(juce::roundToInt((double) args[1]));
                              const int h = clampH(juce::roundToInt((double) args[2]));
                              setSize(w, h);
                              completion(juce::var{ true });
                              return;
                          }
                          if (action == "resizeBy" && args.size() >= 3)
                          {
                              const int dw = juce::roundToInt((double) args[1]);
                              const int dh = juce::roundToInt((double) args[2]);
                              setSize(clampW(getWidth() + dw), clampH(getHeight() + dh));
                              completion(juce::var{ true });
                              return;
                          }
                      }
                      completion(juce::var{ false });
                  })
              .withNativeFunction(
                  juce::Identifier{"open_url"},
                  [](const juce::Array<juce::var>& args,
                     juce::WebBrowserComponent::NativeFunctionCompletion completion)
                  {
                      if (args.size() > 0)
                      {
                          const auto url = args[0].toString();
                          juce::URL(url).launchInDefaultBrowser();
                      }
                      completion(juce::var{ true });
                  })
              .withResourceProvider([this](const juce::String& url) { return getResource(url); })
      }
{
   #if ZEROCOMP_DEV_MODE
    useLocalDevServer = true;
   #else
    useLocalDevServer = false;
   #endif

    addAndMakeVisible(webView);

    // 初期サイズ
    setSize(720, 500);

    // リサイズ可能に（プラグイン/スタンドアロン共通）
    //  - OS ウィンドウ四辺 / ResizableCornerComponent / WebUI オーバーレイ
    //    すべて同じ最小・最大サイズを適用（window_action 側のクランプもこの定数を参照）
    setResizable(true, true);
    setResizeLimits(kMinWidth, kMinHeight, kMaxWidth, kMaxHeight);
    resizerConstraints.setSizeLimits(kMinWidth, kMinHeight, kMaxWidth, kMaxHeight);

    // リサイズグリッパー。WebView よりも前面に置き、WebUI 側の overlay から
    //   window_action.resizeTo を受けた時にも本体を正しく追従させる。
    resizer.reset(new juce::ResizableCornerComponent(this, &resizerConstraints));
    addAndMakeVisible(resizer.get());
    resizer->setAlwaysOnTop(true);

    // ホスト側の最小画面表示量
    if (auto* hostConstrainer = getConstrainer())
        hostConstrainer->setMinimumOnscreenAmounts(50, 50, 50, 50);

    if (useLocalDevServer)
        webView.goToURL(LOCAL_DEV_SERVER_ADDRESS);
    else
        webView.goToURL(juce::WebBrowserComponent::getResourceProviderRoot());

    // 一部ホスト（Pro Tools AAX など）はコンストラクタ中の setSize を無視して
    //  ホスト側の保存サイズで最初の resized() を呼ぶことがあり、結果として
    //  kMinWidth/kMinHeight を割った状態で開いてレイアウトが崩れる。
    //  次のメッセージループで最小値を割っていたら初期サイズを強制する。
    juce::Component::SafePointer<ZeroCompAudioProcessorEditor> safeSelf { this };
    juce::MessageManager::callAsync([safeSelf]()
    {
        if (safeSelf == nullptr) return;
        if (safeSelf->getWidth() < kMinWidth || safeSelf->getHeight() < kMinHeight)
            safeSelf->setSize(720, 500);
    });

    // 60Hz。メーター / 波形 / DPI ポーリングの駆動源。
    //  ディスプレイ vsync と合い、波形ラン描画が 30Hz より滑らかに見える。
    startTimerHz(60);
}

ZeroCompAudioProcessorEditor::~ZeroCompAudioProcessorEditor()
{
    isShuttingDown.store(true, std::memory_order_release);
    stopTimer();
}

void ZeroCompAudioProcessorEditor::paint(juce::Graphics& g)
{
    g.fillAll(juce::Colour(0xFF606F77));
}

void ZeroCompAudioProcessorEditor::resized()
{
    webView.setBounds(getLocalBounds());
    if (resizer)
    {
        const int gripperSize = 24;
        resizer->setBounds(getWidth() - gripperSize, getHeight() - gripperSize, gripperSize, gripperSize);
        resizer->toFront(true);
    }
}

std::optional<ZeroCompAudioProcessorEditor::Resource>
ZeroCompAudioProcessorEditor::getResource(const juce::String& url) const
{
   #if ZEROCOMP_DEV_MODE
    juce::ignoreUnused(url);
    return std::nullopt;
   #else
    #if __has_include(<WebViewFiles.h>)
    const auto cleaned = url.startsWith("/") ? url.substring(1) : url;
    const auto resourcePath = cleaned.isEmpty() ? juce::String("index.html") : cleaned;
    const auto bytes = getWebViewFileAsBytes(resourcePath);
    if (bytes.empty())
        return std::nullopt;

    const auto extension = resourcePath.fromLastOccurrenceOf(".", false, false);
    return Resource{ std::move(bytes), juce::String(getMimeForExtension(extension)) };
    #else
    juce::ignoreUnused(url);
    return std::nullopt;
    #endif
   #endif
}

void ZeroCompAudioProcessorEditor::handleSystemAction(const juce::Array<juce::var>& args,
                                                      juce::WebBrowserComponent::NativeFunctionCompletion completion)
{
    if (args.size() > 0)
    {
        const auto action = args[0].toString();
        // 現状は "ready" を受けて状態を返すだけ。必要に応じて拡張。
        if (action == "ready")
        {
            juce::DynamicObject::Ptr init{ new juce::DynamicObject{} };
            init->setProperty("pluginName", "ZeroComp");
            init->setProperty("version", ZEROCOMP_VERSION_STRING);
            completion(juce::var{ init.get() });
            return;
        }
        if (action == "forward_key_event" && args.size() >= 2)
        {
            const bool forwarded = zc::KeyEventForwarder::forwardKeyEventToHost(args[1], this);
            completion(juce::var{ forwarded });
            return;
        }
    }
    completion(juce::var{});
}

#if defined(JUCE_WINDOWS)
// HWND 基準の DPI をポーリングし、変化時に再レイアウトを強制する。
//  - JUCE の AudioProcessorEditor は DPI 変化時に自動で再レイアウトしないことがあり、
//    特にモニター間移動で WebView 領域が見切れる症状が出る。
//  - `setSize(w+1, h+1); setSize(w, h);` の 2 段でダミー変更 → 元サイズに戻し、
//    内部の resized() を強制発火させる（MixCompare と同じ手当て）。
void ZeroCompAudioProcessorEditor::pollAndMaybeNotifyDpiChange()
{
    auto* peer = getPeer();
    if (peer == nullptr) return;

    HWND hwnd = (HWND) peer->getNativeHandle();
    int dpi = 0;
    double scale = 1.0;
    queryWindowDpi(hwnd, dpi, scale);
    if (dpi <= 0) return;

    const bool scaleChanged = std::abs(lastHwndScaleFactor - scale) >= 0.01;
    const bool dpiChanged   = lastHwndDpi != dpi;
    if (! (scaleChanged || dpiChanged)) return;

    lastHwndScaleFactor = scale;
    lastHwndDpi = dpi;

    // WebUI にも通知（任意の CSS 調整に利用可能）
    juce::DynamicObject::Ptr payload{ new juce::DynamicObject{} };
    payload->setProperty("scale", scale);
    payload->setProperty("dpi", dpi);
    webView.emitEventIfBrowserIsVisible("dpiScaleChanged", payload.get());

    // 見切れ回避のために強制再レイアウト
    const int w = getWidth();
    const int h = getHeight();
    setSize(w + 1, h + 1);
    setSize(w, h);
}
#endif

void ZeroCompAudioProcessorEditor::timerCallback()
{
    if (isShuttingDown.load(std::memory_order_acquire)) return;
    if (! webViewLifetimeGuard.isConstructed()) return;

   #if defined(JUCE_WINDOWS)
    // 各フレームで HWND の DPI 変化をチェック（ディスプレイ間移動対応）
    pollAndMaybeNotifyDpiChange();
   #endif

    // メーター減衰係数（60Hz タイマで約 20 dB/sec のリリースカーブ相当）。
    //  30Hz の 0.93 を per-second 保持率換算すると 0.93^30 ≈ 0.113。
    //  60Hz 同等にするには x^60 = 0.113 → x ≈ 0.965。
    //  - Peak/RMS: 新値は processBlock が atomicMaxFloat で突き上げる。
    //              UI タイマは毎フレーム係数を掛けて徐々に戻す（アタック瞬時・リリース指数）。
    //  - GR:       1.0（リダクション無し）に向かってインバース減衰する。
    //  - Momentary は内部で 400ms スライディング窓の積算を持つため decay 不要。
    constexpr float kPeakDecay = 0.965f;
    constexpr float kRmsDecay  = 0.965f;
    constexpr float kGrDecay   = 0.965f;

    auto readAndDecayMax = [](std::atomic<float>& slot, float decay) noexcept
    {
        float cur = slot.load(std::memory_order_relaxed);
        float next = cur * decay;
        while (! slot.compare_exchange_weak(cur, next,
                                             std::memory_order_acq_rel,
                                             std::memory_order_relaxed))
            next = cur * decay;
        return cur;
    };

    auto readAndDecayTowardsOne = [](std::atomic<float>& slot, float decay) noexcept
    {
        float cur = slot.load(std::memory_order_relaxed);
        float next = 1.0f - (1.0f - cur) * decay;
        while (! slot.compare_exchange_weak(cur, next,
                                             std::memory_order_acq_rel,
                                             std::memory_order_relaxed))
            next = 1.0f - (1.0f - cur) * decay;
        return cur;
    };

    // モード選択を取得
    int meteringMode = 0;
    if (auto* param = audioProcessor.getState().getParameter(zc::id::METERING_MODE.getParamID()))
    {
        if (auto* choice = dynamic_cast<juce::AudioParameterChoice*>(param))
            meteringMode = choice->getIndex();
    }

    // どのモードでも atomic を空に近づけるため、毎フレーム Peak/RMS 両方 decay 読み取り。
    const float inPeakL  = readAndDecayMax(audioProcessor.inPeakAccumL,  kPeakDecay);
    const float inPeakR  = readAndDecayMax(audioProcessor.inPeakAccumR,  kPeakDecay);
    const float outPeakL = readAndDecayMax(audioProcessor.outPeakAccumL, kPeakDecay);
    const float outPeakR = readAndDecayMax(audioProcessor.outPeakAccumR, kPeakDecay);

    const float inRmsL  = readAndDecayMax(audioProcessor.inRmsAccumL,  kRmsDecay);
    const float inRmsR  = readAndDecayMax(audioProcessor.inRmsAccumR,  kRmsDecay);
    const float outRmsL = readAndDecayMax(audioProcessor.outRmsAccumL, kRmsDecay);
    const float outRmsR = readAndDecayMax(audioProcessor.outRmsAccumR, kRmsDecay);

    const float minGainLin = readAndDecayTowardsOne(audioProcessor.minGainAccum, kGrDecay);

    const double grDb = (minGainLin >= 1.0f)
                            ? 0.0
                            : -static_cast<double>(juce::Decibels::gainToDecibels(minGainLin, -60.0f));

    juce::DynamicObject::Ptr meter { new juce::DynamicObject{} };
    juce::DynamicObject::Ptr input { new juce::DynamicObject{} };
    juce::DynamicObject::Ptr output{ new juce::DynamicObject{} };

    meter->setProperty("meteringMode", meteringMode);

    if (meteringMode == 2)
    {
        // Momentary LKFS（単一値）
        input ->setProperty("momentary", static_cast<double>(audioProcessor.inputMomentary .getMomentaryLKFS()));
        output->setProperty("momentary", static_cast<double>(audioProcessor.outputMomentary.getMomentaryLKFS()));
    }
    else if (meteringMode == 1)
    {
        // RMS dB
        input ->setProperty("rmsLeft",  juce::Decibels::gainToDecibels(inRmsL,  -60.0f));
        input ->setProperty("rmsRight", juce::Decibels::gainToDecibels(inRmsR,  -60.0f));
        output->setProperty("rmsLeft",  juce::Decibels::gainToDecibels(outRmsL, -60.0f));
        output->setProperty("rmsRight", juce::Decibels::gainToDecibels(outRmsR, -60.0f));
    }
    else
    {
        // Peak（True Peak 相当）dB
        input ->setProperty("truePeakLeft",  juce::Decibels::gainToDecibels(inPeakL,  -60.0f));
        input ->setProperty("truePeakRight", juce::Decibels::gainToDecibels(inPeakR,  -60.0f));
        output->setProperty("truePeakLeft",  juce::Decibels::gainToDecibels(outPeakL, -60.0f));
        output->setProperty("truePeakRight", juce::Decibels::gainToDecibels(outPeakR, -60.0f));
    }

    meter->setProperty("input",  input.get());
    meter->setProperty("output", output.get());
    meter->setProperty("grDb",   grDb);

    webView.emitEventIfBrowserIsVisible("meterUpdate", meter.get());

    // ---- Waveform display: FIFO からドレインしてまとめて emit ----
    //  audio thread が 200 Hz で slice を貯めている。60 Hz タイマなら毎フレーム 3-4 slice 受け取る想定。
    //  available == 0 のとき（transport 停止やコールバック不安定時）は emit しない。
    //  これにより JS 側は前フレームの canvas 画素を保持し、60Hz 化のちらつきを防ぐ。
    {
        auto& fifo = audioProcessor.waveformFifo;
        const int available = fifo.getNumReady();
        if (available > 0)
        {
            int start1 = 0, size1 = 0, start2 = 0, size2 = 0;
            fifo.prepareToRead(available, start1, size1, start2, size2);

            juce::Array<juce::var> peaks;
            juce::Array<juce::var> grDbs;
            peaks.ensureStorageAllocated(available);
            grDbs.ensureStorageAllocated(available);

            auto push = [&peaks, &grDbs, this](int start, int size)
            {
                for (int i = 0; i < size; ++i)
                {
                    const int idx = start + i;
                    const float peak = audioProcessor.waveformPeakBuffer   [static_cast<size_t>(idx)];
                    const float gLin = audioProcessor.waveformMinGainBuffer[static_cast<size_t>(idx)];
                    peaks.add(juce::var{ static_cast<double>(peak) });
                    const double grDbLocal = (gLin >= 1.0f)
                                                 ? 0.0
                                                 : -static_cast<double>(juce::Decibels::gainToDecibels(gLin, -60.0f));
                    grDbs.add(juce::var{ grDbLocal });
                }
            };
            push(start1, size1);
            push(start2, size2);
            fifo.finishedRead(size1 + size2);

            juce::DynamicObject::Ptr wf { new juce::DynamicObject{} };
            wf->setProperty("sliceHz", static_cast<double>(audioProcessor.waveformSliceHz.load(std::memory_order_relaxed)));
            wf->setProperty("peaks", peaks);
            wf->setProperty("grDb",  grDbs);
            webView.emitEventIfBrowserIsVisible("waveformUpdate", wf.get());
        }
    }
}
