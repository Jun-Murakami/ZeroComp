// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jun Murakami
#include "Compressor.h"

#include <algorithm>
#include <cmath>

namespace zc::dsp {

namespace {
    inline float sanitizeFinite(float v, float fallback = 0.0f) noexcept
    {
        return std::isfinite(v) ? v : fallback;
    }

    inline float clampFinite(float v, float lo, float hi, float fallback) noexcept
    {
        return std::clamp(sanitizeFinite(v, fallback), lo, hi);
    }
}

void Compressor::prepare(double sampleRate, int /*numChannels*/)
{
    currentSampleRate = sampleRate > 0.0 ? sampleRate : 44100.0;
    updateCoeffs();
    reset();
}

void Compressor::reset()
{
    envelopeDb     = 0.0f;
    envelopeDbSlow = 0.0f;
    ldrHeat        = 0.0f;
}

void Compressor::setThresholdDb(float v) noexcept
{
    thresholdDb = clampFinite(v, -80.0f, 0.0f, 0.0f);
}

void Compressor::setRatio(float r) noexcept
{
    ratio = clampFinite(r, 1.0f, 100.0f, 1.0f);
    // 1/ratio: r=1 → 1.0（抑制なし）, r→∞ → 0（ブリックウォール）
    slope = 1.0f - 1.0f / ratio;
}

void Compressor::setKneeDb(float k) noexcept
{
    kneeDb = clampFinite(k, 0.0f, 24.0f, 6.0f);
}

void Compressor::setAttackMs(float ms) noexcept
{
    attackMs = clampFinite(ms, 0.1f, 500.0f, 10.0f);
    updateCoeffs();
}

void Compressor::setReleaseMs(float ms) noexcept
{
    releaseMs = clampFinite(ms, 0.1f, 2000.0f, 100.0f);
    updateCoeffs();
}

void Compressor::updateCoeffs() noexcept
{
    // coeff = exp(-1 / (ms * 1e-3 * fs))
    const double tauA      = static_cast<double>(attackMs)  * 0.001 * currentSampleRate;
    const double tauR      = static_cast<double>(releaseMs) * 0.001 * currentSampleRate;
    // Opto の slow 側は release の 5 倍 ("cold" 基準)。15 倍が "hot" 時の sticky tail。
    const double tauRSlow   = tauR * 5.0;
    const double tauRSticky = tauR * 15.0;

    attackCoeff       = tauA       > 0.0 ? static_cast<float>(std::exp(-1.0 / tauA))       : 0.0f;
    releaseCoeff      = tauR       > 0.0 ? static_cast<float>(std::exp(-1.0 / tauR))       : 0.0f;
    releaseCoeffSlow  = tauRSlow   > 0.0 ? static_cast<float>(std::exp(-1.0 / tauRSlow))   : 0.0f;
    releaseCoeffSticky= tauRSticky > 0.0 ? static_cast<float>(std::exp(-1.0 / tauRSticky)) : 0.0f;

    // LDR 熱の時定数はユーザ release から独立（秒オーダの slow dynamics を意識的に持たせる）。
    //  蓄熱 tau = 1s、冷却 tau = 3s。冷却の方が遅いことで "最近の GR 履歴" が尾を引く形になる。
    const double tauHeatUp = 1.0 * currentSampleRate;
    const double tauCool   = 3.0 * currentSampleRate;
    ldrHeatUpCoeff = static_cast<float>(std::exp(-1.0 / tauHeatUp));
    ldrCoolCoeff   = static_cast<float>(std::exp(-1.0 / tauCool));
}

float Compressor::computeGainReductionDb(float inputDb, float kneeForCurve) const noexcept
{
    inputDb = sanitizeFinite(inputDb, -120.0f);
    kneeForCurve = clampFinite(kneeForCurve, 0.0f, 36.0f, 0.0f);

    // Giannoulis/Massberg/Reiss 2012 の静的カーブ（ソフトニー付き）。
    //  y = x                                      (x < T - K/2)
    //  y = x + slope * (x - T + K/2)^2 / (2K)     (|x - T| <= K/2)
    //  y = x + slope * (x - T)                    (x > T + K/2)
    // GR = x - y（常に >= 0）
    if (kneeForCurve <= 0.0f)
    {
        if (inputDb <= thresholdDb) return 0.0f;
        return slope * (inputDb - thresholdDb);
    }

    const float half = 0.5f * kneeForCurve;
    const float diff = inputDb - thresholdDb;
    if (diff < -half) return 0.0f;
    if (diff >  half) return slope * diff;

    const float x = diff + half;  // 0..K
    return slope * (x * x) / (2.0f * kneeForCurve);
}

namespace {
    // FET 風の非対称ソフトクリップ。drive で強度を調整する。
    //  正側を少し強めに潰し、負側は控えめにすることで 2 次歪を作る（= 偶数次の色付け混じりでも構わないが、
    //  1176 の独特な "grit" は非対称の奇数次主体なのでこちらを採用）。
    inline float fetSaturate(float x, float drive) noexcept
    {
        if (drive <= 0.0f) return x;
        // 非対称バイアスを小さく乗せて tanh
        constexpr float asym = 0.08f;
        const float y = std::tanh((x + asym) * drive) - std::tanh(asym * drive);
        return y / drive;
    }

    // Vari-Mu / tube 風の柔らかい飽和。偶数次倍音を足すため sign preserving に設計。
    //  drive は 0 で透過、1 で分かりやすい倍音量。
    inline float variMuSaturate(float x, float drive) noexcept
    {
        if (drive <= 0.0f) return x;
        const float ax = std::abs(x);
        // 軽い 2 次ベンド: x - a * sign(x) * x^2
        //  入力が大きいほど少し押し戻すような挙動で、tube の "圧縮感" を演出。
        return x - drive * 0.12f * std::copysign(ax * ax, x);
    }
}

float Compressor::processBlock(juce::AudioBuffer<float>& buffer,
                               const juce::AudioBuffer<float>* detectionBuffer,
                               float* gainOut) noexcept
{
    const int numChannels = buffer.getNumChannels();
    const int numSamples  = buffer.getNumSamples();
    if (numChannels <= 0 || numSamples <= 0) return 1.0f;

    // 検出ソース: サイドチェインが渡されていればそれを使う。サンプル数が一致しないものは安全側で無視。
    const bool useExternalDetect =
        detectionBuffer != nullptr
        && detectionBuffer->getNumChannels() > 0
        && detectionBuffer->getNumSamples() == numSamples;
    const int detectChannels = useExternalDetect ? detectionBuffer->getNumChannels() : 0;
    const float* detectL = useExternalDetect ? detectionBuffer->getReadPointer(0) : nullptr;
    const float* detectR = useExternalDetect ? detectionBuffer->getReadPointer(detectChannels > 1 ? 1 : 0)
                                             : nullptr;

    float minGain = 1.0f;
    if (! std::isfinite(envelopeDb)) envelopeDb = 0.0f;
    if (! std::isfinite(envelopeDbSlow)) envelopeDbSlow = 0.0f;
    if (! std::isfinite(ldrHeat)) ldrHeat = 0.0f;

    const float aC  = attackCoeff;
    const float rC  = releaseCoeff;
    const float rCS = releaseCoeffSlow;
    const float rCSticky = releaseCoeffSticky;
    const float heatUp   = ldrHeatUpCoeff;
    const float coolDown = ldrCoolCoeff;

    // Vari-Mu: 静的カーブに +12dB の追加ニーを足して、バンドが浅く緩やかに立ち上がるようにする。
    //  これが vari-mu の「レシオが GR と共に徐々に強くなる」感覚の近似。
    const float kneeForCurve = (mode == Mode::VariMu) ? (kneeDb + 12.0f) : kneeDb;

    // 色付け強度。Character ノブを将来足す前提で内部係数としてここに置く。
    //  現状は各モード固定のマイルドな値。
    const float fetDrive    = (mode == Mode::FET)    ? 1.2f : 0.0f;
    const float variMuDrive = (mode == Mode::VariMu) ? 0.6f : 0.0f;

    constexpr float kMinAbs = 1.0e-6f;  // -120 dBFS 以下は 0 扱い

    // per-sample gain 出力用のサンプルインデックス。lambda からキャプチャする。
    int sampleIdx = 0;

    auto step = [&](float& sampleL, float& sampleR, float detL, float detR) noexcept
    {
        sampleL = sanitizeFinite(sampleL);
        sampleR = sanitizeFinite(sampleR);
        detL    = sanitizeFinite(detL);
        detR    = sanitizeFinite(detR);

        // ピーク検出（ステレオリンク）。検出ソースは sidechain がある場合は detL/detR、無ければメイン信号。
        const float a = std::max(std::abs(detL), std::abs(detR));
        const float x = a > kMinAbs ? a : kMinAbs;
        const float xDb = 20.0f * std::log10(x);
        const float targetDb = computeGainReductionDb(xDb, kneeForCurve);

        // fast envelope（全モード共通のメインエンベロープ）
        const float coeff = (targetDb > envelopeDb) ? aC : rC;
        envelopeDb = targetDb + (envelopeDb - targetDb) * coeff;

        // Opto: slow envelope を並走させ、GR の深い方を採用することで
        //  "リリースが長く引きずる" LA-2A 系の挙動を作る。
        //  さらに LDR 熱メモリを近似: envelopeDb を heat のドライバにし、
        //   hot のときは slow envelope のリリース coeff を sticky 側へブレンドする。
        //   これで「深い GR を長時間掛けていた直後はリリースがさらに粘る」挙動になる。
        float grApplied = envelopeDb;
        if (mode == Mode::Opto)
        {
            // 熱量の目標値: 現行 envelope GR を 18dB で正規化。
            const float heatTarget = std::min(1.0f, envelopeDb / 18.0f);
            const float heatCoeff  = (heatTarget > ldrHeat) ? heatUp : coolDown;
            ldrHeat = heatTarget + (ldrHeat - heatTarget) * heatCoeff;

            // slow envelope のリリース coeff を heat に応じて補間。
            //  cold(ldrHeat=0) → rCS、hot(ldrHeat=1) → rCSticky（より 1.0 に近い = release が長い）。
            //  coeff 自体を線形補間するのは物理的に厳密ではないが、心理音響的には滑らかに推移する。
            const float slowReleaseCoeff = rCS + (rCSticky - rCS) * ldrHeat;

            const float coeffSlow = (targetDb > envelopeDbSlow) ? aC : slowReleaseCoeff;
            envelopeDbSlow = targetDb + (envelopeDbSlow - targetDb) * coeffSlow;
            grApplied = std::max(envelopeDb, envelopeDbSlow);
        }

        const float g = std::pow(10.0f, -grApplied / 20.0f);
        sampleL *= g;
        sampleR *= g;

        // 後段の色付け（モード別）。信号経路に入れるのは最後の一手間で、
        //  サイドチェーンには波形整形を入れない（検出を自然に保つため）。
        if (fetDrive > 0.0f)
        {
            sampleL = fetSaturate(sampleL, fetDrive);
            sampleR = fetSaturate(sampleR, fetDrive);
        }
        else if (variMuDrive > 0.0f)
        {
            sampleL = variMuSaturate(sampleL, variMuDrive);
            sampleR = variMuSaturate(sampleR, variMuDrive);
        }

        if (gainOut) gainOut[sampleIdx] = g;
        if (g < minGain) minGain = g;
    };

    if (numChannels == 1)
    {
        auto* ch = buffer.getWritePointer(0);
        for (int i = 0; i < numSamples; ++i)
        {
            sampleIdx = i;
            float l = ch[i];
            float r = l;
            const float dL = detectL ? detectL[i] : l;
            const float dR = detectR ? detectR[i] : r;
            step(l, r, dL, dR);
            ch[i] = l;
        }
        return minGain;
    }

    auto* left  = buffer.getWritePointer(0);
    auto* right = buffer.getWritePointer(std::min(1, numChannels - 1));

    for (int i = 0; i < numSamples; ++i)
    {
        sampleIdx = i;
        float l = left[i];
        float r = right[i];
        const float dL = detectL ? detectL[i] : l;
        const float dR = detectR ? detectR[i] : r;
        step(l, r, dL, dR);
        left[i]  = l;
        right[i] = r;

        // 3 チャネル以上の場合は同じゲインを他チャネルにも乗せる（サチュレーションは L/R のみ）
        if (numChannels > 2)
        {
            const float g = std::pow(10.0f, -envelopeDb / 20.0f);
            for (int ch = 2; ch < numChannels; ++ch)
            {
                auto* extra = buffer.getWritePointer(ch);
                extra[i] = sanitizeFinite(extra[i]) * g;
            }
        }
    }
    return minGain;
}

} // namespace zc::dsp
