import React, { useEffect, useRef, useState } from 'react';
import { Box, Button, Paper, Tooltip, Typography, useMediaQuery } from '@mui/material';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { juceBridge } from './bridge/juce';
import { useJuceComboBoxIndex, useJuceSliderValue, useJuceToggleValue } from './hooks/useJuceParam';
import { darkTheme } from './theme';
import { ParameterFader } from './components/ParameterFader';
import { HorizontalParameter } from './components/HorizontalParameter';
import { ModeSelector } from './components/ModeSelector';
import { RatioGraph } from './components/RatioGraph';
import { WaveformView } from './components/WaveformView';
import {
  GainReductionMeterBar,
  LevelMeterBar,
  LoudnessMeterBar,
  formatDb,
  formatLkfs,
} from './components/VUMeter';
import { useHostShortcutForwarding } from './hooks/useHostShortcutForwarding';
import { useGlobalZoomGuard } from './hooks/useGlobalZoomGuard';
import { GlobalDialog } from './components/GlobalDialog';
import LicenseDialog from './components/LicenseDialog';
import { WebTransportBar } from './components/WebTransportBar';
import { WebDemoMenu, MENU_WIDE_QUERY, MENU_DRAWER_WIDTH } from './components/WebDemoMenu';

const IS_WEB_MODE = import.meta.env.VITE_RUNTIME === 'web';
import type { MeterUpdateData } from './types';
import './App.css';

const MIN_DB = -60;
const MIN_LKFS = -60;

type MeterMode = 'peak' | 'rms' | 'momentary';
const MODES: MeterMode[] = ['peak', 'rms', 'momentary'];
const MODE_LABEL: Record<MeterMode, string> = {
  peak: 'Peak',
  rms: 'RMS',
  momentary: 'Momentary',
};

function App() {
  useHostShortcutForwarding();
  useGlobalZoomGuard();

  // 狭幅レイアウト（~480px 以下）の切替。
  //  プラグイン最小幅 485px なのでプラグインは絶対に発火しないが、念のため IS_WEB_MODE 縛りで
  //  Web デモ専用に閉じ込めて、デスクトップ実装の保護を二重化している。
  //  mobile レイアウトでは 3 フェーダー横並び + 下段 1 カラムに畳む。
  const isMobile = useMediaQuery('(max-width:480px)') && IS_WEB_MODE;
  // 1200px 以上のときは右に常時表示ドロワーを置くので外枠の右パディングを拡大する
  const wideDrawerDocked = useMediaQuery(MENU_WIDE_QUERY) && IS_WEB_MODE;

  const [inL, setInL] = useState(MIN_DB);
  const [inR, setInR] = useState(MIN_DB);
  const [outL, setOutL] = useState(MIN_DB);
  const [outR, setOutR] = useState(MIN_DB);
  const [grDb, setGrDb] = useState(0);
  const [inLkfs, setInLkfs] = useState(MIN_LKFS);
  const [outLkfs, setOutLkfs] = useState(MIN_LKFS);

  const [inHold, setInHold] = useState({ left: MIN_DB, right: MIN_DB });
  const [outHold, setOutHold] = useState({ left: MIN_DB, right: MIN_DB });
  const [grHold, setGrHold] = useState(0);
  const [inLkfsHold, setInLkfsHold] = useState(MIN_LKFS);
  const [outLkfsHold, setOutLkfsHold] = useState(MIN_LKFS);

  const clampDb = (db: number) => Math.max(MIN_DB, Math.min(0, db));
  const clampLkfs = (v: number) => Math.max(MIN_LKFS, Math.min(0, v));

  const resetInHold = () => {
    setInHold({ left: MIN_DB, right: MIN_DB });
    setInLkfsHold(MIN_LKFS);
  };
  const resetOutHold = () => {
    setOutHold({ left: MIN_DB, right: MIN_DB });
    setOutLkfsHold(MIN_LKFS);
  };
  const resetGrHold = () => setGrHold(0);

  const { index: meterModeIndex, setIndex: setMeterModeIndexJuce } = useJuceComboBoxIndex('METERING_MODE');
  const meterMode: MeterMode = MODES[meterModeIndex] ?? 'peak';

  // DISPLAY_MODE（0=Metering / 1=Waveform）。中央のビジュアル切替。
  const { index: displayModeIndex, setIndex: setDisplayModeIndexJuce } = useJuceComboBoxIndex('DISPLAY_MODE');
  const isWaveformMode = displayModeIndex === 1;
  // Waveform モードに入る時は METERING_MODE を Peak(=0) にロック（右端の細い OUT バー用）。
  //  Trigger は toggleDisplayMode ハンドラ（useEffect で値変化を監視しない方針）。
  const toggleDisplayMode = () => {
    const next = isWaveformMode ? 0 : 1;
    setDisplayModeIndexJuce(next);
    if (next === 1 && meterModeIndex !== 0) {
      resetMetersForMode(0);
      setMeterModeIndexJuce(0);
    }
  };

  const resetMetersForMode = (nextIndex: number) => {
    if (nextIndex === 2) {
      setInLkfs(MIN_LKFS);
      setOutLkfs(MIN_LKFS);
      setInLkfsHold(MIN_LKFS);
      setOutLkfsHold(MIN_LKFS);
    } else {
      setInL(MIN_DB); setInR(MIN_DB);
      setOutL(MIN_DB); setOutR(MIN_DB);
      setInHold({ left: MIN_DB, right: MIN_DB });
      setOutHold({ left: MIN_DB, right: MIN_DB });
    }
  };

  const cycleMeterMode = () => {
    const next = (meterModeIndex + 1) % MODES.length;
    resetMetersForMode(next);
    setMeterModeIndexJuce(next);
  };

  const { value: thresholdDbVal } = useJuceSliderValue('THRESHOLD');
  const { value: ratioVal } = useJuceSliderValue('RATIO');
  const { value: kneeDbVal } = useJuceSliderValue('KNEE_DB');
  const { value: autoMakeupOn, setValue: setAutoMakeup } = useJuceToggleValue('AUTO_MAKEUP', false);

  // Auto Makeup 時の自動補償量（ハーフ補償、DSP 側と同じ式）。
  //   makeup_dB = -threshold * (1 - 1/ratio) * 0.5
  //  グラフのカーブはこの値だけ上にシフトする。Output Gain はグラフに反映しない
  //  （Output は単なる post-comp trim で、コンプの静的カーブ自体を変えるものではないため）。
  const autoMakeupDb = autoMakeupOn
    ? Math.max(0, -thresholdDbVal * (1 - 1 / Math.max(1, ratioVal)) * 0.5)
    : 0;
  const makeupDbDisplay = autoMakeupDb;

  const [graphInDb, setGraphInDb] = useState(MIN_DB);

  const lastMeterModeRef = useRef<number>(meterModeIndex);
  useEffect(() => {
    const id = juceBridge.addEventListener('meterUpdate', (d: unknown) => {
      const m = d as MeterUpdateData;
      const mode = typeof m.meteringMode === 'number' ? m.meteringMode : lastMeterModeRef.current;

      if (mode !== lastMeterModeRef.current) {
        lastMeterModeRef.current = mode;
        if (mode === 2) {
          setInLkfs(MIN_LKFS); setOutLkfs(MIN_LKFS);
          setInLkfsHold(MIN_LKFS); setOutLkfsHold(MIN_LKFS);
        } else {
          setInL(MIN_DB); setInR(MIN_DB); setOutL(MIN_DB); setOutR(MIN_DB);
          setInHold({ left: MIN_DB, right: MIN_DB });
          setOutHold({ left: MIN_DB, right: MIN_DB });
        }
      }

      if (mode === 2) {
        const iL = m.input?.momentary ?? MIN_LKFS;
        const oL = m.output?.momentary ?? MIN_LKFS;
        setInLkfs(iL);
        setOutLkfs(oL);
        setInLkfsHold((p) => (iL > p ? clampLkfs(iL) : p));
        setOutLkfsHold((p) => (oL > p ? clampLkfs(oL) : p));
        setGraphInDb(iL);
      } else {
        const isRms = mode === 1;
        const iL = (isRms ? m.input?.rmsLeft  : m.input?.truePeakLeft)  ?? MIN_DB;
        const iR = (isRms ? m.input?.rmsRight : m.input?.truePeakRight) ?? MIN_DB;
        const oL = (isRms ? m.output?.rmsLeft  : m.output?.truePeakLeft)  ?? MIN_DB;
        const oR = (isRms ? m.output?.rmsRight : m.output?.truePeakRight) ?? MIN_DB;
        setInL(iL); setInR(iR); setOutL(oL); setOutR(oR);
        setInHold((p) => {
          const left = Math.max(p.left, clampDb(iL));
          const right = Math.max(p.right, clampDb(iR));
          return left === p.left && right === p.right ? p : { left, right };
        });
        setOutHold((p) => {
          const left = Math.max(p.left, clampDb(oL));
          const right = Math.max(p.right, clampDb(oR));
          return left === p.left && right === p.right ? p : { left, right };
        });
        setGraphInDb(Math.max(iL, iR));
      }

      const gr = m.grDb ?? 0;
      setGrDb(gr);
      setGrHold((p) => (gr > p ? gr : p));
    });
    return () => juceBridge.removeEventListener(id);
  }, []);

  // ネイティブへの "ready" 通知（マウント時 1 回）。contextmenu listener とは別エフェクトに分離。
  useEffect(() => {
    juceBridge.whenReady(() => {
      juceBridge.callNative('system_action', 'ready');
    });
  }, []);

  // 右クリック抑制。入力系要素・明示 opt-in クラス・DEV モードは除外。
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest('input, textarea, select, [contenteditable="true"], .allow-contextmenu')) return;
      if (import.meta.env.DEV) return;
      e.preventDefault();
    };
    window.addEventListener('contextmenu', onContextMenu, { capture: true });
    return () => {
      window.removeEventListener('contextmenu', onContextMenu, { capture: true });
    };
  }, []);

  const [licenseOpen, setLicenseOpen] = useState(false);
  const openLicenseDialog = () => setLicenseOpen(true);
  const closeLicenseDialog = () => setLicenseOpen(false);

  const mainRef = useRef<HTMLDivElement | null>(null);
  const [mainSize, setMainSize] = useState<{ width: number; height: number }>({ width: 620, height: 280 });
  // ウィンドウリサイズ中は WaveformView の描画を停止して負荷軽減（連続発火の debounce 検出）。
  const [isResizing, setIsResizing] = useState(false);
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        const h = entry.contentRect.height;
        setMainSize((prev) => (prev.width !== w || prev.height !== h ? { width: w, height: h } : prev));
      }
      // 連続発火中は true、最後の発火から 150ms 静寂になったら false
      setIsResizing(true);
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => setIsResizing(false), 150);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, []);

  // 中央エリア（グラフ + メーター群）の 1 ハーフぶんのサイズ。
  //  左半分にグラフ、右半分にメーター群を 50/50 で配置し、各半分のサイズを観測する。
  const leftHalfRef = useRef<HTMLDivElement | null>(null);
  const rightHalfRef = useRef<HTMLDivElement | null>(null);
  const [leftHalfSize, setLeftHalfSize] = useState({ width: 200, height: 200 });
  const [rightHalfSize, setRightHalfSize] = useState({ width: 200, height: 200 });
  useEffect(() => {
    const leftEl = leftHalfRef.current;
    const rightEl = rightHalfRef.current;
    if (!leftEl || !rightEl) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        const h = entry.contentRect.height;
        const setter = entry.target === leftEl ? setLeftHalfSize : setRightHalfSize;
        setter((prev) => (prev.width !== w || prev.height !== h ? { width: w, height: h } : prev));
      }
    });
    ro.observe(leftEl);
    ro.observe(rightEl);
    return () => ro.disconnect();
  }, []);

  // フェーダー/メーターの縦長部分の高さ。ヘッダ36 + hold行18 + ボタン26 + 余白 = 約88 差引
  //  モバイルでは折り返しレイアウトになるので mainSize からの計算は当てにならない → 固定値。
  //  ユーザ要望で、モバイル時はデスクトップ比 2/3 ぶん（140 × 2/3 ≈ 94）に縮めて小画面に収まるように。
  //  挙動確認のため最小高さ floor は一旦外している（負値だけ避ける）。
  const faderHeight = isMobile
    ? 94
    : Math.max(0, Math.floor(mainSize.height - 72));

  // グラフ: 左半分の幅いっぱい × faderHeight に広げる（メーターバーと縦を揃えつつ、横は余った領域全てを使う）。
  //  幅と高さが異なると非正方形になるが、内部は dB 空間で描画しているため縦横比が崩れても意味は保たれる。
  //  挙動確認のため最小寸法 floor は一旦外している（負値だけ避ける）。
  const graphW = Math.max(0, Math.floor(leftHalfSize.width));
  const graphH = Math.max(0, faderHeight);

  // メーター群は右半分を幅いっぱいに使う。
  //  内訳: IN(L+R) + GR(広) + OUT(L+R) = 4 本の通常バー + GR バー(=通常の 2 本分)。合計 6 単位。
  //  グループ間に 2 つのギャップ (0.5 ≒ 4px)、グループ内（L/R 間）に 2 つのギャップ (0.25 ≒ 2px)。
  //   → gapsTotal = 8 + 4 = 12px
  //  barW = (halfWidth - 12) / 6、grBarW = 2 * barW（上限キャップなし、余った領域いっぱいに広がる）
  const meterGaps = 12;
  const unitW = Math.max(10, Math.floor((rightHalfSize.width - meterGaps) / 6));
  const barW = Math.max(12, unitW);
  const grBarW = barW * 2;

  const dragState = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);
  const onDragStart: React.PointerEventHandler<HTMLDivElement> = (e) => {
    dragState.current = { startX: e.clientX, startY: e.clientY, startW: window.innerWidth, startH: window.innerHeight };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onDrag: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if (!dragState.current) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    // 最小サイズはネイティブ側 (PluginEditor.h kMinWidth/kMinHeight) と同期させる。
    const w = Math.max(485, dragState.current.startW + dx);
    const h = Math.max(320, dragState.current.startH + dy);
    if (!window.__resizeRAF) {
      window.__resizeRAF = requestAnimationFrame(() => {
        window.__resizeRAF = 0;
        juceBridge.callNative('window_action', 'resizeTo', w, h);
      });
    }
  };
  const onDragEnd: React.PointerEventHandler<HTMLDivElement> = () => {
    dragState.current = null;
  };

  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <style>{`
        #resizeHandle::after {
          content: '';
          position: absolute;
          right: 4px;
          top: 8px;
          width: 2px;
          height: 2px;
          background: rgba(79, 195, 247, 1);
          border-radius: 1px;
          pointer-events: none;
          box-shadow:
            -4px 4px 0 0 rgba(79, 195, 247, 1),
            -8px 8px 0 0 rgba(79, 195, 247, 1),
            -1px 7px 0 0 rgba(79, 195, 247, 1);
        }

        html, body, #root {
          -webkit-user-select: none;
          -ms-user-select: none;
          user-select: none;
        }
        input, textarea, select, [contenteditable="true"], .allow-selection {
          -webkit-user-select: text !important;
          -ms-user-select: text !important;
          user-select: text !important;
          caret-color: auto;
        }
      `}</style>
      <Box
        sx={IS_WEB_MODE
          ? {
              minHeight: '100vh',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              py: 4,
              pl: 2,
              // 1200px 以上で右に常時表示ドロワーを置くため、drawer 幅ぶん右パディング確保
              pr: wideDrawerDocked ? `${MENU_DRAWER_WIDTH}px` : 2,
              gap: 1.5,
            }
          : {
              height: '100vh',
              display: 'flex',
              flexDirection: 'column',
              p: 2,
              pt: 0,
              overflow: 'hidden',
            }
        }
      >
        {/* Web デモモード時のみ、プラグインカードの外に再生用トランスポートバーを表示 */}
        {IS_WEB_MODE && (
          <Box sx={{ width: '100%', maxWidth: 720 }}>
            <Typography
              variant='caption'
              sx={{
                display: 'block',
                px: 1.5,
                color: 'text.secondary',
                fontWeight: 600,
                letterSpacing: 1,
                textTransform: 'uppercase',
                fontSize: '0.65rem',
                mb: 0.25,
              }}
            >
              Input
            </Typography>
            <WebTransportBar />
          </Box>
        )}

        <Box
          sx={IS_WEB_MODE
            ? {
                width: '100%',
                maxWidth: 720,
                // モバイルでは内容に合わせて伸ばす（縦スクロール許容）。
                height: isMobile ? 'auto' : 480,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                p: 2,
                pt: 0,
                borderRadius: 2,
                boxShadow: 8,
                backgroundColor: 'background.default',
              }
            : { display: 'contents' }
          }
        >
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1, py: 0.5 }}>
            <Typography
              variant='body2'
              component='div'
              sx={{ flexGrow: 1, color: 'primary.main', fontWeight: 600, cursor: 'pointer' }}
              onClick={openLicenseDialog}
              title='Licenses'
            >
              ZeroComp
            </Typography>
            <Typography
              variant='caption'
              color='text.secondary'
              onClick={openLicenseDialog}
              sx={{ cursor: 'pointer' }}
              title='Licenses'
            >
              by Jun Murakami
            </Typography>
          </Box>

          <Paper
            elevation={2}
            sx={{
              pt: isMobile ? 0 : 2,
              px: 2,
              pb: 1,
              mb: 1,
              // モバイルではカード高さ auto 化に合わせ flex:1 を外し、内容に追従させる
              flex: isMobile ? 'none' : 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'stretch',
              // モバイルでは divider も廃したのでメイン段と下段の gap を詰める（16 → 6px）
              gap: isMobile ? 0.75 : 2,
            }}
          >
            <Box
              ref={mainRef}
              sx={{
                width: '100%',
                flex: isMobile ? 'none' : 1,
                minHeight: 0,
                display: 'flex',
                // モバイルは折り返して 2 段構成（行1: 3 フェーダー、行2: グラフ+メーター）
                flexWrap: isMobile ? 'wrap' : 'nowrap',
                gap: 1,
                rowGap: isMobile ? 1.5 : 1,
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                position: 'relative',
              }}
            >
              {/* 左: Threshold + Ratio （desktop: order 0 = 左端 / mobile: order 1 = 行 2 左側） */}
              <Box sx={{ display: 'flex', gap: 1, order: isMobile ? 1 : 0 }}>
                <ParameterFader
                  parameterId='THRESHOLD'
                  label='THRESHOLD'
                  sliderHeight={faderHeight}
                  min={-80}
                  max={0}
                  defaultValue={0}
                  wheelStep={1}
                  wheelStepFine={0.1}
                  scaleMarks={[
                    { value: 0, label: '0' },
                    { value: -12, label: '-12' },
                    { value: -24, label: '-24' },
                    { value: -40, label: '-40' },
                    { value: -60, label: '-60' },
                    { value: -80, label: '-80' },
                  ]}
                />
                <ParameterFader
                  parameterId='RATIO'
                  label='RATIO'
                  sliderHeight={faderHeight}
                  min={1}
                  max={100}
                  skew='log'
                  inverted
                  defaultValue={1}
                  wheelStep={2}
                  wheelStepFine={0.5}
                  formatValue={(v) => (v >= 10 ? v.toFixed(0) : v.toFixed(1))}
                  suffix=':1'
                  scaleMarks={[
                    { value: 1, label: '1' },
                    { value: 2, label: '2' },
                    { value: 4, label: '4' },
                    { value: 8, label: '8' },
                    { value: 20, label: '20' },
                    { value: 100, label: '∞' },
                  ]}
                />
              </Box>

              {/* 中央: Metering モード = 左半分 Graph + 右半分 メーター群
                        Waveform モード = Waveform キャンバス(広く) + 薄い GR + 薄い OUT
                  両モードとも flex: 1 で残りスペースを占有。Auto Makeup は両モードで左下に残す。
                  position: relative にして Metering/Waveform トグルを内側中央上部に absolute 配置する。 */}
              <Box sx={{
                display: 'flex',
                flex: isMobile ? '1 1 100%' : 1,
                minWidth: 0,
                gap: 1,
                alignItems: 'flex-start',
                order: isMobile ? 0 : 1,
                position: 'relative',
              }}>
                {/* Metering / Waveform トグル（中央 flex Box の上部中央に浮かべる）。
                    CURVE / WAVEFORM ラベルは 36px ヘッダの下端にあるので、top: 0 / height: 22 の
                    トグルとは Y 方向で衝突しない（ラベルは y≈30、トグルは y=0..22）。
                    mobile は Paper pt: 0 のためトグルの -4px が title 行と被るので mt を反転して
                    中央 Box の内側に押し下げる（graph の CURVE ラベルは中央寄せで干渉しない）。 */}
                <Box
                  sx={{
                    position: 'absolute',
                    top: 0,
                    mt: isMobile ? 0.5 : -0.5,
                    zIndex: 2,
                    display: 'flex',
                    alignItems: 'center',
                    userSelect: 'none',
                  }}
                >
                  <Typography variant='caption' sx={{ fontSize: '0.7rem', lineHeight: 1, mr: 0.5 }}>
                    Display Mode:
                  </Typography>
                  <Tooltip title='Metering (graph + meters) ⇔ Waveform (oscilloscope)' arrow>
                    <Box
                      onClick={toggleDisplayMode}
                      role='button'
                      aria-label='display mode'
                      sx={{
                        display: 'inline-flex',
                        height: 17,
                        borderRadius: 1,
                        border: '1px solid',
                        borderColor: 'divider',
                        overflow: 'hidden',
                        cursor: 'pointer',
                        userSelect: 'none',
                        fontSize: '0.7rem',
                        lineHeight: 1,
                        backgroundColor: 'background.paper',
                      }}
                    >
                      <Box
                        sx={{
                          px: 0.75,
                          display: 'flex',
                          alignItems: 'center',
                          backgroundColor: !isWaveformMode ? 'primary.main' : 'transparent',
                          color: !isWaveformMode ? 'background.paper' : 'text.secondary',
                        }}
                      >
                        Metering
                      </Box>
                      <Box
                        sx={{
                          px: 0.75,
                          display: 'flex',
                          alignItems: 'center',
                          backgroundColor: isWaveformMode ? 'primary.main' : 'transparent',
                          color: isWaveformMode ? 'background.paper' : 'text.secondary',
                        }}
                      >
                        Waveform
                      </Box>
                    </Box>
                  </Tooltip>
                </Box>
                {/* 左半分: グラフ or 波形キャンバス + 直下に Auto Makeup トグル。
                    Waveform モードでは leftHalfRef で観測した幅をそのまま WaveformView の幅に使う。 */}
                <Box
                  ref={leftHalfRef}
                  sx={{
                    flex: 1,
                    minWidth: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                  }}
                >
                  {isWaveformMode ? (
                    <WaveformView
                      width={graphW}
                      height={graphH}
                      isResizing={isResizing}
                    />
                  ) : (
                    <RatioGraph
                      thresholdDb={thresholdDbVal}
                      ratio={ratioVal}
                      kneeDb={kneeDbVal}
                      inputDb={graphInDb}
                      makeupDb={makeupDbDisplay}
                      width={graphW}
                      height={graphH}
                    />
                  )}
                  {/* 右半分のメーター群には hold 行 (mt:0.5 + height:14 = 18px) があるぶん、
                      左半分にも同じスペーサーを挟んで Auto Makeup ボタンを Peak ボタンと同じ Y に揃える。 */}
                  <Box sx={{ mt: 0.5, height: 14, flexShrink: 0 }} />
                  <Tooltip title='Auto Makeup — compensate gain from threshold & ratio' arrow>
                    <Button
                      onClick={() => setAutoMakeup(!autoMakeupOn)}
                      size='small'
                      variant='contained'
                      aria-pressed={autoMakeupOn}
                      sx={{
                        mt: 0.5,
                        textTransform: 'none',
                        minWidth: 115,
                        px: 1,
                        py: 0.1,
                        height: 22,
                        fontSize: '0.72rem',
                        fontWeight: autoMakeupOn ? 600 : 400,
                        border: '1px solid',
                        borderColor: autoMakeupOn ? 'primary.main' : 'divider',
                        backgroundColor: autoMakeupOn ? 'primary.main' : 'transparent',
                        color: autoMakeupOn ? 'background.paper' : 'text.secondary',
                        '&:hover': { backgroundColor: autoMakeupOn ? 'primary.dark' : 'grey.700' },
                      }}
                    >
                      {autoMakeupOn ? `Makeup  +${autoMakeupDb.toFixed(1)} dB` : 'Makeup'}
                    </Button>
                  </Tooltip>
                </Box>

                {/* 右半分: Metering モード = メーター群（IN/GR/OUT）+ Peak ボタン
                           Waveform モード = 薄い GR + 薄い OUT（IN は波形で表現されるので省略）
                                            Peak ボタンは非表示（METERING_MODE は Peak にロック） */}
                <Box
                  ref={rightHalfRef}
                  sx={{
                    flex: isWaveformMode ? '0 0 auto' : 1,
                    minWidth: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                  }}
                >
                  {isWaveformMode ? (
                    // Waveform モード: 薄い GR + 薄い OUT のみ
                    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'flex-start' }}>
                      {/* 薄い GR */}
                      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <GainReductionMeterBar grDb={grDb} width={18} height={faderHeight} compact />
                        <Tooltip title='Reset Hold'>
                          <Box
                            onClick={resetGrHold}
                            sx={{ mt: 0.5, height: 14, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', cursor: 'pointer', userSelect: 'none' }}
                          >
                            <Typography variant='caption' sx={{ fontSize: '9px', width: 18, textAlign: 'center', lineHeight: 1 }}>
                              -{grHold.toFixed(1)}
                            </Typography>
                          </Box>
                        </Tooltip>
                      </Box>
                      {/* 薄い OUT (merged L/R) */}
                      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <LevelMeterBar level={Math.max(outL, outR)} label='OUT' width={18} height={faderHeight} />
                        <Tooltip title='Reset Hold'>
                          <Box
                            onClick={resetOutHold}
                            sx={{ mt: 0.5, height: 14, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', cursor: 'pointer', userSelect: 'none' }}
                          >
                            <Typography variant='caption' sx={{ fontSize: '9px', width: 18, textAlign: 'center', lineHeight: 1 }}>
                              {formatDb(Math.max(outHold.left, outHold.right))}
                            </Typography>
                          </Box>
                        </Tooltip>
                      </Box>
                    </Box>
                  ) : (
                  <>
                  <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'flex-start' }}>
                    {/* IN */}
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      {meterMode === 'momentary' ? (
                        <>
                          <LoudnessMeterBar lkfs={inLkfs} label='IN' width={barW * 2} height={faderHeight} />
                          <Tooltip title='Reset Hold'>
                            <Box
                              onClick={resetInHold}
                              sx={{
                                mt: 0.5,
                                height: 14,
                                display: 'flex',
                                alignItems: 'flex-start',
                                justifyContent: 'center',
                                cursor: 'pointer',
                                userSelect: 'none',
                              }}
                            >
                              <Typography variant='caption' sx={{ fontSize: '10px', lineHeight: 1 }}>
                                {formatLkfs(inLkfsHold)}
                              </Typography>
                            </Box>
                          </Tooltip>
                        </>
                      ) : (
                        <>
                          <Box sx={{ position: 'relative', display: 'flex', gap: 0.25 }}>
                            <LevelMeterBar level={inL} label='L' width={barW} height={faderHeight} />
                            <LevelMeterBar level={inR} label='R' width={barW} height={faderHeight} />
                            <Typography
                              sx={{
                                position: 'absolute',
                                top: '12px',
                                left: '50%',
                                transform: 'translateX(-50%)',
                                fontSize: '9px',
                                color: 'text.secondary',
                                fontWeight: 600,
                                lineHeight: 1,
                                pointerEvents: 'none',
                              }}
                            >
                              IN
                            </Typography>
                          </Box>
                          <Tooltip title='Reset Hold'>
                            <Box
                              onClick={resetInHold}
                              sx={{
                                mt: 0.5,
                                height: 14,
                                display: 'flex',
                                alignItems: 'flex-start',
                                justifyContent: 'center',
                                gap: 0.25,
                                cursor: 'pointer',
                                userSelect: 'none',
                              }}
                            >
                              <Typography variant='caption' sx={{ fontSize: '10px', width: barW, textAlign: 'center', lineHeight: 1 }}>
                                {formatDb(inHold.left)}
                              </Typography>
                              <Typography variant='caption' sx={{ fontSize: '10px', width: barW, textAlign: 'center', lineHeight: 1 }}>
                                {formatDb(inHold.right)}
                              </Typography>
                            </Box>
                          </Tooltip>
                        </>
                      )}
                    </Box>

                    {/* GR */}
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <GainReductionMeterBar grDb={grDb} width={grBarW} height={faderHeight} />
                      <Tooltip title='Reset Hold'>
                        <Box
                          onClick={resetGrHold}
                          sx={{
                            mt: 0.5,
                            height: 14,
                            display: 'flex',
                            alignItems: 'flex-start',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            userSelect: 'none',
                          }}
                        >
                          <Typography variant='caption' sx={{ fontSize: '10px', width: grBarW, textAlign: 'center', lineHeight: 1 }}>
                            -{grHold.toFixed(1)}
                          </Typography>
                        </Box>
                      </Tooltip>
                    </Box>

                    {/* OUT */}
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      {meterMode === 'momentary' ? (
                        <>
                          <LoudnessMeterBar lkfs={outLkfs} label='OUT' width={barW * 2} height={faderHeight} />
                          <Tooltip title='Reset Hold'>
                            <Box
                              onClick={resetOutHold}
                              sx={{
                                mt: 0.5,
                                height: 14,
                                display: 'flex',
                                alignItems: 'flex-start',
                                justifyContent: 'center',
                                cursor: 'pointer',
                                userSelect: 'none',
                              }}
                            >
                              <Typography variant='caption' sx={{ fontSize: '10px', lineHeight: 1 }}>
                                {formatLkfs(outLkfsHold)}
                              </Typography>
                            </Box>
                          </Tooltip>
                        </>
                      ) : (
                        <>
                          <Box sx={{ position: 'relative', display: 'flex', gap: 0.25 }}>
                            <LevelMeterBar level={outL} label='L' width={barW} height={faderHeight} />
                            <LevelMeterBar level={outR} label='R' width={barW} height={faderHeight} />
                            <Typography
                              sx={{
                                position: 'absolute',
                                top: '12px',
                                left: '50%',
                                transform: 'translateX(-50%)',
                                fontSize: '9px',
                                color: 'text.secondary',
                                fontWeight: 600,
                                lineHeight: 1,
                                pointerEvents: 'none',
                              }}
                            >
                              OUT
                            </Typography>
                          </Box>
                          <Tooltip title='Reset Hold'>
                            <Box
                              onClick={resetOutHold}
                              sx={{
                                mt: 0.5,
                                height: 14,
                                display: 'flex',
                                alignItems: 'flex-start',
                                justifyContent: 'center',
                                gap: 0.25,
                                cursor: 'pointer',
                                userSelect: 'none',
                              }}
                            >
                              <Typography variant='caption' sx={{ fontSize: '10px', width: barW, textAlign: 'center', lineHeight: 1 }}>
                                {formatDb(outHold.left)}
                              </Typography>
                              <Typography variant='caption' sx={{ fontSize: '10px', width: barW, textAlign: 'center', lineHeight: 1 }}>
                                {formatDb(outHold.right)}
                              </Typography>
                            </Box>
                          </Tooltip>
                        </>
                      )}
                    </Box>
                  </Box>

                  {/* メーター群の真下中央にモード切替ボタン（Waveform モード時は非表示） */}
                  <Tooltip title='Meter display mode' arrow>
                    <Button
                      onClick={cycleMeterMode}
                      size='small'
                      variant='contained'
                      sx={{
                        mt: 0.5,
                        textTransform: 'none',
                        width: 92,
                        minWidth: 92,
                        px: 1,
                        py: 0.1,
                        height: 22,
                        fontSize: '0.72rem',
                        border: '1px solid',
                        borderColor: 'divider',
                        backgroundColor: 'transparent',
                        color: 'text.secondary',
                        '&:hover': { backgroundColor: 'grey.700' },
                      }}
                    >
                      {MODE_LABEL[meterMode]}
                    </Button>
                  </Tooltip>
                  </>
                  )}
                </Box>
              </Box>

              {/* 右: Output Gain — Auto Makeup ON の場合はその上に ± トリムとして加算される。
                  モバイル時は order: 2 で、行 2 右端（Threshold/Ratio と同じ行）に並ぶ。 */}
              <Box sx={{ order: isMobile ? 2 : 2 }}>
                <ParameterFader
                  parameterId='OUTPUT_GAIN'
                  label='OUTPUT'
                  sliderHeight={faderHeight}
                  min={-24}
                  max={24}
                  defaultValue={0}
                  wheelStep={1}
                  wheelStepFine={0.1}
                  scaleMarks={[
                    { value: 24, label: '+24' },
                    { value: 12, label: '+12' },
                    { value: 6, label: '+6' },
                    { value: 0, label: '0' },
                    { value: -6, label: '-6' },
                    { value: -12, label: '-12' },
                    { value: -24, label: '-24' },
                  ]}
                />
              </Box>
            </Box>

            {/* 下段: デスクトップは 2 カラム、モバイルは 1 カラムに畳む。
                左カラム: Knee（上）/ MODE（下）
                右カラム: Attack（上）/ Release（下）
                モバイルではセクション間の視覚的な区切りが既に十分なので divider を消す。 */}
            <Box
              sx={{
                width: '100%',
                pt: isMobile ? 0 : 1,
                borderTop: isMobile ? 'none' : '1px solid',
                borderColor: 'divider',
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
                columnGap: 3,
                // 行間は 4px で揃える。mobile では Mode→Attack 間 (= 2 つの col Box の間) の
                //  rowGap として効くが、PC は 2 列レイアウトなのでほぼ無視される。
                rowGap: 0.5,
              }}
            >
              {/* 左カラム */}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0 }}>
                <HorizontalParameter
                  parameterId='KNEE_DB'
                  label='Knee'
                  min={0}
                  max={24}
                  skew='linear'
                  defaultValue={6}
                  formatValue={(v) => v.toFixed(1)}
                  unit='dB'
                  wheelStep={1}
                  wheelStepFine={0.1}
                  marks={[
                    { value: 0, label: '0' },
                    { value: 6, label: '6' },
                    { value: 12, label: '12' },
                    { value: 18, label: '18' },
                    { value: 24, label: '24' },
                  ]}
                />
                <ModeSelector
                  parameterId='MODE'
                  label='Mode'
                  descriptions={[
                    'Clean, Transparent',
                    'Slow, Trailing Release',
                    'Asymmetric Gritty',
                    'Soft Knee + Even-order Warmth',
                  ]}
                />
              </Box>

              {/* 右カラム */}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0 }}>
                <HorizontalParameter
                  parameterId='ATTACK_MS'
                  label='Attack'
                  min={0.1}
                  max={500}
                  skew='log'
                  defaultValue={10}
                  formatValue={(v) => (v < 1 ? v.toFixed(2) : v < 10 ? v.toFixed(1) : Math.round(v).toString())}
                  unit='ms'
                  marks={[
                    { value: 0.1, label: '0.1' },
                    { value: 1, label: '1' },
                    { value: 10, label: '10' },
                    { value: 100, label: '100' },
                  ]}
                />
                <HorizontalParameter
                  parameterId='RELEASE_MS'
                  label='Release'
                  min={0.1}
                  max={2000}
                  skew='log'
                  defaultValue={100}
                  formatValue={(v) => (v < 1 ? v.toFixed(2) : v < 10 ? v.toFixed(1) : Math.round(v).toString())}
                  unit='ms'
                  marks={[
                    { value: 0.1, label: '0.1' },
                    { value: 1, label: '1' },
                    { value: 10, label: '10' },
                    { value: 100, label: '100' },
                    { value: 1000, label: '1k' },
                  ]}
                />
              </Box>
            </Box>
          </Paper>

          {!IS_WEB_MODE && <div
            id='resizeHandle'
            onPointerDown={onDragStart}
            onPointerMove={onDrag}
            onPointerUp={onDragEnd}
            style={{
              position: 'fixed',
              right: 0,
              bottom: 0,
              width: 24,
              height: 24,
              cursor: 'nwse-resize',
              zIndex: 2147483647,
              backgroundColor: 'transparent',
            }}
            title='Resize'
          />}
        </Box>

        {IS_WEB_MODE && (
          <>
          <Typography
            variant='caption'
            color='text.secondary'
            sx={{ mt: isMobile ? 0 : 1, textAlign: 'center', maxWidth: 720, lineHeight: 1.8, px: 2 }}
          >
            ZeroComp — zero-latency broadcast-oriented compressor.
          </Typography>
          <Typography
            variant='caption'
            color='text.secondary'
            sx={{ mt: isMobile ? -1 : 0, textAlign: 'center', maxWidth: 720, lineHeight: 1, px: 2 }}
          >
            ゼロレイテンシーのコンプレッサーです。
          </Typography>
          </>
        )}
      </Box>

      <LicenseDialog open={licenseOpen} onClose={closeLicenseDialog} />
      <GlobalDialog />

      {/* Web デモ時のみ右下にハンバーガーメニュー（Drawer 含めて条件付きマウント） */}
      {IS_WEB_MODE && <WebDemoMenu />}
    </ThemeProvider>
  );
}

export default App;
