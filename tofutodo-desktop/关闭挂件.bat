@echo off
chcp 65001 > nul
echo 正在强制关闭运行中的 TofuTodo 挂件...
taskkill /f /im electron.exe
echo 已关闭！
timeout /t 2 > nul
exit
