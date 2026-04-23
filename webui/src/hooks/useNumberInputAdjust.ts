import React, { useEffect, useRef } from 'react';

export interface NumberInputAdjustOptions {
  /** wheel: 方向 (+1/-1) と fine フラグ（Ctrl/Cmd/Shift/Alt のいずれか押下） */
  onWheelStep: (direction: 1 | -1, fine: boolean) => void;
  /** ドラッグ開始（閾値超え） */
  onDragStart: () => void;
  /** ドラッグ中、開始位置からの累積 px（上方向が正）と fine フラグ */
  onDragDelta: (deltaY: number, fine: boolean) => void;
  /** ドラッグ終了 */
  onDragEnd: () => void;
  /** クリックのみ（移動なし）: 既定はフォーカスして select。カスタムしたい時に指定 */
  onClickEditFallback?: (el: HTMLElement) => void;
  moveThreshold?: number;
}

//
// 数値入力欄にホイール / 縦ドラッグで値を変える操作を追加するフック。
//
//  - wheel: 方向と fine フラグで値更新（preventDefault してブラウザズームや
//           ページスクロールを抑止）
//  - drag: 閾値超えで start/delta/end を発火。fine は drag 中の修飾キー状態で逐次判定。
//  - クリックのみ: 従来どおり focus して編集モード
//
// 編集中（入力欄にフォーカスがある状態）は一切介入しない。テキストカーソル操作や
// 選択などのネイティブ挙動を優先する。
//
export function useNumberInputAdjust(
  inputRef: React.RefObject<HTMLElement | null>,
  options: NumberInputAdjustOptions,
) {
  const optsRef = useRef<NumberInputAdjustOptions>(options);
  optsRef.current = options;

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;

    const isEditing = () => document.activeElement === el;

    const onWheel = (e: WheelEvent) => {
      if (isEditing()) return;
      e.preventDefault();
      const direction = -e.deltaY > 0 ? 1 : -1;
      const fine = e.shiftKey || e.ctrlKey || e.metaKey || e.altKey;
      optsRef.current.onWheelStep(direction, fine);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (isEditing()) return;
      if (e.button !== 0) return;

      const startX = e.clientX;
      const startY = e.clientY;
      const pointerId = e.pointerId;
      let moved = false;
      const threshold = optsRef.current.moveThreshold ?? 3;

      // 先にネイティブ focus を止める（クリックのみ確定時に onUp 内で明示 focus する）
      e.preventDefault();

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!moved && Math.hypot(dx, dy) >= threshold) {
          moved = true;
          optsRef.current.onDragStart();
        }
        if (moved) {
          const fine = ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.altKey;
          optsRef.current.onDragDelta(-dy, fine);
        }
      };

      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        cleanup();
        if (moved) {
          optsRef.current.onDragEnd();
        } else {
          if (optsRef.current.onClickEditFallback) {
            optsRef.current.onClickEditFallback(el);
          } else {
            el.focus();
            if (el instanceof HTMLInputElement) el.select();
          }
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
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onPointerDown);

    return () => {
      el.removeEventListener('wheel', onWheel as EventListener);
      el.removeEventListener('pointerdown', onPointerDown);
    };
  }, [inputRef]);
}
