// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jun Murakami
/**
 * Web デモ版のトランスポートバー。
 * プラグイン版では DAW がオーディオを供給するので不要だが、
 * ブラウザ単体で音を出すには再生ボタン + ソース差し替え + シークバーが必要。
 *
 * 静的に import しても、コンポーネント自身は `VITE_RUNTIME === 'web'` のときだけレンダーされる。
 */

import React, { useEffect, useRef, useState } from 'react';
import { Box, CircularProgress, IconButton, Slider, ToggleButton, Typography, Tooltip } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import LoopIcon from '@mui/icons-material/Loop';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';
import { webAudioEngine } from '../bridge/web/WebAudioEngine';
import { webBridge } from '../bridge/web/WebBridgeManager';

const formatTime = (sec: number): string => {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};

export const WebTransportBar: React.FC = () => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loopEnabled, setLoopEnabled] = useState(true);
  const [bypass, setBypass] = useState(false);
  const [sourceName, setSourceName] = useState('sample.mp3');
  const [isDragging, setIsDragging] = useState(false);
  // 再生ボタン押下→（初回のみ AudioContext 生成 + WASM ロード + sample.mp3 デコード）
  //  が完了するまで、再生ボタンをスピナーに差し替えて無効化する。
  //  iOS WebKit はページロード時に AudioContext を作ると suspended のまま固まるため、
  //  初期状態は false（タップ可能）で始め、初回タップで true に切り替わる。
  //  ユーザがファイルを差し替える間も同じスピナー表示を出す。
  const [isLoading, setIsLoading] = useState(false);
  const draggedPosRef = useRef(0);

  useEffect(() => {
    const posKey = webAudioEngine.addEventListener('transportPositionUpdate', (d) => {
      const m = d as { position: number; duration: number; isPlaying: boolean };
      if (!isDragging) setPosition(m.position);
      setDuration(m.duration);
      setIsPlaying(m.isPlaying);
    });
    const trKey = webAudioEngine.addEventListener('transportUpdate', (d) => {
      const m = d as { isPlaying: boolean; loopEnabled: boolean };
      setIsPlaying(m.isPlaying);
      setLoopEnabled(m.loopEnabled);
    });
    const srcKey = webAudioEngine.addEventListener('sourceLoaded', (d) => {
      const m = d as { name: string; duration: number };
      setSourceName(m.name);
      setDuration(m.duration);
      setIsLoading(false);
    });
    return () => {
      webAudioEngine.removeEventListener(posKey);
      webAudioEngine.removeEventListener(trKey);
      webAudioEngine.removeEventListener(srcKey);
    };
  }, [isDragging]);

  const handlePlayPause = async () => {
    if (isLoading) return;
    if (isPlaying) {
      webAudioEngine.pause();
      return;
    }
    // iOS WebKit 対策: ensureStarted() の冒頭（new AudioContext + resume + 無音 start）は
    //  このジェスチャ同期フレーム内で実行される必要がある。**ここで await を挟まず**に
    //  同期呼び出しし、その戻り値 Promise を後から await する。
    const firstTap = !webBridge.isStarted();
    if (firstTap) setIsLoading(true);
    const ready = webBridge.ensureStarted();
    try {
      await ready;
    } catch {
      if (firstTap) setIsLoading(false);
      return;
    }
    // sample 404 等で sourceLoaded が来ず spinner が残るケースを明示的に解除。
    if (firstTap) setIsLoading(false);
    await webAudioEngine.play();
  };

  const handleLoopToggle = () => {
    webAudioEngine.setLoop(!loopEnabled);
  };

  const handleBypassToggle = () => {
    const next = !bypass;
    setBypass(next);
    webAudioEngine.setBypass(next);
  };

  const handleSeekChange = (_: Event, value: number | number[]) => {
    const v = value as number;
    draggedPosRef.current = v;
    setPosition(v);
    setIsDragging(true);
  };
  const handleSeekCommit = () => {
    webAudioEngine.seek(draggedPosRef.current);
    setIsDragging(false);
  };

  const handleFilePick = async () => {
    // iOS WebKit 対策: Play より先に Upload をタップされた場合でも、
    //  このジェスチャ同期フレーム内で audio unlock を成立させておく。
    const readyPromise = webBridge.ensureStarted();

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*,.wav,.mp3,.flac,.m4a,.aac,.ogg';
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.remove();
      if (file) {
        // 差し替え中は再生ボタンをスピナーに戻す（sourceLoaded で解除）
        setIsLoading(true);
        // 初回タップなら sample.mp3 プリロードまで待ってから差し替える
        //  （audioContext.decodeAudioData には AudioContext が必要）
        try { await readyPromise; } catch { /* fallthrough: try anyway */ }
        await webAudioEngine.loadSampleFromFile(file);
      }
    }, { once: true });
    input.addEventListener('cancel', () => input.remove(), { once: true });
    document.body.appendChild(input);
    input.click();
  };

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1.5,
        py: 0.5,
        mb: 1,
        borderRadius: 2,
        boxShadow: 8,
        backgroundColor: 'background.default',
      }}
    >
      <Tooltip title={isLoading ? 'Loading sample…' : (isPlaying ? 'Pause' : 'Play')}>
        <span>
          <IconButton
            onClick={handlePlayPause}
            disabled={isLoading}
            size='small'
            sx={{
              color: 'primary.main',
              border: '1.5px solid',
              borderColor: isLoading ? 'divider' : 'primary.main',
              width: 32,
              height: 32,
              '&:hover': { backgroundColor: 'rgba(79,195,247,0.1)' },
              '&.Mui-disabled': { color: 'text.disabled', borderColor: 'divider' },
            }}
          >
            {isLoading
              ? <CircularProgress size={16} thickness={5} sx={{ color: 'primary.main' }} />
              : (isPlaying ? <PauseIcon fontSize='small' /> : <PlayArrowIcon fontSize='small' />)}
          </IconButton>
        </span>
      </Tooltip>

      <Tooltip title='Loop'>
        <ToggleButton
          value='loop'
          selected={loopEnabled}
          onChange={handleLoopToggle}
          size='small'
          sx={{ width: 28, height: 28, p: 0, border: '1px solid', borderColor: 'divider' }}
        >
          <LoopIcon fontSize='small' />
        </ToggleButton>
      </Tooltip>

      <Typography variant='caption' sx={{ fontFamily: '"Red Hat Mono", monospace', fontSize: '0.7rem', minWidth: 38, textAlign: 'right' }}>
        {formatTime(position)}
      </Typography>

      <Slider
        value={Math.max(0, Math.min(duration || 1, position))}
        onChange={handleSeekChange}
        onChangeCommitted={handleSeekCommit}
        min={0}
        max={duration || 1}
        step={0.01}
        size='small'
        sx={{ flex: 1, mx: 0.5, color: 'primary.main' }}
      />

      <Typography variant='caption' sx={{ fontFamily: '"Red Hat Mono", monospace', fontSize: '0.7rem', minWidth: 38 }}>
        {formatTime(duration)}
      </Typography>

      <Tooltip title='Bypass (A/B)'>
        <ToggleButton
          value='bypass'
          selected={bypass}
          onChange={handleBypassToggle}
          size='small'
          sx={{
            width: 28,
            height: 28,
            p: 0,
            border: '1px solid',
            borderColor: bypass ? 'warning.main' : 'divider',
            color: bypass ? 'warning.main' : 'text.secondary',
            '&.Mui-selected': { backgroundColor: 'rgba(255, 167, 38, 0.15)' },
          }}
        >
          <PowerSettingsNewIcon fontSize='small' />
        </ToggleButton>
      </Tooltip>

      <Tooltip title={`Load audio file (current: ${sourceName})`}>
        <IconButton onClick={handleFilePick} size='small' sx={{ color: 'text.secondary' }}>
          <UploadFileIcon fontSize='small' />
        </IconButton>
      </Tooltip>
    </Box>
  );
};

export default WebTransportBar;
