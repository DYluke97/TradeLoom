#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."
echo "=================================================="
echo "  TradeLoom 本地投研复盘双链工作台 (127.0.0.1:3200)"
echo "=================================================="
if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 未检测到 Node.js 20+，请先访问 https://nodejs.org/ 安装。"
  read -p "按回车退出..."
  exit 1
fi
if [ ! -d "node_modules" ]; then
  echo "[首次运行] 正在安装依赖..."
  npx --yes pnpm@9 install
fi
if [ ! -f ".next/BUILD_ID" ]; then
  echo "[首次运行] 正在构建本地生产包..."
  npx --yes pnpm@9 run build
fi
(sleep 2 && open "http://127.0.0.1:3200") &
exec node ./node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3200
