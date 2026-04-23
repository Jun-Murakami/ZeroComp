import React, { useEffect, useRef, useState } from 'react';
import { Box, Input, Slider, Typography } from '@mui/material';
import { darken, lighten, styled } from '@mui/material/styles';
import { useJuceSliderValue } from '../hooks/useJuceParam';
import { useFineAdjustPointer } from '../hooks/useFineAdjustPointer';
import { useNumberInputAdjust } from '../hooks/useNumberInputAdjust';

type SkewKind = 'linear' | 'log';

interface ParameterFaderProps {
  parameterId: string;
  min: number;
  max: number;
  /** レンジスキュー。'log' の場合は min..max の等比マッピング（1..100 など） */
  skew?: SkewKind;
  label: string;
  /** 目盛りに配置する実値（下→上） */
  scaleMarks?: Array<{ value: number; label: string }>;
  defaultValue?: number;
  wheelStep?: number;
  wheelStepFine?: number;
  color?: 'primary' | 'secondary';
  active?: boolean;
  sliderHeight?: number;
  /** 表示フォーマッタ（入力欄の桁合わせ用） */
  formatValue?: (v: number) => string;
  /** 数値入力欄のサフィックス（':1' など、UI 表示のみ） */
  suffix?: string;
  /** true で上下反転（最小値を上、最大値を下に配置）。Ratio フェーダー用。 */
  inverted?: boolean;
  /** true で半透明化 + 操作不可（Auto Makeup ON 時の Output Gain など）。 */
  disabled?: boolean;
}

const StyledSlider = styled(Slider)(({ theme }) => {
  const primaryMain = theme.palette.primary.main;
  const primaryLight = theme.palette.primary.light || lighten(primaryMain, 0.2);
  const primaryDark = theme.palette.primary.dark || darken(primaryMain, 0.2);
  const trackGradient = `linear-gradient(180deg, ${lighten(primaryLight, 0.15)} 0%, ${primaryMain} 50%, ${darken(
    primaryDark,
    0.15,
  )} 100%)`;
  const thumbTop = lighten(primaryMain, 0.9);
  const thumbMid1 = lighten(primaryMain, 0.6);
  const thumbMid2 = lighten(primaryMain, 0.2);
  const thumbBottom = darken(primaryMain, 0.2);
  const thumbGradient = `linear-gradient(180deg, ${thumbTop} 0%, ${thumbMid1} 40%, ${thumbMid2} 60%, ${thumbBottom} 100%)`;

  return {
    '& .MuiSlider-rail': {
      width: 8,
      borderRadius: 2,
      backgroundColor: '#1a1a1a',
      border: '1px solid #404040',
      opacity: 1,
    },
    '& .MuiSlider-track': {
      width: 8,
      borderRadius: 2,
      border: 'none',
      background: trackGradient,
    },
    '& .MuiSlider-thumb': {
      width: 20,
      height: 28,
      borderRadius: 4,
      background: thumbGradient,
      border: '1px solid rgba(0,0,0,0.35)',
      boxShadow: ['0 2px 4px rgba(0,0,0,0.45)', 'inset 0 1px 0 rgba(255,255,255,0.7)', 'inset 0 -2px 3px rgba(0,0,0,0.25)'].join(
        ', ',
      ),
      overflow: 'hidden',
      boxSizing: 'border-box',
      '&::before': {
        content: '""',
        position: 'absolute',
        left: 2,
        right: 2,
        top: 4,
        height: 9,
        borderRadius: 3,
        background: 'linear-gradient(180deg, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.35) 60%, rgba(255,255,255,0) 100%)',
        pointerEvents: 'none',
      },
      '&::after': {
        content: '""',
        position: 'absolute',
        left: '20%',
        right: '20%',
        top: '34%',
        bottom: '30%',
        borderRadius: 2,
        background:
          'repeating-linear-gradient(180deg, rgba(0,0,0,0.35) 0 1px, rgba(255,255,255,0.38) 1px 2px, rgba(0,0,0,0) 2px 6px)',
        boxShadow: '0 0 0 1px rgba(0,0,0,0.08) inset',
        pointerEvents: 'none',
      },
    },
  };
});

const StyledInput = styled(Input)(() => ({
  '& input': {
    padding: '2px 3px',
    fontSize: '10px',
    textAlign: 'center',
    width: '38px',
    backgroundColor: '#252525',
    color: 'text.primary',
    border: '1px solid #404040',
    borderRadius: 2,
    '&:focus': {
      borderColor: '#4fc3f7',
      backgroundColor: '#252525',
      outline: 'none',
    },
  },
  '&::before, &::after': {
    display: 'none',
  },
}));

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

export const ParameterFader: React.FC<ParameterFaderProps> = ({
  parameterId,
  min,
  max,
  skew = 'linear',
  label,
  scaleMarks,
  defaultValue,
  wheelStep = 1,
  wheelStepFine = 0.1,
  color = 'primary',
  active = true,
  sliderHeight,
  formatValue,
  suffix,
  inverted = false,
  disabled = false,
}) => {
  const SLIDER_HEIGHT = sliderHeight ?? 160;

  const { value, state: sliderState, setScaled } = useJuceSliderValue(parameterId);

  const [isEditing, setIsEditing] = useState(false);
  const [inputText, setInputText] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);

  const valueRef = useRef<number>(value);
  valueRef.current = value;

  // log スキュー時でも frontend-mirror は線形解釈で scaled 値を送る仕様。
  //  そのため setNormalised(log正規化値) では JUCE 側の値がズレる。
  //  setScaled(true_value, min, max) は線形正規化して送るので、log/linear どちらでも正しく往復する。
  const applyValue = (v: number) => {
    setScaled(v, min, max);
  };

  const formatted = formatValue ? formatValue(value) : value.toFixed(1);
  const displayInput = isEditing ? inputText : formatted;

  // MUI Slider は 0..100 を下→上で描画する。inverted 時はこの軸を反転させる。
  //  ユーザが見る "上" は常に「上にある値」として解釈されるように、
  //   inverted=true のときは 上 = min, 下 = max にする。
  const sliderPosFromValue = (v: number): number => {
    const t = valueToNorm(v, min, max, skew);
    return (inverted ? 1 - t : t) * 100;
  };
  const valueFromSliderPos = (pos: number): number => {
    const t = pos / 100;
    return normToValue(inverted ? 1 - t : t, min, max, skew);
  };

  const handleChange = (_: Event, v: number | number[]) => {
    const n = v as number;
    applyValue(valueFromSliderPos(n));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => setInputText(e.target.value);
  const handleInputFocus = () => {
    setIsEditing(true);
    setInputText(formatted);
  };
  const commitInput = () => {
    setIsEditing(false);
    const parsed = parseFloat(inputText);
    if (!isNaN(parsed)) applyValue(parsed);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
  };

  // 修飾キー + ポインタ操作：
  //  Ctrl/Cmd + クリック      → defaultValue にリセット
  //  (Ctrl/Cmd/Shift) + ドラッグ → 微調整モード（log/linear 両対応）
  //  修飾キーなし              → MUI Slider の通常ドラッグに委譲
  //
  // MUI Slider の onMouseDown は内部で pointerdown を直接扱うため、capture 相 +
  // stopImmediatePropagation で先取りしないと MUI に食われる。
  const fineDragStartRef = useRef<{ value: number; norm: number }>({ value: 0, norm: 0 });
  const handlePointerDownCapture = useFineAdjustPointer({
    orientation: 'vertical',
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
      // vertical なので deltaPx は「上方向が正」。inverted 時は最大値を上に置くため反転させる。
      const signed = inverted ? -deltaPx : deltaPx;
      if (skew === 'log') {
        // log 軸は正規化空間で動かす（1px = 0.003 norm）。全域 0..1 を 330px で横断。
        const nextNorm = fineDragStartRef.current.norm + signed * 0.003;
        applyValue(normToValue(nextNorm, min, max, skew));
      } else {
        // linear は値空間で直接（1px = wheelStepFine）
        applyValue(fineDragStartRef.current.value + signed * wheelStepFine);
      }
    },
    onDragEnd: () => sliderState?.sliderDragEnded(),
  });

  const wheelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = wheelRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      // ホイールの "上方向" を常に「フェーダー本体が視覚的に上に動く」方向に揃える。
      //  inverted のフェーダーでは上 = 小さい値なので、方向を反転させる。
      const visualUp = -event.deltaY > 0 ? 1 : -1;
      const direction = inverted ? -visualUp : visualUp;
      const fine = event.shiftKey || event.ctrlKey || event.metaKey || event.altKey;
      const step = fine ? wheelStepFine : wheelStep;
      if (skew === 'log') {
        const normStep = step / 100;
        const curNorm = valueToNorm(valueRef.current, min, max, skew);
        applyValue(normToValue(curNorm + normStep * direction, min, max, skew));
      } else {
        applyValue(valueRef.current + step * direction);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [min, max, wheelStep, wheelStepFine, skew, inverted]);

  // 数値入力欄のホイール / 縦ドラッグ
  //   inverted フェーダー（RATIO など：上が min / 下が max）では、フェーダー操作の
  //   視覚方向と値の増減が反転している。入力欄のホイール上 / 上方向ドラッグは
  //   「フェーダーを上方向に動かしたとき」と同じ値の動きに揃える（= inverted 時は値が減る）。
  const inputElRef = useRef<HTMLInputElement | null>(null);
  const inputDragStartRef = useRef<{ value: number; norm: number }>({ value: 0, norm: 0 });
  useNumberInputAdjust(inputElRef, {
    onWheelStep: (direction, fine) => {
      const signedDir = inverted ? -direction : direction;
      const step = fine ? wheelStepFine : wheelStep;
      if (skew === 'log') {
        const normStep = step / 100;
        const curNorm = valueToNorm(valueRef.current, min, max, skew);
        applyValue(normToValue(curNorm + normStep * signedDir, min, max, skew));
      } else {
        applyValue(valueRef.current + step * signedDir);
      }
    },
    onDragStart: () => {
      inputDragStartRef.current = {
        value: valueRef.current,
        norm: valueToNorm(valueRef.current, min, max, skew),
      };
      sliderState?.sliderDragStarted();
    },
    onDragDelta: (deltaY, fine) => {
      const signedDelta = inverted ? -deltaY : deltaY;
      if (skew === 'log') {
        const normStep = fine ? 0.003 : 0.01;
        applyValue(normToValue(inputDragStartRef.current.norm + signedDelta * normStep, min, max, skew));
      } else {
        const step = fine ? wheelStepFine : wheelStep;
        applyValue(inputDragStartRef.current.value + signedDelta * step);
      }
    },
    onDragEnd: () => sliderState?.sliderDragEnded(),
  });

  // Auto Makeup ON 時など、フェーダー本体だけ薄くして操作不可に。ラベルは通常表示のまま残す
  //   （OUTPUT 等の色は状態を示す重要な情報なので、disabled でも維持）。
  const controlDimSx = disabled
    ? { opacity: 0.4, pointerEvents: 'none' as const, transition: 'opacity 120ms' }
    : { transition: 'opacity 120ms' };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: 60,
        position: 'relative',
      }}
    >
      <Box sx={{ height: 36, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', width: '100%' }}>
        <Typography
          variant='caption'
          sx={{
            fontWeight: 600,
            fontSize: '0.68rem',
            color: active ? 'primary.main' : 'text.secondary',
            letterSpacing: '0.3px',
            lineHeight: 1,
          }}
        >
          {label}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', height: SLIDER_HEIGHT, width: '100%', justifyContent: 'center', mb: '14px', ...controlDimSx }}>
        <Box
          sx={{ position: 'relative', display: 'flex', alignItems: 'center' }}
          ref={wheelRef}
          onPointerDownCapture={handlePointerDownCapture}
        >
          <StyledSlider
            value={sliderPosFromValue(value)}
            onChange={handleChange}
            onMouseDown={() => {
              setIsDragging(true);
              sliderState?.sliderDragStarted();
            }}
            onMouseUp={() => {
              if (isDragging) {
                setIsDragging(false);
                sliderState?.sliderDragEnded();
              }
            }}
            onChangeCommitted={() => {
              if (isDragging) {
                setIsDragging(false);
                sliderState?.sliderDragEnded();
              }
            }}
            min={0}
            max={100}
            step={0.1}
            orientation='vertical'
            sx={{ color: active ? color : 'grey.500', height: SLIDER_HEIGHT }}
          />

          {scaleMarks && scaleMarks.length > 0 && (
            <Box
              sx={{
                position: 'absolute',
                top: 0,
                left: 'calc(50% + 16px)',
                height: SLIDER_HEIGHT,
                display: 'flex',
                flexDirection: 'column',
                width: 34,
              }}
            >
              {scaleMarks.map((mark) => (
                <Typography
                  key={mark.value}
                  sx={{
                    position: 'absolute',
                    bottom: `${sliderPosFromValue(mark.value)}%`,
                    transform: 'translateY(50%)',
                    fontSize: '9px',
                    color: 'text.primary',
                    lineHeight: 1,
                    userSelect: 'none',
                    width: '100%',
                    textAlign: 'left',
                  }}
                >
                  {mark.label}
                </Typography>
              ))}
            </Box>
          )}
        </Box>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', mt: '10px', ...controlDimSx }}>
        <StyledInput
          className='block-host-shortcuts'
          inputRef={inputElRef}
          value={displayInput}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onBlur={commitInput}
          onKeyDown={handleInputKeyDown}
          disableUnderline
        />
        {suffix && (
          <Typography variant='caption' sx={{ ml: 0.25, fontSize: '10px', color: 'text.secondary' }}>
            {suffix}
          </Typography>
        )}
      </Box>
    </Box>
  );
};
