# AAX Plugin Signing Guide

## Overview
AAX plugin signing is required for Pro Tools compatibility. This document explains the signing process and troubleshooting.

## Prerequisites

1. **PACE Developer Account**
   - Register at https://developer.avid.com
   - Join the AAX Developer program
   - Get your PACE iLok account activated

2. **PACE Eden Tools**
   - Download from PACE Central
   - Install to: `C:\Program Files (x86)\PACEAntiPiracy\Eden\`
   - Version 5.x required

3. **Digital Certificate**
   - Obtain a code signing certificate
   - Export as PFX format with private key
   - Place in: `scripts\zerocomp-dev.pfx`

## Signing Configuration

The build script uses these parameters:
- **Account**: Your PACE account name
- **Password**: Your PACE account password  
- **WCGUID**: Your plugin's unique GUID (registered with PACE)
- **Keyfile**: Path to your PFX certificate
- **Keypassword**: Password for the PFX file

## Error Codes

| Code | Description | Solution |
|------|-------------|----------|
| 1 | Invalid arguments | Check command syntax and paths |
| 2 | File not found | Verify AAX plugin and PFX paths |
| 3 | Certificate error | Check PFX password and validity |
| 4 | Authentication error | Verify PACE credentials and network |
| 5 | Wrap config error | Check WCGUID registration |

## Troubleshooting Error Code 4

This error typically indicates authentication issues:

1. **Check PACE Credentials**
   ```powershell
   # Test authentication separately
   wraptool.exe verify --account YOUR_ACCOUNT --password YOUR_PASSWORD
   ```

2. **Verify Network Access**
   - Ensure firewall allows wraptool.exe
   - Check proxy settings if behind corporate network
   - PACE servers: pace.com ports 443, 8080

3. **Validate WCGUID**
   - Must be registered in your PACE developer account (per-plugin, unique)
   - Format: XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
   - Check at: https://pc2.paceap.com/ (PACE Central Web — must sign in via the iLok License Manager app first; direct browser access is not authorised)

4. **Certificate Issues**
   - Certificate must be valid and not expired
   - Must be a code signing certificate
   - Test with: `certutil -dump scripts\zerocomp-dev.pfx`

## Development vs Production

### Development (Unsigned)
- Use with Pro Tools Developer Edition
- Or hold Shift+Ctrl while starting Pro Tools
- No PACE signing required

### Production (Signed)
- Required for retail Pro Tools
- Must have valid PACE developer account
- Requires annual fee and approval

## Manual Signing

If automated signing fails, try manual signing:

```powershell
cd "C:\Program Files (x86)\PACEAntiPiracy\Eden\Fusion\Versions\5"

.\wraptool.exe sign `
  --verbose `
  --account "your_account" `
  --password "your_password" `
  --wcguid "5C6E4FB0-9F62-11F0-957F-005056928F3B" `
  --keyfile "D:\path\to\your.pfx" `
  --keypassword "pfx_password" `
  --in "path\to\unsigned.aaxplugin" `
  --out "path\to\signed.aaxplugin"
```

## Contact Support

- PACE Support: https://pace.com/support
- Avid Developer: https://developer.avid.com/contact
- Include error logs and wraptool output when reporting issues