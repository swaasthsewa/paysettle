@echo off
rem PaySettle - one-click local run on Windows (Node 22 + Docker Desktop, or your own PostgreSQL 16).
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 22 or newer is required: https://nodejs.org/ & pause & exit /b 1)
if not exist .env.local (
  copy .env.example .env.local >nul
  where docker >nul 2>nul && powershell -NoProfile -Command "(Get-Content .env.local) -replace '^DATABASE_URL=.*','DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5442/paysettle' | Set-Content .env.local"
)
where docker >nul 2>nul && (echo Starting PostgreSQL in Docker on port 5442... & docker compose up -d db)
echo Installing packages (first run takes a few minutes)...
call npm install --no-audit --no-fund || goto :fail
call npx tsx scripts/wait-db.ts || goto :fail
if "%1"=="--keep-data" goto :build
echo Creating the database and demo data...
call npx tsx scripts/reset-db.ts || goto :fail
:build
echo Building the app...
call npm run build || goto :fail
echo.
echo PaySettle is starting at http://localhost:3000  (press Ctrl+C to stop)
start "" http://localhost:3000
call npm run start
goto :eof
:fail
echo.
echo Something failed above. See RUN-ON-WINDOWS.md for help.
pause
exit /b 1
