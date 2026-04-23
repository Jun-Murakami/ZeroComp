// ITU-R BS.1770-4 準拠の Momentary LKFS（400ms 窓）。
// プラグイン側 MomentaryProcessor を JUCE 非依存に移植。
#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include <vector>

namespace zc_wasm {

class MomentaryProcessor
{
public:
    void prepare(double sr, int /*maxBlock*/) noexcept
    {
        sampleRate = sr > 0.0 ? sr : 48000.0;
        const int winSamples = static_cast<int>(sampleRate * WINDOW_MS / 1000.0);
        for (auto& b : msBuf) b.setSizeInSamples(winSamples);
        reset();
    }

    void reset() noexcept
    {
        for (auto& s : filterState) s.reset();
        for (auto& b : msBuf)      b.reset();
        currentLKFS = MIN_LKFS;
    }

    void processStereo(const float* L, const float* R, int n) noexcept
    {
        for (int i = 0; i < n; ++i)
        {
            const float wL = processK(L[i], filterState[0]);
            msBuf[0].pushSample(wL);

            const float x = R ? R[i] : L[i];
            const float wR = processK(x, filterState[1]);
            msBuf[1].pushSample(wR);
        }

        const float msL = msBuf[0].getMeanSquare();
        const float msR = R ? msBuf[1].getMeanSquare() : msL;
        currentLKFS = calculateLKFS(msL, msR);
    }

    float getMomentaryLKFS() const noexcept { return currentLKFS; }

private:
    struct FilterState
    {
        double x1p=0, x2p=0, y1p=0, y2p=0;
        double x1r=0, x2r=0, y1r=0, y2r=0;
        void reset() { x1p=x2p=y1p=y2p=0; x1r=x2r=y1r=y2r=0; }
    };

    class MeanSquareBuffer
    {
    public:
        void setSizeInSamples(int n)
        {
            size = n > 0 ? static_cast<size_t>(n) : 0;
            buf.assign(size, 0.0f);
            writeIdx = 0; sum = 0.0f; full = false;
        }
        void reset()
        {
            std::fill(buf.begin(), buf.end(), 0.0f);
            writeIdx = 0; sum = 0.0f; full = false;
        }
        void pushSample(float weighted)
        {
            if (size == 0) return;
            const float sq = weighted * weighted;
            if (full) sum -= buf[writeIdx];
            buf[writeIdx] = sq;
            sum += sq;
            writeIdx = (writeIdx + 1) % size;
            if (! full && writeIdx == 0) full = true;
        }
        float getMeanSquare() const
        {
            if (! full && writeIdx == 0) return 0.0f;
            const size_t count = full ? size : writeIdx;
            if (count == 0) return 0.0f;
            return sum / static_cast<float>(count);
        }
    private:
        std::vector<float> buf;
        size_t writeIdx = 0;
        size_t size     = 0;
        float  sum      = 0.0f;
        bool   full     = false;
    };

    // ITU 48kHz 標準係数（他サンプルレートでの双一次変換は省略・簡略化）
    struct Coeffs
    {
        double b0p=1.53512485958697, b1p=-2.69169618940638, b2p=1.19839281085285;
        double a1p=-1.69065929318241, a2p=0.73248077421585;
        double b0r=1.0, b1r=-2.0, b2r=1.0;
        double a1r=-1.99004745483398, a2r=0.99007225036621;
    };

    float processK(float x, FilterState& s) noexcept
    {
        const double x0p = x;
        const double y0p = c.b0p*x0p + c.b1p*s.x1p + c.b2p*s.x2p - c.a1p*s.y1p - c.a2p*s.y2p;
        s.x2p = s.x1p; s.x1p = x0p;
        s.y2p = s.y1p; s.y1p = y0p;

        const double x0r = y0p;
        const double y0r = c.b0r*x0r + c.b1r*s.x1r + c.b2r*s.x2r - c.a1r*s.y1r - c.a2r*s.y2r;
        s.x2r = s.x1r; s.x1r = x0r;
        s.y2r = s.y1r; s.y1r = y0r;
        return static_cast<float>(y0r);
    }

    static float calculateLKFS(float msL, float msR)
    {
        if (msL <= 0.0f && msR <= 0.0f) return MIN_LKFS;
        const float weighted = msL + msR;
        if (weighted <= 0.0f) return MIN_LKFS;
        const float lkfs = -0.691f + 10.0f * std::log10(weighted);
        return std::max(lkfs, MIN_LKFS);
    }

    static constexpr float WINDOW_MS = 400.0f;
    static constexpr float MIN_LKFS  = -70.0f;

    double sampleRate = 48000.0;
    Coeffs c;
    std::array<FilterState, 2>      filterState;
    std::array<MeanSquareBuffer, 2> msBuf;
    float currentLKFS = MIN_LKFS;
};

} // namespace zc_wasm
