@echo off
chcp 65001 > nul
echo ===================================================
echo [TofuTodo Widget] 正在启动桌面挂件...
echo ===================================================

where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 找不到 npm 命令！请先下载并安装 Node.js。
    echo 官网下载地址: https://nodejs.org/
    pause
    exit /b
)

echo 首次运行会自动检查并安装必要的运行环境，这可能需要几十秒钟...
if not exist "node_modules\" (
    echo 发现首次运行，正在为你在线安装依赖...
    call npm install
)

echo 依赖正常，开始启动...
call npm start
