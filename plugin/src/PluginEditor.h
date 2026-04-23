#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_extra/juce_gui_extra.h>
#include "PluginProcessor.h"
#include <optional>

class ZeroCompAudioProcessorEditor : public juce::AudioProcessorEditor,
                                     private juce::Timer
{
public:
    static constexpr int kMinWidth  = 520;
    static constexpr int kMinHeight = 390;
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

    std::atomic<bool> isShuttingDown{ false };

#if defined(JUCE_WINDOWS)
    double lastHwndScaleFactor { 0.0 };
    int    lastHwndDpi         { 0 };
    void   pollAndMaybeNotifyDpiChange();
#endif

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(ZeroCompAudioProcessorEditor)
};
