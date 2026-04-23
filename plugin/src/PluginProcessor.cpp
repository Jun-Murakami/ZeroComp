#include "PluginProcessor.h"
#include "PluginEditor.h"

#include <cmath>
#include <algorithm>
#include <memory>
#include <vector>

namespace {
    inline void atomicMaxFloat(std::atomic<float>& slot, float candidate) noexcept
    {
        float prev = slot.load(std::memory_order_relaxed);
        while (candidate > prev &&
               !slot.compare_exchange_weak(prev, candidate,
                                           std::memory_order_acq_rel,
                                           std::memory_order_relaxed))
        { /* retry */ }
    }

    inline void atomicMinFloat(std::atomic<float>& slot, float candidate) noexcept
    {
        float prev = slot.load(std::memory_order_relaxed);
        while (candidate < prev &&
               !slot.compare_exchange_weak(prev, candidate,
                                           std::memory_order_acq_rel,
                                           std::memory_order_relaxed))
        { /* retry */ }
    }

    // 対数スキュー（等比マッピング）付き NormalisableRange を組み立てる。
    juce::NormalisableRange<float> makeLogRange(float start, float end, float interval = 0.0f)
    {
        return juce::NormalisableRange<float>(
            start, end,
            [](float a, float b, float t)  { return a * std::pow(b / a, t); },
            [](float a, float b, float v)  { return std::log(v / a) / std::log(b / a); },
            [interval](float a, float b, float v)
            {
                v = juce::jlimit(a, b, v);
                if (interval > 0.0f)
                    v = a * std::pow(b / a, std::round(std::log(v / a) / std::log(b / a) / interval) * interval);
                return v;
            });
    }
}

ZeroCompAudioProcessor::ZeroCompAudioProcessor()
    : AudioProcessor(BusesProperties()
                         .withInput ("Input",  juce::AudioChannelSet::stereo(), true)
                         .withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      parameters(*this, nullptr, juce::Identifier("ZeroComp"), createParameterLayout())
{
}

ZeroCompAudioProcessor::~ZeroCompAudioProcessor() = default;

juce::AudioProcessorValueTreeState::ParameterLayout ZeroCompAudioProcessor::createParameterLayout()
{
    std::vector<std::unique_ptr<juce::RangedAudioParameter>> params;

    // THRESHOLD: -80..0 dBFS（既定 0 = バイパス相当）
    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        zc::id::THRESHOLD,
        "Threshold",
        juce::NormalisableRange<float>(-80.0f, 0.0f, 0.1f),
        0.0f,
        juce::AudioParameterFloatAttributes().withLabel("dB")));

    // RATIO: 1..100（log skew）
    //  内部は 1:1 〜 100:1 のリニア値。UI には "N:1" 表示を任せる。
    //  既定 1:1 = スルー相当（ユーザが明示的に動かすまでは圧縮しない）。
    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        zc::id::RATIO,
        "Ratio",
        makeLogRange(1.0f, 100.0f),
        1.0f,
        juce::AudioParameterFloatAttributes().withLabel(":1")));

    // KNEE_DB: 0..24 dB（リニア）
    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        zc::id::KNEE_DB,
        "Knee",
        juce::NormalisableRange<float>(0.0f, 24.0f, 0.1f),
        6.0f,
        juce::AudioParameterFloatAttributes().withLabel("dB")));

    // ATTACK_MS: 0.1..500 ms（log skew）
    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        zc::id::ATTACK_MS,
        "Attack",
        makeLogRange(0.1f, 500.0f),
        10.0f,
        juce::AudioParameterFloatAttributes().withLabel("ms")));

    // RELEASE_MS: 0.1..2000 ms（log skew）
    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        zc::id::RELEASE_MS,
        "Release",
        makeLogRange(0.1f, 2000.0f),
        100.0f,
        juce::AudioParameterFloatAttributes().withLabel("ms")));

    // OUTPUT_GAIN: -24..+24 dB
    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        zc::id::OUTPUT_GAIN,
        "Output Gain",
        juce::NormalisableRange<float>(-24.0f, 24.0f, 0.1f),
        0.0f,
        juce::AudioParameterFloatAttributes().withLabel("dB")));

    // AUTO_MAKEUP: bool。既定 OFF。ON 時は threshold/ratio から自動算出した makeup を適用。
    //  UI 側では Output Gain を無効表示にする。
    params.push_back(std::make_unique<juce::AudioParameterBool>(
        zc::id::AUTO_MAKEUP,
        "Auto Makeup",
        false));

    // MODE: VCA(Clean) / Opto / FET / Vari-Mu
    //  いずれもゼロレイテンシー動作で、エンベロープ挙動 + 後段サチュレーションの切替。
    params.push_back(std::make_unique<juce::AudioParameterChoice>(
        zc::id::MODE,
        "Mode",
        juce::StringArray{ "VCA", "Opto", "FET", "Vari-Mu" },
        0));

    // METERING_MODE: Peak / RMS / Momentary
    params.push_back(std::make_unique<juce::AudioParameterChoice>(
        zc::id::METERING_MODE,
        "Metering Mode",
        juce::StringArray{ "Peak", "RMS", "Momentary" },
        0));

    return { params.begin(), params.end() };
}

const juce::String ZeroCompAudioProcessor::getName() const { return JucePlugin_Name; }
bool ZeroCompAudioProcessor::acceptsMidi() const           { return false; }
bool ZeroCompAudioProcessor::producesMidi() const          { return false; }
bool ZeroCompAudioProcessor::isMidiEffect() const          { return false; }
double ZeroCompAudioProcessor::getTailLengthSeconds() const{ return 0.0; }

int ZeroCompAudioProcessor::getNumPrograms() { return 1; }
int ZeroCompAudioProcessor::getCurrentProgram() { return 0; }
void ZeroCompAudioProcessor::setCurrentProgram(int) {}
const juce::String ZeroCompAudioProcessor::getProgramName(int) { return {}; }
void ZeroCompAudioProcessor::changeProgramName(int, const juce::String&) {}

void ZeroCompAudioProcessor::prepareToPlay(double sampleRate, int samplesPerBlock)
{
    compressor.prepare(sampleRate, getTotalNumOutputChannels());

    if (auto* p = parameters.getRawParameterValue(zc::id::THRESHOLD.getParamID()))
        compressor.setThresholdDb(p->load());
    if (auto* p = parameters.getRawParameterValue(zc::id::RATIO.getParamID()))
        compressor.setRatio(p->load());
    if (auto* p = parameters.getRawParameterValue(zc::id::KNEE_DB.getParamID()))
        compressor.setKneeDb(p->load());
    if (auto* p = parameters.getRawParameterValue(zc::id::ATTACK_MS.getParamID()))
        compressor.setAttackMs(p->load());
    if (auto* p = parameters.getRawParameterValue(zc::id::RELEASE_MS.getParamID()))
        compressor.setReleaseMs(p->load());
    if (auto* p = parameters.getRawParameterValue(zc::id::MODE.getParamID()))
    {
        const int idx = juce::jlimit(0, 3, static_cast<int>(p->load() + 0.5f));
        compressor.setMode(static_cast<zc::dsp::Compressor::Mode>(idx));
    }

    inputMomentary.prepareToPlay(sampleRate, samplesPerBlock);
    outputMomentary.prepareToPlay(sampleRate, samplesPerBlock);

    inputCopyBuffer.setSize(getTotalNumInputChannels(),
                            samplesPerBlock,
                            /*keepExistingContent*/ false,
                            /*clearExtraSpace*/     true,
                            /*avoidReallocating*/   false);
}

void ZeroCompAudioProcessor::releaseResources()
{
    compressor.reset();
    inputMomentary.reset();
    outputMomentary.reset();
    inputCopyBuffer.setSize(0, 0);
}

bool ZeroCompAudioProcessor::isBusesLayoutSupported(const juce::AudioProcessor::BusesLayout& layouts) const
{
    const auto& mainIn  = layouts.getMainInputChannelSet();
    const auto& mainOut = layouts.getMainOutputChannelSet();
    if (mainIn.isDisabled() || mainOut.isDisabled()) return false;
    if (mainIn != mainOut) return false;
    return mainOut == juce::AudioChannelSet::mono()
        || mainOut == juce::AudioChannelSet::stereo();
}

void ZeroCompAudioProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& /*midi*/)
{
    juce::ScopedNoDenormals noDenormals;

    const int numChannels = buffer.getNumChannels();
    const int numSamples  = buffer.getNumSamples();
    if (numSamples <= 0 || numChannels <= 0) return;

    // --- パラメータ取得 ---
    const float thresholdDb = parameters.getRawParameterValue(zc::id::THRESHOLD.getParamID())->load();
    const float ratio       = parameters.getRawParameterValue(zc::id::RATIO.getParamID())->load();
    const float kneeDb      = parameters.getRawParameterValue(zc::id::KNEE_DB.getParamID())->load();
    const float attackMs    = parameters.getRawParameterValue(zc::id::ATTACK_MS.getParamID())->load();
    const float releaseMs   = parameters.getRawParameterValue(zc::id::RELEASE_MS.getParamID())->load();
    const float outGainDb   = parameters.getRawParameterValue(zc::id::OUTPUT_GAIN.getParamID())->load();
    const bool  autoMakeup  = parameters.getRawParameterValue(zc::id::AUTO_MAKEUP.getParamID())->load() > 0.5f;
    const int   modeIdx     = static_cast<int>(parameters.getRawParameterValue(zc::id::MODE.getParamID())->load() + 0.5f);

    compressor.setThresholdDb(thresholdDb);
    compressor.setRatio(ratio);
    compressor.setKneeDb(kneeDb);
    compressor.setAttackMs(attackMs);
    compressor.setReleaseMs(releaseMs);
    compressor.setMode(static_cast<zc::dsp::Compressor::Mode>(
        juce::jlimit(0, 3, modeIdx)));

    // --- 入力コピー（破壊前に退避）---
    if (inputCopyBuffer.getNumChannels() != numChannels
        || inputCopyBuffer.getNumSamples() < numSamples)
    {
        inputCopyBuffer.setSize(numChannels, numSamples, false, false, /*avoidReallocating*/ true);
    }
    for (int ch = 0; ch < numChannels; ++ch)
        inputCopyBuffer.copyFrom(ch, 0, buffer, ch, 0, numSamples);

    // --- 入力メータ（Peak + RMS）---
    {
        auto* l = inputCopyBuffer.getReadPointer(0);
        auto* r = inputCopyBuffer.getReadPointer(std::min(1, numChannels - 1));
        float peakL = 0.0f, peakR = 0.0f, sqL = 0.0f, sqR = 0.0f;
        for (int i = 0; i < numSamples; ++i)
        {
            const float al = std::abs(l[i]);
            const float ar = std::abs(r[i]);
            peakL = std::max(peakL, al);
            peakR = std::max(peakR, ar);
            sqL += l[i] * l[i];
            sqR += r[i] * r[i];
        }
        atomicMaxFloat(inPeakAccumL, peakL);
        atomicMaxFloat(inPeakAccumR, peakR);
        const float invN = 1.0f / static_cast<float>(numSamples);
        atomicMaxFloat(inRmsAccumL, std::sqrt(sqL * invN));
        atomicMaxFloat(inRmsAccumR, std::sqrt(sqR * invN));
    }
    inputMomentary.processBlock(inputCopyBuffer);

    // --- コンプ本体 ---
    const float minGain = compressor.processBlock(buffer);
    atomicMinFloat(minGainAccum, minGain);

    // --- 出力ゲイン / Auto Makeup ---
    //  Auto Makeup ON 時は threshold/ratio から自動算出した makeup を基本値として適用。
    //  formula: makeup_dB = -threshold * (1 - 1/ratio) * 0.5   （ハーフ補償）
    //    - フル補償だと 0 dBFS ピークがそのままピークに戻り出力が張り付くため、半分に抑える。
    //  さらに OUTPUT_GAIN をトリムとして加算する（Auto Makeup の上に ± 微調整ができる）。
    //  OFF 時は従来通り OUTPUT_GAIN のみ。
    const float autoMakeupDb = -thresholdDb * (1.0f - 1.0f / std::max(1.0f, ratio)) * 0.5f;
    const float effectiveGainDb = (autoMakeup ? autoMakeupDb : 0.0f) + outGainDb;
    const float outGainLin = std::pow(10.0f, effectiveGainDb / 20.0f);
    if (std::abs(outGainLin - 1.0f) > 1.0e-6f)
    {
        for (int ch = 0; ch < numChannels; ++ch)
            buffer.applyGain(ch, 0, numSamples, outGainLin);
    }

    // --- 出力メータ（Peak + RMS）---
    {
        auto* l = buffer.getReadPointer(0);
        auto* r = buffer.getReadPointer(std::min(1, numChannels - 1));
        float peakL = 0.0f, peakR = 0.0f, sqL = 0.0f, sqR = 0.0f;
        for (int i = 0; i < numSamples; ++i)
        {
            const float al = std::abs(l[i]);
            const float ar = std::abs(r[i]);
            peakL = std::max(peakL, al);
            peakR = std::max(peakR, ar);
            sqL += l[i] * l[i];
            sqR += r[i] * r[i];
        }
        atomicMaxFloat(outPeakAccumL, peakL);
        atomicMaxFloat(outPeakAccumR, peakR);
        const float invN = 1.0f / static_cast<float>(numSamples);
        atomicMaxFloat(outRmsAccumL, std::sqrt(sqL * invN));
        atomicMaxFloat(outRmsAccumR, std::sqrt(sqR * invN));
    }
    outputMomentary.processBlock(buffer);
}

bool ZeroCompAudioProcessor::hasEditor() const { return true; }

juce::AudioProcessorEditor* ZeroCompAudioProcessor::createEditor()
{
    return new ZeroCompAudioProcessorEditor(*this);
}

void ZeroCompAudioProcessor::getStateInformation(juce::MemoryBlock& destData)
{
    if (auto xml = parameters.copyState().createXml())
        copyXmlToBinary(*xml, destData);
}

void ZeroCompAudioProcessor::setStateInformation(const void* data, int sizeInBytes)
{
    if (auto xml = getXmlFromBinary(data, sizeInBytes))
    {
        if (xml->hasTagName(parameters.state.getType()))
            parameters.replaceState(juce::ValueTree::fromXml(*xml));
    }
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new ZeroCompAudioProcessor();
}
