# AAX SDK セットアップガイド

## 概要
AAX（Avid Audio eXtension）プラグインをビルドするには、Avidから提供されるAAX SDKが必要です。
このSDKは独自ライセンスのため、gitリポジトリには含まれていません。

## AAX SDK入手方法

1. **Avid Developer Portalに登録**
   - https://www.avid.com/alliance-partner-program/become-an-audio-developer
   - 開発者アカウントを作成

2. **AAX SDKをダウンロード**
   - Developer Portalにログイン
   - AAX SDK (通常最新版を推奨)をダウンロード
   - 現在サポートしているバージョン: 2.4.1以降

## SDKの配置

以下のいずれかのディレクトリに配置してください（gitignoreで除外されます）：

```
ZeroComp/
├── AAX_SDK/        # 推奨
├── aax-sdk/        # 代替1
└── AAX/            # 代替2
```

### ディレクトリ構造の例

```
AAX_SDK/
├── Documentation/
├── ExamplePlugIns/
├── Extensions/
├── Interfaces/
├── Libs/
├── TI/
└── Utilities/
```

## ビルド設定

### CMakeでAAXビルドを有効化

1. CMakeLists.txtの該当箇所のコメントを解除：

```cmake
# AAXビルドを有効にする場合は以下のコメントを解除
# set(AAX_SDK_PATH "${CMAKE_SOURCE_DIR}/AAX_SDK")
# juce_set_aax_sdk_path(${AAX_SDK_PATH})
```

2. プラグインターゲットにAAXフォーマットを追加：

```cmake
FORMATS AU VST3 Standalone AAX  # AAXを追加
```

### 必要な設定

- **Windows**: Visual Studio 2019以降
- **macOS**: Xcode 12以降
- **Pro Tools**: テスト用にPro Tools（開発者版推奨）

## ビルド手順

### Windows
```powershell
cmake -DAAX_BUILD=ON -DAAX_SDK_PATH="./AAX_SDK" ..
cmake --build . --config Release --target ZeroComp_AAX
```

### macOS
```bash
cmake -DAAX_BUILD=ON -DAAX_SDK_PATH="./AAX_SDK" ..
cmake --build . --config Release --target ZeroComp_AAX
```

## 署名とパッケージング

AAXプラグインには特別な署名プロセスが必要です：

1. **Developer IDの取得**
   - Avid Developer Portalから取得

2. **PACE Eden Tools**
   - 署名ツールのダウンロードと設定

3. **署名コマンド**
   ```bash
   wraptool sign --verbose \
     --account YOUR_DEVELOPER_ID \
     --wcguid YOUR_WRAP_GUID \
     --in ZeroComp.aaxplugin \
     --out ZeroComp_signed.aaxplugin
   ```

## トラブルシューティング

### よくある問題

1. **SDKが見つからない**
   - パスが正しいか確認
   - CMakeCacheを削除して再設定

2. **ビルドエラー**
   - SDKバージョンとJUCEの互換性を確認
   - 必要なライブラリ（特にWindows）がインストールされているか確認

3. **Pro Toolsで認識されない**
   - 署名が正しく行われているか確認
   - Pro Tools Developer版を使用しているか確認

## 注意事項

- AAX SDKは再配布禁止です
- このディレクトリは`.gitignore`で除外されます
- チームメンバーは各自でSDKを入手・配置する必要があります
- 商用リリース前には必ずAvidの認証プロセスを完了してください

## サポート

AAX開発に関する詳細は以下を参照：
- Avid Developer Documentation
- JUCE AAX Documentation
- Pro Tools Developer Forum