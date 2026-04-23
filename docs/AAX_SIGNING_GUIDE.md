# AAXプラグイン署名ガイド

## 概要
通常のPro Toolsで動作させるには、PACE Eden Toolsを使用してAAXプラグインに署名する必要があります。

## 必要なもの

1. **Avid Developer Account**（無料）
2. **PACE Developer Account**（Avid経由で自動的に無料アップグレード）
3. **iLok USB**（物理デバイス、約$50）
4. **PACE Eden Tools**（Windows/macOS）
5. **AAX SDK**（既に取得済み）

## セットアップ手順

### 1. Avid Developer Accountの作成

1. https://developer.avid.com にアクセス
2. "Join Developer Program"から登録（無料）
3. アカウント承認を待つ（通常1-2営業日）

### 2. PACE Centralのセットアップ

1. https://www.ilok.com からPACE Centralをダウンロード
2. iLok.comアカウントを作成
3. PACE Centralをインストール
4. iLok USBを接続

### 3. PACE Central Web（開発者ポータル）へのアクセス

1. Avidから承認メールが届いたら、PACEからも開発者アクセスの招待メールが届く
2. **iLok License Manager アプリを起動してログイン**（ポータルへ直接ブラウザで飛んでも開けないので、必ずここから）
3. アプリの画面（または招待メール内のリンク）から PACE Central Web へ遷移: https://pc2.paceap.com/
4. Developer Subscription（通常$500/年）が無料でアクティベートされていることを確認

### 4. Eden Toolsのダウンロードとセットアップ

```bash
# PACE Central Web（https://pc2.paceap.com/ ・iLok License Manager 経由でログイン）から最新版をダウンロード
# Windows: eden_tools_windows_x.x.x.zip
# macOS: eden_tools_macos_x.x.x.dmg
```

#### Windows
```powershell
# Eden Toolsを解凍（例: C:\PACE\EdenTools）
cd C:\PACE\EdenTools

# 環境変数を設定
[Environment]::SetEnvironmentVariable("PACE_EDEN_TOOLS", "C:\PACE\EdenTools", "User")
$env:PATH += ";C:\PACE\EdenTools\bin"
```

#### macOS
```bash
# Eden Toolsをインストール（通常 /usr/local/pace/eden）
export PACE_EDEN_TOOLS="/usr/local/pace/eden"
export PATH="$PATH:$PACE_EDEN_TOOLS/bin"

# ~/.zshrc or ~/.bash_profileに追加
echo 'export PACE_EDEN_TOOLS="/usr/local/pace/eden"' >> ~/.zshrc
echo 'export PATH="$PATH:$PACE_EDEN_TOOLS/bin"' >> ~/.zshrc
```

### 5. 署名用証明書の作成

wraptool には **コードサイニング用の PFX** を `--keyfile` / `--keypassword` で渡します。社内配布・ベータ用途なら自己署名 PFX で十分動作します。マーケット流通用は商用 CA（DigiCert / SSL.com / Sectigo 等）発行のコードサイニング証明書を推奨。

#### ⚠️ 重大な落とし穴: PFX は **Legacy CSP** で作らないと動かない

`New-SelfSignedCertificate` は Windows 10 以降 **CNG (Cryptography Next Generation)** をデフォルトで使うが、**PACE wraptool 内部の signtool 系 API は Legacy CSP の秘密鍵しか扱えない**。`New-SelfSignedCertificate` で作った CNG 秘密鍵付き PFX を渡すと、wraptool 側は認証・WCGUID 確認を通過した上で、以下のエラーで落ちる:

```
BinaryDsigException::CodesignToolError, 14, Error signing the specified binary.
Key file ...\xxxxx.pfx doesn't contain a valid signing certificate.
```

一方 `Set-AuthenticodeSignature` 等は CNG でも通るため、「PFX 単体は健全に見えるのに wraptool だけ失敗」という紛らわしい状況になる。見分け方:

```powershell
$cert = Get-PfxCertificate -FilePath $pfxPath -Password $pwd
$rsa = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($cert)
$rsa.Key.Provider.Provider   # → "Microsoft Software Key Storage Provider" なら CNG。NG。
                             #   "Microsoft Enhanced RSA and AES Cryptographic Provider" なら Legacy CSP。OK。
```

#### Windows: `certreq.exe` + INF で Legacy CSP PFX を作成（推奨）

`New-SelfSignedCertificate` には Provider を強制するオプションがないので、INF ファイル経由で `certreq.exe` を使う:

```powershell
$pfxPath = "D:\Synching\code\JUCE\ZeroComp\zerocomp-dev.pfx"
$envPath = "D:\Synching\code\JUCE\ZeroComp\.env"

$kv = @{}
foreach ($line in Get-Content $envPath) {
    if ($line -match '^\s*([^#=][^=]*)=(.*)$') { $kv[$matches[1].Trim()] = $matches[2].Trim() }
}
$pfxPwdPlain = $kv['PACE_KEYPASSWORD']

# 既存の ZeroComp Dev 証明書があれば一度クリーンアップ
foreach ($storeName in @('My','Root')) {
    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store($storeName,'CurrentUser')
    $store.Open('ReadWrite')
    $old = @($store.Certificates | Where-Object { $_.Subject -eq 'CN=ZeroComp Dev' })
    foreach ($c in $old) { $store.Remove($c) | Out-Null }
    $store.Close()
}

# Legacy CSP を明示して作成
$inf = @"
[Version]
Signature="`$Windows NT`$"

[NewRequest]
Subject = "CN=ZeroComp Dev"
KeyLength = 2048
KeyAlgorithm = RSA
HashAlgorithm = SHA1
MachineKeySet = False
RequestType = Cert
ValidityPeriod = Years
ValidityPeriodUnits = 3
ProviderName = "Microsoft Enhanced RSA and AES Cryptographic Provider"
ProviderType = 24
KeySpec = 2
KeyUsage = 0x80
SMIME = False
Exportable = True
FriendlyName = "ZeroComp Dev"

[EnhancedKeyUsageExtension]
OID = 1.3.6.1.5.5.7.3.3
"@

$infPath     = "$env:TEMP\zerocomp-cert.inf"
$certOutPath = "$env:TEMP\zerocomp-cert.crt"
Set-Content -Path $infPath -Value $inf -Encoding ASCII
& certreq.exe -new -q $infPath $certOutPath | Out-Null

# CurrentUser\My から拾って PFX 化
$created = Get-ChildItem -Path Cert:\CurrentUser\My |
    Where-Object { $_.Subject -eq 'CN=ZeroComp Dev' } |
    Sort-Object NotBefore -Descending |
    Select-Object -First 1

$pwd = ConvertTo-SecureString -String $pfxPwdPlain -Force -AsPlainText
Export-PfxCertificate -Cert $created -FilePath $pfxPath -Password $pwd | Out-Null

Remove-Item $infPath, $certOutPath -Force -ErrorAction SilentlyContinue
```

INF の要点:
- `ProviderName = "Microsoft Enhanced RSA and AES Cryptographic Provider"` — **Legacy CSP を明示**（これが肝）
- `ProviderType = 24` — PROV_RSA_AES（Enhanced CSP と対応）
- `KeySpec = 2` — AT_SIGNATURE
- `HashAlgorithm = SHA1` — wraptool が古い signtool を呼ぶためデフォルトは SHA-1 で出すのが安全
- `[EnhancedKeyUsageExtension] OID = 1.3.6.1.5.5.7.3.3` — Code Signing EKU

#### 保存先（build_windows.ps1 が参照する順）

1. `$env:PACE_PFX_PATH`（明示指定）
2. プロジェクトルートの `zerocomp-dev.pfx` ← 標準
3. `%USERPROFILE%\.zerocomp\dev.pfx`
4. `.\certificates\zerocomp-dev.pfx`

#### .env に揃えておく値

```env
PACE_USERNAME=<iLok アカウント名>
PACE_PASSWORD=<iLok パスワード>
PACE_ORGANIZATION=<PACE Central Web で取得した WCGUID (プラグインごとに固有)>
PACE_KEYPASSWORD=<PFX のエクスポートパスワードと同じ値>
```

`.env` は `.gitignore` で除外済み。

#### 商用 CA の PFX を使う場合

発行された証明書を PFX 形式（秘密鍵付き）でエクスポートし、上記の保存先に置けば同じフローで動作します。商用 CA の多くは YubiKey / HSM ベースの保管を要求するため、HSM 経由署名に切り替えるケースは別途 wraptool のキー指定を調整してください。

## 署名プロセス

### Windows用スクリプト (sign_aax_windows.ps1)

```powershell
# AAX署名スクリプト - Windows
param(
    [Parameter(Mandatory=$true)]
    [string]$AAXPath,
    
    [string]$OutputPath = "",
    
    [string]$WrapGuid = "YOUR_WRAP_GUID_HERE"  # PACE Central Web（https://pc2.paceap.com/）で生成
)

# Eden Toolsのパスを確認
$EdenPath = $env:PACE_EDEN_TOOLS
if (-not $EdenPath) {
    Write-Error "PACE_EDEN_TOOLS environment variable not set"
    exit 1
}

$WrapTool = "$EdenPath\bin\wraptool.exe"
if (-not (Test-Path $WrapTool)) {
    Write-Error "wraptool.exe not found at: $WrapTool"
    exit 1
}

# 出力パスの設定
if ([string]::IsNullOrEmpty($OutputPath)) {
    $OutputPath = [System.IO.Path]::GetDirectoryName($AAXPath)
    $OutputPath = Join-Path $OutputPath ([System.IO.Path]::GetFileNameWithoutExtension($AAXPath) + "_signed.aaxplugin")
}

Write-Host "Signing AAX Plugin..." -ForegroundColor Green
Write-Host "Input: $AAXPath"
Write-Host "Output: $OutputPath"

# 署名実行
& $WrapTool sign `
    --verbose `
    --account $env:ILOK_ACCOUNT `
    --wcguid $WrapGuid `
    --signid "Developer" `
    --in "$AAXPath" `
    --out "$OutputPath"

if ($LASTEXITCODE -eq 0) {
    Write-Host "Successfully signed AAX plugin!" -ForegroundColor Green
    Write-Host "Signed plugin: $OutputPath"
} else {
    Write-Error "Failed to sign AAX plugin. Error code: $LASTEXITCODE"
    exit 1
}
```

### macOS用スクリプト (sign_aax_macos.sh)

```bash
#!/bin/bash

# AAX署名スクリプト - macOS

# 色設定
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 引数チェック
if [ $# -lt 1 ]; then
    echo -e "${RED}Usage: $0 <path_to_aax_plugin> [output_path]${NC}"
    exit 1
fi

AAX_PATH="$1"
OUTPUT_PATH="${2:-}"
WRAP_GUID="YOUR_WRAP_GUID_HERE"  # PACE Central Web（https://pc2.paceap.com/）で生成

# Eden Toolsパス確認
if [ -z "$PACE_EDEN_TOOLS" ]; then
    echo -e "${RED}Error: PACE_EDEN_TOOLS environment variable not set${NC}"
    exit 1
fi

WRAP_TOOL="$PACE_EDEN_TOOLS/bin/wraptool"
if [ ! -f "$WRAP_TOOL" ]; then
    echo -e "${RED}Error: wraptool not found at: $WRAP_TOOL${NC}"
    exit 1
fi

# 出力パス設定
if [ -z "$OUTPUT_PATH" ]; then
    DIR=$(dirname "$AAX_PATH")
    BASE=$(basename "$AAX_PATH" .aaxplugin)
    OUTPUT_PATH="$DIR/${BASE}_signed.aaxplugin"
fi

echo -e "${GREEN}Signing AAX Plugin...${NC}"
echo "Input: $AAX_PATH"
echo "Output: $OUTPUT_PATH"

# 署名実行
$WRAP_TOOL sign \
    --verbose \
    --account "$ILOK_ACCOUNT" \
    --wcguid "$WRAP_GUID" \
    --signid "Developer" \
    --in "$AAX_PATH" \
    --out "$OUTPUT_PATH"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}Successfully signed AAX plugin!${NC}"
    echo "Signed plugin: $OUTPUT_PATH"
else
    echo -e "${RED}Failed to sign AAX plugin${NC}"
    exit 1
fi
```

## ビルドスクリプトへの統合

### build_windows_release.ps1への追加

```powershell
# AAX署名（オプション）
if ($BuildAAX -and $env:PACE_EDEN_TOOLS) {
    Write-Step "Signing AAX plugin..."
    $SignScript = "$RootDir\scripts\sign_aax_windows.ps1"
    if (Test-Path $SignScript) {
        & $SignScript -AAXPath "$SourceAAX" -OutputPath "$DestAAX"
        if ($LASTEXITCODE -eq 0) {
            Write-Success "AAX plugin signed successfully"
        } else {
            Write-Warning "AAX signing failed - distributing unsigned version"
        }
    }
}
```

## WRAP GUID（= Wrap Config GUID）の取得

### ⚠️ 落とし穴: Product GUID と Wrap Config GUID は別物

PACE Central Web には **Product** と **Wrap Config** という別々のエンティティがあり、それぞれ独自の GUID を持つ。wraptool の `--wcguid` に渡すべきは **Wrap Config GUID**。Product の詳細ページに表示される "Product GUID" を渡すと次のエラーになる:

```
wraptool Error: pace::WrapToolException: Error attempting to get wrapper data from the server.
WrapConfigNotFound: Provided wrapConfigGuid not found.
```

### 手順

1. iLok License Manager アプリを起動してログイン（直接ブラウザで開いても認可されない）
2. そこから PACE Central Web（https://pc2.paceap.com/）へ遷移
3. サイドメニューで **"Products"** を開き、対象プラグインの Product を作成（または既存を選択）
4. サイドメニューで **"Wrap Configs"** を開き、**"New Wrap Config"** でその Product に紐付けて作成
5. 作成後に表示される **Wrap Config GUID**（フォーマットは 8-4-4-4-12 の UUID）をコピー
6. `.env` の `PACE_ORGANIZATION` にこの値をセット

## 署名の確認

```bash
# 署名情報の確認
wraptool verify --in "ZeroComp_signed.aaxplugin"

# 出力例:
# Plugin is signed
# Signer: Your Company Name
# WRAP GUID: xxxx-xxxx-xxxx-xxxx
```

## トラブルシューティング

### よくあるエラーと対処法

1. **"No valid signing certificate found"**
   - iLok USBが接続されているか確認
   - PACE Centralで証明書が有効か確認
   - `pace_eden certificate list`で証明書を確認

2. **"Invalid WRAP GUID"**
   - PACE Central Web（https://pc2.paceap.com/）でWRAP GUIDを再確認
   - 製品が正しく登録されているか確認

3. **"Failed to sign: -2147024891"**
   - iLokライセンスマネージャーが実行中か確認
   - iLok USBを抜き差しして再試行

4. **Pro Toolsで読み込めない**
   - 署名が正しく完了しているか`wraptool verify`で確認
   - Pro Toolsのプラグインフォルダが正しいか確認
   - Pro Toolsを再起動してプラグインを再スキャン

## 自動化のベストプラクティス

1. **環境変数の設定**
   ```bash
   # .env.local（gitignore済み）
   ILOK_ACCOUNT=your_account
   WRAP_GUID=xxxx-xxxx-xxxx-xxxx
   PACE_EDEN_TOOLS=C:\PACE\EdenTools
   ```

2. **CI/CDパイプライン**
   - GitHub ActionsやAzure DevOpsで署名を自動化
   - iLok USBの代わりにクラウドベースの署名サービスを検討

3. **バッチ署名**
   - 複数のフォーマット（VST3、AAX）を一度に署名
   - バージョン管理と署名履歴の記録

## 重要な注意事項

- **署名には時間がかかる**: 初回は特に時間がかかることがある（5-10分）
- **インターネット接続必須**: 署名プロセス中はオンラインである必要がある
- **iLok USBは安全に保管**: 紛失すると証明書の再発行が必要
- **テスト署名と本番署名を分離**: 開発用と配布用で異なるWRAP GUIDを使用することを推奨

## 参考リンク

- [PACE Central Web](https://pc2.paceap.com/) — iLok License Manager アプリからログインして遷移する必要あり
- [Avid AAX Developer](https://developer.avid.com/aax/)
- [iLok License Manager](https://www.ilok.com)
- [AAX SDK Documentation](http://developer.avid.com/aax/documentation)