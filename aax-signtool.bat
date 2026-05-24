@echo off
rem PACE wraptool --signtool wrapper: Authenticode-sign the wrapped AAX binary
rem with the Azure Key Vault certificate via azuresigntool. Code-signing keys
rem are non-exportable (CA/B 2023-06), so no .pfx and no wraptool --keyfile.
rem wraptool calls:  <this> sign /sha1 "<id>" /t <url>  "<file>"
rem We take only the LAST arg (the file) and hand it to azuresigntool. This runs
rem as the final step of the wrap flow, so it does NOT cause a post-wrap
rem HashMismatch. Config via env: CODESIGN_KVU / CODESIGN_KVC / CODESIGN_TR /
rem CODESIGN_AZURESIGNTOOL, plus Azure auth AZURE_CLIENT_ID/TENANT_ID/SECRET.
rem Keep this file ASCII-only (cmd mis-parses non-ASCII under CP932 etc.).
setlocal
:findlast
set "FILE=%~1"
shift
if not "%~1"=="" goto findlast
if not defined FILE ( echo aax-signtool: ERROR: no file argument & exit /b 1 )
set "AST=%CODESIGN_AZURESIGNTOOL%"
if not defined AST set "AST=azuresigntool"
if not defined CODESIGN_KVU ( echo aax-signtool: ERROR: CODESIGN_KVU not set & exit /b 1 )
if not defined CODESIGN_KVC ( echo aax-signtool: ERROR: CODESIGN_KVC not set & exit /b 1 )
if not defined CODESIGN_TR set "CODESIGN_TR=http://timestamp.digicert.com"
echo aax-signtool: signing "%FILE%" via Azure Key Vault (%CODESIGN_KVC%)
"%AST%" sign -kvu "%CODESIGN_KVU%" -kvc "%CODESIGN_KVC%" -kvm -tr "%CODESIGN_TR%" -td sha256 -fd sha256 "%FILE%"
exit /b %ERRORLEVEL%