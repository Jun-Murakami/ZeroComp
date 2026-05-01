// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jun Murakami
import React, { useLayoutEffect, useRef } from 'react';
import { Box, Typography } from '@mui/material';

// コンプレッサー静的カーブ（Input dB → Output dB）の可視化
//  x/y 範囲は 0..-60 dB。threshold, ratio, knee がリアルタイムに反映される。
//  さらに現在の入力ピーク (inputDb) を赤マーカーで、出力ピーク (outputDb) を水平線で重ねる。

interface RatioGraphProps {
  thresholdDb: number;
  ratio: number;
  kneeDb: number;
  /** 現在の入力ピーク dB。カーブ上の対応点にドットを表示する。 */
  inputDb?: number;
  /** Auto Makeup 有効時の補償量（dB, 正値）。カーブとドットをこの分上にシフト描画する。 */
  makeupDb?: number;
  /** 正方形に描画するときのサイズ。width/height が未指定のときの既定値。 */
  size?: number;
  /** 明示的に幅・高さを個別に指定（非正方形描画）。余った領域いっぱいに広げる用途で使う。 */
  width?: number;
  height?: number;
}

const GRAPH_MIN_DB = -60;
const GRAPH_MAX_DB = 0;

// x 軸 / y 軸を個別の長さで扱う。
//  x 軸: 左端 = GRAPH_MIN_DB, 右端 = GRAPH_MAX_DB
//  y 軸: 下端 = GRAPH_MIN_DB, 上端 = GRAPH_MAX_DB
const dbToX = (db: number, w: number): number => {
  const clamped = Math.max(GRAPH_MIN_DB, Math.min(GRAPH_MAX_DB, db));
  const t = (clamped - GRAPH_MIN_DB) / (GRAPH_MAX_DB - GRAPH_MIN_DB);
  return t * w;
};
const dbToY = (db: number, h: number): number => {
  const clamped = Math.max(GRAPH_MIN_DB, Math.min(GRAPH_MAX_DB, db));
  const t = (clamped - GRAPH_MIN_DB) / (GRAPH_MAX_DB - GRAPH_MIN_DB);
  return h - t * h; // y は下向きが正なので反転
};

const computeOutputDb = (inDb: number, threshold: number, ratio: number, knee: number): number => {
  // Giannoulis/Massberg/Reiss 2012: y = x, x + slope*(x-T)^2/(2K) (soft knee), x + slope*(x-T)
  const slope = 1 - 1 / Math.max(1, ratio);
  if (knee <= 0) {
    if (inDb <= threshold) return inDb;
    return inDb - slope * (inDb - threshold);
  }
  const half = 0.5 * knee;
  const diff = inDb - threshold;
  if (diff < -half) return inDb;
  if (diff > half) return inDb - slope * diff;
  const x = diff + half;
  return inDb - slope * (x * x) / (2 * knee);
};

export const RatioGraph: React.FC<RatioGraphProps> = ({
  thresholdDb,
  ratio,
  kneeDb,
  inputDb,
  makeupDb = 0,
  size,
  width,
  height,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const W = width ?? size ?? 160;
  const H = height ?? size ?? 160;

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 背景
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, W, H);

    // グリッド（6dB ごとに垂直 / 水平）
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 0.5;
    for (let db = -6; db >= GRAPH_MIN_DB; db -= 6) {
      const x = dbToX(db, W);
      const y = dbToY(db, H);
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, H);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(W, y + 0.5);
      ctx.stroke();
    }

    // ユニティライン（1:1 参照）— x 軸・y 軸が非等長なとき、対角線ではなく
    //  dB 空間上での y=x を描くためサンプリングする（短辺の長さに影響されない）。
    ctx.strokeStyle = 'rgba(120,120,120,0.6)';
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    {
      const x0 = dbToX(GRAPH_MIN_DB, W);
      const y0 = dbToY(GRAPH_MIN_DB, H);
      const x1 = dbToX(GRAPH_MAX_DB, W);
      const y1 = dbToY(GRAPH_MAX_DB, H);
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // 静的カーブ
    //  Auto Makeup ON のときは、出力全体を makeupDb 分だけ上にシフトして描画する。
    //  これで「Makeup を有効にすると全体がこれだけ持ち上がる」が視覚的に見える。
    ctx.strokeStyle = '#4fc3f7';
    ctx.lineWidth = 2;
    ctx.beginPath();
    let first = true;
    const step = Math.max(1, Math.floor(W / 240));
    for (let x = 0; x <= W; x += step) {
      const inDb = GRAPH_MIN_DB + (x / W) * (GRAPH_MAX_DB - GRAPH_MIN_DB);
      const outDb = computeOutputDb(inDb, thresholdDb, ratio, kneeDb) + makeupDb;
      const yPx = dbToY(outDb, H);
      if (first) {
        ctx.moveTo(x, yPx);
        first = false;
      } else {
        ctx.lineTo(x, yPx);
      }
    }
    ctx.stroke();

    // Threshold マーカー（縦破線）
    {
      const x = dbToX(thresholdDb, W);
      ctx.strokeStyle = 'rgba(255,171,0,0.6)';
      ctx.setLineDash([2, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, H);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 現在の動作点ドット。
    //  IN と OUT のピーク値は独立に減衰していて「同一瞬間の値」ではないため、
    //  単純に (inputDb, outputDb) の十字を引くとカーブ表示からズレる。
    //  そこで入力 dB からカーブの理論出力値を計算し、カーブ上に必ず乗るドットで示す。
    if (typeof inputDb === 'number' && inputDb > GRAPH_MIN_DB) {
      const outDbOnCurve = computeOutputDb(inputDb, thresholdDb, ratio, kneeDb) + makeupDb;
      const dotX = dbToX(inputDb, W);
      const dotY = dbToY(outDbOnCurve, H);
      // 外周（視認性のためのハロ）
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath();
      ctx.arc(dotX, dotY, 6, 0, Math.PI * 2);
      ctx.fill();
      // 本体（プライマリブルー）
      ctx.fillStyle = '#4fc3f7';
      ctx.beginPath();
      ctx.arc(dotX, dotY, 4, 0, Math.PI * 2);
      ctx.fill();
    }

  }, [thresholdDb, ratio, kneeDb, inputDb, makeupDb, W, H]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <Box sx={{ height: 36, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', pb: 0.25 }}>
        <Typography variant='caption' sx={{ fontSize: '9px', color: 'text.secondary', fontWeight: 500, lineHeight: 1 }}>
          CURVE
        </Typography>
      </Box>
      <canvas
        ref={canvasRef}
        style={{ borderRadius: 4, border: '1px solid #333', width: W, height: H, display: 'block' }}
      />
    </Box>
  );
};
