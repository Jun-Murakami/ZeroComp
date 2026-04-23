必ず日本語で回答すること。

## ZeroComp 開発用 ルール（AGENTS）

この文書は JUCE + WebView（Vite/React/MUI）構成で「ゼロレイテンシー・ブロードキャスト用コンプレッサー」を実装するための合意ルールです。開発時の意思決定や PR レビューの基準として用います。

### 目的とスコープ

- **目的**: ルックアヘッド無しでフィードフォワード検出するブロードキャスト用コンプレッサー。放送／配信／ライブの音声処理を最優先（ゼロレイテンシー）、副次的にマスタリング／ミックス用途にも対応。
- **対象フォーマット**: VST3 / AU / AAX / Standalone
- **機能要件**:
  - Threshold フェーダー（-80..0 dB、放送向けの広レンジ）
  - Ratio フェーダー（1:1..100:1、log skew、100:1 でブリックウォール相当）
  - Output Gain フェーダー（-24..+24 dB）
  - Knee（0..24 dB、ソフトニー二次曲線）
  - Attack（0.1..500 ms、log skew）
  - Release（0.1..2000 ms、log skew）
  - Mode（VCA / Opto / FET / Vari-Mu の 4 択、動作キャラクター切替）
  - Ratio グラフ（Input→Output 静的カーブの可視化、リアルタイムで入力レベルに対応する動作点をドット表示）
  - Input / GR / Output メーター（Peak / RMS / Momentary LKFS 切替）

### アーキテクチャ

- **C++/JUCE**:
  - `PluginProcessor` が APVTS を保持、`processBlock` で DSP チェーンを実行
  - `zc::dsp::Compressor` — ゼロレイテンシー・フィードフォワード・コンプレッサー
    - ピーク検出（ルックアヘッド無し）→ 静的カーブで target GR 計算 → attack/release envelope 平滑化 → L/R 共通ゲイン適用
  - メーター値は `std::atomic<float>` で audio → UI に受け渡し（区間最大を `compare_exchange_weak` で更新）
- **WebUI**:
  - APVTS とは `useJuceParam.ts` 経由で `useSyncExternalStore` 購読（tearing-free）
  - フェーダーは `ParameterFader`（縦）と `HorizontalParameter`（横、Knee/Attack/Release 用）に一本化
  - `RatioGraph` が Input dB → Output dB の静的カーブを canvas 描画。threshold / ratio / knee を即時反映
  - メーターは 30Hz で `meterUpdate` イベントを購読して canvas 描画
- **コンプ方針**: `target_dB = computeGainReductionDb(input_dB)` → `envelope` は attack 側で素早く、release 側でゆっくり追従 → ゲイン `g = 10^(-envelope/20)` を全チャネル共通で適用

### 静的カーブ（ソフトニー）

Giannoulis/Massberg/Reiss 2012 に準拠:
- `x < T - K/2`：GR = 0（スルー）
- `|x - T| <= K/2`：GR = slope × (x - T + K/2)² / (2K)（二次補間）
- `x > T + K/2`：GR = slope × (x - T)（ハードカーブ）

ここで `slope = 1 - 1/ratio`。K=0 の場合はソフトニー無しのハードニー挙動になる。

### オーディオスレッド原則

- `processBlock` 内でのメモリ確保・ロック・ファイル I/O は禁止
- メーター蓄積は `compare_exchange_weak` で区間最大を保持し、UI タイマーで `exchange(0)` して取り出し
- パラメータの読み取りは `getRawParameterValue(...)->load()` を使用し、`AudioProcessorValueTreeState::Listener` は使わない（UI スレッドからのコールバック発生を避ける）

### UI/UX 原則

- ダークテーマ前提。MUI v7、`@fontsource/jost` をデフォルトフォントに使用
- メーターは HiDPI 対応 canvas で描画
- 縦フェーダーは `ParameterFader` に一本化（linear / log skew 両対応）
  - frontend-mirror は lambda 形式 skew を認識できないので、log 変換は UI 側で `valueToNorm` / `normToValue` を使って行う
- 横スライダーは `HorizontalParameter` を使用。Knee/Attack/Release の配置に最適
- 数値入力欄は `block-host-shortcuts` クラスでキーイベントの DAW 転送を抑制
- 既定値: Threshold 0 / Ratio 4:1 / Knee 6 dB / Attack 10 ms / Release 100 ms / Output 0 dB

### ブリッジ / メッセージ設計

- JS → C++（コマンド系、`callNative` 経由）:
  - `system_action("ready")` — 初期化完了通知
  - `system_action("forward_key_event", payload)` — キー転送
  - `open_url(url)` — 外部 URL の起動
  - `window_action("resizeTo", w, h)` — Standalone 用リサイズ
- C++ → JS（イベント系、30Hz スロットル）:
  - `meterUpdate`: `{ input: {...}, output: {...}, grDb, meteringMode }`
    - mode 0 (Peak): `truePeakLeft / truePeakRight`
    - mode 1 (RMS): `rmsLeft / rmsRight`
    - mode 2 (Momentary): `momentary`（LKFS）

### パラメータ一覧（APVTS）

- `THRESHOLD`:   float, -80..0 dB, 既定 0
- `RATIO`:       float, 1..100,  log skew, 既定 4.0
- `KNEE_DB`:     float, 0..24 dB, 既定 6.0
- `ATTACK_MS`:   float, 0.1..500 ms,  log skew, 既定 10.0
- `RELEASE_MS`:  float, 0.1..2000 ms, log skew, 既定 100.0
- `OUTPUT_GAIN`: float, -24..+24 dB, 既定 0
- `MODE`:        choice [VCA, Opto, FET, Vari-Mu], 既定 VCA
- `METERING_MODE`: choice [Peak, RMS, Momentary], 既定 Peak

### 動作モード（MODE）

ゼロレイテンシー原則を崩さずに古典的コンプの音色キャラクターを切り替える 4 択。
ユーザの Threshold/Ratio/Knee/Attack/Release 設定はそのまま有効で、モードは
「エンベロープ挙動 + 信号経路後段の色付け（サチュレーション）」を差し替える。
lookahead も oversampling も**使わない**。

- **VCA (Clean)**: 現行の透明なフィードフォワード動作。色付け無し。
- **Opto**: LA-2A 系。`release_ms * 5` の slow envelope を並走させ、`max(fast_gr, slow_gr)` で抑制量を採用する。リリースが 2 段になり、深いリダクションが長く持続する（LDR の熱的記憶の粗い近似）。
- **FET**: 1176 系。ゲイン適用後の信号経路に非対称ソフトクリップ（`tanh(x + asym)`）を薄く噛ませて "grit"（1176 の独特な荒さ）を作る。
- **Vari-Mu**: Fairchild 系。静的カーブのニーを内部で +12 dB 広げ、ratio が GR と共にゆっくり立ち上がる感覚を作る。さらに `sign(x) * x^2` ベースの柔らかい偶数次倍音を信号経路に足す（tube 風の暖かさ）。

実装は `plugin/src/dsp/Compressor.cpp` の `processBlock` 内で分岐。状態は `envelopeDb`（fast）と `envelopeDbSlow`（Opto 用）。

### React 設計方針

- 外部ストア購読は `useSyncExternalStore`（`hooks/useJuceParam.ts`）。tearing-free で StrictMode 安全
- `useEffect` は最小限。JUCE の `valueChangedEvent` から呼び出すコールバックでは Latest Ref Pattern を使う
- Latest Ref Pattern: `const xRef = useRef(x); xRef.current = x;` を render 中に実行

### コーディング規約（C++）

- 明示的な型、早期 return、2 段以上の深いネスト回避
- 例外は原則不使用。戻り値でエラー伝搬
- コメントは「なぜ」を中心に要点のみ
- 新規 DSP クラスは `plugin/src/dsp/` 配下、`namespace zc::dsp` で統一

### コーディング規約（Web）

- TypeScript 必須。any 型は禁止
- ESLint + Prettier。コンポーネントは疎結合・小さく
- MUI テーマはダーク優先

### ビルド

- Dev: WebView は `http://127.0.0.1:5173`（Vite dev server）
- Prod: `webui build` を zip 化 → `juce_add_binary_data` で埋め込み
- AAX SDK は `aax-sdk/` 配下に配置された場合のみ自動的に有効化
- Windows 配布ビルド: `powershell -File build_windows.ps1 -Configuration Release`
  - 成果物: `releases/<VERSION>/ZeroComp_<VERSION>_Windows_VST3_AAX_Standalone.zip` と `ZeroComp_<VERSION>_Windows_Setup.exe`（Inno Setup 6 必須）
  - AAX 署名は `.env` に PACE 情報がある場合のみ自動実行

### バージョン管理

- `VERSION` ファイルで一元管理。CMake と `build_windows.ps1` がここから読む
- `webui/package.json` の `version` も手動で同期する
- コミットは**ユーザが明示的に指示しない限り行わない**

### デフォルト挙動メモ

- 新規インスタンス時は Threshold 0 dB（実質バイパス）、Ratio 4:1、Knee 6 dB、Attack 10 ms、Release 100 ms で立ち上がる
- Threshold 0 dB = フルスケールでは GR 発生しない。ユーザが下げたときだけコンプが掛かる
- プラグインウィンドウ最小 520 × 390、初期 720 × 500
