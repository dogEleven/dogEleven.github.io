@echo off
chcp 65001 > nul
echo ===================================================
echo [TofuTodo Widget] 正在打包源码压缩包...
echo ===================================================

echo.
echo 1. 准备源码文件...
if exist "dist-src" rmdir /s /q "dist-src"
mkdir "dist-src\TofuTodo-Widget"
copy main.js "dist-src\TofuTodo-Widget\" > nul
copy preload.js "dist-src\TofuTodo-Widget\" > nul
copy package.json "dist-src\TofuTodo-Widget\" > nul
copy "启动挂件.bat" "dist-src\TofuTodo-Widget\" > nul

echo.
echo 2. 正在自动打包成 ZIP 文件...
if exist "..\test\TofuTodo-Widget.zip" del /f /q "..\test\TofuTodo-Widget.zip"
powershell -Command "Compress-Archive -Path 'dist-src\TofuTodo-Widget' -DestinationPath '..\test\TofuTodo-Widget.zip' -Force"

echo.
echo ===================================================
echo [成功] 全部处理完毕！
echo TofuTodo-Widget.zip already moved to test folder!
echo 此压缩包非常小，你可以立即提交部署到 Github Pages 啦！
echo ===================================================
pause
