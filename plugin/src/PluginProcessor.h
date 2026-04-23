#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_core/juce_core.h>
#include <juce_dsp/juce_dsp.h>
#include <atomic>

#include "ParameterIDs.h"
#include "dsp/Compressor.h"
#include "dsp/MomentaryProcessor.h"

class ZeroCompAudioProcessor : public juce::AudioProcessor
{
public:
    ZeroCompAudioProcessor();
    ~ZeroCompAudioProcessor() override;

    const juce::String getName() const override;
    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override;
    bool isBusesLayoutSupported(const juce::AudioProcessor::BusesLayout& layouts) const override;
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    bool hasEditor() const override;
    juce::AudioProcessorEditor* createEditor() override;

    double getTailLengthSeconds() const override;
    bool acceptsMidi() const override;
    bool producesMidi() const override;
    bool isMidiEffect() const override;

    int getNumPrograms() override;
    int getCurrentProgram() override;
    void setCurrentProgram(int) override;
    const juce::String getProgramName(int) override;
    void changeProgramName(int, const juce::String&) override;
    void getStateInformation(juce::MemoryBlock& destData) override;
    void setStateInformation(const void* data, int sizeInBytes) override;

    juce::AudioProcessorValueTreeState& getState() { return parameters; }

    // メーター値（区間最大の蓄積用。UI タイマーで読み取る）
    std::atomic<float> inPeakAccumL { 0.0f };
    std::atomic<float> inPeakAccumR { 0.0f };
    std::atomic<float> outPeakAccumL{ 0.0f };
    std::atomic<float> outPeakAccumR{ 0.0f };
    std::atomic<float> minGainAccum { 1.0f };  // 区間最小ゲイン = 最大リダクション

    std::atomic<float> inRmsAccumL { 0.0f };
    std::atomic<float> inRmsAccumR { 0.0f };
    std::atomic<float> outRmsAccumL{ 0.0f };
    std::atomic<float> outRmsAccumR{ 0.0f };

    zc::dsp::MomentaryProcessor inputMomentary;
    zc::dsp::MomentaryProcessor outputMomentary;

private:
    juce::AudioProcessorValueTreeState parameters;
    static juce::AudioProcessorValueTreeState::ParameterLayout createParameterLayout();

    zc::dsp::Compressor compressor;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(ZeroCompAudioProcessor)
};
