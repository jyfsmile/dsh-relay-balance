@echo off
echo ==============================================
echo  dsh-relay-balance one-click update
echo.
echo  Please fully quit DSH first (including the
echo  tray icon), then press any key to start.
echo ==============================================
pause >nul
"E:\soft\Deepseek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop update dsh-relay-balance
echo.
echo ==============================================
echo  Update finished. Press any key to close,
echo  then reopen DSH.
echo ==============================================
pause >nul
