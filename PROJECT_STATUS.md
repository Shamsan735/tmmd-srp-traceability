# TMMD & SRP Traceability System - Current Status

## Stable Versions

### v1-executive-dashboard
- Executive dashboard redesign
- Working sidebar tabs
- Live asset data
- Movement entry working

### v1.1-report-export
- Reports tab upgraded
- CSV export/download added
- Asset Master Report CSV
- Expiry Visibility Report CSV
- Location Summary Report CSV

### v1.2-login-auth
- Login/auth system added
- Backend protected with Authorization token
- Animated professional login page added
- Logout button added
- Live production URL protected

## Frontend

Main Live URL:
https://tmmd-srp-traceability.pages.dev

Production Branch Used:
production

Latest production deployment was updated after deploying with:
npx wrangler pages deploy dist --project-name tmmd-srp-traceability --branch production --commit-dirty=true

## Backend API

Worker API:
https://tmmd-srp-traceability-api.shamas-tmmd-srp.workers.dev

Health Check:
https://tmmd-srp-traceability-api.shamas-tmmd-srp.workers.dev/api/health

Login Endpoint:
POST /api/auth/login

## Login/Auth Notes

- Username/password are stored in Cloudflare Worker secrets.
- AUTH_USERNAME, AUTH_PASSWORD, and AUTH_TOKEN are Worker secrets.
- Do not commit real passwords or tokens into Git.
- Before final client delivery, change AUTH_PASSWORD and AUTH_TOKEN from Cloudflare secrets.

## Completed

- Backend Worker deployed
- Cloudflare D1 database connected
- Backend auth secrets added
- Login API working
- Protected API routes added
- Assets API working with auth
- Sites API working with auth
- Movement save working with auth
- Current location updates working
- Sidebar tabs working
- Executive dashboard redesigned
- Reports CSV export added
- Animated login page added
- Logout added
- Cloudflare Pages production deployed
- Git repo initialized
- Stable versions committed and tagged

## Current Working Features

### Login/Auth
- Secure login page
- Username/password verification via Worker secrets
- Token stored in browser localStorage
- Protected API calls
- Logout clears session

### Dashboard
- Executive overview
- KPI cards
- Critical expiry watchlist
- Location distribution
- Asset register snapshot
- Operational summary

### Movement Entry
- Select asset
- Current location auto display
- Select destination site
- Save movement
- Current location updates after save

### Traceability
- Search by identification number
- Asset profile
- Movement history timeline

### Asset Master
- Full asset register
- Search/filter
- Expiry status badges

### Reports
- Asset Master CSV download
- Expiry Visibility CSV download
- Location Summary CSV download

## Rollback Commands

Rollback to executive dashboard:
git checkout v1-executive-dashboard

Rollback to report export version:
git checkout v1.1-report-export

Rollback to login/auth version:
git checkout v1.2-login-auth

## Next Possible Work

- Change production password before client delivery
- Add role-based users
- Add user management page
- Add PDF export option
- Add Excel XLSX export option
- Improve Calibration records UI
- Improve PM / Checklist records UI
- Add real movement history export
- Add R2 file/photo upload after R2 billing activation
- Add photo compression before upload

## v1.3-executive-ui-theme

### Completed UI Upgrade
- Executive Sapphire + Platinum theme applied
- Sidebar upgraded to premium enterprise style
- Dashboard upgraded to executive control tower style
- Black-heavy theme removed
- Professional colors added
- Dashboard visual sections improved
- Production URL deployed and checked

Production Deploy Command Used:
npx wrangler pages deploy dist --project-name tmmd-srp-traceability --branch production --commit-dirty=true
