@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Voxora Bot
pushd "%~dp0" >nul
if errorlevel 1 (
  echo Could not open the bot folder. Extract the ZIP before launching the bot.
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 goto missingNode
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
if errorlevel 1 goto missingNode

node start-bot.mjs
set "VOXORA_BOT_EXIT=%ERRORLEVEL%"
if "%VOXORA_BOT_EXIT%"=="2" (
  echo.
  echo Opening .env in Notepad. Set your Voxora server URL and bot token.
  echo Save the file, then double-click start-bot.bat again.
  start "" notepad.exe "%CD%\.env"
)
popd
echo.
pause
exit /b %VOXORA_BOT_EXIT%

:missingNode
echo.
echo This bot needs Node.js 22 or later.
echo Install the LTS version from https://nodejs.org/
echo Then close this window and double-click start-bot.bat again.
popd
pause
exit /b 1
