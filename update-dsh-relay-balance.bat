@echo off
chcp 65001 >nul
echo ==============================================
echo  dsh-relay-balance 一键更新
echo.
echo  请先完全退出 DSH（包括托盘），
echo  然后再按任意键开始更新。
echo ==============================================
pause >nul
"E:\soft\Deepseek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop update dsh-relay-balance
echo.
echo ==============================================
echo  更新完成。按任意键关闭窗口，
echo  然后重新打开 DSH 即可。
echo ==============================================
pause >nul
