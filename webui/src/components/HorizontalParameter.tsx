import React, { useEffect, useRef, useState } from 'react';
import { Box, Input, Slider, Typography,useMediaQuery, useTheme } from '@mui/material';
import { useJuceSliderValue } from '../hooks/useJuceParam';

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

  const wheelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = wheelRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const direction = -e.deltaY > 0 ? 1 : -1;
      const normStep = e.shiftKey ? 0.002 : 0.01;
      const cur = valueToNorm(valueRef.current, min, max, skew);
      applyValue(normToValue(cur + normStep * direction, min, max, skew));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [min, max, skew]);

  // Ctrl/Cmd + クリックのデフォルト値リセットは、キャプチャフェーズで最優先に処理する。
  //  MUI Slider の onMouseDown にバブルさせてしまうと、その直後のわずかなポインタ移動で
  //  onChange が発火してリセット値が上書きされる（= 効いたり効かなかったりの原因）。
  //  capture + stopImmediatePropagation で MUI に届く前に完全に握り潰す。
  const handleResetCapture = (e: React.MouseEvent | React.PointerEvent) => {
    if ((e.ctrlKey || e.metaKey) && defaultValue !== undefined) {
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      applyValue(defaultValue);
    }
  };
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
        onMouseDownCapture={handleResetCapture}
        onPointerDownCapture={handleResetCapture}
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
