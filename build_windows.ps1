# ZeroComp Windows Release Build Script
# PowerShell script for building production release with embedded WebUI

param(
    [string]$Configuration = "Release"
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

# Check if node_modules exists
if (-not (Test-Path "node_modules")) {
    Write-Step "Installing npm dependencies..."
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to install npm dependencies"
        exit 1
    }
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
        
        if (Test-Path $WrapToolPath) {
            # Check for PFX certificate in multiple locations
            $PfxCandidates = @(
                $env:PACE_PFX_PATH,                    # Environment variable path
                "$RootDir\zerocomp-dev.pfx",         # Project root
                "$env:USERPROFILE\.zerocomp\dev.pfx", # User home directory
                ".\certificates\zerocomp-dev.pfx"    # Certificates folder
            )
            
            $PfxPath = $null
            foreach ($candidate in $PfxCandidates) {
                if ($candidate -and (Test-Path $candidate)) {
                    $PfxPath = $candidate
                    Write-Host "  PFX certificate found at: $PfxPath" -ForegroundColor Green
                    break
                }
            }
            
            if (-not $PfxPath) {
                Write-Host "Warning: PFX certificate file not found in any of the following locations:" -ForegroundColor Yellow
                foreach ($candidate in $PfxCandidates) {
                    if ($candidate) {
                        Write-Host "  - $candidate" -ForegroundColor Gray
                    }
                }
                Write-Host "AAX plugin will remain unsigned." -ForegroundColor Yellow
                Write-Host "To enable signing, set PACE_PFX_PATH environment variable or place certificate in project root." -ForegroundColor Yellow
                $AAXSigningStatus = "certificate_missing"
            } else {
                
                # Check if PACE signing credentials are available
                $SkipAAXSigning = $false
                $RequiredEnvVars = @("PACE_USERNAME", "PACE_PASSWORD", "PACE_ORGANIZATION", "PACE_KEYPASSWORD")
                $MissingVars = @()
                
                foreach ($var in $RequiredEnvVars) {
                    if (-not (Get-Item "env:$var" -ErrorAction SilentlyContinue)) {
                        $MissingVars += $var
                    }
                }
                
                if ($MissingVars.Count -gt 0) {
                    Write-Warning "The following environment variables are not set: $($MissingVars -join ', ')"
                    Write-Host "Skipping AAX signing. Unsigned plugin will be generated." -ForegroundColor Yellow
                    $SkipAAXSigning = $true
                    $AAXSigningStatus = "credentials_missing"
                } else {
                    Write-Host "PACE signing information detected. Executing AAX signing." -ForegroundColor Green
                }
                
                if (-not $SkipAAXSigning) {
                    # Sign in place (input and output must be the same for wraptool)
                    # Run signing command with better error capture (signing in place)
                    $SigningArgs = @(
                        "sign",
                        "--verbose",
                        "--account", $env:PACE_USERNAME,
                        "--password", $env:PACE_PASSWORD,
                        "--wcguid", $env:PACE_ORGANIZATION,
                        "--keyfile", $PfxPath,
                        "--keypassword", $env:PACE_KEYPASSWORD,
                        "--in", $DestAAX,
                        "--out", $DestAAX  # Output must be same as input for AAX signing
                        # Note: Do not autoinstall to system from wraptool to avoid duplicate installs
                    )
                    
                    Write-Host "  Running PACE wraptool with arguments:" -ForegroundColor Gray
                    Write-Host "    $($SigningArgs -join ' ')" -ForegroundColor Gray
                    
                    # Capture output for better error reporting
                    $SigningOutput = & $WrapToolPath $SigningArgs 2>&1
                    $SigningExitCode = $LASTEXITCODE
                    
                    # Display signing output
                    $SigningOutput | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }
                    
                    if ($SigningExitCode -eq 0) {
                        Write-Success "AAX plugin signed successfully (in place)"
                        $AAXSignedSuccessfully = $true
                        $AAXSigningStatus = "signed"
                    } else {
                        Write-Host "Warning: AAX signing failed with exit code: $SigningExitCode" -ForegroundColor Yellow
                        Write-Host "Common error codes:" -ForegroundColor Yellow
                        Write-Host "  1 = Invalid arguments or syntax error" -ForegroundColor Yellow
                        Write-Host "  2 = File not found or access denied" -ForegroundColor Yellow
                        Write-Host "  3 = Certificate error (invalid PFX or password)" -ForegroundColor Yellow
                        Write-Host "  4 = Network/server authentication error" -ForegroundColor Yellow
                        Write-Host "  5 = Wrap configuration error" -ForegroundColor Yellow
                        Write-Host "Keeping unsigned version." -ForegroundColor Yellow
                        $AAXSigningStatus = "signing_failed"
                    }
                } else {
                    Write-Host "AAX signing skipped. Unsigned plugin will be generated." -ForegroundColor Yellow
                    if ($AAXSigningStatus -eq "unsigned_developer") {
                        $AAXSigningStatus = "signing_skipped"
                    }
                }
            }
        } else {
            Write-Host "Warning: PACE Eden wraptool not found. AAX plugin will remain unsigned." -ForegroundColor Yellow
            Write-Host "Expected path: $WrapToolPath" -ForegroundColor Yellow
            $AAXSigningStatus = "wraptool_missing"
        }
    } else {
        Write-Error "AAX build output not found at: $SourceAAX"
        exit 1
    }
}

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

"@

if ($BuildAAX) {
    $ReadmeContent += @"

4. For AAX Plugin (Pro Tools):
   Copy the entire ZeroComp.aaxplugin folder to the following location:
   C:\Program Files\Common Files\Avid\Audio\Plug-Ins\

"@
}

$ReadmeContent += @"

5. If Windows Defender SmartScreen appears:
   Click "More info"
   Then click "Run anyway"

6. Launch your DAW and rescan for plugins.
"@

$ReadmeContent | Out-File -FilePath "$OutputDir\Windows\ReadMe.txt" -Encoding UTF8
Write-Success "Documentation created"

# Create version.json
Write-Step "Creating version information..."
# Build formats list
$formats = @("VST3", "Standalone")
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
    $ZipName = "ZeroComp_${Version}_Windows_VST3_AAX_Standalone.zip"
} else {
    $ZipName = "ZeroComp_${Version}_Windows_VST3_Standalone.zip"
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
if ($BuildAAX) {
    Write-Host "[✓] ZeroComp.aaxplugin ($AAXSigningStatusSummary)" -ForegroundColor Green
}
Write-Host "[✓] Installation instructions" -ForegroundColor Green
Write-Host "[✓] Version information" -ForegroundColor Green
Write-Host ""
Write-Host "Distribution checklist:" -ForegroundColor Cyan
Write-Host "[✓] WebUI built and embedded" -ForegroundColor Green
if ($BuildAAX) {
    Write-Host "[✓] VST3, Standalone, and AAX compiled in $Configuration mode" -ForegroundColor Green
} else {
    Write-Host "[✓] VST3 and Standalone compiled in $Configuration mode" -ForegroundColor Green
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