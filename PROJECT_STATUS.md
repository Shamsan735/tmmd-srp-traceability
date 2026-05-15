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

## Frontend

Main Live URL:
https://tmmd-srp-traceability.pages.dev

Main Branch Alias:
https://main.tmmd-srp-traceability.pages.dev

Latest Deployment Tested:
https://86c3f0a1.tmmd-srp-traceability.pages.dev

## Backend API

Worker API:
https://tmmd-srp-traceability-api.shamas-tmmd-srp.workers.dev

Health Check:
https://tmmd-srp-traceability-api.shamas-tmmd-srp.workers.dev/api/health

## Completed

- Backend Worker deployed
- Cloudflare D1 database connected
- Assets API working
- Sites API working
- Movement save working
- Current location updates working
- Sidebar tabs working
- Executive dashboard redesigned
- Reports CSV export added
- Cloudflare Pages deployed
- Git repo initialized
- Stable versions committed and tagged

## Current Working Features

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

## Next Possible Work

- Add login/auth
- Add PDF export option
- Add Excel XLSX export option
- Improve Calibration records UI
- Improve PM / Checklist records UI
- Add real movement history export
- Add R2 file/photo upload after R2 billing activation
- Add photo compression before upload
