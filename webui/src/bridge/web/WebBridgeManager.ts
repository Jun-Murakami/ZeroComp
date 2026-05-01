// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jun Murakami
/**
 * juceBridge の Web 互換実装。
 * App.tsx 等既存コンポーネントの `juceBridge.addEventListener(...)` 等をそのまま動かす薄いラッパー。
 */

import { webAudioEngine } from './WebAudioEngine';

type EventCallback = (data: unknown) => void;

class WebBridgeManager
{
  private initialized = false;
  private initCallbacks: Array<() => void> = [];
  private startPromise: Promise<void> | null = null;

  constructor()
  {
    // iOS WebKit 対策: AudioContext の生成はユーザジェスチャ内で行う必要がある。
    // ページロード時（= ジェスチャ外）で作ると suspended のまま固まり、
    // あとから resume() しても音が出ない版が存在する。
    // 初回タップで `ensureStarted()` が呼ばれるまで初期化を遅延する。
  }

  /**
   * 初回起動。**必ずユーザジェスチャ（tap/click）のハンドラから同期的に**呼ぶこと。
   * 冒頭で `webAudioEngine.startFromUserGesture()` を同期呼び出しすることで
   * iOS の audio unlock を成立させ、その後 sample.mp3 のプリロードまで続行する。
   *
   * 2 回目以降の呼び出しでは同じ Promise を返す（idempotent）。
   */
  public ensureStarted(): Promise<void>
  {
    if (this.startPromise) return this.startPromise;

    // 同期フレームでの unlock はここで実行される（最初の await より前）。
    const unlocked = webAudioEngine.startFromUserGesture();

    this.startPromise = unlocked
      .then(() => webAudioEngine.loadSampleFromUrl('/audio/sample.mp3', 'sample.mp3'))
      .then(() => {
        this.initialized = true;
        this.initCallbacks.forEach((cb) => cb());
        this.initCallbacks = [];
      })
      .catch((err) => {
        console.error('[WebBridge] Initialization failed:', err);
      });

    return this.startPromise;
  }

  public isStarted(): boolean { return this.startPromise !== null; }

  public whenReady(callback: () => void): void
  {
    if (this.initialized) callback();
    else this.initCallbacks.push(callback);
  }

  public async callNative(functionName: string, ...args: unknown[]): Promise<unknown>
  {
    if (functionName === 'system_action') return null;
    if (functionName === 'window_action') return null;
    if (functionName === 'open_url')
    {
      if (typeof args[0] === 'string') window.open(args[0], '_blank');
      return true;
    }
    return null;
  }

  public addEventListener(event: string, callback: EventCallback): string
  {
    return webAudioEngine.addEventListener(event, callback);
  }

  public removeEventListener(key: string): void
  {
    webAudioEngine.removeEventListener(key);
  }

  public emitEvent(_event: string, _data: unknown): void {}
}

export const webBridge = new WebBridgeManager();
