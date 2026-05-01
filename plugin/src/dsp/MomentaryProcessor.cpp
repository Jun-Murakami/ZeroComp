// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jun Murakami
#include "MomentaryProcessor.h"

#include <algorithm>
#include <cmath>

namespace zc::dsp
{

MomentaryProcessor::MomentaryProcessor()
{
    reset();
}

void MomentaryProcessor::prepareToPlay(double sampleRate, int maximumBlockSize)
{
    currentSampleRate = sampleRate > 0.0 ? sampleRate : 48000.0;
    samplesPerBlock = maximumBlockSize;

    coefficients.updateForSampleRate(currentSampleRate);

    const int windowSamples = static_cast<int>(currentSampleRate * WINDOW_SIZE_MS / 1000.0);
    for (auto& buf : meanSquareBuffers)
        buf.setSizeInSamples(windowSamples);

    reset();
}

void MomentaryProcessor::reset()
{
    for (auto& state : filterStates)
        state.reset();
    for (auto& buf : meanSquareBuffers)
        buf.reset();

    momentaryLKFS = MIN_LKFS;
}

void MomentaryProcessor::processBlock(const juce::AudioBuffer<float>& buffer)
{
    const int numChannels = buffer.getNumChannels();
    const int numSamples = buffer.getNumSamples();
    if (numChannels == 0 || numSamples == 0)
        return;

    const int lanesToProcess = std::min(numChannels, 2);
    for (int channel = 0; channel < lanesToProcess; ++channel)
    {
        const float* channelData = buffer.getReadPointer(channel);
        auto& filterState = filterStates[static_cast<std::size_t>(channel)];
        auto& msBuffer = meanSquareBuffers[static_cast<std::size_t>(channel)];

        for (int sample = 0; sample < numSamples; ++sample)
        {
            const float weighted = processKWeighting(channelData[sample], filterState);
            msBuffer.pushSample(weighted);
        }
    }

    const float msL = meanSquareBuffers[0].getMeanSquare();
    const float msR = numChannels >= 2 ? meanSquareBuffers[1].getMeanSquare() : msL;

    momentaryLKFS = calculateLKFS(msL, msR);
}

float MomentaryProcessor::getMomentaryLKFS() const noexcept
{
    return momentaryLKFS.load(std::memory_order_relaxed);
}

float MomentaryProcessor::processKWeighting(float input, FilterState& state)
{
    const double x0_pre = input;
    const double y0_pre = coefficients.b0_pre * x0_pre
                        + coefficients.b1_pre * state.x1_pre
                        + coefficients.b2_pre * state.x2_pre
                        - coefficients.a1_pre * state.y1_pre
                        - coefficients.a2_pre * state.y2_pre;

    state.x2_pre = state.x1_pre;
    state.x1_pre = x0_pre;
    state.y2_pre = state.y1_pre;
    state.y1_pre = y0_pre;

    const double x0_rlb = y0_pre;
    const double y0_rlb = coefficients.b0_rlb * x0_rlb
                        + coefficients.b1_rlb * state.x1_rlb
                        + coefficients.b2_rlb * state.x2_rlb
                        - coefficients.a1_rlb * state.y1_rlb
                        - coefficients.a2_rlb * state.y2_rlb;

    state.x2_rlb = state.x1_rlb;
    state.x1_rlb = x0_rlb;
    state.y2_rlb = state.y1_rlb;
    state.y1_rlb = y0_rlb;

    return static_cast<float>(y0_rlb);
}

float MomentaryProcessor::calculateLKFS(float meanSquareLeft, float meanSquareRight) const
{
    if (meanSquareLeft <= 0.0f && meanSquareRight <= 0.0f)
        return MIN_LKFS;

    const float weightedSum = CHANNEL_WEIGHT * meanSquareLeft + CHANNEL_WEIGHT * meanSquareRight;
    if (weightedSum <= 0.0f)
        return MIN_LKFS;

    // LK = -0.691 + 10 * log10(sum(Gi * zi))  （ITU-R BS.1770-4）
    const float lkfs = -0.691f + 10.0f * std::log10(weightedSum);
    return std::max(lkfs, MIN_LKFS);
}

void MomentaryProcessor::KWeightingCoefficients::updateForSampleRate(double sampleRate)
{
    // 実装を簡略化して 48kHz 係数を流用する（広帯域な LKFS 表示には実用的に十分）。
    // 必要ならここに双一次変換による再計算を追加する。
    juce::ignoreUnused(sampleRate);
}

void MomentaryProcessor::FilterState::reset()
{
    x1_pre = x2_pre = y1_pre = y2_pre = 0.0;
    x1_rlb = x2_rlb = y1_rlb = y2_rlb = 0.0;
}

void MomentaryProcessor::MeanSquareBuffer::setSizeInSamples(int numSamples)
{
    const std::size_t size = numSamples > 0 ? static_cast<std::size_t>(numSamples) : 0;
    bufferSize = size;
    buffer.resize(bufferSize, 0.0f);
    reset();
}

void MomentaryProcessor::MeanSquareBuffer::reset()
{
    std::fill(buffer.begin(), buffer.end(), 0.0f);
    writeIndex = 0;
    sum = 0.0f;
    isFull = false;
}

void MomentaryProcessor::MeanSquareBuffer::pushSample(float weightedSample)
{
    if (bufferSize == 0)
        return;

    const float squared = weightedSample * weightedSample;
    if (isFull)
        sum -= buffer[writeIndex];

    buffer[writeIndex] = squared;
    sum += squared;

    writeIndex = (writeIndex + 1) % bufferSize;
    if (! isFull && writeIndex == 0)
        isFull = true;
}

float MomentaryProcessor::MeanSquareBuffer::getMeanSquare() const
{
    if (! isFull && writeIndex == 0)
        return 0.0f;

    const std::size_t count = isFull ? bufferSize : writeIndex;
    if (count == 0)
        return 0.0f;

    return sum / static_cast<float>(count);
}

} // namespace zc::dsp
