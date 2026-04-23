# AAX Plugin Signing Script for Windows
# Usage: .\sign_aax_windows.ps1 -AAXPath "path\to\plugin.aaxplugin"

param(
    [Parameter(Mandatory=$true)]
    [string]$AAXPath,
    
    [string]$OutputPath = "",
    
    [string]$WrapGuid = ""
)

# 色付き出力用の関数
function Write-ColorOutput($ForegroundColor) {
    $fc = $host.UI.RawUI.ForegroundColor
    $host.UI.RawUI.ForegroundColor = $ForegroundColor
    if ($args) {
        Write-Output $args
    }
    $host.UI.RawUI.ForegroundColor = $fc
}

# 環境変数または.envファイルから設定を読み込み
$EnvFile = Join-Path $PSScriptRoot "..\.env.local"
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
        if ($_ -match '^([^=]+)=(.*)$') {
            $key = $matches[1].Trim()
            $value = $matches[2].Trim()
            if (-not (Get-Item -Path "Env:$key" -ErrorAction SilentlyContinue)) {
                [Environment]::SetEnvironmentVariable($key, $value, "Process")
            }
        }
    }
}

# WRAP GUIDの取得
if ([string]::IsNullOrEmpty($WrapGuid)) {
    $WrapGuid = $env:WRAP_GUID
    if ([string]::IsNullOrEmpty($WrapGuid)) {
        Write-Error "WRAP_GUID not provided and not found in environment"
        Write-Host "Please set WRAP_GUID in .env.local or provide it as a parameter"
        exit 1
    }
}

# iLokアカウントの確認
$IlokAccount = $env:ILOK_ACCOUNT
if ([string]::IsNullOrEmpty($IlokAccount)) {
    Write-Error "ILOK_ACCOUNT not found in environment"
    Write-Host "Please set ILOK_ACCOUNT in .env.local"
    exit 1
}

# Eden Toolsのパスを確認
$EdenPath = $env:PACE_EDEN_TOOLS
if (-not $EdenPath) {
    # デフォルトパスを試す
    $DefaultPaths = @(
        "C:\PACE\EdenTools",
        "C:\Program Files\PACE\Eden Tools",
        "C:\Program Files (x86)\PACE\Eden Tools"
    )
    
    foreach ($path in $DefaultPaths) {
        if (Test-Path "$path\bin\wraptool.exe") {
            $EdenPath = $path
            break
        }
    }
    
    if (-not $EdenPath) {
        Write-Error "PACE Eden Tools not found. Please install and set PACE_EDEN_TOOLS environment variable"
        exit 1
    }
}

$WrapTool = "$EdenPath\bin\wraptool.exe"
if (-not (Test-Path $WrapTool)) {
    Write-Error "wraptool.exe not found at: $WrapTool"
    exit 1
}

# AAXプラグインの存在確認
if (-not (Test-Path $AAXPath)) {
    Write-Error "AAX plugin not found at: $AAXPath"
    exit 1
}

# 出力パスの設定
if ([string]::IsNullOrEmpty($OutputPath)) {
    $Dir = [System.IO.Path]::GetDirectoryName($AAXPath)
    $BaseName = [System.IO.Path]::GetFileNameWithoutExtension($AAXPath)
    $OutputPath = Join-Path $Dir "${BaseName}_signed.aaxplugin"
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "    AAX Plugin Signing" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Input:  $AAXPath" -ForegroundColor Gray
Write-Host "Output: $OutputPath" -ForegroundColor Gray
Write-Host "WRAP:   $WrapGuid" -ForegroundColor Gray
Write-Host ""

# 既存の署名済みファイルをバックアップ
if (Test-Path $OutputPath) {
    $BackupPath = "${OutputPath}.backup"
    Write-Host "Backing up existing signed plugin..." -ForegroundColor Yellow
    Move-Item -Path $OutputPath -Destination $BackupPath -Force
}

# 署名実行
Write-Host "Signing AAX plugin..." -ForegroundColor Green
Write-Host "This may take several minutes..." -ForegroundColor Gray

$SignArgs = @(
    "sign",
    "--verbose",
    "--account", $IlokAccount,
    "--wcguid", $WrapGuid,
    "--signid", "Developer",
    "--in", $AAXPath,
    "--out", $OutputPath
)

$Process = Start-Process -FilePath $WrapTool -ArgumentList $SignArgs -PassThru -Wait -NoNewWindow
$ExitCode = $Process.ExitCode

if ($ExitCode -eq 0) {
    Write-Host ""
    Write-Host "✓ Successfully signed AAX plugin!" -ForegroundColor Green
    Write-Host "  Signed plugin: $OutputPath" -ForegroundColor Gray
    
    # 署名の検証
    Write-Host ""
    Write-Host "Verifying signature..." -ForegroundColor Cyan
    & $WrapTool verify --in "$OutputPath"
    
} else {
    Write-Host ""
    Write-Error "Failed to sign AAX plugin. Exit code: $ExitCode"
    
    # バックアップを復元
    if (Test-Path "${OutputPath}.backup") {
        Write-Host "Restoring backup..." -ForegroundColor Yellow
        Move-Item -Path "${OutputPath}.backup" -Destination $OutputPath -Force
    }
    
    exit 1
}

Write-Host ""
Write-Host "Done!" -ForegroundColor Green