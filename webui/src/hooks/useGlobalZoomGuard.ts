// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jun Murakami
import { useEffect } from 'react';

//
// WebView（Windows WebView2 / macOS WKWebView）の Ctrl+Wheel ズームを抑止する。
// プラグイン UI では UI 自体のズームは不要で、Ctrl+Wheel はスライダー微調整に使うため、
// グローバルで preventDefault する。capture 相で先取りして確実に止める。
//
// Web (VITE_RUNTIME=web) モードではブラウザズームを尊重するため無効化。
//
export function useGlobalZoomGuard() {
  useEffect(() => {
    if (import.meta.env.VITE_RUNTIME === 'web') return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) e.preventDefault();
    };
    // 非パッシブ + capture。こうしないと Ctrl+Wheel のズームは止まらない。
    window.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => {
      window.removeEventListener('wheel', onWheel, { capture: true } as AddEventListenerOptions);
    };
  }, []);
}
