// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jun Murakami
//
// メーター数値表示のフォーマッタ。
//  Fast Refresh の制約（react-refresh/only-export-components: コンポーネントファイルは
//  コンポーネントのみを export すべき）を満たすため、VUMeter.tsx から非コンポーネントの
//  ヘルパーをここへ分離した。表示レンジの下限は VUMeter の描画レンジと一致させる。

// dB メーターの表示下限（VUMeter の MIN_DB と同値）。これ以下は -∞ 表示。
const METER_MIN_DB = -30;
// Momentary LKFS の表示下限（VUMeter の LOUDNESS_MIN_LKFS と同値）。
const LOUDNESS_MIN_LKFS = -60;

// ラベル付き dB 表示（-∞ から 0 dB）
export const formatDb = (db: number): string =>
  db <= METER_MIN_DB ? '-∞' : Math.max(METER_MIN_DB, Math.min(0, db)).toFixed(1);

// Momentary LKFS 値用の数値表示（-∞ から 0 LKFS）
export const formatLkfs = (lkfs: number): string =>
  lkfs <= LOUDNESS_MIN_LKFS ? '-∞' : Math.max(LOUDNESS_MIN_LKFS, Math.min(0, lkfs)).toFixed(1);
