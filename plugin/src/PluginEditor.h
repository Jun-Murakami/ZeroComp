// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jun Murakami
#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_extra/juce_gui_extra.h>
#include "PluginProcessor.h"
#include <optional>

class ZeroCompAudioProcessorEditor : public juce::AudioProcessorEditor,
                                     private juce::Timer
{
public:
    static constexpr int kMinWidth  = 485;
    static constexpr int kMinHeight = 320;
    static constexpr int kMaxWidth  = 2560;
    static constexpr int kMaxHeight = 1440;

    explicit ZeroCompAudioProcessorEditor(ZeroCompAudioProcessor&);
    ~ZeroCompAudioProcessorEditor() override;

    void paint(juce::Graphics&) override;
    void resized() override;

private:
    void timerCallback() override;

    using Resource = juce::WebBrowserComponent::Resource;
    std::optional<Resource> getResource(const juce::String& url) const;

    void handleSystemAction(const juce::Array<juce::var>& args,
                            juce::WebBrowserComponent::NativeFunctionCompletion completion);

    ZeroCompAudioProcessor& audioProcessor;

    // WebBrowserComponent より先に宣言（attachment から参照されるため）
    juce::WebSliderRelay       webThresholdRelay;
    juce::WebSliderRelay       webRatioRelay;
    juce::WebSliderRelay       webKneeRelay;
    juce::WebSliderRelay       webAttackRelay;
    juce::WebSliderRelay       webReleaseRelay;
    juce::WebSliderRelay       webOutputGainRelay;
    juce::WebToggleButtonRelay webAutoMakeupRelay;
    juce::WebToggleButtonRelay webSidechainRelay;
    juce::WebComboBoxRelay     webModeRelay;
    juce::WebComboBoxRelay     webMeteringModeRelay;
    juce::WebComboBoxRelay     webDisplayModeRelay; // Metering / Waveform

    juce::WebSliderParameterAttachment       thresholdAttachment;
    juce::WebSliderParameterAttachment       ratioAttachment;
    juce::WebSliderParameterAttachment       kneeAttachment;
    juce::WebSliderParameterAttachment       attackAttachment;
    juce::WebSliderParameterAttachment       releaseAttachment;
    juce::WebSliderParameterAttachment       outputGainAttachment;
    juce::WebToggleButtonParameterAttachment autoMakeupAttachment;
    juce::WebToggleButtonParameterAttachment sidechainAttachment;
    juce::WebComboBoxParameterAttachment     modeAttachment;
    juce::WebComboBoxParameterAttachment     meteringModeAttachment;
    juce::WebComboBoxParameterAttachment     displayModeAttachment;

    juce::WebControlParameterIndexReceiver controlParameterIndexReceiver;

    struct WebViewLifetimeGuard : public juce::WebViewLifetimeListener
    {
        std::atomic<bool> constructed{ false };
        void webViewConstructed(juce::WebBrowserComponent*) override { constructed.store(true, std::memory_order_release); }
        void webViewDestructed(juce::WebBrowserComponent*) override  { constructed.store(false, std::memory_order_release); }
        bool isConstructed() const { return constructed.load(std::memory_order_acquire); }
    } webViewLifetimeGuard;

    juce::WebBrowserComponent webView;

    bool useLocalDevServer = false;

    std::unique_ptr<juce::ResizableCornerComponent> resizer;
    juce::ComponentBoundsConstrainer resizerConstraints;

    // --- Linux 限定のウィンドウ制御（[[linux-dpi-resize-scaling]] と同方針）---
    //  Bitwig 等はホスト枠ドラッグをプラグインへ転送しないため、Linux では枠リサイズを無効化し
    //  （setResizable(false)）、自前ハンドル（window_action.resizeTo→setSize→host request_resize）
    //  のみ許可する。高頻度リサイズで取り残された黒残り/見切れは、ホストの echo 待ち（バック
    //  プレッシャ）と落ち着き後の 1px ジグル再同期で収束させる。Windows/macOS は従来どおり。
    void applyWindowResize(int targetW, int targetH,
                           juce::WebBrowserComponent::NativeFunctionCompletion completion);
    void resolveResizeAck();
    bool   resizeAckPending { false };
    bool   resizeSelfDriven { false };
    juce::uint32 resizeAckStartMs { 0 };
    juce::WebBrowserComponent::NativeFunctionCompletion pendingResizeCompletion;
    juce::uint32 lastResizeActivityMs { 0 };
    bool   settleReconcileDone { true };
    bool   resyncStep2Pending { false };
    int    resyncTargetW { 0 };
    int    resyncTargetH { 0 };
    // CSS px → 論理 px の換算比率（resizeBegin/apply_layout で確定し resizeTo/初期サイズに適用）。
    //  分数スケーリング環境でハンドル(CSS px)とウィンドウ(論理px)、初期サイズのズレを防ぐ（MixCompare 方式）。
    double webResizeRatioW { 1.0 };
    double webResizeRatioH { 1.0 };
    bool   initialLayoutApplied { false };
    int    designTargetW { 720 };
    int    designTargetH { 460 };

    std::atomic<bool> isShuttingDown{ false };

#if defined(JUCE_WINDOWS)
    double lastHwndScaleFactor { 0.0 };
    int    lastHwndDpi         { 0 };
    void   pollAndMaybeNotifyDpiChange();
#endif

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(ZeroCompAudioProcessorEditor)
};
