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

  constructor()
  {
    void this.initialize();
  }

  private async initialize(): Promise<void>
  {
    try
    {
      await webAudioEngine.initialize();
      // デモソース（sample.mp3）を自動プリロード
      await webAudioEngine.loadSampleFromUrl('/audio/sample.mp3', 'sample.mp3');
    }
    catch (err)
    {
      console.error('[WebBridge] Initialization failed:', err);
    }
    this.initialized = true;
    this.initCallbacks.forEach((cb) => cb());
    this.initCallbacks = [];
  }

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
