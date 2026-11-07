# Consent-based Login Verification Demo

This educational project demonstrates a login-style submission flow without collecting passwords.

## What it does
- Public page: `/` — participant enters a demo ID and explicitly consents.
- Admin page: `/admin` — project owner enters the admin key to view submitted demo IDs and timestamps.
- It does **not** ask for, store, transmit, or display passwords.

## Run locally
1. Install Node.js 18 or newer.
2. In this folder run: `node server.js`
3. Open `http://localhost:3000`
4. Open `http://localhost:3000/admin` for the dashboard.
5. Set a strong admin key before running:
   - macOS/Linux: `ADMIN_KEY='your-long-random-key' node server.js`
   - Windows PowerShell: `$env:ADMIN_KEY='your-long-random-key'; node server.js`

If no key is set, the local development default is `change-this-admin-key`. Never use that default on a public deployment.

## Public hosting
Deploy this folder to a Node.js host that supports persistent storage. Set the start command to `node server.js` and configure a strong `ADMIN_KEY` environment variable. Add persistent storage for `submissions.json`; otherwise submissions may be lost when the host restarts or redeploys. Share the public root URL with participants and keep `/admin` private.

## Safety
Use invented demo IDs only. Do not impersonate Instagram, Google, or another service. Do not ask participants to enter real credentials.
