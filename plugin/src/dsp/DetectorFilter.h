// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jun Murakami
#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_dsp/juce_dsp.h>

#include <array>

namespace zc::dsp {

// 検出（サイドチェイン）経路用の HPF + LPF。
//  - 出力音声には掛からず、GR 検出に使う信号だけを帯域制限する。位相回りは
//    出力音質を汚さない（コントロール信号にのみ作用）ので、急峻なスロープでも安全。
//  - スロープは 6/12/18/24 dB/oct（Butterworth カスケード, 最小位相, ゼロレイテンシー）。
//  - HPF は freqHz <= kOffHpfHz で OFF、LPF は freqHz >= kOffLpfHz で OFF（端＝バイパス）。
//  - すべて audio thread から呼ばれる前提（ZeroComp は APVTS listener を使わず processBlock で
//    パラメータを読むため）。スレッド間同期は不要。
class DetectorFilter
{
public:
    static constexpr int   kMaxChannels = 2;
    // 24 dB/oct = biquad 2 段、18 dB/oct = biquad 1 段 + 1st-order 1 段 → いずれも最大 2 段。
    static constexpr int   kMaxStages   = 2;
    static constexpr float kOffHpfHz    = 10.0f;
    static constexpr float kOffLpfHz    = 24000.0f;

    void prepare(double sampleRate, int numChannels, int maxBlockSize) noexcept;
    void reset() noexcept;

    // freqHz が OFF 域なら該当フィルタは無効化。slopeDbPerOct は 6/12/18/24。
    void setHighPass(float freqHz, int slopeDbPerOct) noexcept;
    void setLowPass (float freqHz, int slopeDbPerOct) noexcept;

    bool isActive() const noexcept { return hpStages_ > 0 || lpStages_ > 0; }

    // バッファ in-place 処理（検出ソースバッファに対して呼ぶ）。両方 OFF なら何もしない。
    void processBlock(juce::AudioBuffer<float>& buffer) noexcept;

private:
    enum class Kind { HighPass, LowPass };
    void rebuild(Kind kind) noexcept;

    double sampleRate_  = 44100.0;
    int    numChannels_ = 2;

    float hpFreq_  = kOffHpfHz; int hpSlope_ = 12; bool hpDirty_ = true;
    float lpFreq_  = kOffLpfHz; int lpSlope_ = 12; bool lpDirty_ = true;

    int hpStages_ = 0;
    int lpStages_ = 0;

    // [stage][channel]。1st-order も biquad コンテナで扱う（b2=a2=0）。
    std::array<std::array<juce::dsp::IIR::Filter<float>, kMaxChannels>, kMaxStages> hpFilters_{};
    std::array<std::array<juce::dsp::IIR::Filter<float>, kMaxChannels>, kMaxStages> lpFilters_{};
};

} // namespace zc::dsp
