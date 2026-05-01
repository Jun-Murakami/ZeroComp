// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jun Murakami
#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include <atomic>

namespace zc::dsp {

// ゼロレイテンシー・フィードフォワード・コンプレッサー
// - ピーク検出（ルックアヘッド無し）→ 瞬時ゲインリダクション計算 → attack/release envelope で平滑化
// - L/R 共通のゲインを適用（ステレオ像維持）
// - ソフトニー: threshold ± knee/2 の範囲で 2 次曲線により静的カーブを平滑化
// - 動作モード切替（Clean/Opto/FET/VariMu）:
//     Clean:  VCA ライク。ユーザ設定の attack/release をそのまま、色付け無し。
//     Opto:   dual envelope（slow = release * 5x）の max GR。リリースが 2 段になり粘る。
//             加えて LDR 熱メモリを近似: 深い GR が続くほど slow release がさらに長く引きずる
//             （LA-2A T4B セルの熱蓄積による "sticky" 挙動の粗い近似）。
//     FET:    1176 ライクの非対称ソフトクリップを信号経路後段に薄く足す（grit）。
//     VariMu: ニーを +12dB ぶん広げてカーブをなだらかに。加えて偶数次倍音系の柔らかい歪み。
//     いずれも lookahead / oversampling は一切使わず、純粋にゼロサンプルレイテンシーを維持。
class Compressor
{
public:
    enum class Mode
    {
        Clean = 0,   // VCA
        Opto,
        FET,
        VariMu,
    };

    void prepare(double sampleRate, int numChannels);
    void reset();

    // スレッショルド（dBFS, -80..0）
    void setThresholdDb(float thresholdDb) noexcept;
    // レシオ（1.0 = スルー, 100.0 = ブリックウォール相当）
    void setRatio(float ratio) noexcept;
    // ニー幅（dB, 0..24）— ユーザ設定値。VariMu モードでは内部で +12dB 広げて使う。
    void setKneeDb(float kneeDb) noexcept;
    // アタック時間（ms, 0.1..500）
    void setAttackMs(float attackMs) noexcept;
    // リリース時間（ms, 0.1..2000）
    void setReleaseMs(float releaseMs) noexcept;
    // 動作モード切替。
    void setMode(Mode m) noexcept { mode = m; }

    // ブロック処理（N チャネル対応）。
    // 戻り値は区間内の最大リダクション（リニア, 0..1, 1 = リダクション無し）
    // detectionBuffer != nullptr なら検出（サイドチェイン）用の信号として使い、ゲインは buffer に適用する。
    //  detectionBuffer == nullptr のときは buffer 自身が検出ソース（従来動作）。
    //  detectionBuffer は numSamples が buffer と一致している必要がある。チャネル数は 1 でも 2 以上でも可。
    // gainOut != nullptr なら各サンプルで適用された gain（リニア, 0..1）を書き出す。
    //  配列長は最低でも `buffer.getNumSamples()` 必要。
    float processBlock(juce::AudioBuffer<float>& buffer,
                       const juce::AudioBuffer<float>* detectionBuffer = nullptr,
                       float* gainOut = nullptr) noexcept;

private:
    // 入力 dB を GR（dB, 正値 = どれだけ下げるか）にマップする静的カーブ
    float computeGainReductionDb(float inputDb, float kneeForCurve) const noexcept;
    void  updateCoeffs() noexcept;

    // パラメータ
    float thresholdDb = 0.0f;
    float ratio       = 1.0f;    // >= 1
    float slope       = 0.0f;    // 1 - 1/ratio（静的カーブの傾き乗算子）
    float kneeDb      = 6.0f;
    float attackMs    = 10.0f;
    float releaseMs   = 100.0f;
    Mode  mode        = Mode::Clean;

    // 実行時状態
    double currentSampleRate = 44100.0;
    float  attackCoeff       = 0.0f;    // = exp(-1 / attack_samples)
    float  releaseCoeff      = 0.0f;
    float  releaseCoeffSlow  = 0.0f;    // Opto 用：release_ms * 5 の時定数（"cold" 時）
    float  releaseCoeffSticky = 0.0f;   // Opto 用：LDR が "hot" のとき目指す sticky 時定数（release_ms * 15）
    float  envelopeDb        = 0.0f;    // 平滑化後の GR envelope（dB, 正値 = 抑制量）
    float  envelopeDbSlow    = 0.0f;    // Opto 用の 2 本目

    // Opto LDR メモリ: envelope GR に追従してゆっくり蓄熱・冷却する 0..1 状態。
    //  - tauHeat:  ~1 秒で蓄熱（熱くなるのは比較的早い）
    //  - tauCool: ~3 秒で冷却（冷めるのは遅い、これが "記憶" の正体）
    //  熱いほど slow envelope のリリース coeff を sticky 側に寄せる（release が長引く）。
    float  ldrHeat        = 0.0f;
    float  ldrHeatUpCoeff = 0.0f;
    float  ldrCoolCoeff   = 0.0f;
};

} // namespace zc::dsp
