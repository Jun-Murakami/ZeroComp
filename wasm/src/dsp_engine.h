// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jun Murakami
// WASM デモ用 DSP オーケストレータ（ZeroComp 版）。
//  - 1 本のオーディオソース（PCM L/R）
//  - トランスポート（再生 / 停止 / シーク / ループ）
//  - Compressor（Mode, Auto Makeup 含む）
//  - Input / GR / Output メーター（Peak / RMS / Momentary）
#pragma once

#include "compressor.h"
#include "momentary_processor.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <vector>

namespace zc_wasm {

class DspEngine
{
public:
    // 波形表示用スライスレート（plugin 側と揃える）
    static constexpr double kWaveformSliceHz = 200.0;
    static constexpr int    kWaveformRingSize = 2048; // ~10 秒ぶん

    void prepare(double sr, int maxBlock) noexcept
    {
        sampleRate = std::isfinite(sr) && sr > 0.0 ? sr : 48000.0;
        maxBlockSize = std::max(1, maxBlock);

        compressor.prepare(sampleRate);
        momentaryIn .prepare(sampleRate, maxBlockSize);
        momentaryOut.prepare(sampleRate, maxBlockSize);

        // 波形スライス準備（plugin と同じ 200 Hz）
        waveformSliceSize = std::max(1, static_cast<int>(std::round(sampleRate / kWaveformSliceHz)));
        waveformPeaks.assign(static_cast<size_t>(kWaveformRingSize), 0.0f);
        waveformGrDb .assign(static_cast<size_t>(kWaveformRingSize), 0.0f);
        waveformWriteIdx = 0;
        waveformReadIdx  = 0;
        waveformSliceSampleCount = 0;
        waveformSlicePeakAccum   = 0.0f;
        waveformSliceGrAccum     = 0.0f;

        // per-sample gain スクラッチ
        waveformGainScratch.assign(static_cast<size_t>(maxBlockSize), 1.0f);

        resetMeters();
    }

    // ====== ソース管理 ======

    void loadSource(const float* L, const float* R, int numSamples, double sourceSampleRate) noexcept
    {
        if (numSamples <= 0) { clearSource(); return; }
        sourceL.assign(L, L + numSamples);
        sourceR.assign(R ? R : L, (R ? R : L) + numSamples);
        for (auto& s : sourceL) s = sanitizeFinite(s);
        for (auto& s : sourceR) s = sanitizeFinite(s);
        sourceNumSamples = numSamples;
        sourceRate       = std::isfinite(sourceSampleRate) && sourceSampleRate > 0.0 ? sourceSampleRate : sampleRate;

        rateRatio = sourceRate / sampleRate;
        playPos   = 0.0;
        playing   = false;
        stoppedAtEnd = false;
    }

    void clearSource() noexcept
    {
        sourceL.clear(); sourceR.clear();
        sourceNumSamples = 0;
        playPos = 0.0;
        playing = false;
    }

    bool hasSource() const noexcept { return sourceNumSamples > 0; }

    // ====== トランスポート ======

    void setPlaying(bool p) noexcept
    {
        if (p && !hasSource()) return;
        if (p && stoppedAtEnd) { playPos = 0.0; stoppedAtEnd = false; }
        playing = p;
    }

    bool isPlaying() const noexcept { return playing; }

    void setLoop(bool enabled) noexcept { loopEnabled = enabled; }
    bool getLoop() const noexcept { return loopEnabled; }

    void seekNormalized(double norm) noexcept
    {
        if (sourceNumSamples <= 0) return;
        if (norm < 0.0) norm = 0.0;
        if (norm > 1.0) norm = 1.0;
        playPos = norm * static_cast<double>(sourceNumSamples);
        stoppedAtEnd = false;
    }

    double getPositionSeconds() const noexcept
    {
        if (sourceRate <= 0.0) return 0.0;
        return playPos / sourceRate;
    }

    double getDurationSeconds() const noexcept
    {
        if (sourceRate <= 0.0) return 0.0;
        return static_cast<double>(sourceNumSamples) / sourceRate;
    }

    bool consumeStoppedAtEnd() noexcept
    {
        if (stoppedAtEnd) { stoppedAtEnd = false; return true; }
        return false;
    }

    // ====== パラメータ ======

    void setThresholdDb(float db) noexcept { thresholdDb = clampFinite(db, -80.0f, 0.0f, 0.0f); compressor.setThresholdDb(thresholdDb); }
    void setRatio(float r) noexcept        { ratio = clampFinite(r, 1.0f, 100.0f, 1.0f);        compressor.setRatio(ratio); }
    void setKneeDb(float k) noexcept       { compressor.setKneeDb(k); }
    void setAttackMs(float ms) noexcept    { compressor.setAttackMs(ms); }
    void setReleaseMs(float ms) noexcept   { compressor.setReleaseMs(ms); }
    void setOutputGainDb(float db) noexcept{ outputGainDb = clampFinite(db, -24.0f, 24.0f, 0.0f); }
    void setAutoMakeup(bool on) noexcept   { autoMakeupOn = on; }
    void setMode(int m) noexcept           { compressor.setMode(m); }

    void setMeteringMode(int mode) noexcept { meteringMode = mode; }
    void setBypass(bool b) noexcept         { bypass = b; }

    // ====== メイン処理 ======

    void processBlock(float* outL, float* outR, int numSamples) noexcept
    {
        if (numSamples <= 0) return;
        if (numSamples > maxBlockSize)
        {
            int offset = 0;
            while (offset < numSamples)
            {
                const int chunk = std::min(maxBlockSize, numSamples - offset);
                processBlock(outL + offset, outR + offset, chunk);
                offset += chunk;
            }
            return;
        }

        // --- 1) ソース fetch ---
        fetchSource(outL, outR, numSamples);
        sanitizeStereo(outL, outR, numSamples);

        // --- 2) 入力メーター ---
        accumInMeters(outL, outR, numSamples);
        momentaryIn.processStereo(outL, outR, numSamples);

        if (bypass)
        {
            accumOutMeters(outL, outR, numSamples);
            momentaryOut.processStereo(outL, outR, numSamples);
            return;
        }

        // 波形用に入力サンプル max(|L|,|R|) を事前キャッシュ（compressor が破壊する前）
        if (static_cast<int>(waveformInputPeakScratch.size()) < numSamples)
            waveformInputPeakScratch.resize(static_cast<size_t>(numSamples), 0.0f);
        for (int i = 0; i < numSamples; ++i)
            waveformInputPeakScratch[static_cast<size_t>(i)] = std::max(std::fabs(outL[i]), std::fabs(outR[i]));

        // --- 3) Compressor（per-sample gain を scratch に取得）---
        if (static_cast<int>(waveformGainScratch.size()) < numSamples)
            waveformGainScratch.resize(static_cast<size_t>(numSamples), 1.0f);
        float* gainPerSample = waveformGainScratch.data();
        const float minGain = compressor.processStereoInPlace(outL, outR, numSamples, gainPerSample);

        // 波形スライスに入力ピーク + per-sample gain を流す
        accumWaveformSlices(waveformInputPeakScratch.data(), gainPerSample, numSamples);

        // --- 4) Auto Makeup + Output Gain（プラグイン側と同じ式）---
        const float autoMakeupDb = compressor.computeAutoMakeupDb();
        const float effectiveDb = (autoMakeupOn ? autoMakeupDb : 0.0f) + outputGainDb;
        const float total = sanitizeFinite(std::pow(10.0f, effectiveDb / 20.0f), 1.0f);
        if (std::fabs(total - 1.0f) > 1.0e-6f)
        {
            for (int i = 0; i < numSamples; ++i)
            {
                outL[i] *= total;
                outR[i] *= total;
            }
        }

        // --- 5) 出力メーター ---
        accumOutMeters(outL, outR, numSamples);
        momentaryOut.processStereo(outL, outR, numSamples);

        // GR dB
        const float grDb = (minGain > 0.0f && minGain < 1.0f) ? -20.0f * std::log10(minGain) : 0.0f;
        if (grDb > grDbAccum) grDbAccum = grDb;
    }

    // ====== メーターデータ取り出し ======
    // レイアウト:
    //   0: mode
    //   1: inPeakL   2: inPeakR   3: inRmsL   4: inRmsR   5: inMomentary
    //   6: outPeakL  7: outPeakR  8: outRmsL  9: outRmsR 10: outMomentary
    //   11: grDb
    //   12: reserved
    void getMeterData(float* out) noexcept
    {
        const float minDb   = -60.0f;
        const float minLkfs = -70.0f;

        out[0]  = static_cast<float>(meteringMode);
        out[1]  = amplitudeToDb(inPeakAccumL, minDb);
        out[2]  = amplitudeToDb(inPeakAccumR, minDb);
        out[3]  = amplitudeToDb(inRmsAccumL,  minDb);
        out[4]  = amplitudeToDb(inRmsAccumR,  minDb);
        out[5]  = momentaryIn.getMomentaryLKFS();
        if (out[5] < minLkfs) out[5] = minLkfs;
        out[6]  = amplitudeToDb(outPeakAccumL, minDb);
        out[7]  = amplitudeToDb(outPeakAccumR, minDb);
        out[8]  = amplitudeToDb(outRmsAccumL,  minDb);
        out[9]  = amplitudeToDb(outRmsAccumR,  minDb);
        out[10] = momentaryOut.getMomentaryLKFS();
        if (out[10] < minLkfs) out[10] = minLkfs;
        out[11] = grDbAccum;
        out[12] = 0.0f;

        // プラグイン版 PluginEditor::timerCallback と同じ減衰を適用。
        constexpr float kMeterDecay = 0.89f;
        inPeakAccumL  *= kMeterDecay; inPeakAccumR  *= kMeterDecay;
        outPeakAccumL *= kMeterDecay; outPeakAccumR *= kMeterDecay;
        inRmsAccumL   *= kMeterDecay; inRmsAccumR   *= kMeterDecay;
        outRmsAccumL  *= kMeterDecay; outRmsAccumR  *= kMeterDecay;
        grDbAccum     *= kMeterDecay;
    }

    void resetMomentaryHold() noexcept
    {
        momentaryIn.reset();
        momentaryOut.reset();
    }

    // ====== 波形スライス取り出し（JS から pull）======
    int getWaveformSlices(float* peaks, float* grDb, int maxN) noexcept
    {
        if (maxN <= 0 || !peaks || !grDb) return 0;
        int count = 0;
        while (count < maxN && waveformReadIdx != waveformWriteIdx)
        {
            peaks[count] = waveformPeaks[static_cast<size_t>(waveformReadIdx)];
            grDb [count] = waveformGrDb [static_cast<size_t>(waveformReadIdx)];
            waveformReadIdx = (waveformReadIdx + 1) % kWaveformRingSize;
            ++count;
        }
        return count;
    }

    double getWaveformSliceHz() const noexcept
    {
        return sampleRate / static_cast<double>(std::max(1, waveformSliceSize));
    }

private:
    static float amplitudeToDb(float amp, float floorDb) noexcept
    {
        if (! std::isfinite(amp) || amp <= 0.0f) return floorDb;
        const float db = 20.0f * std::log10(amp);
        return std::max(db, floorDb);
    }

    static float sanitizeFinite(float v, float fallback = 0.0f) noexcept
    {
        return std::isfinite(v) ? v : fallback;
    }

    static float clampFinite(float v, float lo, float hi, float fallback) noexcept
    {
        v = sanitizeFinite(v, fallback);
        return v < lo ? lo : (v > hi ? hi : v);
    }

    static void sanitizeStereo(float* L, float* R, int n) noexcept
    {
        for (int i = 0; i < n; ++i)
        {
            L[i] = sanitizeFinite(L[i]);
            R[i] = sanitizeFinite(R[i]);
        }
    }

    void fetchSource(float* outL, float* outR, int n) noexcept
    {
        if (!playing || sourceNumSamples <= 0)
        {
            std::memset(outL, 0, sizeof(float) * static_cast<size_t>(n));
            std::memset(outR, 0, sizeof(float) * static_cast<size_t>(n));
            return;
        }

        for (int i = 0; i < n; ++i)
        {
            double idx = playPos;
            int i0 = static_cast<int>(idx);
            int i1 = i0 + 1;
            double frac = idx - static_cast<double>(i0);

            if (i0 >= sourceNumSamples)
            {
                if (loopEnabled)
                {
                    playPos = 0.0; stoppedAtEnd = false;
                    idx = 0.0; i0 = 0; i1 = 1; frac = 0.0;
                }
                else
                {
                    outL[i] = 0.0f; outR[i] = 0.0f;
                    playing = false;
                    stoppedAtEnd = true;
                    for (int k = i + 1; k < n; ++k) { outL[k] = 0.0f; outR[k] = 0.0f; }
                    return;
                }
            }
            if (i1 >= sourceNumSamples) i1 = loopEnabled ? 0 : i0;

            const float l0 = sourceL[static_cast<size_t>(i0)];
            const float l1 = sourceL[static_cast<size_t>(i1)];
            const float r0 = sourceR[static_cast<size_t>(i0)];
            const float r1 = sourceR[static_cast<size_t>(i1)];
            outL[i] = static_cast<float>(l0 + (l1 - l0) * frac);
            outR[i] = static_cast<float>(r0 + (r1 - r0) * frac);

            playPos += rateRatio;
        }
    }

    void accumInMeters(const float* L, const float* R, int n) noexcept
    {
        float pL = inPeakAccumL, pR = inPeakAccumR;
        double sumL = 0.0, sumR = 0.0;
        for (int i = 0; i < n; ++i)
        {
            const float l = sanitizeFinite(L[i]);
            const float r = sanitizeFinite(R[i]);
            const float aL = std::fabs(l);
            const float aR = std::fabs(r);
            if (aL > pL) pL = aL;
            if (aR > pR) pR = aR;
            sumL += static_cast<double>(l) * l;
            sumR += static_cast<double>(r) * r;
        }
        inPeakAccumL = pL;
        inPeakAccumR = pR;
        const float rmsL = static_cast<float>(std::sqrt(sumL / static_cast<double>(n)));
        const float rmsR = static_cast<float>(std::sqrt(sumR / static_cast<double>(n)));
        if (rmsL > inRmsAccumL) inRmsAccumL = rmsL;
        if (rmsR > inRmsAccumR) inRmsAccumR = rmsR;
    }

    void accumOutMeters(const float* L, const float* R, int n) noexcept
    {
        float pL = outPeakAccumL, pR = outPeakAccumR;
        double sumL = 0.0, sumR = 0.0;
        for (int i = 0; i < n; ++i)
        {
            const float l = sanitizeFinite(L[i]);
            const float r = sanitizeFinite(R[i]);
            const float aL = std::fabs(l);
            const float aR = std::fabs(r);
            if (aL > pL) pL = aL;
            if (aR > pR) pR = aR;
            sumL += static_cast<double>(l) * l;
            sumR += static_cast<double>(r) * r;
        }
        outPeakAccumL = pL;
        outPeakAccumR = pR;
        const float rmsL = static_cast<float>(std::sqrt(sumL / static_cast<double>(n)));
        const float rmsR = static_cast<float>(std::sqrt(sumR / static_cast<double>(n)));
        if (rmsL > outRmsAccumL) outRmsAccumL = rmsL;
        if (rmsR > outRmsAccumR) outRmsAccumR = rmsR;
    }

    void resetMeters() noexcept
    {
        inPeakAccumL = inPeakAccumR = 0.0f;
        outPeakAccumL = outPeakAccumR = 0.0f;
        inRmsAccumL = inRmsAccumR = 0.0f;
        outRmsAccumL = outRmsAccumR = 0.0f;
        grDbAccum = 0.0f;
    }

    // 入力サンプル + per-sample gain を slice にダウンサンプリングして内部リングに push。
    //   peak    = slice 内の max(|L|,|R|) の最大
    //   grDb    = per-sample gain から算出した slice 内最大リダクション（dB）
    void accumWaveformSlices(const float* inputPeakPerSample, const float* perSampleGain, int n) noexcept
    {
        for (int i = 0; i < n; ++i)
        {
            const float mergedAbs = inputPeakPerSample[i];
            if (mergedAbs > waveformSlicePeakAccum) waveformSlicePeakAccum = mergedAbs;

            const float gLin = perSampleGain[i];
            const float perSampleGrDb = (gLin >= 1.0f)
                ? 0.0f
                : -20.0f * std::log10(std::max(gLin, 1.0e-6f));
            if (perSampleGrDb > waveformSliceGrAccum) waveformSliceGrAccum = perSampleGrDb;

            if (++waveformSliceSampleCount >= waveformSliceSize)
            {
                const int nextWrite = (waveformWriteIdx + 1) % kWaveformRingSize;
                if (nextWrite == waveformReadIdx)
                {
                    // 満杯 → 最古を 1 つ捨てる
                    waveformReadIdx = (waveformReadIdx + 1) % kWaveformRingSize;
                }
                waveformPeaks[static_cast<size_t>(waveformWriteIdx)] = waveformSlicePeakAccum;
                waveformGrDb [static_cast<size_t>(waveformWriteIdx)] = waveformSliceGrAccum;
                waveformWriteIdx = nextWrite;

                waveformSliceSampleCount = 0;
                waveformSlicePeakAccum   = 0.0f;
                waveformSliceGrAccum     = 0.0f;
            }
        }
    }

    // state
    double sampleRate = 48000.0;
    int    maxBlockSize = 128;

    // Source
    std::vector<float> sourceL, sourceR;
    int    sourceNumSamples = 0;
    double sourceRate = 48000.0;
    double rateRatio = 1.0;

    // Transport
    double playPos = 0.0;
    bool   playing = false;
    bool   loopEnabled = true;
    bool   stoppedAtEnd = false;

    // Params
    float thresholdDb   = 0.0f;
    float ratio         = 1.0f;
    float outputGainDb  = 0.0f;
    bool  autoMakeupOn  = false;
    int   meteringMode  = 0;
    bool  bypass        = false;

    // DSP
    Compressor         compressor;
    MomentaryProcessor momentaryIn;
    MomentaryProcessor momentaryOut;

    // Meter accumulators（amplitude で保持、取り出し時に dB 変換）
    float inPeakAccumL  = 0.0f, inPeakAccumR  = 0.0f;
    float outPeakAccumL = 0.0f, outPeakAccumR = 0.0f;
    float inRmsAccumL   = 0.0f, inRmsAccumR   = 0.0f;
    float outRmsAccumL  = 0.0f, outRmsAccumR  = 0.0f;
    float grDbAccum     = 0.0f;

    // Waveform ring（Pro-L 風オシロ表示用）
    std::vector<float> waveformPeaks;
    std::vector<float> waveformGrDb;
    int   waveformWriteIdx         = 0;
    int   waveformReadIdx          = 0;
    int   waveformSliceSize        = 240;
    int   waveformSliceSampleCount = 0;
    float waveformSlicePeakAccum   = 0.0f;
    float waveformSliceGrAccum     = 0.0f;

    // per-sample gain と入力ピークのスクラッチ（compressor に渡す / 波形集計に使う）
    std::vector<float> waveformGainScratch;
    std::vector<float> waveformInputPeakScratch;
};

} // namespace zc_wasm
