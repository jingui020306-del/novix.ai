@echo off
setlocal
cd /d %~dp0

python -m venv .venv
call .venv\Scripts\activate

pip install -r backend\requirements.txt
if errorlevel 1 (
  echo [ERROR] backend 依赖安装失败。请检查离线镜像/代理配置，例如：
  echo   pip install -i https://pypi.org/simple -r backend\requirements.txt
  exit /b 1
)

if not "%NPM_REGISTRY%"=="" (
  npm config set registry %NPM_REGISTRY%
)

echo [frontend] npm registry: 
npm config get registry

if not exist frontend\node_modules (
  if exist frontend\package-lock.json (
    set NPM_CMD=npm ci
  ) else (
    set NPM_CMD=npm install
  )

  cd frontend
  call %NPM_CMD% > ..\npm-install.log 2>&1
  if errorlevel 1 (
    findstr /I /C:"E403" /C:"registry.npmmirror.com" ..\npm-install.log >nul
    if not errorlevel 1 (
      echo [frontend] detected npm E403/mirror issue, switching registry to https://registry.npmjs.org/ and retrying once
      cd ..
      npm config set registry https://registry.npmjs.org/
      echo [frontend] npm registry(after switch):
      npm config get registry
      cd frontend
      call %NPM_CMD% >> ..\npm-install.log 2>&1
      if errorlevel 1 (
        type ..\npm-install.log
        echo [ERROR] npm install retry failed. npm debug logs: %USERPROFILE%\AppData\Local\npm-cache\_logs
        exit /b 1
      )
    ) else (
      type ..\npm-install.log
      echo [ERROR] npm install failed. npm debug logs: %USERPROFILE%\AppData\Local\npm-cache\_logs
      exit /b 1
    )
  )
  cd ..
)

start cmd /k "cd backend && uvicorn main:app --host 127.0.0.1 --port 8000"
cd frontend
npm run dev
