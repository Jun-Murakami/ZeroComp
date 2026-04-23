/**
 * Web Audio API + WASM AudioWorklet のマネージャ（ZeroComp Web デモ版）。
 *
 * - ソース 1 本（初期は docs/sample.mp3、ユーザがファイル差し替え可能）
 * - トランスポート（play / pause / seek / loop）は C++ WASM 側が保持
 * - この層はファイルデコード、worklet ↔ main thread 中継、UI イベント発行のみ
 */

type EventCallback = (data: unknown) => void;

export interface WebMeterSnapshot {
  mode: number;
  inPeakLeft: number;
  inPeakRight: number;
  inRmsLeft: number;
  inRmsRight: number;
  inMomentary: number;
  outPeakLeft: number;
  outPeakRight: number;
  outRmsLeft: number;
  outRmsRight: number;
  outMomentary: number;
  grDb: number;
}

export class WebAudioEngine
{
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private listeners = new Map<string, EventCallback>();
  private nextListenerId = 1;

  // 最新状態（worklet から state-update で随時更新）
  private position = 0;
  private duration = 0;
  private isPlayingState = false;
  private loopEnabled = true;

  // 現在のソース情報（UI 表示用）
  private sourceName = '';
  private sourceLoaded = false;

  private initialized = false;
  private startPromise: Promise<void> | null = null;
  private initResolvers: Array<() => void> = [];

  /**
   * 初回起動。**必ずユーザタップ/クリックのハンドラから同期的に**呼ぶこと。
   *
   * iOS WebKit の unlock 条件:
   *   1. `new AudioContext()` をジェスチャ同期フレーム内で実行
   *   2. 同じフレームで `resume()` の Promise を発行（fire-and-forget ではなく
   *      戻り Promise を保持して重い init より前に await する）
   *   3. 同じフレームで無音 BufferSource を start する。1 サンプルでは
   *      unlock にカウントされない iOS 版があるため、ネイティブ sampleRate
   *      で 128 サンプル以上を再生する
   *
   * 重い init（WASM / sample.mp3 ロード）に入る前に resume の完了を待つことで、
   * ジェスチャ失効後に `ensureAudioContext()` が再 resume を試みて iOS に黙殺
   * されるケースを回避する。
   */
  startFromUserGesture(): Promise<void>
  {
    if (this.startPromise) return this.startPromise;

    // ---- 同期フレーム: iOS 向け audio unlock ----
    // sampleRate はハードウェア任せ。固定すると HW が 44.1k の iOS で起動失敗する。
    const ctx = new AudioContext();
    this.audioContext = ctx;

    // ジェスチャ同期で resume を発行。戻り Promise は捨てず、重い init より
    // 前に await する（fire-and-forget だと古い iOS で昇格しない実例あり）。
    const resumed = ctx.resume();

    // 1 サンプル (22050 Hz) だと unlock にカウントされない iOS 版があるため、
    // ネイティブ sampleRate で 128 サンプル分の無音を prime する。
    const primeFrames = 128;
    const silent = ctx.createBuffer(1, primeFrames, ctx.sampleRate);
    const src = ctx.createBufferSource();
    src.buffer = silent;
    src.connect(ctx.destination);
    src.start(0);

    // ---- 以降は非同期（ジェスチャスコープを抜けても OK） ----
    this.startPromise = (async () => {
      // resume が先に完了していないと worklet 接続後も context が suspended
      // のまま出力が捨てられる。失敗時は completeInit 側の動作に任せる。
      try { await resumed; } catch { /* ignore */ }
      await this.completeInit();
    })();
    return this.startPromise;
  }

  private async completeInit(): Promise<void>
  {
    const ctx = this.audioContext;
    if (!ctx) return;
    try
    {
      await ctx.audioWorklet.addModule('/worklet/dsp-processor.js');

      this.workletNode = new AudioWorkletNode(ctx, 'dsp-processor', {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
      });
      this.workletNode.connect(ctx.destination);
      this.workletNode.port.onmessage = (e) => this.handleWorkletMessage(e.data);

      // WASM ロード
      const resp = await fetch('/wasm/zerocomp_dsp.wasm');
      if (resp.ok)
      {
        const bytes = await resp.arrayBuffer();
        this.workletNode.port.postMessage({ type: 'init-wasm', wasmBytes: bytes }, [bytes]);
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('WASM init timeout')), 10000);
          this.initResolvers.push(() => { clearTimeout(t); resolve(); });
        });
      }
      else
      {
        console.warn('[WebAudioEngine] WASM binary not found at /wasm/zerocomp_dsp.wasm');
      }
    }
    catch (err)
    {
      console.warn('[WebAudioEngine] Init error:', err);
    }
    this.initialized = true;
  }

  isInitialized(): boolean { return this.initialized; }
  isStarted(): boolean { return this.startPromise !== null; }

  async ensureAudioContext(): Promise<void>
  {
    if (this.audioContext?.state === 'suspended') await this.audioContext.resume();
  }

  // ====== イベント ======

  addEventListener(event: string, callback: EventCallback): string
  {
    const id = `web_${this.nextListenerId++}`;
    this.listeners.set(`${event}:${id}`, callback);
    return `${event}:${id}`;
  }

  removeEventListener(key: string): void { this.listeners.delete(key); }

  private emit(event: string, data: unknown): void
  {
    this.listeners.forEach((cb, key) => { if (key.startsWith(`${event}:`)) cb(data); });
  }

  // ====== Worklet メッセージ ======

  private handleWorkletMessage(msg: Record<string, unknown>): void
  {
    switch (msg.type)
    {
      case 'wasm-ready':
        this.initResolvers.forEach((r) => r());
        this.initResolvers = [];
        // Worklet 初期化直後に loop=true を反映
        this.setLoop(this.loopEnabled);
        break;

      case 'wasm-error':
        this.emit('errorNotification', { severity: 'error', message: 'WASM init failed', details: String(msg.error) });
        break;

      case 'state-update':
      {
        this.position = msg.position as number;
        this.duration = msg.duration as number;
        this.isPlayingState = msg.isPlaying as boolean;

        this.emit('transportPositionUpdate', {
          position: this.position,
          duration: this.duration,
          isPlaying: this.isPlayingState,
        });

        if (msg.stoppedAtEnd)
        {
          this.emit('transportUpdate', {
            isPlaying: false,
            position: this.position,
            duration: this.duration,
            loopEnabled: this.loopEnabled,
          });
        }

        // プラグイン側の meterUpdate と同じ形式で流す
        const m = msg.meter as WebMeterSnapshot;
        this.emit('meterUpdate', {
          meteringMode: m.mode,
          input: {
            truePeakLeft:  m.inPeakLeft,
            truePeakRight: m.inPeakRight,
            rmsLeft:       m.inRmsLeft,
            rmsRight:      m.inRmsRight,
            momentary:     m.inMomentary,
          },
          output: {
            truePeakLeft:  m.outPeakLeft,
            truePeakRight: m.outPeakRight,
            rmsLeft:       m.outRmsLeft,
            rmsRight:      m.outRmsRight,
            momentary:     m.outMomentary,
          },
          grDb: m.grDb,
        });

        // 波形スライス（optional）
        const wf = msg.waveform as { sliceHz?: number; peaks?: number[]; grDb?: number[] } | null | undefined;
        if (wf && wf.peaks && wf.grDb && wf.peaks.length > 0) {
          this.emit('waveformUpdate', {
            sliceHz: wf.sliceHz,
            peaks:   wf.peaks,
            grDb:    wf.grDb,
          });
        }
        break;
      }
    }
  }

  // ====== ソースのロード ======

  async loadSampleFromUrl(url: string, displayName = 'sample.mp3'): Promise<boolean>
  {
    if (!this.audioContext) return false;
    try
    {
      const r = await fetch(url);
      if (!r.ok) return false;
      const audioBuf = await this.audioContext.decodeAudioData(await r.arrayBuffer());
      this.sendSourceToWasm(audioBuf, displayName);
      return true;
    }
    catch (err)
    {
      this.emit('errorNotification', { severity: 'error', message: `Failed to load sample`, details: String(err) });
      return false;
    }
  }

  async loadSampleFromFile(file: File): Promise<boolean>
  {
    if (!this.audioContext) return false;
    try
    {
      await this.ensureAudioContext();
      const audioBuf = await this.audioContext.decodeAudioData(await file.arrayBuffer());
      this.sendSourceToWasm(audioBuf, file.name);
      return true;
    }
    catch (err)
    {
      this.emit('errorNotification', { severity: 'error', message: `Decode failed: ${file.name}`, details: String(err) });
      return false;
    }
  }

  private sendSourceToWasm(audioBuf: AudioBuffer, displayName: string): void
  {
    const leftCopy = new Float32Array(audioBuf.getChannelData(0));
    const rightCopy = new Float32Array(
      audioBuf.numberOfChannels >= 2 ? audioBuf.getChannelData(1) : audioBuf.getChannelData(0),
    );

    this.workletNode?.port.postMessage({
      type: 'load-source',
      left:  leftCopy.buffer,
      right: rightCopy.buffer,
      numSamples: leftCopy.length,
      sourceSampleRate: audioBuf.sampleRate,
    }, [leftCopy.buffer, rightCopy.buffer]);

    this.sourceName = displayName;
    this.sourceLoaded = true;
    this.duration = audioBuf.duration;

    this.emit('sourceLoaded', { name: displayName, duration: audioBuf.duration });
  }

  getSourceName(): string { return this.sourceName; }
  isSourceLoaded(): boolean { return this.sourceLoaded; }

  // ====== トランスポート → WASM 直送 ======

  async play(): Promise<void>
  {
    await this.ensureAudioContext();
    this.workletNode?.port.postMessage({ type: 'set-playing', value: true });
    this.isPlayingState = true;
    this.emit('transportUpdate', {
      isPlaying: true, position: this.position, duration: this.duration, loopEnabled: this.loopEnabled,
    });
  }

  pause(): void
  {
    this.workletNode?.port.postMessage({ type: 'set-playing', value: false });
    this.isPlayingState = false;
    this.emit('transportUpdate', {
      isPlaying: false, position: this.position, duration: this.duration, loopEnabled: this.loopEnabled,
    });
  }

  seek(positionSec: number): void
  {
    if (this.duration <= 0) return;
    const norm = Math.max(0, Math.min(1, positionSec / this.duration));
    this.position = positionSec;
    this.workletNode?.port.postMessage({ type: 'seek-normalised', value: norm });
  }

  setLoop(enabled: boolean): void
  {
    this.loopEnabled = enabled;
    this.workletNode?.port.postMessage({ type: 'set-loop', value: enabled });
    this.emit('transportUpdate', {
      isPlaying: this.isPlayingState, position: this.position, duration: this.duration, loopEnabled: enabled,
    });
  }

  // ====== パラメータ → WASM 直送（ZeroComp の全パラメータ） ======

  setThresholdDb(db: number): void     { this.workletNode?.port.postMessage({ type: 'set-param', param: 'threshold_db',   value: db }); }
  setRatio(r: number): void            { this.workletNode?.port.postMessage({ type: 'set-param', param: 'ratio',          value: r  }); }
  setKneeDb(k: number): void           { this.workletNode?.port.postMessage({ type: 'set-param', param: 'knee_db',        value: k  }); }
  setAttackMs(ms: number): void        { this.workletNode?.port.postMessage({ type: 'set-param', param: 'attack_ms',      value: ms }); }
  setReleaseMs(ms: number): void       { this.workletNode?.port.postMessage({ type: 'set-param', param: 'release_ms',     value: ms }); }
  setOutputGainDb(db: number): void    { this.workletNode?.port.postMessage({ type: 'set-param', param: 'output_gain_db', value: db }); }
  setAutoMakeup(on: boolean): void     { this.workletNode?.port.postMessage({ type: 'set-param', param: 'auto_makeup',    value: on }); }
  setMode(modeIdx: number): void       { this.workletNode?.port.postMessage({ type: 'set-param', param: 'mode',           value: modeIdx }); }
  setMeteringMode(mode: number): void  { this.workletNode?.port.postMessage({ type: 'set-param', param: 'metering_mode',  value: mode }); }
  setBypass(b: boolean): void          { this.workletNode?.port.postMessage({ type: 'set-param', param: 'bypass',         value: b }); }
  resetMomentary(): void               { this.workletNode?.port.postMessage({ type: 'set-param', param: 'reset_momentary', value: true }); }

  // ====== 状態取得 ======

  getIsPlaying(): boolean  { return this.isPlayingState; }
  getLoopEnabled(): boolean { return this.loopEnabled; }
  getPosition(): number    { return this.position; }
  getDuration(): number    { return this.duration; }
}

export const webAudioEngine = new WebAudioEngine();
