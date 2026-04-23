import React, { useLayoutEffect, useRef } from 'react';
import { Box, Typography } from '@mui/material';

// メーター描画定数
//  レンジは Threshold/Output フェーダー・GR メーターと揃えて 0..-30 dB。
//  中点(-15)に設定して VISUAL_EXPONENT=1 の線形マッピングになる（GR と視覚的に揃う）。
const METER_HEIGHT = 160;
const DEFAULT_BAR_WIDTH = 24;
const MIN_DB = -30;
const TARGET_DB_AT_MID = -15;
const LINEAR_AT_TARGET = (TARGET_DB_AT_MID - MIN_DB) / (0 - MIN_DB);
const VISUAL_EXPONENT = Math.log(0.5) / Math.log(Math.max(1e-6, LINEAR_AT_TARGET));

const dbToUnit = (db: number): number => {
  const clamped = Math.max(MIN_DB, Math.min(0, db));
  const linear = (clamped - MIN_DB) / (0 - MIN_DB);
  return Math.pow(linear, VISUAL_EXPONENT);
};
const dbToY = (db: number, h: number): number => h - dbToUnit(db) * h;

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

// ============================
// レベルメーター（dB, 上=0dBFS）
// ============================
export const LevelMeterBar: React.FC<{ level: number; label: string; width?: number; height?: number }> = ({
  level,
  label,
  width,
  height,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cssW = width ?? DEFAULT_BAR_WIDTH;
  const cssH = height ?? METER_HEIGHT;

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = setupHiDPICanvas(canvas, cssW, cssH);
    if (!ctx) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);

    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = '#333';
    ctx.fillRect(0, 0, cssW, cssH);

    const grad = ctx.createLinearGradient(0, cssH, 0, 0);
    grad.addColorStop(0, '#4fc3f7');
    grad.addColorStop(0.6, '#4fc3f7');
    grad.addColorStop(0.8, '#ffeb3b');
    grad.addColorStop(1, '#ff5252');

    const clamped = Math.max(MIN_DB, Math.min(0, level));
    const yTop = dbToY(clamped, cssH);
    ctx.fillStyle = grad;
    ctx.fillRect(0, yTop, cssW, cssH - yTop);

    // GR メーターと同じ目盛り値（0 と最下端を省いた中間値）を、
    //  左側のみ短い線で引く。
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 0.5;
    [-3, -6, -9, -12, -18, -24].forEach((db) => {
      const y = dbToY(db, cssH);
      ctx.beginPath();
      const ya = crisp(y, dpr);
      ctx.moveTo(0, ya);
      ctx.lineTo(cssW * 0.25, ya);
      ctx.stroke();
    });
  }, [level, cssW, cssH]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <Box sx={{ height: 36, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', pb: 0.25 }}>
        <Typography variant='caption' sx={{ fontSize: '9px', color: 'text.secondary', fontWeight: 500, lineHeight: 1 }}>
          {label}
        </Typography>
      </Box>
      <canvas
        ref={canvasRef}
        width={cssW}
        height={cssH}
        style={{ borderRadius: 2, border: '1px solid #333', width: cssW, height: cssH }}
      />
    </Box>
  );
};

// ============================
// GR メーター（上=0dB、下方向にリダクション量）
// ============================
//  Threshold/Output フェーダーのスケールに合わせて 0..-30 dB 範囲で描画。
const GR_MAX_DB = 30; // 表示上限（フェーダー側と揃える）
const grToUnit = (grDb: number): number => Math.max(0, Math.min(1, grDb / GR_MAX_DB));

export const GainReductionMeterBar: React.FC<{ grDb: number; width?: number; height?: number; compact?: boolean }> = ({
  grDb,
  width,
  height,
  compact = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cssW = width ?? DEFAULT_BAR_WIDTH * 2;
  const cssH = height ?? METER_HEIGHT;

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = setupHiDPICanvas(canvas, cssW, cssH);
    if (!ctx) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);

    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = '#333';
    ctx.fillRect(0, 0, cssW, cssH);

    const u = grToUnit(grDb);
    const barHeight = u * cssH;
    // GR バーは上から下へ伸びる（上端 = 0 dB GR、下端 = 最大 GR）。
    //  バーが長いほど = 圧縮量が大きいほど赤が自然なので、上端オレンジ → 下端赤の 2 ストップ リニア。
    const grad = ctx.createLinearGradient(0, 0, 0, cssH);
    grad.addColorStop(0, '#ffab00'); // 上端（浅い圧縮側） = オレンジ
    grad.addColorStop(1, '#ff5252'); // 下端（深い圧縮側） = 赤

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, cssW, barHeight);

    // compact: Waveform モードの細い GR バー用。ラベル省略、左端から短いチックのみ。
    // 通常: 数値の両脇に水平線を引く。0 と -30 は省略。
    if (compact) {
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 0.5;
      [3, 6, 9, 12, 18, 24].forEach((db) => {
        const y = grToUnit(db) * cssH;
        const ya = crisp(y, dpr);
        ctx.beginPath();
        ctx.moveTo(0, ya);
        ctx.lineTo(cssW * 0.35, ya);
        ctx.stroke();
      });
    } else {
      ctx.font = '9px sans-serif';
      const tickColor = 'rgba(255,255,255,0.28)';
      ctx.fillStyle = tickColor;
      ctx.strokeStyle = tickColor;
      ctx.lineWidth = 1;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const centerX = cssW / 2;
      [3, 6, 9, 12, 18, 24].forEach((db) => {
        const y = grToUnit(db) * cssH;
        const labelText = `-${db}`;
        const textWidth = Math.ceil(ctx.measureText(labelText).width);
        const halfGap = textWidth / 2 + 3;

        const ya = crisp(y, dpr);
        ctx.beginPath();
        ctx.moveTo(0, ya);
        ctx.lineTo(centerX - halfGap, ya);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(centerX + halfGap, ya);
        ctx.lineTo(cssW, ya);
        ctx.stroke();

        ctx.fillText(labelText, centerX, y);
      });
    }
  }, [grDb, cssW, cssH, compact]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <Box sx={{ height: 36, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', pb: 0.25 }}>
        <Typography variant='caption' sx={{ fontSize: '9px', color: 'text.secondary', fontWeight: 500, lineHeight: 1 }}>
          GR
        </Typography>
      </Box>
      <canvas
        ref={canvasRef}
        width={cssW}
        height={cssH}
        style={{ borderRadius: 2, border: '1px solid #333', width: cssW, height: cssH }}
      />
    </Box>
  );
};


// ============================
// ラウドネス（Momentary LKFS）メーター
// ============================
//  単一バーで -60..0 LKFS を非線形スケール（dbToUnit と同じ視覚カーブ）
const LOUDNESS_MIN_LKFS = -60;

const lkfsToUnit = (lkfs: number): number => {
  const clamped = Math.max(LOUDNESS_MIN_LKFS, Math.min(0, lkfs));
  const linear = (clamped - LOUDNESS_MIN_LKFS) / (0 - LOUDNESS_MIN_LKFS);
  return Math.pow(linear, VISUAL_EXPONENT);
};
const lkfsToY = (lkfs: number, h: number): number => h - lkfsToUnit(lkfs) * h;

export const LoudnessMeterBar: React.FC<{ lkfs: number; width?: number; height?: number; label?: string }> = ({
  lkfs,
  width,
  height,
  label,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cssW = width ?? DEFAULT_BAR_WIDTH * 2 + 4;
  const cssH = height ?? METER_HEIGHT;

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = setupHiDPICanvas(canvas, cssW, cssH);
    if (!ctx) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);

    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = '#333';
    ctx.fillRect(0, 0, cssW, cssH);

    const grad = ctx.createLinearGradient(0, cssH, 0, 0);
    grad.addColorStop(0, '#4fc3f7');
    grad.addColorStop(0.6, '#4fc3f7');
    grad.addColorStop(0.8, '#ffeb3b');
    grad.addColorStop(1, '#ff5252');

    const clamped = Math.max(LOUDNESS_MIN_LKFS, Math.min(0, lkfs));
    const yTop = lkfsToY(clamped, cssH);
    ctx.fillStyle = grad;
    ctx.fillRect(0, yTop, cssW, cssH - yTop);

    ctx.strokeStyle = '#666';
    ctx.lineWidth = 0.5;
    [0, -6, -12, -18, -24, -30, -40, -50, -60].forEach((lk) => {
      const y = lkfsToY(lk, cssH);
      ctx.beginPath();
      const ya = crisp(y, dpr);
      ctx.moveTo(0, ya);
      ctx.lineTo(cssW * 0.15, ya);
      ctx.stroke();
    });
  }, [lkfs, cssW, cssH]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {/* Momentary モードは 1 段ラベル。下端に寄せてメーターにくっつける。 */}
      <Box sx={{ height: 36, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', pb: 0.25 }}>
        <Typography variant='caption' sx={{ fontSize: '9px', color: 'text.secondary', fontWeight: 500, lineHeight: 1 }}>
          {label ?? 'LKFS'}
        </Typography>
      </Box>
      <canvas
        ref={canvasRef}
        width={cssW}
        height={cssH}
        style={{ borderRadius: 2, border: '1px solid #333', width: cssW, height: cssH }}
      />
    </Box>
  );
};

// ============================
// ラベル付き dB 表示
// ============================
export const formatDb = (db: number): string => (db <= MIN_DB ? '-∞' : Math.max(MIN_DB, Math.min(0, db)).toFixed(1));

// Momentary LKFS 値用の数値表示（-∞ から 0 LKFS）
export const formatLkfs = (lkfs: number): string =>
  lkfs <= LOUDNESS_MIN_LKFS ? '-∞' : Math.max(LOUDNESS_MIN_LKFS, Math.min(0, lkfs)).toFixed(1);
