import React, { useEffect, useRef, useState } from 'react';
import { Box, Input, Slider, Typography,useMediaQuery, useTheme } from '@mui/material';
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
}) => {
  const { value, state: sliderState, setScaled } = useJuceSliderValue(parameterId);
  const [isDragging, setIsDragging] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [inputText, setInputText] = useState('');
  const valueRef = useRef(value);
  valueRef.current = value;

  // log スキュー時でも frontend-mirror は線形解釈で scaled 値を送る仕様のため、
  //  log 正規化値ではなく scaled 値 → 線形正規化 の経路で渡す必要がある。
  const applyValue = (v: number) => setScaled(v, min, max);

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

  const wheelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = wheelRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const direction: 1 | -1 = -e.deltaY > 0 ? 1 : -1;
      const fine = e.shiftKey || e.ctrlKey || e.metaKey || e.altKey;
      applyValue(stepValue(valueRef.current, fine, direction));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [min, max, skew, wheelStep, wheelStepFine]);

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
        value: valueRef.current,
        norm: valueToNorm(valueRef.current, min, max, skew),
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
      applyValue(stepValue(valueRef.current, fine, direction));
    },
    onDragStart: () => {
      inputDragStartRef.current = {
        value: valueRef.current,
        norm: valueToNorm(valueRef.current, min, max, skew),
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
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: `${labelWidth}px 1fr ${inputWidth}px`,
        alignItems: 'center',
        columnGap: 0.5,
        width: '100%',
        py: isMobile ? 0 : 0.5,
        mt: isMobile ? -1 : 0,
      }}
    >
      <Typography
        variant='caption'
        sx={{
          fontWeight: 500,
          fontSize: '0.72rem',
          color: 'text.primary',
          lineHeight: 1,
        }}
      >
        {label}
      </Typography>

      {/* スライダー + 自前マーカー。MUI の marks プロパティは環境依存でレール末端と
          ラベル位置がズレることがあるため、ラベルはオーバーレイで自分で描画する。 */}
      <Box
        ref={wheelRef}
        onPointerDownCapture={handlePointerDownCapture}
        sx={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          minWidth: 0,
          px: '6px', // thumb 半径 = 6px。レール端で thumb が親からはみ出ないように。
          // 縦スペースをさらに節約: marker ラベルを thumb 下端と重ねる配置。
          //  pb=2 なので marker(height:10, mt:-8) が thumb 領域に 4px 食い込む。
          //  thumb が marker 位置に来た瞬間だけラベルが一時的に重なるが UX 許容範囲。
          pt: isMobile ? '0px' : '10px',
          pb: isMobile ? '0px' : '14px',
        }}
      >
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
          valueLabelDisplay='off'
          sx={{
            width: '100%',
            padding: 0,
            height: 12,
            '& .MuiSlider-thumb': {
              width: 12,
              height: 12,
              transition: 'opacity 80ms',
            },
            '& .MuiSlider-track': { height: 3, border: 'none' },
            '& .MuiSlider-rail': { height: 3, opacity: 0.5 },
          }}
        />

        {/* マーカー（レールと完全に同じ座標系で描画）。
            親コンテナの px: 6px ぶんが thumb 確保領域なので、その内側の 0..100% が rail の範囲。 */}
        {marks && marks.length > 0 && (
          <Box
            sx={{
              position: 'absolute',
              left: '6px',
              right: '6px',
              // marker の上端を slider box 下端より 8px 上に置く（= rail 中心より 2px 下）。
              //  これで「レール下の数字ラベルがすぐ下に見える」密な見た目になる。
              top: '100%',
              mt: isMobile ? '-8px' : '-12px',
              pointerEvents: 'none',
              height: isMobile ? 8 : 12,
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
                    top: isMobile ? -8 : 4,
                    margin: isMobile ? 0 : undefined,
                    fontSize: isMobile ? '0.55rem' : '0.6rem',
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
        )}
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}>
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
            if (!isNaN(parsed)) applyValue(parsed);
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
    </Box>
  );
};
