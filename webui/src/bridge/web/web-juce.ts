// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jun Murakami
/**
 * bridge/juce.ts のドロップイン置換（Web 版）。
 * Vite エイリアスで `import { juceBridge } from '../bridge/juce'` がこのファイルに解決される。
 */

export { webBridge as juceBridge } from './WebBridgeManager';

export async function openUrl(url: string): Promise<boolean>
{
  window.open(url, '_blank');
  return true;
}
