@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22 or later before publishing Voxora updates.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm ci
  if errorlevel 1 exit /b 1
)
echo Publishing the committed Voxora version to GitHub. Keep this window open.
call npm run release:push
if errorlevel 1 echo Release stopped. Read the error above; your source and chat data are preserved.
pause
