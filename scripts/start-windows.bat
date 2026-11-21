@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo ==================================================
echo   TradeLoom 本地投研复盘双链工作台 (127.0.0.1:3200)
echo ==================================================
where node >nul 2>nul || (echo [错误] 未检测到 Node.js 20+，请先安装 https://nodejs.org/ & pause & exit /b 1)
if not exist node_modules (
  echo [首次运行] 正在安装依赖...
  call npx --yes pnpm@9 install
)
if not exist .next\BUILD_ID (
  echo [首次运行] 正在构建本地生产包...
  call npx --yes pnpm@9 run build
)
start "" "http://127.0.0.1:3200"
node .\node_modules\next\dist\bin\next start --hostname 127.0.0.1 --port 3200
pause
