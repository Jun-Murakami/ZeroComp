// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jun Murakami
import React, { useEffect, useState } from 'react';
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
  const sliderState = getSliderState(identifier);
  // Hooks は無条件に宣言する必要がある（早期 return の前に置く）。
  // sliderState が未解決の初期レンダーでも安全な初期値を使い、実体が来たら useEffect で同期する。
  const [value, setValue] = useState<number>(0);
  const [properties, setProperties] = useState(sliderState?.properties);

  useEffect(() => {
    // sliderState がまだ無い場合は何もしない（Hooks 自体は無条件に呼ばれている）
    if (!sliderState) return;
    // 初回同期（実体が得られたら最新値/プロパティを反映）
    setValue(sliderState.getNormalisedValue());
    setProperties(sliderState.properties);
    // 変更リスナーを登録して UI を更新
    const vId = sliderState.valueChangedEvent.addListener(() => setValue(sliderState.getNormalisedValue()));
    const pId = sliderState.propertiesChangedEvent.addListener(() => setProperties(sliderState.properties));
    return () => {
      sliderState.valueChangedEvent.removeListener(vId);
      sliderState.propertiesChangedEvent.removeListener(pId);
    };
  }, [sliderState]);

  // ここで安全に早期 return（Hooks 以降なのでルールに抵触しない）
  if (!sliderState) return null;

  const handleChange = (_: Event, nv: number | number[]) => {
    const n = nv as number;
    setValue(n);
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
  const toggleState = getToggleState(identifier);
  // Hooks は早期 return より前に無条件で呼び出す
  const [checked, setChecked] = useState<boolean>(false);
  const [properties, setProperties] = useState(toggleState?.properties);

  useEffect(() => {
    if (!toggleState) return;
    // 初回同期
    setChecked(toggleState.getValue());
    setProperties(toggleState.properties);
    // 変更監視
    const vId = toggleState.valueChangedEvent.addListener(() => setChecked(toggleState.getValue()));
    const pId = toggleState.propertiesChangedEvent.addListener(() => setProperties(toggleState.properties));
    return () => {
      toggleState.valueChangedEvent.removeListener(vId);
      toggleState.propertiesChangedEvent.removeListener(pId);
    };
  }, [toggleState]);

  if (!toggleState) return null;

  const onChange = (_: React.ChangeEvent<HTMLInputElement>, val: boolean) => {
    setChecked(val);
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
  const comboState = getComboBoxState(identifier);
  // Hooks は早期 return より前に無条件で呼び出す
  const [index, setIndex] = useState<number>(0);
  const [properties, setProperties] = useState(comboState?.properties);

  useEffect(() => {
    if (!comboState) return;
    // 初回同期
    setIndex(comboState.getChoiceIndex());
    setProperties(comboState.properties);
    // 変更監視
    const vId = comboState.valueChangedEvent.addListener(() => setIndex(comboState.getChoiceIndex()));
    const pId = comboState.propertiesChangedEvent.addListener(() => setProperties(comboState.properties));
    return () => {
      comboState.valueChangedEvent.removeListener(vId);
      comboState.propertiesChangedEvent.removeListener(pId);
    };
  }, [comboState]);

  if (!comboState) return null;

  const onChange = (e: SelectNumberEvent) => {
    // union の両辺とも target.value は number なので安全に取り出す
    const i = (e as { target: { value: number } }).target.value;
    setIndex(i);
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
