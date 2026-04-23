// ZeroComp: ゼロレイテンシー・リミッター用の型定義

// メーターレベル（dBFS スケール）
// - Peak モード: truePeakLeft/Right が入る
// - RMS モード:  rmsLeft/Right が入る
// - Momentary:   momentary（LKFS 単一値）が入る
export interface StereoMeter {
  truePeakLeft?: number;
  truePeakRight?: number;
  rmsLeft?: number;
  rmsRight?: number;
  momentary?: number;
}

// JUCE → WebUI のメーター更新イベント
export interface MeterUpdateData {
  meteringMode?: number; // 0=Peak / 1=RMS / 2=Momentary
  input?: StereoMeter;
  output?: StereoMeter;
  grDb?: number;
}

// JUCE Backend 型定義
declare class Backend {
  addEventListener(eventId: string, fn: (args: unknown) => unknown): [string, number];
  removeEventListener(param: [string, number]): void;
  emitEvent(eventId: string, object: unknown): void;
  emitByBackend(eventId: string, object: unknown): void;
}

declare global {
  interface Window {
    __JUCE__?: {
      backend: Backend;
      initialisationData: Record<string, unknown>;
      postMessage: () => void;
    };
    getNativeFunction?: (name: string) => (...args: unknown[]) => Promise<unknown>;
    getSliderState?: (name: string) => unknown;
    getToggleState?: (name: string) => unknown;
    getComboBoxState?: (name: string) => unknown;
    getBackendResourceAddress?: (path: string) => string;
    __resizeRAF?: number;
  }
}

export {};
