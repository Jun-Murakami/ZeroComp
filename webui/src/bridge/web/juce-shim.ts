// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jun Murakami
/**
 * juce-framework-frontend-mirror の Web 互換 shim（ZeroComp 版）。
 * Vite エイリアスで本家モジュールの代わりにこれが解決される。
 *
 * ZeroComp の APVTS パラメータ
 *   THRESHOLD / RATIO / KNEE_DB / ATTACK_MS / RELEASE_MS / OUTPUT_GAIN
 *   AUTO_MAKEUP / MODE / METERING_MODE
 * を Web 側でエミュレートし、値変化を WebAudioEngine へ直送する。
 *
 * 重要: フェーダー側 (ParameterFader / HorizontalParameter) は `setScaled` を
 *  「scaled 値 → 線形正規化 → setNormalisedValue」で呼ぶ。
 *  shim 側でも `toScaled` / `fromScaled` は線形マッピングにしておけば、plugin 側と同じ往復になる。
 */

import {
  WebSliderState,
  WebToggleState,
  WebComboBoxState,
} from './WebParamState';
import { webAudioEngine } from './WebAudioEngine';

const sliderStates   = new Map<string, WebSliderState>();
const toggleStates   = new Map<string, WebToggleState>();
const comboBoxStates = new Map<string, WebComboBoxState>();

function makeLinearSlider(defaultScaled: number, min: number, max: number): WebSliderState
{
  return new WebSliderState({
    defaultScaled,
    min,
    max,
    toScaled:   (n: number) => min + n * (max - min),
    fromScaled: (v: number) => (v - min) / (max - min),
  });
}

function registerDefaults(): void
{
  // --- Slider 系（すべて scaled 値 ⇔ 線形正規化。plugin 側と同じ仕組み）---
  sliderStates.set('THRESHOLD',   makeLinearSlider(0.0, -80, 0));
  sliderStates.set('RATIO',       makeLinearSlider(1.0, 1, 100));
  sliderStates.set('KNEE_DB',     makeLinearSlider(6.0, 0, 24));
  sliderStates.set('ATTACK_MS',   makeLinearSlider(10.0, 0.1, 500));
  sliderStates.set('RELEASE_MS',  makeLinearSlider(100.0, 0.1, 2000));
  sliderStates.set('OUTPUT_GAIN', makeLinearSlider(0.0, -24, 24));

  // --- Toggle ---
  toggleStates.set('AUTO_MAKEUP', new WebToggleState(false));

  // --- Choice ---
  comboBoxStates.set('MODE',          new WebComboBoxState(0, 4)); // VCA / Opto / FET / Vari-Mu
  comboBoxStates.set('METERING_MODE', new WebComboBoxState(0, 3)); // Peak / RMS / Momentary
  comboBoxStates.set('DISPLAY_MODE',  new WebComboBoxState(0, 2)); // Metering / Waveform（UI のみ、DSP 送信なし）

  // --- 値変化 → WASM エンジンへ直送 ---
  sliderStates.get('THRESHOLD')!.valueChangedEvent.addListener(() => {
    webAudioEngine.setThresholdDb(sliderStates.get('THRESHOLD')!.getScaledValue());
  });
  sliderStates.get('RATIO')!.valueChangedEvent.addListener(() => {
    webAudioEngine.setRatio(sliderStates.get('RATIO')!.getScaledValue());
  });
  sliderStates.get('KNEE_DB')!.valueChangedEvent.addListener(() => {
    webAudioEngine.setKneeDb(sliderStates.get('KNEE_DB')!.getScaledValue());
  });
  sliderStates.get('ATTACK_MS')!.valueChangedEvent.addListener(() => {
    webAudioEngine.setAttackMs(sliderStates.get('ATTACK_MS')!.getScaledValue());
  });
  sliderStates.get('RELEASE_MS')!.valueChangedEvent.addListener(() => {
    webAudioEngine.setReleaseMs(sliderStates.get('RELEASE_MS')!.getScaledValue());
  });
  sliderStates.get('OUTPUT_GAIN')!.valueChangedEvent.addListener(() => {
    webAudioEngine.setOutputGainDb(sliderStates.get('OUTPUT_GAIN')!.getScaledValue());
  });
  toggleStates.get('AUTO_MAKEUP')!.valueChangedEvent.addListener(() => {
    webAudioEngine.setAutoMakeup(toggleStates.get('AUTO_MAKEUP')!.getValue());
  });
  comboBoxStates.get('MODE')!.valueChangedEvent.addListener(() => {
    webAudioEngine.setMode(comboBoxStates.get('MODE')!.getChoiceIndex());
  });
  comboBoxStates.get('METERING_MODE')!.valueChangedEvent.addListener(() => {
    webAudioEngine.setMeteringMode(comboBoxStates.get('METERING_MODE')!.getChoiceIndex());
  });

  // 初期値を WASM に反映（WASM 未初期化時は noop になる）
  webAudioEngine.setThresholdDb(sliderStates.get('THRESHOLD')!.getScaledValue());
  webAudioEngine.setRatio(sliderStates.get('RATIO')!.getScaledValue());
  webAudioEngine.setKneeDb(sliderStates.get('KNEE_DB')!.getScaledValue());
  webAudioEngine.setAttackMs(sliderStates.get('ATTACK_MS')!.getScaledValue());
  webAudioEngine.setReleaseMs(sliderStates.get('RELEASE_MS')!.getScaledValue());
  webAudioEngine.setOutputGainDb(sliderStates.get('OUTPUT_GAIN')!.getScaledValue());
  webAudioEngine.setAutoMakeup(toggleStates.get('AUTO_MAKEUP')!.getValue());
  webAudioEngine.setMode(comboBoxStates.get('MODE')!.getChoiceIndex());
  webAudioEngine.setMeteringMode(comboBoxStates.get('METERING_MODE')!.getChoiceIndex());
}

registerDefaults();

// ---------- juce-framework-frontend-mirror 互換 API ----------

export function getSliderState(id: string): WebSliderState | null
{
  return sliderStates.get(id) ?? null;
}

export function getToggleState(id: string): WebToggleState | null
{
  return toggleStates.get(id) ?? null;
}

export function getComboBoxState(id: string): WebComboBoxState | null
{
  return comboBoxStates.get(id) ?? null;
}

export function getNativeFunction(
  _name: string,
): ((...args: unknown[]) => Promise<unknown>) | null
{
  return null;
}
