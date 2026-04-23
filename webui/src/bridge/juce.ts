// juce-framework-frontend-mirrorから必要な関数をインポート
import {
  getNativeFunction,
  getSliderState,
  getToggleState,
} from 'juce-framework-frontend-mirror';

class JuceBridgeManager {
  private initialized = false;
  private initCallbacks: Array<() => void> = [];
  // JUCE backend の addEventListener が返すハンドルは [eventName, id] タプルの場合がある。
  // 環境により解除関数を返す実装にも対応するため、ユニオンで保持する。
  private listeners: Map<string, [string, number] | (() => void)> = new Map();
  // valueChangedEvent の addListener は数値ハンドルを返す前提で ID を保持する
  private parameterListeners: Map<string, Array<number>> = new Map();
  // フロントから送った直後のエコー（JUCE→フロントのループバック）を抑制するための期限
  private suppressEchoUntil: Map<string, number> = new Map();
  // DAWオートメーション受信後など、一定時間はフロントからの送信を抑制するための期限
  private outgoingLockUntil: Map<string, number> = new Map();

  constructor() {
    this.initialize();
  }

  private async initialize() {
    // JUCEブリッジが利用可能になるまで待機
    const checkBridge = () => {
      if (window.__JUCE__?.backend) {
        this.initialized = true;
        this.initCallbacks.forEach(cb => cb());
        this.initCallbacks = [];
      } else {
        setTimeout(checkBridge, 100);
      }
    };
    checkBridge();
  }

  public whenReady(callback: () => void) {
    if (this.initialized) {
      callback();
    } else {
      this.initCallbacks.push(callback);
    }
  }

  public async callNative(functionName: string, ...args: unknown[]): Promise<unknown> {
    try {
      const nativeFunction = getNativeFunction(functionName);
      if (!nativeFunction) {
        return null;
      }
      return await nativeFunction(...args);
    } catch {
      return null;
    }
  }

  public addEventListener(event: string, callback: (data: unknown) => void): string {
    if (!window.__JUCE__?.backend) {
      return '';
    }
    const listenerId = window.__JUCE__.backend.addEventListener(event, callback);
    // 複数のリスナーを管理できるように修正
    const uniqueKey = `${event}_${listenerId}`;
    this.listeners.set(uniqueKey, listenerId);
    return uniqueKey;
  }

  public removeEventListener(uniqueKey: string) {
    if (!window.__JUCE__?.backend) return;
    const handle = this.listeners.get(uniqueKey);
    if (handle !== undefined) {
      // タプル([eventName, id]) または 解除関数に対応
      if (Array.isArray(handle)) {
        window.__JUCE__.backend.removeEventListener(handle);
      } else if (typeof handle === 'function') {
        handle();
      }
      this.listeners.delete(uniqueKey);
    }
  }

  public emitEvent(event: string, data: unknown) {
    if (!window.__JUCE__?.backend) {
      return;
    }
    window.__JUCE__.backend.emitEvent(event, data);
  }

  // DAW からの parameterUpdate を受けた直後などに呼ぶと、指定ミリ秒は同じIDの送信を抑止
  public lockOutgoing(id: string, ms: number = 220) {
    this.outgoingLockUntil.set(id, Date.now() + ms);
  }

  private isToggleParameter(id: string): boolean {
    // 明示マップ + 大文字小文字無視のヒューリスティックでトグル判定
    const knownToggles = new Set<string>(['LPF_ENABLED']);
    if (knownToggles.has(id)) return true;
    const lowered = id.toLowerCase();
    return lowered.includes('enabled') || lowered.includes('bypass') || lowered.includes('mute');
  }

  public addParameterListener(id: string, callback: (value: number | boolean) => void): string {
    const uniqueKey = `param_${id}_${Date.now()}`;

    // JUCEライブラリのスライダー/トグル状態オブジェクトを使用
    const listener = () => {
      // 抑制ウィンドウ内のエコーは無視
      const until = this.suppressEchoUntil.get(id) || 0;
      if (Date.now() < until) return;

      if (this.isToggleParameter(id)) {
        const toggleState = getToggleState(id);
        if (toggleState) {
          callback(toggleState.getValue());
        }
      } else {
        const sliderState = getSliderState(id);
        if (sliderState) {
          callback(sliderState.getNormalisedValue());
        }
      }
    };

    if (this.isToggleParameter(id)) {
      const toggleState = getToggleState(id);
      if (toggleState) {
        const handleId = toggleState.valueChangedEvent.addListener(listener);
        // リスナー ID を保存
        if (!this.parameterListeners.has(id)) {
          this.parameterListeners.set(id, []);
        }
        this.parameterListeners.get(id)!.push(handleId);
      }
    } else {
      const sliderState = getSliderState(id);
      if (sliderState) {
        const handleId = sliderState.valueChangedEvent.addListener(listener);
        // リスナー ID を保存
        if (!this.parameterListeners.has(id)) {
          this.parameterListeners.set(id, []);
        }
        this.parameterListeners.get(id)!.push(handleId);
      }
    }

    return uniqueKey;
  }

  public removeParameterListener(id: string): void {
    const listeners = this.parameterListeners.get(id);
    if (!listeners) return;

    // すべてのリスナーを削除
    if (this.isToggleParameter(id)) {
      const toggleState = getToggleState(id);
      if (toggleState) {
        listeners.forEach(listener => {
          toggleState.valueChangedEvent.removeListener(listener);
        });
      }
    } else {
      const sliderState = getSliderState(id);
      if (sliderState) {
        listeners.forEach(listener => {
          sliderState.valueChangedEvent.removeListener(listener);
        });
      }
    }

    this.parameterListeners.delete(id);
  }
}

export const juceBridge = new JuceBridgeManager();

// URL をシステムブラウザで開く
export async function openUrl(url: string): Promise<boolean> {
  try {
    const result = await juceBridge.callNative('open_url', url);
    return result === true;
  } catch {
    return false;
  }
}