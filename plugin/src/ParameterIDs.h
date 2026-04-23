#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

namespace zc::id {
    // ゼロレイテンシー・コンプレッサー
    // - THRESHOLD:     -80..0 dBFS  (既定 0 = バイパス相当)
    // - RATIO:         1..100       (既定 4.0, log skew)
    // - KNEE_DB:       0..24 dB     (既定 6.0)
    // - ATTACK_MS:     0.1..500 ms  (既定 10.0, log skew)
    // - RELEASE_MS:    0.1..2000 ms (既定 100.0, log skew)
    // - OUTPUT_GAIN:   -24..+24 dB  (既定 0)
    // - AUTO_MAKEUP:   bool        (既定 OFF) ON 時は threshold/ratio から自動算出した makeup を OUTPUT_GAIN の代わりに適用。
    //                              makeup_dB = -threshold * (1 - 1/ratio)。UI 側では Output フェーダーを無効表示にする。
    // - MODE:          0=VCA(Clean) / 1=Opto / 2=FET / 3=Vari-Mu（既定 VCA）
    //                  既存の Threshold/Ratio/Knee/Attack/Release をそのまま使い、モードは
    //                  エンベロープ挙動 + 信号経路の色付け（サチュレーション）を切り替える。
    //                  ゼロレイテンシー原則を崩すような処理（lookahead / oversampling）は一切入れない。
    // - METERING_MODE: 0=Peak / 1=RMS / 2=Momentary
    // - DISPLAY_MODE:  中央表示のモード（0=Metering / 1=Waveform、既定 Metering）
    const juce::ParameterID THRESHOLD    {"THRESHOLD",     1};
    const juce::ParameterID RATIO        {"RATIO",         1};
    const juce::ParameterID KNEE_DB      {"KNEE_DB",       1};
    const juce::ParameterID ATTACK_MS    {"ATTACK_MS",     1};
    const juce::ParameterID RELEASE_MS   {"RELEASE_MS",    1};
    const juce::ParameterID OUTPUT_GAIN  {"OUTPUT_GAIN",   1};
    const juce::ParameterID AUTO_MAKEUP  {"AUTO_MAKEUP",   1};
    const juce::ParameterID MODE         {"MODE",          1};
    const juce::ParameterID METERING_MODE{"METERING_MODE", 1};
    const juce::ParameterID DISPLAY_MODE {"DISPLAY_MODE",  1};
}  // namespace zc::id
