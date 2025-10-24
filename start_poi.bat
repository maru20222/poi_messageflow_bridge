@echo off
setlocal

:: =========================
:: ▼ Config 
:: =========================
:: ─ DevTools Port を固定
set "DEVTOOLS_PORT=9222"

:: ─ poi 実行ファイル
set "POI_EXE=%LocalAppData%\Programs\poi\poi.exe"

:: ─ ブリッジ関連
set "BRIDGE_DIR=%USERPROFILE%\Documents\logbook-bridge"
set "BRIDGE_JS=poi_messageflow_bridge.js"
set "BRIDGE_LOG=poi_messageflow_bridge.log"
:: =========================

:: --- 1) poi をデバッグポート付きで起動（未起動なら）
tasklist /FI "IMAGENAME eq poi.exe" | find /I "poi.exe" >NUL
if errorlevel 1 (
  echo [bat] start poi with --remote-debugging-port=%DEVTOOLS_PORT%
  start "" "%POI_EXE%" --remote-debugging-port=%DEVTOOLS_PORT%
  timeout /t 7 /nobreak >nul
) else (
  echo [bat] poi is already running
)

:: --- 2) ブリッジの作業フォルダへ
pushd "%BRIDGE_DIR%" || ( echo [bat] BRIDGE_DIR not found: %BRIDGE_DIR% & goto :end )

:: --- 3) 多重起動防止：旧 node と旧 cmd を掃除（※自分の cmd は PowerShell 内で除外）
set "ENV_BRIDGE_JS=%BRIDGE_JS%"
set "ENV_THIS_BAT=%~nx0"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$js=[regex]::Escape($env:ENV_BRIDGE_JS);" ^
  "$bat=[regex]::Escape($env:ENV_THIS_BAT);" ^
  "$self=(Get-CimInstance Win32_Process -Filter \"ProcessId=$PID\").ParentProcessId;" ^
  "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match $js } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} };" ^
  "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'cmd.exe' -and $_.ProcessId -ne $self -and $_.CommandLine -match $bat } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} };"

:: --- 4) ブリッジ起動（落ちたら自動再起動）
:loop
echo [bat] starting %BRIDGE_JS%
node "%BRIDGE_JS%" >> "%BRIDGE_LOG%" 2>&1
echo [bat] bridge exited. restart in 5s... >> "%BRIDGE_LOG%" 2>&1
timeout /t 5 >nul
goto loop

:end
popd
endlocal
