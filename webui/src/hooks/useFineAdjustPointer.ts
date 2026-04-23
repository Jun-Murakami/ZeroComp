import React, { useCallback, useRef } from 'react';

export interface FineAdjustPointerOptions {
  /** Ctrl/Cmd + クリック（移動なし）でリセット。Shift のみのクリックでは呼ばれない */
  onReset: () => void;
  /** 修飾キー + ドラッグ開始（閾値超え）で 1 回だけ呼ばれる */
  onDragStart: () => void;
  /** 修飾キー + ドラッグ中、ドラッグ開始位置からの累積 px を渡す。
   *  vertical なら上方向が正、horizontal なら右方向が正。 */
  onDragDelta: (deltaPx: number) => void;
  /** 修飾キー + ドラッグ終了（pointerup / pointercancel）で呼ばれる */
  onDragEnd: () => void;
  orientation?: 'vertical' | 'horizontal';
  /** click と drag を区別する閾値(px)。既定 3 */
  moveThreshold?: number;
}

//
// 修飾キー（Ctrl / Cmd / Shift）+ ポインタ操作で微調整モードへ入るためのヘルパー。
//  - クリック（移動なし）:
//      Ctrl/Cmd → onReset（既定値へ戻す）
//      Shift のみ → no-op（誤クリックを誤爆させない）
//  - ドラッグ（閾値超え）:
//      どの修飾キーでも → onDragStart → onDragDelta(累積px) → onDragEnd
//  - 修飾キーなしのドラッグは MUI Slider に委譲するため、ここでは何もしない。
//
// 実装メモ:
//  - capture 相で先取り + stopImmediatePropagation で MUI の pointerdown を完全に封じる。
//  - pointermove / up は document レベルで拾う（スライダー外へ出てもドラッグ継続させる）。
//  - 累積 px は caller 側で wheelStepFine 相当の係数を掛けて値空間へ変換する。
//
export function useFineAdjustPointer(options: FineAdjustPointerOptions) {
  const optsRef = useRef<FineAdjustPointerOptions>(options);
  optsRef.current = options;

  return useCallback((e: React.PointerEvent) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;
    if (!ctrl && !shift) return;

    e.preventDefault();
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation();

    const startX = e.clientX;
    const startY = e.clientY;
    const pointerId = e.pointerId;
    let moved = false;
    const threshold = optsRef.current.moveThreshold ?? 3;
    const orientation = optsRef.current.orientation ?? 'vertical';

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && Math.hypot(dx, dy) >= threshold) {
        moved = true;
        optsRef.current.onDragStart();
      }
      if (moved) {
        const delta = orientation === 'vertical' ? -dy : dx;
        optsRef.current.onDragDelta(delta);
      }
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      cleanup();
      if (moved) {
        optsRef.current.onDragEnd();
      } else if (ctrl) {
        // Ctrl/Cmd クリック（移動なし）のみリセット。Shift のみは no-op。
        optsRef.current.onReset();
      }
    };

    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      cleanup();
      if (moved) optsRef.current.onDragEnd();
    };

    const cleanup = () => {
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onCancel, true);
    };

    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onCancel, true);
  }, []);
}
