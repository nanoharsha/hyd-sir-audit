# SIR Social Audit

Door-to-door electoral roll verification and public-hearing tool (Cloudflare Workers + Hono + D1).
Read `CLAUDE.md` first: architecture, roles, deploy pattern and deliberate design decisions.

## Run locally
    npm install
    npx wrangler dev

## No voter data in this repo
The electoral roll, seed/import SQL, backups and generated reports are deliberately NOT included.
Apply `schema.sql` then `migration_002.sql` ... `migration_026.sql` to a local D1 to get empty tables,
and load your own test data.

`hyd_import/` holds the builders for this deployment: `build_hyd.py` turns our OCR of the ECI
PDFs plus the official ASD-D and notice reports into the `ok_*` register, and
`booth_coverage.py` works out which booths must be canvassed to cover an area. Both read
`hyd.config.json`, which is the single source of truth for everything specific to this
constituency. They need the source CSVs, which hold voter data and are not shared.

`okhla_import/` is inherited from the Delhi deployment. Only `house_fix.py` is still used —
it defines what counts as the same house, and must stay in step with `src/okhla_house.ts` and
`public/js/okhla-house.js` (shared test vectors: `okhla_import/test_house_norm.sh`). The rest
builds Delhi's Okhla register from an audit pack we do not have.
