# ZeroComp Version Update Script
# Updates version across all project files

param(
    [Parameter(Mandatory=$true)]
    [string]$NewVersion
)

$ErrorActionPreference = "Stop"

# Validate version format
if ($NewVersion -notmatch "^\d+\.\d+\.\d+(-\w+)?$") {
    Write-Host "Error: Invalid version format. Use X.Y.Z or X.Y.Z-suffix" -ForegroundColor Red
    Write-Host "Example: 3.0.0 or 3.0.0-beta1" -ForegroundColor Gray
    exit 1
}

$RootDir = "D:\Synching\code\JUCE\ZeroComp"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "   Updating ZeroComp version to $NewVersion" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# 1. Update VERSION file
Write-Host "► Updating VERSION file..." -ForegroundColor Yellow
$NewVersion | Out-File -FilePath "$RootDir\VERSION" -NoNewline -Encoding UTF8
Write-Host "✓ VERSION file updated" -ForegroundColor Green

# 2. Update package.json
Write-Host "► Updating package.json..." -ForegroundColor Yellow
$PackageJsonPath = "$RootDir\webui\package.json"
if (Test-Path $PackageJsonPath) {
    $PackageJson = Get-Content $PackageJsonPath -Raw | ConvertFrom-Json
    
    # Extract base version without suffix for package.json
    $BaseVersion = $NewVersion -replace "-.*$", ""
    $PackageJson.version = $BaseVersion
    
    $PackageJson | ConvertTo-Json -Depth 10 | Set-Content $PackageJsonPath -Encoding UTF8
    Write-Host "✓ package.json updated to $BaseVersion" -ForegroundColor Green
} else {
    Write-Host "⚠ package.json not found" -ForegroundColor Yellow
}

# 3. Update PluginEditor.cpp
Write-Host "► Updating PluginEditor.cpp..." -ForegroundColor Yellow
$PluginEditorPath = "$RootDir\plugin\src\PluginEditor.cpp"
if (Test-Path $PluginEditorPath) {
    $Content = Get-Content $PluginEditorPath -Raw
    $Content = $Content -replace '\.withInitialisationData\("pluginVersion", "[^"]+"\)', ".withInitialisationData(`"pluginVersion`", `"$NewVersion`")"
    $Content | Set-Content $PluginEditorPath -NoNewline -Encoding UTF8
    Write-Host "✓ PluginEditor.cpp updated" -ForegroundColor Green
} else {
    Write-Host "⚠ PluginEditor.cpp not found" -ForegroundColor Yellow
}

# 4. Update build scripts
$ScriptsToUpdate = @(
    "$RootDir\scripts\build_windows_release.ps1",
    "$RootDir\scripts\build_complete_release.bat",
    "$RootDir\scripts\package_release.ps1"
)

foreach ($Script in $ScriptsToUpdate) {
    if (Test-Path $Script) {
        $ScriptName = Split-Path $Script -Leaf
        Write-Host "► Updating $ScriptName..." -ForegroundColor Yellow
        
        $Content = Get-Content $Script -Raw
        
        # Update version patterns
        $Content = $Content -replace 'Version\s*=\s*"[^"]+"\s*,', "Version = `"$NewVersion`","
        $Content = $Content -replace '\$Version\s*=\s*"[^"]+"', "`$Version = `"$NewVersion`""
        $Content = $Content -replace 'set VERSION=[^\r\n]+', "set VERSION=$NewVersion"
        
        $Content | Set-Content $Script -NoNewline -Encoding UTF8
        Write-Host "✓ $ScriptName updated" -ForegroundColor Green
    }
}

# 5. Update documentation
Write-Host "► Updating documentation..." -ForegroundColor Yellow
$DocsToUpdate = @(
    "$RootDir\docs\BETA_DISTRIBUTION_GUIDE.md"
)

foreach ($Doc in $DocsToUpdate) {
    if (Test-Path $Doc) {
        $DocName = Split-Path $Doc -Leaf
        $Content = Get-Content $Doc -Raw
        
        # Update version references in docs
        $OldVersionPattern = '\d+\.\d+\.\d+(-\w+)?'
        $Content = $Content -replace "Version: $OldVersionPattern", "Version: $NewVersion"
        $Content = $Content -replace "v$OldVersionPattern", "v$NewVersion"
        $Content = $Content -replace "_${OldVersionPattern}_", "_${NewVersion}_"
        
        $Content | Set-Content $Doc -NoNewline -Encoding UTF8
        Write-Host "✓ $DocName updated" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "   Version updated successfully!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "New version: $NewVersion" -ForegroundColor White
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Rebuild CMake configuration:" -ForegroundColor Gray
Write-Host "   cd build && cmake .." -ForegroundColor Gray
Write-Host "2. Rebuild the project" -ForegroundColor Gray
Write-Host "3. Commit the version change:" -ForegroundColor Gray
Write-Host "   git add -A && git commit -m `"Bump version to $NewVersion`"" -ForegroundColor Gray
Write-Host "4. Create a git tag:" -ForegroundColor Gray
Write-Host "   git tag v$NewVersion" -ForegroundColor Gray
Write-Host ""