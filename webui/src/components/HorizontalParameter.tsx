// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jun Murakami
import React, { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Box, Input, Slider, Typography } from '@mui/material';
import { useJuceSliderValue } from '../hooks/useJuceParam';
import { useFineAdjustPointer } from '../hooks/useFineAdjustPointer';
import { useNumberInputAdjust } from '../hooks/useNumberInputAdjust';

type SkewKind = 'linear' | 'log';

interface HorizontalParameterProps {
  parameterId: string;
  label: string;
  min: number;
  max: number;
  skew?: SkewKind;
  defaultValue?: number;
  formatValue?: (v: number) => string;
  unit?: string;
  marks?: Array<{ value: number; label: string }>;
  /** ラベル（左側）の固定幅 */
  labelWidth?: number;
  /** 入力ボックス（右側）の固定幅 */
  inputWidth?: number;
  /** wheel 1tick の刻み（linear は値空間、log は step/100 を norm 空間に使う）。
   *  linear の APVTS が interval step を持つ場合（例: Knee の 0.1 dB）、
   *  fine step はその interval 以上に設定すること（それ未満だとスナップで値が変わらない）。 */
  wheelStep?: number;
  wheelStepFine?: number;
  /** 値を確定する直前に通すクランプ関数（相互制約用、例: SC HPF ≤ SC LPF）。
   *  slider / wheel / 数値入力 / 微調整ドラッグ いずれの経路でも適用される。 */
  clampValue?: (v: number) => number;
  /** 右側に追加で描画する要素（slope ドロップダウン等）。入力欄のさらに右に並ぶ。 */
  endAdornment?: React.ReactNode;
  /** レールの塗りつぶしをサムの右側にする（HPF 用。通常は左＝min→thumb を塗る）。 */
  trackInverted?: boolean;
  /** 数値入力で許可する小数点以下の桁数（確定時に丸める）。未指定なら丸めなし。 */
  maxInputDecimals?: number;
  /** 塗り側を太く・未塗り側を細くテーパーするレール描画にする（SC フィルタ用）。
   *  MUI の rail/track は全幅一律のため、専用のカスタムレールに差し替える。
   *  塗り側は trackInverted に従う（true=右側 / false=左側）。 */
  taperFill?: boolean;
}

const valueToNorm = (v: number, min: number, max: number, skew: SkewKind): number => {
  if (max === min) return 0;
  const clamped = Math.max(min, Math.min(max, v));
  if (skew === 'log' && min > 0) {
    return Math.log(clamped / min) / Math.log(max / min);
  }
  return (clamped - min) / (max - min);
};

const normToValue = (t: number, min: number, max: number, skew: SkewKind): number => {
  const clamped = Math.max(0, Math.min(1, t));
  if (skew === 'log' && min > 0) {
    return min * Math.pow(max / min, clamped);
  }
  return min + (max - min) * clamped;
};

export const HorizontalParameter: React.FC<HorizontalParameterProps> = ({
  parameterId,
  label,
  min,
  max,
  skew = 'linear',
  defaultValue,
  formatValue,
  unit,
  marks,
  labelWidth = 46,
  inputWidth = 50,
  wheelStep = 1,
  wheelStepFine = 0.2,
  clampValue,
  endAdornment,
  trackInverted = false,
  maxInputDecimals,
  taperFill = false,
}) => {
  const { value, state: sliderState, setScaled } = useJuceSliderValue(parameterId);
  const [isDragging, setIsDragging] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [inputText, setInputText] = useState('');

  // log スキュー時でも frontend-mirror は線形解釈で scaled 値を送る仕様のため、
  //  log 正規化値ではなく scaled 値 → 線形正規化 の経路で渡す必要がある。
  //  clampValue があれば確定直前に通す（相互制約: SC HPF ≤ SC LPF など）。
  const applyValue = (v: number) => setScaled(clampValue ? clampValue(v) : v, min, max);

  const formatted = formatValue ? formatValue(value) : value.toFixed(1);
  const displayInput = isEditing ? inputText : formatted;

  // wheel 1tick の値空間での刻み量。
  //  linear: そのまま値空間で直接加減算（APVTS の interval step より細かくならない）
  //  log:    step / 100 を「log 空間での 0..1 刻み」として扱い、比率で変化させる
  const stepValueLinear = (current: number, fine: boolean, direction: 1 | -1): number => {
    const s = fine ? wheelStepFine : wheelStep;
    return current + s * direction;
  };
  const stepValueLog = (current: number, fine: boolean, direction: 1 | -1): number => {
    const s = fine ? wheelStepFine : wheelStep;
    const normStep = s / 100;
    const cur = valueToNorm(current, min, max, 'log');
    return normToValue(cur + normStep * direction, min, max, 'log');
  };
  const stepValue = (current: number, fine: boolean, direction: 1 | -1): number =>
    skew === 'log' ? stepValueLog(current, fine, direction) : stepValueLinear(current, fine, direction);

  // wheel リスナーは effect 内で 1 回だけ登録し、最新 value/skew/min/max を Effect Event 経由で読む。
  //  これにより value 変化のたびに addEventListener を貼り直す必要がなく、依存配列も空にできる。
  const stepFromCurrent = useEffectEvent((direction: 1 | -1, fine: boolean) => {
    applyValue(stepValue(value, fine, direction));
  });

  const wheelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = wheelRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const direction: 1 | -1 = -e.deltaY > 0 ? 1 : -1;
      const fine = e.shiftKey || e.ctrlKey || e.metaKey || e.altKey;
      stepFromCurrent(direction, fine);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel as EventListener);
  }, []);

  // 修飾キー + ポインタ操作：
  //  Ctrl/Cmd + クリック      → defaultValue にリセット
  //  (Ctrl/Cmd/Shift) + ドラッグ → 微調整モード
  //    linear: 1px = wheelStepFine 値（dB など）/ log: 1px = 0.002 norm
  //  修飾キーなし              → MUI Slider の通常ドラッグに委譲
  const fineDragStartRef = useRef<{ value: number; norm: number }>({ value: 0, norm: 0 });
  const handlePointerDownCapture = useFineAdjustPointer({
    orientation: 'horizontal',
    onReset: () => {
      if (defaultValue !== undefined) applyValue(defaultValue);
    },
    onDragStart: () => {
      fineDragStartRef.current = {
        value: value,
        norm: valueToNorm(value, min, max, skew),
      };
      sliderState?.sliderDragStarted();
    },
    onDragDelta: (deltaPx) => {
      if (skew === 'log') {
        applyValue(normToValue(fineDragStartRef.current.norm + deltaPx * 0.002, min, max, 'log'));
      } else {
        applyValue(fineDragStartRef.current.value + deltaPx * wheelStepFine);
      }
    },
    onDragEnd: () => sliderState?.sliderDragEnded(),
  });

  // 数値入力欄のホイール / 縦ドラッグ
  const inputElRef = useRef<HTMLInputElement | null>(null);
  const inputDragStartRef = useRef<{ value: number; norm: number }>({ value: 0, norm: 0 });
  useNumberInputAdjust(inputElRef, {
    onWheelStep: (direction, fine) => {
      applyValue(stepValue(value, fine, direction));
    },
    onDragStart: () => {
      inputDragStartRef.current = {
        value: value,
        norm: valueToNorm(value, min, max, skew),
      };
      sliderState?.sliderDragStarted();
    },
    onDragDelta: (deltaY, fine) => {
      if (skew === 'log') {
        const normStep = fine ? 0.002 : 0.01;
        applyValue(normToValue(inputDragStartRef.current.norm + deltaY * normStep, min, max, 'log'));
      } else {
        const step = fine ? wheelStepFine : wheelStep;
        applyValue(inputDragStartRef.current.value + deltaY * step);
      }
    },
    onDragEnd: () => sliderState?.sliderDragEnded(),
  });

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: endAdornment
          ? `${labelWidth}px 1fr ${inputWidth}px auto`
          : `${labelWidth}px 1fr ${inputWidth}px`,
        // 2 行 grid: 1 行目 = slider レール行 (auto = 入力欄の高さに自動合わせ),
        //  2 行目 = marker ラベル (12px)。
        //  alignItems: center で 1 行目の中央 (= レール) にラベル/入力欄/slider thumb が揃う。
        //  marker は 2 行目に明示配置して slider 列の真下に並べる。
        gridTemplateRows: 'auto 12px',
        alignItems: 'center',
        columnGap: 0.5,
        width: '100%',
      }}
    >
      <Typography
        variant='caption'
        sx={{
          gridRow: 1,
          fontWeight: 500,
          fontSize: '0.72rem',
          color: 'text.primary',
          lineHeight: 1,
        }}
      >
        {label}
      </Typography>

      {/* スライダー本体。1 行目に置く。MUI の marks プロパティは環境依存でレール末端と
          ラベル位置がズレることがあるため、ラベルは下の marker 行で自分で描画する。 */}
      <Box
        ref={wheelRef}
        onPointerDownCapture={handlePointerDownCapture}
        sx={{
          gridRow: 1,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          minWidth: 0,
          px: '6px', // thumb 半径 = 6px。レール端で thumb が親からはみ出ないように。
          py: 0,
        }}
      >
        {/* テーパーレール: 塗り側を太く・未塗り側を細く描く専用レイヤ（MUI rail/track は非表示にする）。
            thumb 半径 6px ぶん内側（left/right:6px）に置いて MUI のレール域と一致させる。 */}
        {taperFill && (
          <Box sx={{ position: 'absolute', left: '6px', right: '6px', top: 0, bottom: 0, pointerEvents: 'none' }}>
            {/* レール（全幅・淡色）。太さ/淡さはデフォルトスライダーと同じ（height 3 / opacity 0.5）。 */}
            <Box
              sx={{
                position: 'absolute', left: 0, right: 0, top: '50%', transform: 'translateY(-50%)',
                height: 3, borderRadius: 1.5, bgcolor: 'primary.main', opacity: 0.5,
              }}
            />
            {/* 塗り（filled 側）。HPF(trackInverted)=サム→右端 / それ以外=左端→サム。太さはデフォルトと同じ height 3。 */}
            <Box
              sx={{
                position: 'absolute', top: '50%', transform: 'translateY(-50%)',
                height: 3, borderRadius: 1.5, bgcolor: 'primary.main',
                ...(trackInverted
                  ? { left: `${valueToNorm(value, min, max, skew) * 100}%`, right: 0 }
                  : { left: 0, width: `${valueToNorm(value, min, max, skew) * 100}%` }),
              }}
            />
          </Box>
        )}
        <Slider
          value={valueToNorm(value, min, max, skew)}
          onChange={(_: Event, v: number | number[]) => {
            applyValue(normToValue(v as number, min, max, skew));
          }}
          onMouseDown={() => {
            if (!isDragging) {
              setIsDragging(true);
              sliderState?.sliderDragStarted();
            }
          }}
          onChangeCommitted={() => {
            if (isDragging) {
              setIsDragging(false);
              sliderState?.sliderDragEnded();
            }
          }}
          min={0}
          max={1}
          step={0.001}
          // taperFill 時はカスタムレールを描くので MUI の track は無効化する。
          track={taperFill ? false : trackInverted ? 'inverted' : 'normal'}
          valueLabelDisplay='off'
          sx={{
            width: '100%',
            padding: 0,
            height: 12,
            // MUI Slider はタッチデバイス（pointer: coarse）で自動的に padding: 20px 0 を
            //  足してくる（指タップ用の hit area 拡大）。これを無効化しないと slider container が
            //  +40px され、結果としてマーカーが下にズレて間延びして見える。
            //  代わりに padding は 0 のままにし、必要ならコンポーネント側で hit area を確保する。
            '@media (pointer: coarse)': {
              padding: 0,
            },
            '& .MuiSlider-thumb': {
              width: 12,
              height: 12,
              transition: 'opacity 80ms',
            },
            // track='inverted' は「track（左→サム）を暗色・rail を不透明」にして右側が塗られて
            //  見える仕組み。右側の塗り＝rail なので、normal の塗りと同じ濃さにするには反転時の
            //  rail を opacity:1（実色）にする。track（左の未塗り側）は MUI 既定の暗色のまま。
            '& .MuiSlider-track': { height: 3, border: 'none', display: taperFill ? 'none' : 'block' },
            '& .MuiSlider-rail': { height: 3, opacity: trackInverted ? 1 : 0.5, display: taperFill ? 'none' : 'block' },
          }}
        />
      </Box>

      {/* マーカー帯（grid 2 行目 / slider 列の真下）。
          slider 列の x 範囲 (px:6 で left/right を 6px 内側へ) と一致するよう、
          内側に left:6/right:6 の絶対配置 Box を被せて、その中にラベルを配置する。 */}
      {marks && marks.length > 0 && (
        <Box
          sx={{
            gridRow: 2,
            gridColumn: 2,
            position: 'relative',
            height: '12px',
            pointerEvents: 'none',
          }}
        >
          <Box
            sx={{
              position: 'absolute',
              left: '6px',
              right: '6px',
              top: 0,
              bottom: 0,
            }}
          >
            {marks.map((m) => {
              const pct = valueToNorm(m.value, min, max, skew) * 100;
              return (
                <Typography
                  key={m.value}
                  component='span'
                  sx={{
                    position: 'absolute',
                    left: `${pct}%`,
                    transform: 'translateX(-50%)',
                    top: 0,
                    fontSize: '0.6rem',
                    color: 'text.secondary',
                    lineHeight: 1,
                    userSelect: 'none',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {m.label}
                </Typography>
              );
            })}
          </Box>
        </Box>
      )}

      <Box sx={{ gridRow: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}>
        <Input
          className='block-host-shortcuts'
          inputRef={inputElRef}
          value={displayInput}
          onChange={(e) => setInputText(e.target.value)}
          onFocus={() => {
            setIsEditing(true);
            setInputText(formatted);
          }}
          onBlur={() => {
            setIsEditing(false);
            const parsed = parseFloat(inputText);
            if (!isNaN(parsed)) {
              const v =
                maxInputDecimals != null
                  ? Math.round(parsed * 10 ** maxInputDecimals) / 10 ** maxInputDecimals
                  : parsed;
              applyValue(v);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          disableUnderline
          sx={{
            '& input': {
              padding: '2px 3px',
              fontSize: '10px',
              textAlign: 'right',
              width: 26,
              backgroundColor: '#252525',
              border: '1px solid #404040',
              borderRadius: 2,
              fontFamily: '"Red Hat Mono", monospace',
            },
          }}
        />
        {unit && (
          <Typography
            variant='caption'
            sx={{ fontSize: '10px', color: 'text.secondary', width: 14, textAlign: 'left', lineHeight: 1 }}
          >
            {unit}
          </Typography>
        )}
      </Box>

      {endAdornment && (
        <Box sx={{ gridRow: 1, gridColumn: 4, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', pl: 0.5 }}>
          {endAdornment}
        </Box>
      )}
    </Box>
  );
};
