@echo off
setlocal
cd /d "%~dp0"
powershell.exe -ExecutionPolicy Bypass -File "%~dp0install-context7-mcp.ps1" %*
set "EXITCODE=%ERRORLEVEL%"
echo.
if not "%EXITCODE%"=="0" (
  echo Context7 install failed with exit code %EXITCODE%.
) else (
  echo Completed successfully. Press any key to close.
)
pause >nul
endlocal
exit /b %EXITCODE%
