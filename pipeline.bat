@echo off
cd /d "%~dp0"
if not exist logs mkdir logs
set LOG=logs\pipeline.log
echo.>> %LOG%
echo ===== %date% %time% =====>> %LOG%
echo [1/2] Trigger WordPress generation and wait for cloud run...>> %LOG%
node triggerGenerate.js >> %LOG% 2>&1
rem WordPress public REST reflects the new post a few seconds after the run ends
ping -n 21 127.0.0.1 >nul
echo [2/2] Mirror to Tistory...>> %LOG%
node tistoryMirror.js >> %LOG% 2>&1
echo ===== done %time% (exit %errorlevel%) =====>> %LOG%
