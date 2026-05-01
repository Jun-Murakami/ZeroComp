// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jun Murakami
#pragma once

#include <juce_audio_basics/juce_audio_basics.h>

#include <array>
#include <atomic>
#include <cstddef>
#include <vector>

namespace zc::dsp
{

// ITU-R BS.1770-4 準拠の Momentary ラウドネス（LKFS）計算。
// - K-weighting（2 段 IIR）で聴感補正
// - 400ms スライディング窓で mean square → LKFS
class MomentaryProcessor
{
public:
    MomentaryProcessor();
    ~MomentaryProcessor() = default;

    void prepareToPlay(double sampleRate, int maximumBlockSize);
    void reset();

    // ステレオ想定。モノラルでも動作する（L=R として扱う）。
    void processBlock(const juce::AudioBuffer<float>& buffer);

    float getMomentaryLKFS() const noexcept;

private:
    struct KWeightingCoefficients
    {
        // Stage 1: Pre-filter (high shelf)
        double b0_pre = 1.53512485958697;
        double b1_pre = -2.69169618940638;
        double b2_pre = 1.19839281085285;
        double a1_pre = -1.69065929318241;
        double a2_pre = 0.73248077421585;

        // Stage 2: RLB-weighting (high-pass)
        double b0_rlb = 1.0;
        double b1_rlb = -2.0;
        double b2_rlb = 1.0;
        double a1_rlb = -1.99004745483398;
        double a2_rlb = 0.99007225036621;

        // ITU 係数は 48kHz 基準。別サンプルレートでは双一次変換での再計算が理想だが、
        // ブロードキャスト用途の実用範囲では簡略化（MixCompare と同等）。
        void updateForSampleRate(double sampleRate);
    };

    struct FilterState
    {
        double x1_pre = 0.0, x2_pre = 0.0, y1_pre = 0.0, y2_pre = 0.0;
        double x1_rlb = 0.0, x2_rlb = 0.0, y1_rlb = 0.0, y2_rlb = 0.0;
        void reset();
    };

    class MeanSquareBuffer
    {
    public:
        void setSizeInSamples(int numSamples);
        void reset();
        void pushSample(float weightedSample);
        float getMeanSquare() const;

    private:
        std::vector<float> buffer;
        std::size_t writeIndex = 0;
        std::size_t bufferSize = 0;
        float sum = 0.0f;
        bool isFull = false;
    };

    float processKWeighting(float input, FilterState& state);
    float calculateLKFS(float meanSquareLeft, float meanSquareRight) const;

    double currentSampleRate = 48000.0;
    int samplesPerBlock = 512;

    KWeightingCoefficients coefficients;
    std::array<FilterState, 2> filterStates;
    std::array<MeanSquareBuffer, 2> meanSquareBuffers;

    std::atomic<float> momentaryLKFS{ -100.0f };

    static constexpr float WINDOW_SIZE_MS = 400.0f;
    static constexpr float MIN_LKFS = -70.0f;
    static constexpr float CHANNEL_WEIGHT = 1.0f;
};

} // namespace zc::dsp
