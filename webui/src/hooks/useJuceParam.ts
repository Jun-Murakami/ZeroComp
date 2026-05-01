// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jun Murakami
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { getComboBoxState, getSliderState, getToggleState } from 'juce-framework-frontend-mirror';

//
// JUCE パラメータ (APVTS) のリアクティブ購読フック。
//
// 旧実装（useState + useEffect で valueChangedEvent.addListener 経由で setState）は、
// 「外部ストアの値をコンポーネントに取り込む」という useSyncExternalStore 本来の用途。
//
// useSyncExternalStore に寄せるメリット：
//  - subscribe/getSnapshot が契約として明示され、StrictMode 二重マウントでも正しく動く
//  - tearing-free（concurrent rendering 対応）
//  - subscribe は stable な参照である限り不要な購読再登録が起きない
//  - getSnapshot がプリミティブ値を返す限り、自前の値一致判定は不要
//

type SliderStateMirror = ReturnType<typeof getSliderState>;
type ToggleStateMirror = ReturnType<typeof getToggleState>;
type ComboBoxStateMirror = ReturnType<typeof getComboBoxState>;

// ============================================================================
// Slider: state だけ取り出す（value は購読しない）
// ============================================================================
//  App.tsx で THRESHOLD / OUTPUT_GAIN の mirror ロジック用に state だけ欲しい
//  場合に使う。購読しないので、値の変化による不要な App 再レンダーが発生しない。
//  → Link ON 中の rapid drag で生じていたフェーダーのワブリングを軽減。
export function useJuceSliderState(parameterId: string): NonNullable<SliderStateMirror> | null {
  return useMemo(() => getSliderState(parameterId) ?? null, [parameterId]);
}

// ============================================================================
// Slider: scaled 値を購読する
// ============================================================================
export function useJuceSliderValue(parameterId: string): {
  value: number;
  state: NonNullable<SliderStateMirror> | null;
  setNormalised: (t: number) => void;
  setScaled: (v: number, min: number, max: number) => void;
  getScaled: () => number | null;
} {
  // getSliderState はコンポーネントマウント時に 1 回取れば十分（パラメータ ID は不変）
  const state = useMemo<NonNullable<SliderStateMirror> | null>(() => getSliderState(parameterId) ?? null, [parameterId]);

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!state) return () => {};
      const id = state.valueChangedEvent.addListener(onChange);
      return () => state.valueChangedEvent.removeListener(id);
    },
    [state],
  );
  const getSnapshot = useCallback(() => (state ? state.getScaledValue() : 0), [state]);
  const value = useSyncExternalStore(subscribe, getSnapshot);

  const setNormalised = useCallback((t: number) => state?.setNormalisedValue(t), [state]);
  const setScaled = useCallback(
    (v: number, min: number, max: number) => {
      if (!state) return;
      const clamped = Math.max(min, Math.min(max, v));
      const norm = (clamped - min) / (max - min);
      state.setNormalisedValue(Math.max(0, Math.min(1, norm)));
    },
    [state],
  );
  const getScaled = useCallback(() => (state ? state.getScaledValue() : null), [state]);

  return { value, state, setNormalised, setScaled, getScaled };
}

// ============================================================================
// Toggle: bool 値を購読する
// ============================================================================
export function useJuceToggleValue(parameterId: string, defaultValue = false): {
  value: boolean;
  state: NonNullable<ToggleStateMirror> | null;
  setValue: (v: boolean) => void;
} {
  const state = useMemo<NonNullable<ToggleStateMirror> | null>(() => getToggleState(parameterId) ?? null, [parameterId]);

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!state) return () => {};
      const id = state.valueChangedEvent.addListener(onChange);
      return () => state.valueChangedEvent.removeListener(id);
    },
    [state],
  );
  const getSnapshot = useCallback(() => (state ? state.getValue() : defaultValue), [state, defaultValue]);
  const value = useSyncExternalStore(subscribe, getSnapshot);

  const setValue = useCallback((v: boolean) => state?.setValue(v), [state]);

  return { value, state, setValue };
}

// ============================================================================
// ComboBox: 選択インデックスを購読する
// ============================================================================
export function useJuceComboBoxIndex(parameterId: string): {
  index: number;
  state: NonNullable<ComboBoxStateMirror> | null;
  setIndex: (i: number) => void;
} {
  const state = useMemo<NonNullable<ComboBoxStateMirror> | null>(() => getComboBoxState(parameterId) ?? null, [parameterId]);

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!state) return () => {};
      const id = state.valueChangedEvent.addListener(onChange);
      return () => state.valueChangedEvent.removeListener(id);
    },
    [state],
  );
  const getSnapshot = useCallback(() => (state ? state.getChoiceIndex() : 0), [state]);
  const index = useSyncExternalStore(subscribe, getSnapshot);

  const setIndex = useCallback((i: number) => state?.setChoiceIndex(i), [state]);

  return { index, state, setIndex };
}
