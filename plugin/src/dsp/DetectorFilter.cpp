// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jun Murakami
#include "DetectorFilter.h"

#include <cmath>

// Equalizer.cpp と同様、int↔size_t がループ境界で必然的に混在するためファイル単位で抑制。
JUCE_BEGIN_IGNORE_WARNINGS_GCC_LIKE ("-Wsign-conversion")

namespace zc::dsp {

namespace {

using Coeffs    = juce::dsp::IIR::Coefficients<float>;
using CoeffsPtr = Coeffs::Ptr;

// Butterworth n 次を biquad 段に分解した各段の Q（1/(2·sin((2k-1)π/(2n)))）+ 1st-order 有無。
//   6  → [],            1st ✓
//  12  → [0.7071],       1st ✗
//  18  → [1.0],          1st ✓
//  24  → [1.307, 0.541], 1st ✗
//  gainDb による共振スケールは検出用途では不要（pure Butterworth = maximally flat）。
struct SlopePlan { int numBiquads; bool has1stOrder; float biquadQs[2]; };

inline const SlopePlan& slopePlan(int slopeDbPerOct) noexcept
{
    static const SlopePlan s6  = { 0, true,  { 0.0f,        0.0f        } };
    static const SlopePlan s12 = { 1, false, { 0.70710678f, 0.0f        } };
    static const SlopePlan s18 = { 1, true,  { 1.0f,        0.0f        } };
    static const SlopePlan s24 = { 2, false, { 1.30656296f, 0.54119610f } };
    switch (slopeDbPerOct)
    {
        case  6: return s6;
        case 18: return s18;
        case 24: return s24;
        case 12: default: return s12;
    }
}

} // namespace

void DetectorFilter::prepare(double sampleRate, int numChannels, int maxBlockSize) noexcept
{
    sampleRate_  = sampleRate > 0.0 ? sampleRate : 44100.0;
    numChannels_ = juce::jlimit(1, kMaxChannels, numChannels);

    juce::dsp::ProcessSpec spec{};
    spec.sampleRate       = sampleRate_;
    spec.maximumBlockSize = static_cast<juce::uint32>(juce::jmax(1, maxBlockSize));
    spec.numChannels      = 1; // per-channel で手動ループ

    for (int s = 0; s < kMaxStages; ++s)
        for (int ch = 0; ch < kMaxChannels; ++ch)
        {
            hpFilters_[s][ch].prepare(spec);
            lpFilters_[s][ch].prepare(spec);
        }

    hpDirty_ = lpDirty_ = true;
    rebuild(Kind::HighPass);
    rebuild(Kind::LowPass);
}

void DetectorFilter::reset() noexcept
{
    for (int s = 0; s < kMaxStages; ++s)
        for (int ch = 0; ch < kMaxChannels; ++ch)
        {
            hpFilters_[s][ch].reset();
            lpFilters_[s][ch].reset();
        }
}

void DetectorFilter::setHighPass(float freqHz, int slopeDbPerOct) noexcept
{
    if (freqHz != hpFreq_ || slopeDbPerOct != hpSlope_)
    {
        hpFreq_  = freqHz;
        hpSlope_ = slopeDbPerOct;
        hpDirty_ = true;
    }
}

void DetectorFilter::setLowPass(float freqHz, int slopeDbPerOct) noexcept
{
    if (freqHz != lpFreq_ || slopeDbPerOct != lpSlope_)
    {
        lpFreq_  = freqHz;
        lpSlope_ = slopeDbPerOct;
        lpDirty_ = true;
    }
}

void DetectorFilter::rebuild(Kind kind) noexcept
{
    const bool isHp = (kind == Kind::HighPass);
    const float freq = isHp ? hpFreq_ : lpFreq_;
    // 端の値はバイパス扱い（HPF は最低域、LPF は最高域で「効かない」）。
    const bool enabled = isHp ? (freq > kOffHpfHz) : (freq < kOffLpfHz);

    auto& filters    = isHp ? hpFilters_ : lpFilters_;
    int&  stageCount = isHp ? hpStages_  : lpStages_;

    if (! enabled)
    {
        stageCount = 0;
        return;
    }

    const float sr = static_cast<float>(sampleRate_);
    const float f  = juce::jlimit(10.0f, sr * 0.49f, freq);
    const auto& plan = slopePlan(isHp ? hpSlope_ : lpSlope_);

    int stage = 0;
    for (int i = 0; i < plan.numBiquads; ++i, ++stage)
    {
        const float q = plan.biquadQs[i];
        CoeffsPtr c = isHp ? Coeffs::makeHighPass(sr, f, q)
                           : Coeffs::makeLowPass (sr, f, q);
        for (int ch = 0; ch < kMaxChannels; ++ch)
            *filters[stage][ch].coefficients = *c;
    }

    if (plan.has1stOrder)
    {
        CoeffsPtr c = isHp ? Coeffs::makeFirstOrderHighPass(sr, f)
                           : Coeffs::makeFirstOrderLowPass (sr, f);
        for (int ch = 0; ch < kMaxChannels; ++ch)
            *filters[stage][ch].coefficients = *c;
        ++stage;
    }

    stageCount = stage;
}

void DetectorFilter::processBlock(juce::AudioBuffer<float>& buffer) noexcept
{
    if (hpDirty_) { rebuild(Kind::HighPass); hpDirty_ = false; }
    if (lpDirty_) { rebuild(Kind::LowPass);  lpDirty_ = false; }

    const int numCh = juce::jmin(buffer.getNumChannels(), numChannels_);
    const int n     = buffer.getNumSamples();
    if (n <= 0 || numCh <= 0) return;
    if (hpStages_ == 0 && lpStages_ == 0) return;

    for (int ch = 0; ch < numCh; ++ch)
    {
        auto* data = buffer.getWritePointer(ch);
        juce::dsp::AudioBlock<float> block(&data, 1, static_cast<size_t>(n));
        juce::dsp::ProcessContextReplacing<float> ctx(block);
        for (int s = 0; s < hpStages_; ++s) hpFilters_[s][ch].process(ctx);
        for (int s = 0; s < lpStages_; ++s) lpFilters_[s][ch].process(ctx);
    }
}

} // namespace zc::dsp

JUCE_END_IGNORE_WARNINGS_GCC_LIKE
