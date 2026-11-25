@echo off
title Minh Hoang AI Data Analyst Agent (AI301)
cd /d "%~dp0"
echo Starting Minh Hoang AI Data Analyst Agent Server on http://localhost:8765 ...
start "" "http://localhost:8765"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" -Port 8765
pause
