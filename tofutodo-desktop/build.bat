@echo off
chcp 65001 > nul
echo ===================================================
echo [TofuTodo Widget] 正在构建 Windows 安装包...
echo ===================================================

echo.
echo 1. 使用 electron-builder 构建 NSIS 安装程序...
call npm run build
if errorlevel 1 (
    echo.
    echo [失败] 安装包构建失败。
    pause
    exit /b 1
)

echo.
echo 2. 发布安装包到网页下载目录...
copy /Y "dist\TofuTodo-Widget-Setup.exe" "..\test\TofuTodo-Widget-Setup.exe" > nul
if errorlevel 1 (
    echo.
    echo [失败] 无法复制安装包到 test 目录。
    pause
    exit /b 1
)

echo.
echo ===================================================
echo [成功] 全部处理完毕！
echo 安装包位置: ..\test\TofuTodo-Widget-Setup.exe
echo ===================================================
pause
