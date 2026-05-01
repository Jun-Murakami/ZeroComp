// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jun Murakami
/**
 * ZeroComp WASM AudioWorkletProcessor.
 * すべてのオーディオ処理（再生・コンプ・メーター）は C++ WASM の dsp_process_block() に委譲。
 */

const INITIAL_RENDER_FRAMES = 2048;
const METER_FLOATS = 13;

class DspProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.wasm = null;
    this.wasmReady = false;
    this.wasmMemory = null;

    this.outLPtr = 0;
    this.outRPtr = 0;
    this.meterBufPtr = 0; // 13 floats
    this.renderBufferFrames = 0;
    this.heapF32 = null;

    // 波形スライス用の pull バッファ（optional）
    this.waveformMaxPerPull = 256;
    this.waveformPeaksPtr = 0;
    this.waveformGrDbPtr  = 0;
    this.waveformAvailable = false;
    this.waveformSliceHz = 200;

    this.updateCounter = 0;

    this.port.onmessage = (e) => this.handleMessage(e.data);
  }

  handleMessage(msg) {
    switch (msg.type) {
      case 'init-wasm':
        this.initWasm(msg.wasmBytes);
        break;

      case 'load-source': {
        if (!this.wasm) break;
        const { left, right, numSamples, sourceSampleRate } = msg;
        if (!Number.isFinite(numSamples) || numSamples <= 0) break;
        const L = new Float32Array(left);
        const R = new Float32Array(right);

        const lPtr = this.wasm.dsp_alloc_buffer(numSamples);
        const rPtr = this.wasm.dsp_alloc_buffer(numSamples);
        this.refreshHeapView();
        const heap = this.heapF32;
        if (!lPtr || !rPtr || !heap) {
          if (lPtr) this.wasm.dsp_free_buffer(lPtr);
          if (rPtr) this.wasm.dsp_free_buffer(rPtr);
          break;
        }
        heap.set(L, lPtr / 4);
        heap.set(R, rPtr / 4);

        this.wasm.dsp_load_source(lPtr, rPtr, numSamples, sourceSampleRate);

        this.wasm.dsp_free_buffer(lPtr);
        this.wasm.dsp_free_buffer(rPtr);
        this.refreshHeapView();
        break;
      }

      case 'clear-source':
        if (this.wasm) this.wasm.dsp_clear_source();
        break;

      case 'set-playing':
        if (this.wasm) this.wasm.dsp_set_playing(msg.value ? 1 : 0);
        break;

      case 'set-loop':
        if (this.wasm) this.wasm.dsp_set_loop(msg.value ? 1 : 0);
        break;

      case 'seek-normalised':
        if (this.wasm) this.wasm.dsp_seek_normalised(msg.value);
        break;

      case 'set-param': {
        if (!this.wasm) break;
        const p = msg.param;
        const v = msg.value;
        if (p === 'threshold_db')        this.wasm.dsp_set_threshold_db(v);
        else if (p === 'ratio')          this.wasm.dsp_set_ratio(v);
        else if (p === 'knee_db')        this.wasm.dsp_set_knee_db(v);
        else if (p === 'attack_ms')      this.wasm.dsp_set_attack_ms(v);
        else if (p === 'release_ms')     this.wasm.dsp_set_release_ms(v);
        else if (p === 'output_gain_db') this.wasm.dsp_set_output_gain_db(v);
        else if (p === 'auto_makeup')    this.wasm.dsp_set_auto_makeup(v ? 1 : 0);
        else if (p === 'mode')           this.wasm.dsp_set_mode(v);             // 0=VCA/1=Opto/2=FET/3=Vari-Mu
        else if (p === 'metering_mode')  this.wasm.dsp_set_metering_mode(v);    // 0=Peak/1=RMS/2=Momentary
        else if (p === 'bypass')         this.wasm.dsp_set_bypass(v ? 1 : 0);
        else if (p === 'reset_momentary') this.wasm.dsp_reset_momentary();
        break;
      }
    }
  }

  async initWasm(wasmBytes) {
    try {
      const module = await WebAssembly.compile(wasmBytes);
      const importObject = {
        env: { emscripten_notify_memory_growth: () => {} },
      };
      const instance = await WebAssembly.instantiate(module, importObject);
      if (instance.exports._initialize) instance.exports._initialize();

      this.wasm = instance.exports;
      this.wasmMemory = instance.exports.memory;

      // sampleRate はワークレットのグローバル定数
      this.wasm.dsp_init(sampleRate, INITIAL_RENDER_FRAMES);

      this.meterBufPtr = this.wasm.dsp_alloc_buffer(METER_FLOATS);
      if (!this.ensureRenderBufferCapacity(INITIAL_RENDER_FRAMES) || !this.meterBufPtr) {
        throw new Error('WASM audio buffer allocation failed');
      }

      // 波形 API は古い wasm には無いので optional 扱い
      if (typeof this.wasm.dsp_get_waveform_slices === 'function') {
        this.waveformPeaksPtr = this.wasm.dsp_alloc_buffer(this.waveformMaxPerPull);
        this.waveformGrDbPtr  = this.wasm.dsp_alloc_buffer(this.waveformMaxPerPull);
        this.waveformAvailable = !!(this.waveformPeaksPtr && this.waveformGrDbPtr);
        if (this.waveformAvailable && typeof this.wasm.dsp_get_waveform_slice_hz === 'function') {
          this.waveformSliceHz = this.wasm.dsp_get_waveform_slice_hz() || 200;
        }
      }

      this.refreshHeapView();

      this.wasmReady = true;
      this.port.postMessage({ type: 'wasm-ready' });
    } catch (err) {
      this.port.postMessage({ type: 'wasm-error', error: String(err) });
    }
  }

  refreshHeapView() {
    if (!this.wasmMemory) return false;
    if (!this.heapF32 || this.heapF32.buffer !== this.wasmMemory.buffer) {
      this.heapF32 = new Float32Array(this.wasmMemory.buffer);
    }
    return true;
  }

  ensureRenderBufferCapacity(frameCount) {
    if (!this.wasm || frameCount <= 0) return false;
    if (frameCount <= this.renderBufferFrames && this.refreshHeapView()) return true;

    const nextFrames = Math.max(frameCount, INITIAL_RENDER_FRAMES);
    const nextL = this.wasm.dsp_alloc_buffer(nextFrames);
    const nextR = this.wasm.dsp_alloc_buffer(nextFrames);
    if (!nextL || !nextR) {
      if (nextL) this.wasm.dsp_free_buffer(nextL);
      if (nextR) this.wasm.dsp_free_buffer(nextR);
      return false;
    }

    if (this.outLPtr) this.wasm.dsp_free_buffer(this.outLPtr);
    if (this.outRPtr) this.wasm.dsp_free_buffer(this.outRPtr);
    this.outLPtr = nextL;
    this.outRPtr = nextR;
    this.renderBufferFrames = nextFrames;
    return this.refreshHeapView();
  }

  process(inputs, outputs) {
    if (!this.wasmReady) return true;

    const output = outputs[0];
    if (!output || output.length < 2) return true;
    const outL = output[0];
    const outR = output[1];
    const n = outL.length;
    if (!this.ensureRenderBufferCapacity(n)) {
      outL.fill(0);
      outR.fill(0);
      return true;
    }

    this.wasm.dsp_process_block(this.outLPtr, this.outRPtr, n);

    this.refreshHeapView();
    const heap = this.heapF32;
    const lBase = this.outLPtr / 4;
    const rBase = this.outRPtr / 4;
    for (let i = 0; i < n; ++i) {
      outL[i] = heap[lBase + i];
      outR[i] = heap[rBase + i];
    }

    // ~20Hz でメインスレッドへ状態通知
    const interval = Math.max(1, Math.round(sampleRate / (n * 20)));
    if (++this.updateCounter >= interval) {
      this.updateCounter = 0;

      const stoppedAtEnd = this.wasm.dsp_consume_stopped_at_end();
      this.wasm.dsp_get_meter_data(this.meterBufPtr);
      this.refreshHeapView();
      const mh = this.heapF32;
      const mo = this.meterBufPtr / 4;

      // 波形スライスをドレイン（optional）
      let waveformPayload = null;
      if (this.waveformAvailable) {
        const got = this.wasm.dsp_get_waveform_slices(
          this.waveformPeaksPtr,
          this.waveformGrDbPtr,
          this.waveformMaxPerPull,
        );
        if (got > 0) {
          this.refreshHeapView();
          const peaksView = new Float32Array(this.wasmMemory.buffer, this.waveformPeaksPtr, got);
          const grDbView  = new Float32Array(this.wasmMemory.buffer, this.waveformGrDbPtr,  got);
          waveformPayload = {
            sliceHz: this.waveformSliceHz,
            peaks:   Array.from(peaksView),
            grDb:    Array.from(grDbView),
          };
        }
      }

      this.port.postMessage({
        type: 'state-update',
        position: this.wasm.dsp_get_position(),
        duration: this.wasm.dsp_get_duration(),
        isPlaying: !!this.wasm.dsp_is_playing(),
        stoppedAtEnd: !!stoppedAtEnd,
        meter: {
          mode:           mh[mo + 0],
          inPeakLeft:     mh[mo + 1],
          inPeakRight:    mh[mo + 2],
          inRmsLeft:      mh[mo + 3],
          inRmsRight:     mh[mo + 4],
          inMomentary:    mh[mo + 5],
          outPeakLeft:    mh[mo + 6],
          outPeakRight:   mh[mo + 7],
          outRmsLeft:     mh[mo + 8],
          outRmsRight:    mh[mo + 9],
          outMomentary:   mh[mo + 10],
          grDb:           mh[mo + 11],
        },
        waveform: waveformPayload,
      });
    }

    return true;
  }
}

registerProcessor('dsp-processor', DspProcessor);
