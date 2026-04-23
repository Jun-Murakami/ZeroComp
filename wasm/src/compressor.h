// WASM 版: ZeroComp のゼロレイテンシー・フィードフォワード・コンプレッサー。
//  plugin/src/dsp/Compressor.{h,cpp} を JUCE 依存なしで純 C++ に移植したもの。
//  挙動は完全に同一（Mode、ソフトニー、LDR メモリ含む）。
#pragma once

#include <algorithm>
#include <cmath>
#include <cstring>

namespace zc_wasm {

class Compressor
{
public:
    enum Mode
    {
        Clean = 0,   // VCA
        Opto,
        FET,
        VariMu,
    };

    void prepare(double sampleRate) noexcept
    {
        currentSampleRate = sampleRate > 0.0 ? sampleRate : 48000.0;
        updateCoeffs();
        reset();
    }

    void reset() noexcept
    {
        envelopeDb     = 0.0f;
        envelopeDbSlow = 0.0f;
        ldrHeat        = 0.0f;
    }

    void setThresholdDb(float v) noexcept { thresholdDb = clampFinite(v, -80.0f, 0.0f, 0.0f); }
    void setRatio(float r) noexcept
    {
        ratio = clampFinite(r, 1.0f, 100.0f, 1.0f);
        slope = 1.0f - 1.0f / ratio;
    }
    void setKneeDb(float k) noexcept { kneeDb = clampFinite(k, 0.0f, 24.0f, 6.0f); }
    void setAttackMs(float ms) noexcept  { attackMs  = clampFinite(ms, 0.1f, 500.0f, 10.0f);  updateCoeffs(); }
    void setReleaseMs(float ms) noexcept { releaseMs = clampFinite(ms, 0.1f, 2000.0f, 100.0f); updateCoeffs(); }
    void setMode(int m) noexcept
    {
        if (m < 0) m = 0;
        if (m > 3) m = 3;
        mode = static_cast<Mode>(m);
    }

    // L/R をイン・プレース処理。戻り値は区間の最小ゲイン (= 最大 GR を linear で)。
    float processStereoInPlace(float* L, float* R, int n) noexcept
    {
        float minGain = 1.0f;
        if (! std::isfinite(envelopeDb)) envelopeDb = 0.0f;
        if (! std::isfinite(envelopeDbSlow)) envelopeDbSlow = 0.0f;
        if (! std::isfinite(ldrHeat)) ldrHeat = 0.0f;

        const float aC = attackCoeff;
        const float rC = releaseCoeff;
        const float rCS = releaseCoeffSlow;
        const float rCSticky = releaseCoeffSticky;
        const float heatUp   = ldrHeatUpCoeff;
        const float coolDown = ldrCoolCoeff;

        const float kneeForCurve = (mode == VariMu) ? (kneeDb + 12.0f) : kneeDb;

        const float fetDrive    = (mode == FET)    ? 1.2f : 0.0f;
        const float variMuDrive = (mode == VariMu) ? 0.6f : 0.0f;

        constexpr float kMinAbs = 1.0e-6f;

        for (int i = 0; i < n; ++i)
        {
            const float inL = sanitizeFinite(L[i]);
            const float inR = sanitizeFinite(R[i]);
            const float a = std::max(std::fabs(inL), std::fabs(inR));
            const float x = a > kMinAbs ? a : kMinAbs;
            const float xDb = 20.0f * std::log10(x);
            const float targetDb = computeGainReductionDb(xDb, kneeForCurve);

            const float coeff = (targetDb > envelopeDb) ? aC : rC;
            envelopeDb = targetDb + (envelopeDb - targetDb) * coeff;

            float grApplied = envelopeDb;
            if (mode == Opto)
            {
                const float heatTarget = std::min(1.0f, envelopeDb / 18.0f);
                const float heatCoeff  = (heatTarget > ldrHeat) ? heatUp : coolDown;
                ldrHeat = heatTarget + (ldrHeat - heatTarget) * heatCoeff;

                const float slowReleaseCoeff = rCS + (rCSticky - rCS) * ldrHeat;
                const float coeffSlow = (targetDb > envelopeDbSlow) ? aC : slowReleaseCoeff;
                envelopeDbSlow = targetDb + (envelopeDbSlow - targetDb) * coeffSlow;
                grApplied = std::max(envelopeDb, envelopeDbSlow);
            }

            const float g = std::pow(10.0f, -grApplied / 20.0f);
            float sL = inL * g;
            float sR = inR * g;

            if (fetDrive > 0.0f)       { sL = fetSaturate(sL, fetDrive);    sR = fetSaturate(sR, fetDrive);    }
            else if (variMuDrive > 0.0f){ sL = variMuSaturate(sL, variMuDrive); sR = variMuSaturate(sR, variMuDrive); }

            L[i] = sL;
            R[i] = sR;
            if (g < minGain) minGain = g;
        }
        return minGain;
    }

    // 現状のパラメータから「適用される makeup 補償」を返す（UI 表示と一致させるため）。
    //  formula: makeup_dB = -threshold * (1 - 1/ratio) * 0.5
    float computeAutoMakeupDb() const noexcept
    {
        return -thresholdDb * (1.0f - 1.0f / std::max(1.0f, ratio)) * 0.5f;
    }

private:
    static float sanitizeFinite(float v, float fallback = 0.0f) noexcept
    {
        return std::isfinite(v) ? v : fallback;
    }

    static float clampFinite(float v, float lo, float hi, float fallback) noexcept
    {
        v = sanitizeFinite(v, fallback);
        return v < lo ? lo : (v > hi ? hi : v);
    }

    float computeGainReductionDb(float inputDb, float kneeForCurve) const noexcept
    {
        inputDb = sanitizeFinite(inputDb, -120.0f);
        kneeForCurve = clampFinite(kneeForCurve, 0.0f, 36.0f, 0.0f);

        if (kneeForCurve <= 0.0f)
        {
            if (inputDb <= thresholdDb) return 0.0f;
            return slope * (inputDb - thresholdDb);
        }
        const float half = 0.5f * kneeForCurve;
        const float diff = inputDb - thresholdDb;
        if (diff < -half) return 0.0f;
        if (diff >  half) return slope * diff;
        const float x = diff + half;
        return slope * (x * x) / (2.0f * kneeForCurve);
    }

    static float fetSaturate(float x, float drive) noexcept
    {
        if (drive <= 0.0f) return x;
        constexpr float asym = 0.08f;
        const float y = std::tanh((x + asym) * drive) - std::tanh(asym * drive);
        return y / drive;
    }

    static float variMuSaturate(float x, float drive) noexcept
    {
        if (drive <= 0.0f) return x;
        const float ax = std::fabs(x);
        return x - drive * 0.12f * std::copysign(ax * ax, x);
    }

    void updateCoeffs() noexcept
    {
        const double tauA       = static_cast<double>(attackMs)  * 0.001 * currentSampleRate;
        const double tauR       = static_cast<double>(releaseMs) * 0.001 * currentSampleRate;
        const double tauRSlow   = tauR * 5.0;
        const double tauRSticky = tauR * 15.0;

        attackCoeff        = tauA       > 0.0 ? static_cast<float>(std::exp(-1.0 / tauA))       : 0.0f;
        releaseCoeff       = tauR       > 0.0 ? static_cast<float>(std::exp(-1.0 / tauR))       : 0.0f;
        releaseCoeffSlow   = tauRSlow   > 0.0 ? static_cast<float>(std::exp(-1.0 / tauRSlow))   : 0.0f;
        releaseCoeffSticky = tauRSticky > 0.0 ? static_cast<float>(std::exp(-1.0 / tauRSticky)) : 0.0f;

        const double tauHeatUp = 1.0 * currentSampleRate;
        const double tauCool   = 3.0 * currentSampleRate;
        ldrHeatUpCoeff = static_cast<float>(std::exp(-1.0 / tauHeatUp));
        ldrCoolCoeff   = static_cast<float>(std::exp(-1.0 / tauCool));
    }

    // params
    float thresholdDb = 0.0f;
    float ratio       = 1.0f;
    float slope       = 0.0f;
    float kneeDb      = 6.0f;
    float attackMs    = 10.0f;
    float releaseMs   = 100.0f;
    Mode  mode        = Clean;

    // runtime
    double currentSampleRate = 48000.0;
    float  attackCoeff       = 0.0f;
    float  releaseCoeff      = 0.0f;
    float  releaseCoeffSlow  = 0.0f;
    float  releaseCoeffSticky= 0.0f;
    float  envelopeDb        = 0.0f;
    float  envelopeDbSlow    = 0.0f;

    float  ldrHeat        = 0.0f;
    float  ldrHeatUpCoeff = 0.0f;
    float  ldrCoolCoeff   = 0.0f;
};

} // namespace zc_wasm
