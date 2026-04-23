# AAX開発者ビルドガイド

## 重要: Pro Tools 2023/2024での未署名AAXプラグイン

**注意**: 通常のPro Tools（2023年以降）では、未署名のAAXプラグインを読み込むことはできません。
- Shift+Control起動による開発者モードは**現在使用できません**
- `-LoadUnsignedPlugins`コマンドラインフラグも**動作しません**

## 開発ビルドの配布とテスト

### 方法1: Pro Tools Developer Edition（必須）

未署名のAAXプラグインをテストするには、**Pro Tools Developer Edition**が必要です。

1. **Avid Developer Accountの作成**
   - https://developer.avid.com でアカウント作成（無料）
   - Pro Tools Developer Editionをダウンロード

2. **インストールと使用**
   - 通常のPro Toolsとは別にインストール可能
   - 未署名AAXプラグインが自動的に読み込まれる
   - 開発・テスト専用（商用利用不可）
   - **これが唯一の確実な方法です**

### 方法2: PACE Eden Toolsによる正式な署名（通常のPro Tools用）

1. **PACE Eden Toolsのセットアップ**
   ```bash
   # Eden Toolsがインストール済みの場合
   cd /path/to/aax-sdk/Utilities/CreatePackage
   ```

2. **開発者証明書の生成**
   ```bash
   # 自己署名証明書を作成
   ./makedeveloperpackage.bat  # Windows
   ./makedeveloperpackage.sh   # macOS
   ```

3. **AAXプラグインの署名**
   ```bash
   # Windows
   wraptool.exe sign --verbose \
     --account "YOUR_ILOK_ID" \
     --wcguid "YOUR_WRAP_GUID" \
     --signid "Developer" \
     --in "ZeroComp.aaxplugin" \
     --out "ZeroComp_signed.aaxplugin"

   # macOS
   wraptool sign --verbose \
     --account "YOUR_ILOK_ID" \
     --wcguid "YOUR_WRAP_GUID" \
     --signid "Developer" \
     --in "ZeroComp.aaxplugin" \
     --out "ZeroComp_signed.aaxplugin"
   ```

### 方法4: テスト用ライセンスファイル

一部のPro Toolsバージョンでは、特定のディレクトリに配置したライセンスファイルで未署名プラグインを許可できます：

1. **Windows**
   ```
   C:\ProgramData\Avid\Audio\Plug-Ins\developer.license
   ```

2. **macOS**
   ```
   /Library/Application Support/Avid/Audio/Plug-Ins/developer.license
   ```

### トラブルシューティング

#### プラグインが表示されない場合

1. **プラグインフォルダを確認**
   - Windows: `C:\Program Files\Common Files\Avid\Audio\Plug-Ins\`
   - macOS: `/Library/Application Support/Avid/Audio/Plug-Ins/`

2. **Pro Toolsのプラグインスキャン**
   - Preferences → Plug-In → Re-scan

3. **ログを確認**
   - Windows: `%USERPROFILE%\Documents\Pro Tools\Plug-in Scan Logs\`
   - macOS: `~/Documents/Pro Tools/Plug-in Scan Logs/`

#### "Plugin could not be loaded"エラー

1. **依存ライブラリの確認**
   ```bash
   # Windows (Dependency Walker)
   depends.exe ZeroComp.aaxplugin

   # macOS
   otool -L ZeroComp.aaxplugin/Contents/MacOS/ZeroComp
   ```

2. **AAXライブラリのリンク確認**
   - AAXLibrary.lib/libAAXLibrary.aが正しくリンクされているか
   - Visual C++ Redistributableがインストールされているか（Windows）

### 開発者向けベストプラクティス

1. **デバッグビルドの配布**
   - デバッグシンボル付きビルドを提供
   - クラッシュダンプの収集設定を有効化

2. **ログ機能の実装**
   ```cpp
   // AAXプラグイン内でのログ
   #ifdef DEBUG
   AAX_TRACE(AAX_TRACE_PRIORITY_NORMAL, "ZeroComp: %s", message);
   #endif
   ```

3. **バージョン管理**
   - ビルド番号を含める
   - Git commit hashを埋め込む

4. **テスター向けドキュメント**
   - インストール手順
   - 既知の問題
   - フィードバック方法

### セキュリティ上の注意

- 開発者ビルドは内部テストのみに使用
- 署名されていないプラグインは本番環境で使用しない
- テスターには信頼できる人のみを選定
- ビルドの有効期限を設定することを検討

### 配布チェックリスト

- [ ] AAXプラグインのビルド完了
- [ ] 依存ライブラリの確認
- [ ] インストール手順書の作成
- [ ] Pro Tools起動オプションの説明
- [ ] トラブルシューティング情報の提供
- [ ] フィードバック収集方法の確立