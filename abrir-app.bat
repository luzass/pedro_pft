@echo off
cd /d "%~dp0"
set PORT=5173
start "" "http://127.0.0.1:%PORT%/index.html"
node dev-server.js %PORT%
