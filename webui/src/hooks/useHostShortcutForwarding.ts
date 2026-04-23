import { useEffect } from 'react';
import { juceBridge } from '../bridge/juce';

// テキスト入力要素のみを除外（スライダーなどのコントロールは除外しない）
const EDITABLE_TARGET_SELECTOR = '.block-host-shortcuts';


const SUPPRESSION_WINDOW_MS = 200;

type SuppressionId = `${ForwardKeyEventPayload['type']}:${string}`;

const suppressionCache = new Map<SuppressionId, number>();

const shouldSuppressEvent = (id: SuppressionId): boolean => {
  const timestamp = suppressionCache.get(id);
  if (timestamp === undefined) return false;
  const elapsed = performance.now() - timestamp;
  if (elapsed < SUPPRESSION_WINDOW_MS) return true;
  suppressionCache.delete(id);
  return false;
};

const markSuppressed = (id: SuppressionId) => {
  const now = performance.now();
  suppressionCache.set(id, now);
  window.setTimeout(() => {
    const stored = suppressionCache.get(id);
    if (stored === now) {
      suppressionCache.delete(id);
    }
  }, SUPPRESSION_WINDOW_MS);
};
interface ForwardKeyEventPayload {
  type: 'keydown' | 'keyup';
  key: string;
  code: string;
  keyCode: number;
  repeat: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!target) return false;
  const element = target as HTMLElement;
  if (element.matches(EDITABLE_TARGET_SELECTOR)) return true;
  return Boolean(element.closest(EDITABLE_TARGET_SELECTOR));
};

const buildPayload = (event: KeyboardEvent, type: ForwardKeyEventPayload['type']): ForwardKeyEventPayload => ({
  type,
  key: event.key,
  code: event.code,
  keyCode: typeof event.keyCode === 'number' && event.keyCode > 0 ? event.keyCode : event.which ?? 0,
  repeat: event.repeat,
  altKey: event.altKey,
  ctrlKey: event.ctrlKey,
  shiftKey: event.shiftKey,
  metaKey: event.metaKey,
});

export const useHostShortcutForwarding = () => {
  useEffect(() => {
    // Web (SPA) モードではホスト転送は不要（ブラウザのキー操作を阻害するため）
    if (import.meta.env.VITE_RUNTIME === 'web') return;

    let bridgeReady = false;
    juceBridge.whenReady(() => {
      bridgeReady = true;
    });

    const shouldForward = (event: KeyboardEvent): boolean => {
      if (!bridgeReady) return false;
      // テキスト入力要素の場合は転送しない
      if (isEditableTarget(event.target)) return false;
      if (event.isComposing) return false;
      return true;
    };

    const forward = (type: ForwardKeyEventPayload['type']) => (event: KeyboardEvent) => {
      if (!shouldForward(event)) return;
      // リピートkeydownは転送対象にする（Cubase等で押しっぱなしを認識させるため）
      const isRepeatKeydown = type === 'keydown' && event.repeat;

      const suppressionId: SuppressionId = `${type}:${event.code}`;
      // 初回のみ抑制ウィンドウを適用。リピートkeydownは抑制しない
      if (!isRepeatKeydown && shouldSuppressEvent(suppressionId)) return;

      // キーイベント転送前に、MUIコンポーネントなどがフォーカスを持っている場合は外す
      // これにより、ボタンをクリックした後のスペース/Enterキーがボタンのクリックではなく
      // DAWに転送されるようになる
      const activeElement = document.activeElement as HTMLElement;
      if (activeElement && activeElement !== document.body && !isEditableTarget(activeElement)) {
        // body以外の要素がフォーカスされていて、かつ.block-host-shortcutsを持たない場合は
        // フォーカスを外してDAWに転送する
        activeElement.blur();
      }

      const payload = buildPayload(event, type);
      if (!isRepeatKeydown) markSuppressed(suppressionId);

      void juceBridge
        .callNative('system_action', 'forward_key_event', payload)
        .then(() => { })
        .catch(() => { });

      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const keydownHandler = forward('keydown');
    const keyupHandler = forward('keyup');

    window.addEventListener('keydown', keydownHandler, true);
    window.addEventListener('keyup', keyupHandler, true);

    return () => {
      window.removeEventListener('keydown', keydownHandler, true);
      window.removeEventListener('keyup', keyupHandler, true);
      suppressionCache.clear();
    };
  }, []);
};

