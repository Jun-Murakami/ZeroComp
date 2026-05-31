// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jun Murakami
import React, { useCallback, useMemo, useSyncExternalStore } from 'react';
import { type SxProps, Slider, Checkbox, FormControl, InputLabel, MenuItem, Select, Box, Typography } from '@mui/material';
// MUI Select の onChange コールバックが受け取るイベントの number 版（型不一致回避のため union で表現）
type SelectNumberEvent =
  | React.ChangeEvent<Omit<HTMLInputElement, 'value'> & { value: number }>
  | (Event & { target: { value: number; name: string } });
import { getSliderState, getToggleState, getComboBoxState } from 'juce-framework-frontend-mirror';

type SliderProps = {
  identifier: string;
  label?: string;
  orientation?: 'horizontal' | 'vertical';
  sx?: SxProps;
  valueLabelDisplay?: 'auto' | 'on' | 'off';
};

export const JuceBoundSlider: React.FC<SliderProps> = ({ identifier, label, orientation, sx, valueLabelDisplay }) => {
  // パラメータ ID は不変なので state は 1 回だけ取得。未解決時は null。
  const sliderState = useMemo(() => getSliderState(identifier) ?? null, [identifier]);

  // 外部ストア（APVTS mirror）の購読は useSyncExternalStore に寄せる。
  //  旧実装（useEffect 内で初回 setState + addListener）は set-state-in-effect 警告対象で、
  //  tearing / StrictMode 二重実行の懸念もあった。value と properties をそれぞれ購読する。
  const subscribeValue = useCallback((onChange: () => void) => {
    if (!sliderState) return () => {};
    const id = sliderState.valueChangedEvent.addListener(onChange);
    return () => sliderState.valueChangedEvent.removeListener(id);
  }, [sliderState]);
  const value = useSyncExternalStore(subscribeValue, () => (sliderState ? sliderState.getNormalisedValue() : 0));

  const subscribeProps = useCallback((onChange: () => void) => {
    if (!sliderState) return () => {};
    const id = sliderState.propertiesChangedEvent.addListener(onChange);
    return () => sliderState.propertiesChangedEvent.removeListener(id);
  }, [sliderState]);
  // mirror の properties は propertiesChanged 時のみ再代入される安定参照なので getSnapshot にそのまま使える。
  const properties = useSyncExternalStore(subscribeProps, () => sliderState?.properties);

  if (!sliderState) return null;

  const handleChange = (_: Event, nv: number | number[]) => {
    const n = nv as number;
    // 値は useSyncExternalStore が valueChangedEvent 経由で反映するので楽観的更新は不要。
    sliderState.setNormalisedValue(n);
  };

  const handleMouseDown = () => sliderState.sliderDragStarted();
  const handleCommit = (_: unknown, nv: number | number[]) => {
    const n = nv as number;
    sliderState.setNormalisedValue(n);
    sliderState.sliderDragEnded();
  };

  const scaled = sliderState.getScaledValue();

  return (
    <Box>
      {label || properties?.name ? (
        <Typography variant='caption' sx={{ mb: 0.5, display: 'block' }}>
          {label || properties?.name}: {scaled} {properties?.label}
        </Typography>
      ) : null}
      <Slider
        min={0}
        max={1}
        step={1 / Math.max(1, (properties?.numSteps ?? 2) - 1)}
        value={value}
        onChange={handleChange}
        onMouseDown={handleMouseDown}
        onChangeCommitted={handleCommit}
        orientation={orientation}
        sx={sx}
        valueLabelDisplay={valueLabelDisplay}
      />
    </Box>
  );
};

type ToggleProps = {
  identifier: string;
  label?: string;
};

export const JuceBoundToggle: React.FC<ToggleProps> = ({ identifier, label }) => {
  const toggleState = useMemo(() => getToggleState(identifier) ?? null, [identifier]);

  const subscribeValue = useCallback((onChange: () => void) => {
    if (!toggleState) return () => {};
    const id = toggleState.valueChangedEvent.addListener(onChange);
    return () => toggleState.valueChangedEvent.removeListener(id);
  }, [toggleState]);
  const checked = useSyncExternalStore(subscribeValue, () => (toggleState ? toggleState.getValue() : false));

  const subscribeProps = useCallback((onChange: () => void) => {
    if (!toggleState) return () => {};
    const id = toggleState.propertiesChangedEvent.addListener(onChange);
    return () => toggleState.propertiesChangedEvent.removeListener(id);
  }, [toggleState]);
  const properties = useSyncExternalStore(subscribeProps, () => toggleState?.properties);

  if (!toggleState) return null;

  const onChange = (_: React.ChangeEvent<HTMLInputElement>, val: boolean) => {
    toggleState.setValue(val);
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Checkbox checked={checked} onChange={onChange} size='small' />
      <Typography variant='caption'>{label || properties?.name}</Typography>
    </Box>
  );
};

type ComboProps = {
  identifier: string;
  label?: string;
};

export const JuceBoundCombo: React.FC<ComboProps> = ({ identifier, label }) => {
  const comboState = useMemo(() => getComboBoxState(identifier) ?? null, [identifier]);

  const subscribeValue = useCallback((onChange: () => void) => {
    if (!comboState) return () => {};
    const id = comboState.valueChangedEvent.addListener(onChange);
    return () => comboState.valueChangedEvent.removeListener(id);
  }, [comboState]);
  const index = useSyncExternalStore(subscribeValue, () => (comboState ? comboState.getChoiceIndex() : 0));

  const subscribeProps = useCallback((onChange: () => void) => {
    if (!comboState) return () => {};
    const id = comboState.propertiesChangedEvent.addListener(onChange);
    return () => comboState.propertiesChangedEvent.removeListener(id);
  }, [comboState]);
  const properties = useSyncExternalStore(subscribeProps, () => comboState?.properties);

  if (!comboState) return null;

  const onChange = (e: SelectNumberEvent) => {
    // union の両辺とも target.value は number なので安全に取り出す
    const i = (e as { target: { value: number } }).target.value;
    comboState.setChoiceIndex(i);
  };

  const lbl = label || properties?.name || identifier;
  const choices: string[] = properties?.choices || [];

  return (
    <FormControl size='small' fullWidth>
      <InputLabel id={identifier}>{lbl}</InputLabel>
      <Select labelId={identifier} value={index} label={lbl} onChange={onChange}>
        {choices.map((c, i) => (
          <MenuItem value={i} key={i}>
            {c}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
};
