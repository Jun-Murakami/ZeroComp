// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jun Murakami
// JUCE JavaScript library must be imported first
import 'juce-framework-frontend-mirror'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'

// フォント読み込み待機（CSS Font Loading API）
async function waitForFontsReady(timeoutMs = 3000): Promise<void> {
  try {
    const ready = document.fonts.ready as Promise<unknown>
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))
    await Promise.race([ready.then(() => {}), timeout])
  } catch {
    // 未対応でも失敗は無視
  }
}

function hideSplash() {
  const el = document.getElementById('splash')
  if (el) el.classList.add('hidden') // display:none に切替
}

async function bootstrap() {
  await waitForFontsReady(2500)

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )

  // 次フレームで即時にマスク解除
  requestAnimationFrame(() => hideSplash())
}

bootstrap()
