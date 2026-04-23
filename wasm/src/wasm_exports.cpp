// JS 側（AudioWorklet）が呼ぶ C ABI。
// エンジン本体は dsp_engine.h。
#include "dsp_engine.h"
#include <cstdlib>

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#define WASM_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define WASM_EXPORT
#endif

static zc_wasm::DspEngine* g_engine = nullptr;

extern "C" {

// ---------- 初期化 / 解放 ----------

WASM_EXPORT void dsp_init(double sampleRate, int maxBlockSize)
{
    if (g_engine) delete g_engine;
    g_engine = new zc_wasm::DspEngine();
    g_engine->prepare(sampleRate, maxBlockSize);
}

WASM_EXPORT void dsp_destroy()
{
    delete g_engine;
    g_engine = nullptr;
}

// ---------- メモリ ----------

WASM_EXPORT float* dsp_alloc_buffer(int numSamples)
{
    return static_cast<float*>(std::malloc(sizeof(float) * static_cast<size_t>(numSamples)));
}

WASM_EXPORT void dsp_free_buffer(float* p)
{
    std::free(p);
}

// ---------- ソース管理 ----------

WASM_EXPORT void dsp_load_source(const float* L, const float* R, int numSamples, double sampleRate)
{
    if (g_engine) g_engine->loadSource(L, R, numSamples, sampleRate);
}

WASM_EXPORT void dsp_clear_source()
{
    if (g_engine) g_engine->clearSource();
}

// ---------- トランスポート ----------

WASM_EXPORT void dsp_set_playing(int p)
{
    if (g_engine) g_engine->setPlaying(p != 0);
}

WASM_EXPORT int dsp_is_playing()
{
    return g_engine && g_engine->isPlaying() ? 1 : 0;
}

WASM_EXPORT void dsp_set_loop(int enabled)
{
    if (g_engine) g_engine->setLoop(enabled != 0);
}

WASM_EXPORT int dsp_consume_stopped_at_end()
{
    return g_engine && g_engine->consumeStoppedAtEnd() ? 1 : 0;
}

WASM_EXPORT void dsp_seek_normalised(double norm)
{
    if (g_engine) g_engine->seekNormalized(norm);
}

WASM_EXPORT double dsp_get_position()
{
    return g_engine ? g_engine->getPositionSeconds() : 0.0;
}

WASM_EXPORT double dsp_get_duration()
{
    return g_engine ? g_engine->getDurationSeconds() : 0.0;
}

// ---------- DSP パラメータ ----------

WASM_EXPORT void dsp_set_threshold_db(float db)    { if (g_engine) g_engine->setThresholdDb(db); }
WASM_EXPORT void dsp_set_ratio(float r)            { if (g_engine) g_engine->setRatio(r); }
WASM_EXPORT void dsp_set_knee_db(float k)          { if (g_engine) g_engine->setKneeDb(k); }
WASM_EXPORT void dsp_set_attack_ms(float ms)       { if (g_engine) g_engine->setAttackMs(ms); }
WASM_EXPORT void dsp_set_release_ms(float ms)      { if (g_engine) g_engine->setReleaseMs(ms); }
WASM_EXPORT void dsp_set_output_gain_db(float db)  { if (g_engine) g_engine->setOutputGainDb(db); }
WASM_EXPORT void dsp_set_auto_makeup(int on)       { if (g_engine) g_engine->setAutoMakeup(on != 0); }
WASM_EXPORT void dsp_set_mode(int m)               { if (g_engine) g_engine->setMode(m); }
WASM_EXPORT void dsp_set_metering_mode(int m)      { if (g_engine) g_engine->setMeteringMode(m); }
WASM_EXPORT void dsp_set_bypass(int b)             { if (g_engine) g_engine->setBypass(b != 0); }

// ---------- メイン処理 ----------

WASM_EXPORT void dsp_process_block(float* outL, float* outR, int numSamples)
{
    if (g_engine) g_engine->processBlock(outL, outR, numSamples);
}

WASM_EXPORT void dsp_get_meter_data(float* buf13)
{
    if (g_engine) g_engine->getMeterData(buf13);
}

WASM_EXPORT void dsp_reset_momentary()
{
    if (g_engine) g_engine->resetMomentaryHold();
}

// ---------- 波形表示（Pro-L / Pro-C 風オシロ）----------

// 最大 maxN slice ぶんを peaks[] と grDb[] に書き込み、実際の slice 数を返す。
//  peaks: slice 内の max(|L|,|R|) のリニア振幅（pre-compressor）
//  grDb : slice 内 per-sample gain から算出した最大 GR（dB, >= 0）
WASM_EXPORT int dsp_get_waveform_slices(float* peaks, float* grDb, int maxN)
{
    if (!g_engine) return 0;
    return g_engine->getWaveformSlices(peaks, grDb, maxN);
}

WASM_EXPORT double dsp_get_waveform_slice_hz()
{
    return g_engine ? g_engine->getWaveformSliceHz() : 0.0;
}

} // extern "C"
