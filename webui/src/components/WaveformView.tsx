// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jun Murakami
import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { Box, Typography } from '@mui/material';
import { juceBridge } from '../bridge/juce';
import { useJuceSliderValue } from '../hooks/useJuceParam';

// ============================================================================
// WaveformView
// ============================================================================
//  Pro-C / Pro-L 風のオシロスコープ表示。
//  - 右端が now、左に向かって過去へ流れる（右→左スクロール、約 7 秒ぶん）。
//  - 位相はマージ済みの絶対値（|L|,|R| の max）。
//  - 縦軸は 0 dB (top) ... -60 dB (bottom) の非線形スケール（Threshold フェーダーと揃える）。
//    ZeroComp の THRESHOLD は -80..0 まで動けるが、視覚的に -60 より深い領域は殆ど使わないので
//    既定の表示レンジは -60 までに抑え、それ以下に行ったら画面底にクランプ（線だけ残す）。
//  - Threshold 値に応じて水平線を描き、per-sample gain（Compressor が適用した本当の値）の
//    slice 最小値から dB 換算した GR を、threshold 線から下方向に反転描画する。
//
// データは `waveformUpdate` イベント経由で slice 単位の配列を受け取り、
//  内部のリングバッファ（ref）に書き込む。React state は使わず、インクリメンタルに
//  canvas を更新して再レンダーを回避する。

const MIN_DB = -60;
const TARGET_DB_AT_MID = -24; // -24 dB を視覚中央に（Threshold フェーダーの目盛り中央に合わせる）
const LINEAR_AT_TARGET = (TARGET_DB_AT_MID - MIN_DB) / (0 - MIN_DB);
const VISUAL_EXPONENT = Math.log(0.5) / Math.log(Math.max(1e-6, LINEAR_AT_TARGET));

const dbToUnit = (db: number): number => {
  const clamped = Math.max(MIN_DB, Math.min(0, db));
  const linear = (clamped - MIN_DB) / (0 - MIN_DB);
  return Math.pow(linear, VISUAL_EXPONENT);
};
const dbToY = (db: number, h: number): number => h - dbToUnit(db) * h;

// リニア振幅 → dB（min クランプ）
const linToDb = (lin: number): number => {
  if (lin <= 1e-6) return MIN_DB;
  return 20 * Math.log10(lin);
};

const setupHiDPICanvas = (canvas: HTMLCanvasElement, cssW: number, cssH: number): CanvasRenderingContext2D | null => {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  return ctx;
};

const crisp = (v: number, dpr: number): number => Math.round(v * dpr) / dpr + 0.5 / dpr;

// 描画ループで参照する定数は module-level に置いて毎フレームのアロケーションを避ける。
//  ZeroComp の Threshold フェーダー目盛り（0 / -6 / -12 / -24 / -40 / -60 / -80）のうち
//  表示レンジ（-60..0）に収まるものを採用。
const DB_GRID_LEVELS: readonly number[] = [-6, -12, -24, -40];
const DB_SCALE_MARKS: ReadonlyArray<readonly [number, string]> = [
  [  0,   '0'],
  [ -6,  '-6'],
  [-12, '-12'],
  [-24, '-24'],
  [-40, '-40'],
  [-60, '-60'],
];

// waveformUpdate の生データ型
interface WaveformUpdateData {
  sliceHz?: number;
  peaks?: number[];  // linear amplitude per slice
  grDb?: number[];   // gain reduction in dB per slice (>= 0)
}

interface WaveformViewProps {
  width: number;
  height: number;
  seconds?: number;           // 表示秒数（既定 7）
  sliceHz?: number;           // スライスレート（既定 200）
  isResizing?: boolean;       // ウィンドウリサイズ中は描画をスキップ（負荷軽減）
}

export const WaveformView: React.FC<WaveformViewProps> = ({
  width,
  height,
  seconds = 7,
  sliceHz = 200,
  isResizing = false,
}) => {
  // Threshold をここで購読。App.tsx は購読しないことで Threshold ドラッグ中の
  //  App 全体の再レンダーを避ける（ZeroLimit の Link と同じ方針）。
  const { value: thresholdDb } = useJuceSliderValue('THRESHOLD');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 表示用リングバッファ（slice 単位）。サイズはスライスレート × 秒数。
  //  lazy init: useRef(new Float32Array(...)) だと毎レンダーで引数式が評価されて
  //  初期化用配列が無駄に生成される（最終的に捨てられる）。ref.current を遅延初期化することで
  //  最初の 1 回だけ割り当てる。
  const bufferLen = Math.max(16, Math.round(sliceHz * seconds));
  const peaksRef = useRef<Float32Array | null>(null);
  const grDbRef  = useRef<Float32Array | null>(null);
  if (peaksRef.current === null || peaksRef.current.length !== bufferLen) {
    peaksRef.current = new Float32Array(bufferLen);
    grDbRef.current  = new Float32Array(bufferLen);
  }
  const writeIdxRef = useRef<number>(0);

  // 最新の threshold / isResizing を render 中 ref で保持（draw ループから参照）
  const thresholdRef = useRef<number>(thresholdDb);
  thresholdRef.current = thresholdDb;
  const isResizingRef = useRef<boolean>(isResizing);
  isResizingRef.current = isResizing;

  const sizeRef = useRef<{ w: number; h: number }>({ w: width, h: height });
  sizeRef.current = { w: width, h: height };

  const drawRef = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // リサイズ中は canvas bitmap 再確保 + 描画をスキップ。CSS サイズだけ追従させる。
    if (isResizing) {
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      return;
    }

    const ctx = setupHiDPICanvas(canvas, width, height);
    if (!ctx) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);

    drawRef.current = () => {
      if (isResizingRef.current) return;

      const { w: cssW, h: cssH } = sizeRef.current;
      const threshold = thresholdRef.current;
      const peaks = peaksRef.current!;
      const grDbs = grDbRef.current!;
      const writeIdx = writeIdxRef.current;
      const len = peaks.length;

      // ---- 背景 ----
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, cssW, cssH);

      // ---- dB グリッド ----
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      for (const db of DB_GRID_LEVELS) {
        const y = crisp(dbToY(db, cssH), dpr);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(cssW, y);
        ctx.stroke();
      }

      // ---- 波形エンベロープ ----
      //  ZeroEQ のスペアナと揃えて縦グラデーションで塗る（上端が濃く、底にかけてフェード）。
      //  スペアナと違い波形ラン表示にはアウトライン（境界線）は引かない。
      const pxPerSlice = cssW / len;
      // 上端はテーマプライマリシアン α=1.0、上〜中段にかけて滑らかにフェードし、
      //  下 10% 付近で一気に抜ける非線形カーブ。
      //  中段もしっかりグラデーションが見える明るさを保ちつつ、底は暗く沈める。
      const envGrad = ctx.createLinearGradient(0, 0, 0, cssH);
      envGrad.addColorStop(0.00, 'rgba(79,195,247,1.00)');
      envGrad.addColorStop(0.35, 'rgba(79,195,247,0.85)');
      envGrad.addColorStop(0.70, 'rgba(79,195,247,0.50)');
      envGrad.addColorStop(0.92, 'rgba(79,195,247,0.10)');
      envGrad.addColorStop(1.00, 'rgba(79,195,247,0.02)');
      ctx.fillStyle = envGrad;
      ctx.beginPath();
      ctx.moveTo(0, cssH);
      for (let i = 0; i < len; ++i) {
        const bufIdx = (writeIdx + i) % len;
        const peak = peaks[bufIdx];
        const db = linToDb(peak);
        const y = dbToY(db, cssH);
        const x = i * pxPerSlice;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(cssW, cssH);
      ctx.closePath();
      ctx.fill();

      // ---- Threshold 超過部分のハイライト（threshold より上を薄グレーで塗り直す） ----
      //  Threshold が表示下限より下の場合（-80..-60 の領域）は画面底にクランプ扱いで線だけ引く。
      //  エンベロープと同じく縦グラデーションで濃度を揃える。
      const yThreshold = dbToY(Math.max(MIN_DB, threshold), cssH);
      if (yThreshold > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, cssW, yThreshold);
        ctx.clip();

        // グレーは控えめにして下のシアンが透けるようにする。エンベロープと同じ曲線に揃える。
        const overGrad = ctx.createLinearGradient(0, 0, 0, cssH);
        overGrad.addColorStop(0.00, 'rgba(160,160,160,1.00)');
        overGrad.addColorStop(0.35, 'rgba(160,160,160,0.85)');
        overGrad.addColorStop(0.70, 'rgba(160,160,160,0.50)');
        overGrad.addColorStop(0.92, 'rgba(160,160,160,0.10)');
        overGrad.addColorStop(1.00, 'rgba(160,160,160,0.02)');
        ctx.fillStyle = overGrad;
        ctx.beginPath();
        ctx.moveTo(0, cssH);
        for (let i = 0; i < len; ++i) {
          const bufIdx = (writeIdx + i) % len;
          const peak = peaks[bufIdx];
          const db = linToDb(peak);
          const y = dbToY(db, cssH);
          const x = i * pxPerSlice;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(cssW, cssH);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // ---- GR を threshold 線から下方向に反転描画 ----
      //  縦グラデーションは threshold 線起点で、下に向かってフェード。深い GR ほど薄く残る。
      if (yThreshold < cssH) {
        // GR も同じプロファイル: threshold 線直下は濃い赤、中段まで徐々に薄くなり、底で急抜け。
        const grGrad = ctx.createLinearGradient(0, yThreshold, 0, cssH);
        grGrad.addColorStop(0.00, 'rgba(255,82,82,0.75)');
        grGrad.addColorStop(0.35, 'rgba(255,82,82,0.60)');
        grGrad.addColorStop(0.70, 'rgba(255,82,82,0.35)');
        grGrad.addColorStop(0.92, 'rgba(255,82,82,0.07)');
        grGrad.addColorStop(1.00, 'rgba(255,82,82,0.02)');
        ctx.fillStyle = grGrad;
        ctx.beginPath();
        ctx.moveTo(0, yThreshold);
        for (let i = 0; i < len; ++i) {
          const bufIdx = (writeIdx + i) % len;
          const gr = grDbs[bufIdx];
          if (gr <= 0.01) {
            const x = i * pxPerSlice;
            ctx.lineTo(x, yThreshold);
            continue;
          }
          const reducedDb = Math.max(MIN_DB, Math.max(MIN_DB, threshold) - gr);
          const y = dbToY(reducedDb, cssH);
          const x = i * pxPerSlice;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(cssW, yThreshold);
        ctx.closePath();
        ctx.fill();
      }

      // ---- 右端内側 dB 目盛りラベル ----
      ctx.save();
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(37, 37, 37, 0.5)';
      ctx.fillStyle = 'rgba(255, 255, 255, 1)';
      ctx.shadowColor  = 'rgba(37, 37, 37, 0.75)';
      ctx.shadowBlur   = 3;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 1;
      for (const [db, label] of DB_SCALE_MARKS) {
        let y = dbToY(db, cssH);
        const padY = 6;
        y = Math.max(padY, Math.min(cssH - padY, y));
        ctx.strokeText(label, cssW - 3, y);
        const prevShadow = ctx.shadowColor;
        ctx.shadowColor = 'rgba(0, 0, 0, 0)';
        ctx.fillText(label, cssW - 3, y);
        ctx.shadowColor = prevShadow;
      }
      ctx.restore();

      // ---- Threshold 水平線（dashed, white）----
      //  threshold が MIN_DB 未満の場合は底に固定。
      if (threshold < 0) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        const y = crisp(yThreshold, dpr);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(cssW, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    };

    drawRef.current();
  }, [width, height, bufferLen, isResizing]);

  // waveformUpdate 購読。ring buffer に書き込んで即時再描画。
  //  イベント配信元 (C++ 側 60Hz タイマ) が描画トリガーを兼ねる。
  //
  //  60Hz 化のちらつき対策: 新しい slice が無い / ペイロードが空のイベントが届いた場合は
  //  早期 return で redraw を走らせない。canvas 画素は前フレームのまま残るので、
  //  "描画データが落ちた場合は前のフレームを保持" という挙動になる。
  //  C++ 側も available == 0 のときは emit しないので、通常この分岐には落ちない想定。
  useEffect(() => {
    const id = juceBridge.addEventListener('waveformUpdate', (d: unknown) => {
      const wf = d as WaveformUpdateData;
      const ps = wf.peaks;
      const gs = wf.grDb;
      if (!ps || !gs) return;
      const n = Math.min(ps.length, gs.length);
      if (n === 0) return;  // 前フレーム保持

      const peaks = peaksRef.current!;
      const grDbs = grDbRef.current!;
      const len = peaks.length;
      let w = writeIdxRef.current;
      for (let i = 0; i < n; ++i) {
        peaks[w] = ps[i];
        grDbs[w] = gs[i];
        w = (w + 1) % len;
      }
      writeIdxRef.current = w;

      drawRef.current();
    });
    return () => juceBridge.removeEventListener(id);
  }, []);

  // threshold 変化で即時再描画
  useEffect(() => {
    drawRef.current();
  }, [thresholdDb]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {/* 36px ヘッダ — ParameterFader / RatioGraph / VUMeter と同じ高さに合わせて
           canvas の上端を他の slider / メーターバーの上端と垂直にアラインさせる。 */}
      <Box sx={{ height: 36, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', pb: 0.25 }}>
        <Typography variant='caption' sx={{ fontSize: '9px', color: 'text.secondary', fontWeight: 500, lineHeight: 1 }}>
          WAVEFORM
        </Typography>
      </Box>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{ borderRadius: 2, border: '1px solid #333', width, height }}
      />
    </Box>
  );
};
