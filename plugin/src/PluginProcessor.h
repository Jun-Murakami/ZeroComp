#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_core/juce_core.h>
#include <juce_dsp/juce_dsp.h>
#include <atomic>
#include <vector>

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

    // ================= Waveform display (Pro-L / Pro-C 風オシロ表示) =================
    //  - 入力側の |L|,|R| マージ済みサンプルを slice（約 200 Hz）単位にダウンサンプルし、
    //    per-sample gain（Compressor から取得）の slice 内最小値と一緒にリングバッファへ push。
    //  - audio → UI は AbstractFifo で wait-free に受け渡し。
    //  - 5〜7 秒表示でも余裕を持つため 2048 slot（200Hz × ~10s）。
    static constexpr int kWaveformFifoSize   = 2048;
    static constexpr double kWaveformSliceHz = 200.0;
    juce::AbstractFifo waveformFifo{ kWaveformFifoSize };
    std::vector<float> waveformPeakBuffer;      // size = kWaveformFifoSize
    std::vector<float> waveformMinGainBuffer;   // size = kWaveformFifoSize
    int   waveformSliceSize         = 220;      // prepare 時に sampleRate/200 で設定
    int   waveformSliceSampleCount  = 0;        // audio thread のみ
    float waveformSlicePeakAccum    = 0.0f;     // audio thread のみ
    float waveformSliceMinGainAccum = 1.0f;     // audio thread のみ

    // UI 側が slice rate を描画スケールに使う（ほぼ 200 Hz 固定だが念のため）
    std::atomic<float> waveformSliceHz{ static_cast<float>(kWaveformSliceHz) };

    // audio thread から呼ばれる：1 サンプル相当の入力ピーク / per-sample gain を slice に積む。
    void pushWaveformSample(float absPeakSample, float perSampleGainLin) noexcept;

    // processBlock で使うスクラッチ（compressor の per-sample gain を受ける）。
    //  prepare で maxBlockSize ぶん事前確保、processBlock 中は追加 alloc しない。
    std::vector<float> waveformGainScratch;

private:
    juce::AudioProcessorValueTreeState parameters;
    static juce::AudioProcessorValueTreeState::ParameterLayout createParameterLayout();

    zc::dsp::Compressor compressor;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(ZeroCompAudioProcessor)
};
