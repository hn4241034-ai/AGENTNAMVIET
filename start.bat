@echo off
title Nam Viet AI Sales Lead Agent (AI301 - De 02)
cd /d "%~dp0"
echo Starting Nam Viet AI Sales Lead Agent Server on http://localhost:8765 ...
start "" "http://localhost:8765"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" -Port 8765
pause
