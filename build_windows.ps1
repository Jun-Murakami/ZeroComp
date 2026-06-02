# ZeroComp Windows Release Build Script
# PowerShell script for building production release with embedded WebUI

param(
    [string]$Configuration = "Release",
    [switch]$SkipCodeSign
)

# Read version from VERSION file
$ScriptDir = $PSScriptRoot
if (-not $ScriptDir) { $ScriptDir = (Get-Location).Path }
$RootDir = $ScriptDir  # Script is now in root
$VersionFile = "$RootDir\VERSION"

if (Test-Path $VersionFile) {
    $Version = Get-Content $VersionFile -Raw
    $Version = $Version.Trim()
} else {
    Write-Error "VERSION file not found at: $VersionFile"
    exit 1
}

# Set error action preference
$ErrorActionPreference = "Stop"

# Define colors for output
function Write-Header {
    param([string]$Text)
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host "   $Text" -ForegroundColor Cyan
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Step {
    param([string]$Text)
    Write-Host "► $Text" -ForegroundColor Yellow
}

function Write-Success {
    param([string]$Text)
    Write-Host "✓ $Text" -ForegroundColor Green
}

function Write-Error {
    param([string]$Text)
    Write-Host "✗ $Text" -ForegroundColor Red
}

# Start build process
Write-Header "ZeroComp $Version Build Script"

# Load .env file if present (KEY=VALUE format, one per line)
$EnvFilePath = "$RootDir\.env"
if (Test-Path $EnvFilePath) {
    Write-Host "Loading environment variables from .env ..." -ForegroundColor Gray
    Get-Content $EnvFilePath | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#")) {
            $eqIdx = $line.IndexOf("=")
            if ($eqIdx -gt 0) {
                $key   = $line.Substring(0, $eqIdx).Trim()
                $value = $line.Substring($eqIdx + 1).Trim().Trim('"').Trim("'")
                if (-not (Get-Item "env:$key" -ErrorAction SilentlyContinue)) {
                    [Environment]::SetEnvironmentVariable($key, $value, "Process")
                }
            }
        }
    }
}

# ----------------------------------------------------------------------------
# Windows Authenticode code signing (Azure Key Vault via azuresigntool)
# ----------------------------------------------------------------------------
# Signs distributable PE files (VST3 DLL / Standalone exe / Inno Setup installer)
# with the Azure Key Vault certificate. Auth uses -kvm (DefaultAzureCredential):
# AZURE_CLIENT_ID / AZURE_TENANT_ID / AZURE_CLIENT_SECRET (User env or .env), or
# an az login session. No secrets are stored here. AAX is signed by PACE wraptool
# (Step 3) since it cannot be re-signed afterwards without breaking the wrap.
$AzureKeyVaultUrl = if ($env:AZURE_KEYVAULT_URL) { $env:AZURE_KEYVAULT_URL } else { 'https://jun-codesign-kv.vault.azure.net/' }
$AzureCertName    = if ($env:AZURE_CERT_NAME)    { $env:AZURE_CERT_NAME }    else { 'jun-codesigning-2026' }
$TimestampUrl     = if ($env:CODESIGN_TIMESTAMP_URL) { $env:CODESIGN_TIMESTAMP_URL } else { 'http://timestamp.digicert.com' }
$CodeSigningStatus = "unsigned"

function Invoke-AuthenticodeSign {
    param([Parameter(Mandatory = $true)][string[]]$Paths)

    if ($SkipCodeSign) {
        Write-Host "Code signing skipped (-SkipCodeSign)" -ForegroundColor Yellow
        $script:CodeSigningStatus = "skipped"
        return $false
    }

    $existing = @($Paths | Where-Object { $_ -and (Test-Path $_) })
    if ($existing.Count -eq 0) {
        Write-Host "Code signing: no target files found" -ForegroundColor Yellow
        return $false
    }

    if (-not (Get-Command azuresigntool -ErrorAction SilentlyContinue)) {
        Write-Host "Warning: azuresigntool not found on PATH - skipping code signing" -ForegroundColor Yellow
        Write-Host "  Install with: dotnet tool install --global AzureSignTool" -ForegroundColor Gray
        $script:CodeSigningStatus = "tool_missing"
        return $false
    }

    foreach ($f in $existing) { Write-Step "Signing: $f" }

    $signArgs = @(
        "sign",
        "-kvu", $AzureKeyVaultUrl,
        "-kvc", $AzureCertName,
        "-kvm",
        "-tr", $TimestampUrl,
        "-td", "sha256",
        "-fd", "sha256"
    ) + $existing

    & azuresigntool @signArgs
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Code signing succeeded ($($existing.Count) file(s))"
        $script:CodeSigningStatus = "signed"
        return $true
    } else {
        Write-Host "Warning: code signing failed (exit $LASTEXITCODE)" -ForegroundColor Yellow
        $script:CodeSigningStatus = "signing_failed"
        return $false
    }
}

# Get build date
$BuildDate = Get-Date -Format "yyyy-MM-dd"

# Directory settings (use script directory as root)
$RootDir = $ScriptDir
$WebUIDir = "$RootDir\webui"
$BuildDir = "$RootDir\build"
$OutputDir = "$RootDir\releases\$Version"
$AAXSDKPath = "$RootDir\aax-sdk"

# Check for AAX SDK
Write-Step "Checking AAX SDK..."
if (Test-Path "$AAXSDKPath\Interfaces\AAX.h") {
    Write-Success "AAX SDK found - AAX will be built"
    $BuildAAX = $true
    
    # Build AAX Library if not already built or if it's outdated
    Write-Step "Building AAX Library..."
    $AAXLibraryPath = "$AAXSDKPath\Libs\Release\AAXLibrary.lib"
    $AAXLibraryBuildDir = "$AAXSDKPath\Libs\AAXLibrary\build"
    
    # Always rebuild AAX library to ensure it matches current configuration
    if (Test-Path $AAXLibraryBuildDir) {
        Write-Host "  Cleaning previous AAX Library build..." -ForegroundColor Gray
        Remove-Item -Path $AAXLibraryBuildDir -Recurse -Force
    }
    
    New-Item -ItemType Directory -Force -Path $AAXLibraryBuildDir | Out-Null
    Set-Location $AAXLibraryBuildDir
    
    Write-Host "  Configuring AAX Library with CMake..." -ForegroundColor Gray
    cmake .. -G "Visual Studio 17 2022" -A x64 -DCMAKE_BUILD_TYPE=Release
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to configure AAX Library"
        exit 1
    }
    
    Write-Host "  Building AAX Library (Release)..." -ForegroundColor Gray
    cmake --build . --config Release --parallel 8
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to build AAX Library"
        exit 1
    }
    
    # Copy library to expected location
    $BuiltLibPath = "$AAXLibraryBuildDir\Release\AAXLibrary.lib"
    if (Test-Path $BuiltLibPath) {
        New-Item -ItemType Directory -Force -Path "$AAXSDKPath\Libs\Release" | Out-Null
        Copy-Item -Path $BuiltLibPath -Destination $AAXLibraryPath -Force
        Write-Success "AAX Library built successfully"
    } else {
        Write-Error "AAX Library build output not found"
        exit 1
    }
    
    Set-Location $RootDir
} else {
    Write-Host "AAX SDK not found at: $AAXSDKPath - AAX will be skipped" -ForegroundColor Yellow
    $BuildAAX = $false
}

# Create output directories
Write-Step "Creating output directories..."
New-Item -ItemType Directory -Force -Path "$OutputDir\Windows" | Out-Null
Write-Success "Output directories created"

# Step 1: Build WebUI for production
Write-Header "Step 1: Building WebUI for production"

# Clean up previous build output
$UIPublicDir = "$RootDir\plugin\ui\public"
if (Test-Path $UIPublicDir) {
    Write-Step "Cleaning previous WebUI build..."
    Remove-Item -Path $UIPublicDir -Recurse -Force
    Write-Success "Previous build cleaned"
}

Set-Location $WebUIDir

# Install/refresh npm dependencies on every build so it is never skipped.
# (Source tree is Syncthing-synced across platforms, so node_modules may be
#  stale or missing; npm install — not ci — tolerates lockfile/platform drift.)
Write-Step "Installing npm dependencies..."
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to install npm dependencies"
    exit 1
}

# Build WebUI
Write-Step "Building WebUI..."
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Error "WebUI build failed"
    exit 1
}

Write-Success "WebUI built successfully"
Write-Host "Output: $RootDir\plugin\ui\public" -ForegroundColor Gray

# Verify WebUI build output
if (-not (Test-Path "$RootDir\plugin\ui\public\index.html")) {
    Write-Error "WebUI build output not found!"
    exit 1
}

# Step 2: Build VST3, Standalone, and AAX (if SDK available) with embedded WebUI
if ($BuildAAX) {
    Write-Header "Step 2: Building VST3, Standalone, and AAX"
} else {
    Write-Header "Step 2: Building VST3 and Standalone"
}

Set-Location $BuildDir

# Configure CMake for Release build
Write-Step "Configuring CMake for $Configuration build..."
cmake -DCMAKE_BUILD_TYPE=$Configuration ..
if ($LASTEXITCODE -ne 0) {
    Write-Error "CMake configuration failed"
    exit 1
}

# Build VST3
Write-Step "Building VST3 plugin..."
cmake --build . --config $Configuration --target ZeroComp_VST3
if ($LASTEXITCODE -ne 0) {
    Write-Error "VST3 build failed"
    exit 1
}

Write-Success "VST3 built successfully"

# Build Standalone
Write-Step "Building Standalone application..."
cmake --build . --config $Configuration --target ZeroComp_Standalone
if ($LASTEXITCODE -ne 0) {
    Write-Error "Standalone build failed"
    exit 1
}

Write-Success "Standalone built successfully"

# Build CLAP
Write-Step "Building CLAP plugin..."
cmake --build . --config $Configuration --target ZeroComp_CLAP
if ($LASTEXITCODE -ne 0) {
    Write-Error "CLAP build failed"
    exit 1
}
Write-Success "CLAP built successfully"

# Build AAX if SDK is available
if ($BuildAAX) {
    Write-Step "Building AAX plugin..."
    cmake --build . --config $Configuration --target ZeroComp_AAX
    if ($LASTEXITCODE -ne 0) {
        Write-Error "AAX build failed"
        exit 1
    }
    Write-Success "AAX built successfully"
}

# Step 3: Packaging for distribution
Write-Header "Step 3: Packaging for distribution"

# Copy VST3 files
Write-Step "Copying VST3 files..."
$SourceVST3 = "$BuildDir\plugin\ZeroComp_artefacts\$Configuration\VST3\ZeroComp.vst3"
$DestVST3 = "$OutputDir\Windows\ZeroComp.vst3"

if (Test-Path $SourceVST3) {
    # 既存の VST3 バンドルがある場合は削除してからコピーする。
    # PowerShell の Copy-Item は、宛先フォルダが既に存在すると
    # SourceDir を DestDir\(SourceDir名) として入れ子にしてしまうため、
    # 二重フォルダ生成を避ける。
    if (Test-Path $DestVST3) {
        Remove-Item -Path $DestVST3 -Recurse -Force
    }
    Copy-Item -Path $SourceVST3 -Destination $DestVST3 -Recurse -Force
    Write-Success "VST3 copied successfully"
} else {
    Write-Error "VST3 build output not found at: $SourceVST3"
    exit 1
}

# Copy Standalone files
Write-Step "Copying Standalone files..."
$SourceStandalone = "$BuildDir\plugin\ZeroComp_artefacts\$Configuration\Standalone\ZeroComp.exe"
$DestStandalone = "$OutputDir\Windows\ZeroComp.exe"

if (Test-Path $SourceStandalone) {
    # 既存の EXE がある場合は削除してからコピーする（上書き時のロック/属性問題回避）。
    if (Test-Path $DestStandalone) {
        Remove-Item -Path $DestStandalone -Force
    }
    Copy-Item -Path $SourceStandalone -Destination $DestStandalone -Force
    Write-Success "Standalone copied successfully"
} else {
    Write-Error "Standalone build output not found at: $SourceStandalone"
    exit 1
}

# Copy CLAP files
# CLAP は単一ファイル（.clap = DLL に拡張子を付けたもの）。Authenticode 署名は Step 3.5 で実施。
Write-Step "Copying CLAP files..."
$SourceCLAP = "$BuildDir\plugin\ZeroComp_artefacts\$Configuration\CLAP\ZeroComp.clap"
$DestCLAP = "$OutputDir\Windows\ZeroComp.clap"

if (Test-Path $SourceCLAP) {
    if (Test-Path $DestCLAP) {
        Remove-Item -Path $DestCLAP -Force
    }
    Copy-Item -Path $SourceCLAP -Destination $DestCLAP -Force
    Write-Success "CLAP copied successfully"
} else {
    Write-Error "CLAP build output not found at: $SourceCLAP"
    exit 1
}

# Copy and Sign AAX files if built
$AAXSignedSuccessfully = $false
$AAXSigningStatus = "unsigned_developer"

if ($BuildAAX) {
    Write-Step "Processing AAX plugin..."
    $SourceAAX = "$BuildDir\plugin\ZeroComp_artefacts\$Configuration\AAX\ZeroComp.aaxplugin"
    $DestAAX = "$OutputDir\Windows\ZeroComp.aaxplugin"
    
    if (Test-Path $SourceAAX) {
        # 既存の AAX バンドルがある場合は削除してからコピーする。
        # これを行わないと、Copy-Item が入れ子の
        # ZeroComp.aaxplugin\ZeroComp.aaxplugin\... を作ってしまう。
        if (Test-Path $DestAAX) {
            Remove-Item -Path $DestAAX -Recurse -Force
        }
        # まず宛先ディレクトリを作成し、"中身のみ" をコピーする（フォルダごとでなく、ネスト回避）。
        New-Item -ItemType Directory -Force -Path $DestAAX | Out-Null
        Copy-Item -Path (Join-Path $SourceAAX '*') -Destination $DestAAX -Recurse -Force
        Write-Success "AAX copied successfully (unsigned)"

        # AAX バンドルの中身が空でないかを検証（少なくとも本体バイナリが存在するか）
        $AAXBinary = Join-Path $DestAAX "Contents\x64\ZeroComp.aaxplugin"
        if (-not (Test-Path $AAXBinary)) {
            Write-Host "Warning: AAX bundle binary not found at: $AAXBinary" -ForegroundColor Yellow
            Write-Host "Attempting to re-copy from build artefacts..." -ForegroundColor Yellow

            # 再コピー前に確実に削除
            if (Test-Path $DestAAX) {
                Remove-Item -Path $DestAAX -Recurse -Force
            }
            Copy-Item -Path $SourceAAX -Destination $DestAAX -Recurse -Force

            if (-not (Test-Path $AAXBinary)) {
                Write-Error "AAX bundle appears empty after copy. Source may be invalid: $SourceAAX"
                exit 1
            }
        }
        
        # Sign AAX plugin
        Write-Step "Signing AAX plugin with PACE Eden tools..."
        $WrapToolPath = "C:\Program Files (x86)\PACEAntiPiracy\Eden\Fusion\Versions\5\wraptool.exe"

        if (-not (Test-Path $WrapToolPath)) {
            Write-Host "Warning: PACE Eden wraptool not found. AAX plugin will remain unsigned." -ForegroundColor Yellow
            Write-Host "Expected path: $WrapToolPath" -ForegroundColor Yellow
            $AAXSigningStatus = "wraptool_missing"
        } else {
            $PaceVars = @("PACE_USERNAME", "PACE_PASSWORD", "PACE_ORGANIZATION")
            $MissingVars = @($PaceVars | Where-Object { -not (Get-Item "env:$_" -ErrorAction SilentlyContinue) })
            if ($MissingVars.Count -gt 0) {
                Write-Warning "Missing PACE env vars: $($MissingVars -join ', ')"
                $AAXSigningStatus = "credentials_missing"
            } else {
                # --signtool path requires PACE_FUSION_HOME (= wraptool.exe directory).
                $env:PACE_FUSION_HOME = Split-Path $WrapToolPath -Parent

                # Authenticode-sign with the Azure KV certificate via azuresigntool.
                # Code-signing keys are non-exportable (CA/B 2023-06), so there is no
                # .pfx and wraptool's --keyfile cannot be used. Instead --signtool
                # points at aax-signtool.bat which runs azuresigntool as the final
                # step of the wrap flow (re-signing after wrap would HashMismatch).
                $AaxWrapper = "$RootDir\aax-signtool.bat"
                $HaveAst = [bool](Get-Command azuresigntool -ErrorAction SilentlyContinue)
                $SigningArgs = $null
                $SignMethod = ""
                if (-not $SkipCodeSign -and $HaveAst -and (Test-Path $AaxWrapper)) {
                    $env:CODESIGN_KVU = $AzureKeyVaultUrl
                    $env:CODESIGN_KVC = $AzureCertName
                    $env:CODESIGN_TR  = $TimestampUrl
                    $env:CODESIGN_AZURESIGNTOOL = (Get-Command azuresigntool).Source
                    $SigningArgs = @(
                        "sign", "--verbose", "--installedbinaries",
                        "--signtool", $AaxWrapper, "--signid", "1",
                        "--account",  $env:PACE_USERNAME,
                        "--password", $env:PACE_PASSWORD,
                        "--wcguid",   $env:PACE_ORGANIZATION,
                        "--in",  $DestAAX,
                        "--out", $DestAAX
                    )
                    $SignMethod = "Azure Key Vault ($AzureCertName)"
                } else {
                    # Fallback: dev pfx (Pro Tools works, Authenticode root NOT trusted).
                    # Used with -SkipCodeSign or when azuresigntool / wrapper is absent.
                    $DevPfxName = ([IO.Path]::GetFileNameWithoutExtension($DestVST3)).ToLower() + "-dev.pfx"
                    $PfxCandidates = @($env:PACE_PFX_PATH, "$RootDir\$DevPfxName")
                    $PfxPath = $null
                    foreach ($candidate in $PfxCandidates) { if ($candidate -and (Test-Path $candidate)) { $PfxPath = $candidate; break } }
                    if (-not $PfxPath -or -not (Get-Item "env:PACE_KEYPASSWORD" -ErrorAction SilentlyContinue)) {
                        Write-Host "Warning: Azure signing unavailable and no usable dev pfx/PACE_KEYPASSWORD - AAX left unsigned" -ForegroundColor Yellow
                        $AAXSigningStatus = "certificate_missing"
                    } else {
                        $SigningArgs = @(
                            "sign", "--verbose",
                            "--account",  $env:PACE_USERNAME,
                            "--password", $env:PACE_PASSWORD,
                            "--wcguid",   $env:PACE_ORGANIZATION,
                            "--keyfile",  $PfxPath,
                            "--keypassword", $env:PACE_KEYPASSWORD,
                            "--in",  $DestAAX,
                            "--out", $DestAAX
                        )
                        $SignMethod = "dev pfx ($([IO.Path]::GetFileName($PfxPath)))"
                    }
                }

                if ($SigningArgs) {
                    Write-Host "  AAX signing method: $SignMethod" -ForegroundColor Gray
                    $SigningOutput = & $WrapToolPath $SigningArgs 2>&1
                    $SigningExitCode = $LASTEXITCODE
                    $SigningOutput | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }
                    if ($SigningExitCode -eq 0) {
                        Write-Success "AAX plugin signed successfully ($SignMethod)"
                        $AAXSignedSuccessfully = $true
                        $AAXSigningStatus = if ($SignMethod -like 'Azure*') { "signed_kv" } else { "signed_devcert" }
                    } else {
                        Write-Host "Warning: AAX signing failed with exit code: $SigningExitCode" -ForegroundColor Yellow
                        $AAXSigningStatus = "signing_failed"
                    }
                }
            }
        }
    } else {
        Write-Error "AAX build output not found at: $SourceAAX"
        exit 1
    }
}

# ----------------------------------------------------------------------------
# Step 3.5: Authenticode signing (VST3 DLL + Standalone exe)
# ----------------------------------------------------------------------------
# Sign before ZIP/installer so distributables embed signed binaries. AAX is
# handled by PACE wraptool in Step 3 (not signed here - re-signing a wrapped
# binary externally would HashMismatch).
Write-Header "Step 3.5: Signing Windows binaries (Authenticode)"
$Vst3InnerPE = Join-Path $DestVST3 ("Contents\x86_64-win\" + [IO.Path]::GetFileNameWithoutExtension($DestVST3) + ".vst3")
# CLAP は実体が DLL (PE) なので Authenticode 署名対象に含める。
Invoke-AuthenticodeSign -Paths @($Vst3InnerPE, $DestStandalone, $DestCLAP) | Out-Null

# Create README
Write-Step "Creating documentation..."
$ReadmeContent = @"
ZeroComp $Version - Windows Installation Guide
====================================================

Important: Required Software
-------------------
This plugin requires the Microsoft Visual C++ 2019 Redistributable Package.
If the plugin fails to load, please download and install it from the following link:
https://aka.ms/vs/17/release/vc_redist.x64.exe

Installation Steps
-------------------
1. Close your DAW before proceeding.

2. For VST3 Plugin:
   Copy the entire ZeroComp.vst3 folder to the following location:
   C:\Program Files\Common Files\VST3\

3. For Standalone Application:
   Copy ZeroComp.exe to any preferred location, for example:
   C:\Program Files\ZeroComp\ or your Desktop.

4. For CLAP Plugin:
   Copy ZeroComp.clap to the following location:
   C:\Program Files\Common Files\CLAP\

"@

if ($BuildAAX) {
    $ReadmeContent += @"

5. For AAX Plugin (Pro Tools):
   Copy the entire ZeroComp.aaxplugin folder to the following location:
   C:\Program Files\Common Files\Avid\Audio\Plug-Ins\

"@
}

$ReadmeContent += @"

6. If Windows Defender SmartScreen appears:
   Click "More info"
   Then click "Run anyway"

7. Launch your DAW and rescan for plugins.
"@

$ReadmeContent | Out-File -FilePath "$OutputDir\Windows\ReadMe.txt" -Encoding UTF8
Write-Success "Documentation created"

# Create version.json
Write-Step "Creating version information..."
# Build formats list
$formats = @("VST3", "Standalone", "CLAP")
if ($BuildAAX) {
    $formats += "AAX"
}

$VersionInfo = @{
    name = "ZeroComp"
    version = $Version
    build_date = $BuildDate
    platform = "Windows"
    architecture = "x64"
    formats = $formats
    webui = "embedded"
    build_type = $Configuration
    aax_signing = if ($BuildAAX) { $AAXSigningStatus } else { "N/A" }
    code_signing = $CodeSigningStatus
} | ConvertTo-Json

$VersionInfo | Out-File -FilePath "$OutputDir\Windows\version.json" -Encoding UTF8
Write-Success "Version info created"

# Step 4: Create Installer with Inno Setup
Write-Header "Step 4: Creating installer with Inno Setup"

$InnoSetupPath = "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
if (-not (Test-Path $InnoSetupPath)) {
    # Try alternative path
    $InnoSetupPath = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
}

if (Test-Path $InnoSetupPath) {
    Write-Step "Building installer with Inno Setup..."
    
    # Create installer script with version
    $InstallerScript = "$RootDir\installer.iss"
    if (Test-Path $InstallerScript) {
        # Run Inno Setup compiler
        & $InnoSetupPath /DMyAppVersion="$Version" /Q $InstallerScript
        
        if ($LASTEXITCODE -eq 0) {
            Write-Success "Installer created successfully"
            $InstallerPath = "$OutputDir\ZeroComp_${Version}_Windows_Setup.exe"
            Invoke-AuthenticodeSign -Paths @($InstallerPath) | Out-Null
            if (Test-Path $InstallerPath) {
                $InstallerInfo = Get-Item $InstallerPath
                $InstallerSizeMB = [math]::Round($InstallerInfo.Length / 1MB, 2)
                Write-Host "Installer: $InstallerPath ($InstallerSizeMB MB)" -ForegroundColor Green
            }
        } else {
            Write-Host "Warning: Installer creation failed. Error code: $LASTEXITCODE" -ForegroundColor Yellow
        }
    } else {
        Write-Host "Warning: Installer script not found at: $InstallerScript" -ForegroundColor Yellow
    }
} else {
    Write-Host "Warning: Inno Setup not found. Skipping installer creation." -ForegroundColor Yellow
    Write-Host "Download from: https://jrsoftware.org/isdl.php" -ForegroundColor Yellow
}

# Create ZIP archive (as backup or alternative distribution)
Write-Step "Creating ZIP archive..."
if ($BuildAAX) {
    $ZipName = "ZeroComp_${Version}_Windows_VST3_AAX_CLAP_Standalone.zip"
} else {
    $ZipName = "ZeroComp_${Version}_Windows_VST3_CLAP_Standalone.zip"
}
$ZipPath = "$OutputDir\$ZipName"

# Remove old ZIP if exists
if (Test-Path $ZipPath) {
    Remove-Item $ZipPath -Force
}

# Bundle LICENSE in the distribution ZIP (AGPL-3.0-or-later requires the license to ship with the binary)
if (Test-Path "$RootDir\LICENSE") {
    Copy-Item -Path "$RootDir\LICENSE" -Destination "$OutputDir\Windows\LICENSE.txt" -Force
}

# Create ZIP using Compress-Archive
Compress-Archive -Path "$OutputDir\Windows\*" -DestinationPath $ZipPath -CompressionLevel Optimal
Write-Success "ZIP archive created"

# Get file size
$FileInfo = Get-Item $ZipPath
$SizeMB = [math]::Round($FileInfo.Length / 1MB, 2)

# Final summary
Write-Header "Build completed successfully!"

Write-Host "Package: $ZipPath" -ForegroundColor White
Write-Host "Size: $SizeMB MB" -ForegroundColor White
Write-Host ""
if ($CodeSigningStatus -eq "signed") {
    Write-Host "[OK] VST3 / Standalone / Installer signed via Azure Key Vault" -ForegroundColor Green
} else {
    Write-Host "[!] Authenticode signing status: $CodeSigningStatus" -ForegroundColor Yellow
}
Write-Host ""
if ($BuildAAX) {
    $AAXSigningStatusSummary = switch ($AAXSigningStatus) {
        "signed" { "PACE-signed build" }
        "certificate_missing" { "certificate missing" }
        "credentials_missing" { "missing signing credentials" }
        "signing_failed" { "signing command failed" }
        "wraptool_missing" { "wraptool not installed" }
        "signing_skipped" { "signing skipped manually" }
        Default { "unsigned developer build" }
    }
}
Write-Host "The package includes:" -ForegroundColor Cyan
Write-Host "[✓] ZeroComp.vst3 (with embedded WebUI)" -ForegroundColor Green
Write-Host "[✓] ZeroComp.exe (Standalone application)" -ForegroundColor Green
Write-Host "[✓] ZeroComp.clap (CLAP plugin)" -ForegroundColor Green
if ($BuildAAX) {
    Write-Host "[✓] ZeroComp.aaxplugin ($AAXSigningStatusSummary)" -ForegroundColor Green
}
Write-Host "[✓] Installation instructions" -ForegroundColor Green
Write-Host "[✓] Version information" -ForegroundColor Green
Write-Host ""
Write-Host "Distribution checklist:" -ForegroundColor Cyan
Write-Host "[✓] WebUI built and embedded" -ForegroundColor Green
if ($BuildAAX) {
    Write-Host "[✓] VST3, Standalone, CLAP, and AAX compiled in $Configuration mode" -ForegroundColor Green
} else {
    Write-Host "[✓] VST3, Standalone, and CLAP compiled in $Configuration mode" -ForegroundColor Green
}
if (Test-Path "$OutputDir\ZeroComp_${Version}_Windows_Setup.exe") {
    Write-Host "[✓] Installer created with Inno Setup" -ForegroundColor Green
}
Write-Host "[✓] Installation guide included" -ForegroundColor Green
Write-Host "[✓] Version info included" -ForegroundColor Green
if ($BuildAAX) {
    if ($AAXSignedSuccessfully) {
        Write-Host "[✓] AAX plugin signed with PACE Eden tools" -ForegroundColor Green
    } else {
        Write-Host "[!] AAX plugin NOT signed ($AAXSigningStatusSummary)" -ForegroundColor Yellow
    }
}
Write-Host "[ ] Upload to distribution platform" -ForegroundColor Yellow
Write-Host "[ ] Share link with beta testers" -ForegroundColor Yellow
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan