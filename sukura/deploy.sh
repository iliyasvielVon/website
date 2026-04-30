#!/bin/bash
# 沙雕库部署脚本
# 在 /var/www/sukura 目录下执行

set -e
echo "=== 沙雕库部署开始 ==="

# 1. 安装依赖
echo "[1/4] 安装 npm 依赖..."
npm install --production

# 2. 创建数据目录
echo "[2/4] 创建数据目录..."
mkdir -p data

# 3. 安装 pm2（进程守护）
echo "[3/4] 安装 PM2..."
npm install -g pm2 2>/dev/null || true

# 4. 启动服务
echo "[4/4] 启动服务..."
pm2 delete sukura 2>/dev/null || true
pm2 start server.js --name sukura
pm2 save
pm2 startup | tail -1 | bash 2>/dev/null || true

echo ""
echo "=== 部署完成 ==="
echo "服务运行在: http://localhost:3000"
echo "查看日志: pm2 logs sukura"
echo "重启服务: pm2 restart sukura"
echo ""
echo "接下来配置 nginx 反代（见 nginx.conf.example）"
