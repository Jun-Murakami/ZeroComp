# ZeroComp — AGENTS

このリポジトリで作業する AI コーディングエージェント向けの要点サマリです。詳細は [CLAUDE.md](./CLAUDE.md) を参照してください。

## プロジェクト

- JUCE + WebView（Vite/React/MUI）のオーディオプラグイン
- ゼロレイテンシー（ルックアヘッド無し）のブロードキャスト用コンプレッサー
- ユーザが触るのは Threshold / Ratio / Knee / Attack / Release / Mode / Output Gain と Metering Mode
- Mode は VCA / Opto / FET / Vari-Mu の 4 択。lookahead / oversampling を一切使わず、エンベロープ挙動と後段サチュレーションだけでキャラクターを切替

## ディレクトリ概観

- `plugin/src/` — JUCE プラグイン本体（C++）
  - `PluginProcessor.*`, `PluginEditor.*`, `ParameterIDs.h`
  - `dsp/Limiter.*` — ゼロレイテンシー・ブリックウォール・リミッター（dual envelope の Auto Release 対応）
  - `dsp/CrossoverLR4.*` — 可変バンド数（3/4/5）LR4 IIR クロスオーバー、allpass 位相アライメント付き
  - `dsp/MultibandLimiter.*` — マルチバンドのラッパー（バンド別時定数）
  - `dsp/MomentaryProcessor.*` — ITU-R BS.1770-4 Momentary LKFS
  - `KeyEventForwarder.*` — WebView → DAW ホストのキーイベント転送
- `webui/src/` — Vite + React 19 + MUI v7 フロントエンド
  - `App.tsx`、`components/ParameterFader.tsx`、`components/VUMeter.tsx`、`components/ReleaseSection.tsx`、`components/LicenseDialog.tsx`
  - `hooks/useJuceParam.ts` — APVTS 購読の React フック（useSyncExternalStore ベース）
  - `hooks/useHostShortcutForwarding.ts` — ショートカット転送

## 作業するうえでの原則

1. オーディオスレッド上では確保 / ロック / I/O を行わない
2. パラメータは APVTS に集約、UI との双方向同期は `WebSliderRelay` / `WebToggleButtonRelay` / `WebComboBoxRelay` + `Web*ParameterAttachment` で行う
3. 高頻度データ（メーター）は `std::atomic<float>` で audio → UI へ渡し、UI タイマーで 30Hz 送出
4. TypeScript は `any` 禁止。購読系は `useSyncExternalStore`、イベント系 hook は `useEffectEvent` を優先（ただし JUCE の `valueChangedEvent` からの呼び出しは **Latest Ref Pattern** が安定）
5. 新規 DSP クラスは `plugin/src/dsp/` に置き、`CMakeLists.txt` の `target_sources` に登録
6. WebUI コンポーネントは疎結合・小さく、フェーダーは `ParameterFader` に一本化

## ビルド

- Windows（本番配布）: `powershell -File build_windows.ps1 -Configuration Release` — WebUI ビルド → VST3 / AAX / Standalone コンパイル → AAX 署名（`.env` に PACE 情報あれば）→ ZIP 梱包 → Inno Setup インストーラ生成
- Windows（開発）: `cmake -B build -G "Visual Studio 17 2022" -A x64 && cmake --build build --config Debug --target ZeroComp_VST3`
- macOS: `./build_macos.zsh`
- WebUI dev: `cd webui && npm install && npm run dev`
- 型チェックのみ: `cd webui && npx tsc --noEmit`

## よく使う拡張ポイント

- 新規 APVTS パラメータ追加: `ParameterIDs.h` に ID 追加 → `createParameterLayout()` で登録 → `PluginEditor` に Web*Relay / Attachment 追加 → `.withOptionsFrom()` に追加 → WebUI 側 hook で購読
- 新規バンド構成やクロスオーバー変更: `MultibandLimiter.cpp` の匿名名前空間にある `kBands3/4/5` と `kCrossovers3/4/5` を編集
- 新規 DAW 互換対応: `KeyEventForwarder.cpp` の `resolveHostWindowForForwarding` / `handleDefaultPostMessage`
