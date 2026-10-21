# API checks (Super Admin)

End-to-end checks against a running Super Admin (`npm run build && npm start`, or `npm run dev`).
Plain Node 20+ scripts, no dependencies. Each prints `PASS`/`FAIL` lines and a total.

| Script | What it covers | Writes (undone in the same run) |
|--------|----------------|------|
| `admin.mjs` | Every admin GET (all screens + details), malformed input never 500, vendor namespace hidden, demo reset refused on Supabase, then reversible writes on demo records | suspend/reactivate, branch off/on, review hide/restore, commission ±1, draft offer (left disabled), a complaint note |
| `cross-app.mjs` | Super Admin ↔ vendor portal on one database: admin cancels a vendor booking, suspension blocks new orders (423), vendor report → admin "keep", commission override shown to the wash; `--approve` approves an application and signs the new owner in to the portal | as listed in the script header |

```bash
node qa/api-check/admin.mjs http://localhost:3100 sara@carzen.demo demo1234
node qa/api-check/cross-app.mjs http://localhost:3100 http://localhost:3200
```

Vendor-only checks live in `washup-vendor/qa/api-check/`. Run against demo data only.
