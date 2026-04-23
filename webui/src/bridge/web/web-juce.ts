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
