// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jun Murakami
import React from 'react';
import { Box, Tooltip, Typography } from '@mui/material';
import { useJuceComboBoxIndex } from '../hooks/useJuceParam';

// コンプの動作モード（VCA / Opto / FET / Vari-Mu）を横並びタブで切替えるセレクタ。
//  HorizontalParameter と同じ labelWidth を使って縦方向に揃えつつ、
//  このコンポーネントは数値入力を持たないのでトグル列を最右端までぶち抜いて使う。

interface ModeSelectorProps {
  parameterId: string;
  label: string;
  /** ラベル列の幅（HorizontalParameter と合わせる） */
  labelWidth?: number;
  options?: string[];
  /** Tooltip に出す補足説明（option と同じ長さの配列） */
  descriptions?: string[];
}

const DEFAULT_OPTIONS = ['VCA', 'Opto', 'FET', 'Vari-Mu'];

export const ModeSelector: React.FC<ModeSelectorProps> = ({
  parameterId,
  label,
  labelWidth = 46,
  options = DEFAULT_OPTIONS,
  descriptions,
}) => {
  const { index, setIndex } = useJuceComboBoxIndex(parameterId);
  const safeIdx = Math.max(0, Math.min(options.length - 1, index));

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: `${labelWidth}px 1fr`,
        alignItems: 'center',
        columnGap: 0.5,
        width: '100%',
        py: 0,
      }}
    >
      <Typography
        variant='caption'
        sx={{ fontWeight: 500, fontSize: '0.72rem', color: 'text.primary', lineHeight: 1 }}
      >
        {label}
      </Typography>

      <Box
        sx={{
          display: 'flex',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          overflow: 'hidden',
          height: 24,
        }}
      >
        {options.map((opt, i) => {
          const active = i === safeIdx;
          const btn = (
            <Box
              key={opt}
              onClick={() => setIndex(i)}
              sx={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                px: 0.5,
                fontSize: '0.72rem',
                fontWeight: active ? 600 : 400,
                letterSpacing: 0.2,
                whiteSpace: 'nowrap',
                cursor: 'pointer',
                userSelect: 'none',
                backgroundColor: active ? 'primary.main' : 'transparent',
                color: active ? 'background.paper' : 'text.secondary',
                borderRight: i < options.length - 1 ? '1px solid' : 'none',
                borderColor: 'divider',
                transition: 'background-color 80ms',
                '&:hover': { backgroundColor: active ? 'primary.dark' : 'grey.700' },
              }}
            >
              {opt}
            </Box>
          );
          return descriptions && descriptions[i] ? (
            <Tooltip key={opt} title={descriptions[i]} arrow placement='top'>
              {btn}
            </Tooltip>
          ) : (
            btn
          );
        })}
      </Box>
    </Box>
  );
};
