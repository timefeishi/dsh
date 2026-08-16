@echo off
rem ============================================
rem  DeepSeek Harness 发布工具（双击运行）
rem  检查 git 干净且最新 → 升版本号 → 构建 → 发布
rem
rem  首次使用前先设置 token（在"此电脑-属性-高级系统设置-环境变量"里添加）：
rem    GH_TOKEN = 你的 GitHub token（勾选 repo 权限）
rem ============================================
chcp 65001 >nul
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0scripts\release.ps1"
echo.
pause
