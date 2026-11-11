# Run PaySettle on Windows

## Once
1. Install **Node.js 22** (https://nodejs.org/) and **Docker Desktop** (or have PostgreSQL 16 running yourself).
2. Start Docker Desktop and wait until it says *Running*.

## Every time
Double-click **`start-windows.bat`** in this folder (or run it from a terminal).
It installs packages, starts PostgreSQL in Docker on port 5442, creates the database with demo data, builds the app
and opens **http://localhost:3000**. Press `Ctrl+C` in the window to stop.

- Keep your data between runs: `start-windows.bat --keep-data`
- Reset the demo data at any time: `npm run demo:reset`
- Own PostgreSQL instead of Docker: edit `DATABASE_URL` in `.env.local` before the first run.

## Optional keys (in `.env.local`)
- `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` — PayPal Sandbox app. Without them the deterministic mock rail is used.
- `AI_API_KEY` — enables the AI drafter, verifier and mediator. Without it, rule-based checks run and AI panels say so.

## Troubleshooting
- *Could not reach PostgreSQL*: Docker Desktop is not running, or port 5442 is taken (change it in `docker-compose.yml` and `.env.local`).
- *Old pages after an update*: stop the app, delete the `.next` folder, run `start-windows.bat --keep-data`.
