@echo off
title Football App Server
cd /d %USERPROFILE%\Desktop\Projet\football-app-v2
echo Starting server...
node server.js
echo.
echo Server stopped. Press any key to close.
pause > nul
