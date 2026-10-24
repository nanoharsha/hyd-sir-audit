// Aggregate-only snapshot powering the public dashboard at /live/.
//
// SECURITY — read before editing. This is the only module whose output is
// served with no Cloudflare Access login in front of it, so anything added
// here becomes world-readable the moment it ships. Every value returned must
// be a count or a percentage.
//
// Two rules keep that true:
//   1. Build the response field by field. Never spread a D1 row, and never
//      return a helper's result object wholesale — reports.ts helpers carry
//      record ids and staff emails alongside the counts we want.
//   2. Never import from records.ts / exports.ts / filters.ts here. Those
//      modules exist to return elector rows.
import { dailyActivity, dashboard, partProgress } from "./reports";

export async function publicSnapshot(db: D1Database) {
  const d = await dashboard(db);
  const parts = await partProgress(db);
  // dailyActivity() returns a per-surveyor `rows` array keyed by email. We
  // take only `totals` — the per-person breakdown never leaves the Worker.
  const daily = await dailyActivity(db);

  return {
    generated_at: new Date().toISOString(),
    totals: {
      base_roll_total: d.base_roll_total,
      verification_completed: d.verification_completed,
      pending: d.pending,
      additions: d.additions,
      deletions: d.deletions,
      corrections: d.corrections,
      revised_total: d.revised_total,
      found: d.found,
      not_found: d.not_found,
      not_started: d.not_started,
      percent_complete: d.percent_complete,
    },
    revised_total_formula: d.revised_total_formula,
    parts: (parts as any[]).map((p) => ({
      part_number: p.part_number,
      base_total: p.base_total,
      done: p.done,
      additions: p.additions,
      deletions: p.deletions,
      corrections: p.corrections,
    })),
    today: {
      date: daily.date,
      verifications: daily.totals.verifications,
      additions: daily.totals.additions,
      deletions: daily.totals.deletions,
      corrections: daily.totals.corrections,
    },
  };
}
