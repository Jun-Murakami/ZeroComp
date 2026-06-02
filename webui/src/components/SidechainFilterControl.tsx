// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jun Murakami
import React from 'react';
import { Box, MenuItem, Select } from '@mui/material';
import { HorizontalParameter } from './HorizontalParameter';
import { useJuceComboBoxIndex, useJuceSliderValue } from '../hooks/useJuceParam';

// SC 検出フィルタ 1 本ぶんの UI（スライダー + 数値入力 + slope ドロップダウン）。
//  - HPF は最低域(10Hz)で OFF、LPF は最高域(24kHz)で OFF。端＝バイパス。
//  - お互いの値を超えられない（HPF ≤ LPF）。clampValue で確定直前にクランプする。
//  - slope セレクタは ZeroEQ の HP/LP slope UI を踏襲（6/12/18/24 dB/oct）。

const SLOPE_VALUES_DB = [6, 12, 18, 24] as const;

export const SC_HPF_OFF_HZ = 10;
export const SC_LPF_OFF_HZ = 24000;

const SLOPE_SELECT_HEIGHT = 22;

interface Props {
  kind: 'hpf' | 'lpf';
  freqParamId: string;
  slopeParamId: string;
  /** 相手フィルタの現在カットオフ（相互制約用）。HPF なら LPF の Hz、LPF なら HPF の Hz。 */
  otherHz: number;
}

// 数値入力欄と round-trip できるよう Hz をプレーン表記にする（'k' 表記は parseFloat と相性が悪い）。
//  小数点以下は 1 桁まで（末尾 .0 は省く）。
const formatHzWithOff = (v: number, isOff: boolean): string => {
  if (isOff) return 'OFF';
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? r.toString() : r.toFixed(1);
};

export const SidechainFilterControl: React.FC<Props> = ({ kind, freqParamId, slopeParamId, otherHz }) => {
  const isHpf = kind === 'hpf';
  const { value: freq } = useJuceSliderValue(freqParamId);
  const { index: slopeIdx, setIndex: setSlopeIdx } = useJuceComboBoxIndex(slopeParamId);

  const isOff = isHpf ? freq <= SC_HPF_OFF_HZ : freq >= SC_LPF_OFF_HZ;

  // HPF は相手(LPF)を超えない / LPF は相手(HPF)を下回らない。
  //  相手が OFF（HPF=10 / LPF=24000）のときは端値クランプになり実質無制約。
  const clampValue = isHpf
    ? (v: number) => Math.min(v, otherHz)
    : (v: number) => Math.max(v, otherHz);

  const slopeSelect = (
    <Select
      value={slopeIdx}
      onChange={(e) => setSlopeIdx(Number(e.target.value))}
      size='small'
      variant='outlined'
      disabled={isOff}
      MenuProps={{ slotProps: { paper: { sx: { '& .MuiMenuItem-root': { fontSize: 12, minHeight: 24, py: 0.3 } } } } }}
      sx={{
        width: 26,
        height: SLOPE_SELECT_HEIGHT,
        ml: -0.5,
        fontSize: 11,
        color: 'text.primary',
        opacity: isOff ? 0.4 : 1,
        '& .MuiSelect-select': {
          padding: '0 9px 0 1px !important',
          textAlign: 'center',
          lineHeight: `${SLOPE_SELECT_HEIGHT - 2}px`,
        },
        '& .MuiOutlinedInput-notchedOutline': { borderColor: 'divider' },
        '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'primary.main' },
        '& .MuiSelect-icon': { color: 'text.secondary', right: -3, fontSize: 14 },
      }}
    >
      {SLOPE_VALUES_DB.map((db, i) => (
        <MenuItem key={db} value={i}>{db}</MenuItem>
      ))}
    </Select>
  );

  return (
    <Box sx={{ opacity: isOff ? 0.7 : 1, mb:-2.5 }}>
      <HorizontalParameter
        parameterId={freqParamId}
        label={isHpf ? 'SC HPF' : 'SC LPF'}
        min={10}
        max={24000}
        skew='log'
        defaultValue={isHpf ? SC_HPF_OFF_HZ : SC_LPF_OFF_HZ}
        formatValue={(v) => formatHzWithOff(v, isHpf ? v <= SC_HPF_OFF_HZ : v >= SC_LPF_OFF_HZ)}
        unit={isOff ? undefined : 'Hz'}
        // 下段コンプパラメータ（Knee/Attack/Release）の既定 labelWidth と揃えてスライダー左端を一致させる。
        labelWidth={46}
        inputWidth={46}
        clampValue={clampValue}
        endAdornment={slopeSelect}
        maxInputDecimals={1}
        // HPF はサムの右側（通過帯域＝高域側）を塗る。LPF は通常どおり左を塗る。
        trackInverted={isHpf}
        // 塗り側を太く・未塗り側を細くテーパー表示（HPF=右太/左細、LPF=左太/右細）。
        taperFill
        marks={
          isHpf
            ? [
                { value: 10, label: 'OFF' },
                { value: 100, label: '100' },
                { value: 1000, label: '1k' },
              ]
            : [
                { value: 10, label: '10' },
                { value: 1000, label: '1k' },
                { value: 24000, label: 'OFF' },
              ]
        }
      />
    </Box>
  );
};
