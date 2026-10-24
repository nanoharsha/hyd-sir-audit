# SIR Social Audit

Door-to-door electoral roll verification and public-hearing tool (Cloudflare Workers + Hono + D1).
Read `CLAUDE.md` first: architecture, roles, deploy pattern and deliberate design decisions.

## Run locally
    npm install
    npx wrangler dev

## No voter data in this repo
The electoral roll, seed/import SQL, backups and generated reports are deliberately NOT included.
Apply `schema.sql` then `migration_002.sql` ... `migration_026.sql` to a local D1 to get empty tables,
and load your own test data. `okhla_import/` and `trilokpuri_import/` hold the Python builders that
turn an audit pack into import SQL; they need the pack files, which are not shared.
