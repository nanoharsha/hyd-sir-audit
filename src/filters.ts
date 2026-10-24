// Named record filters, shared by the dashboard drill-down list and the
// downloads so a list and its export can never disagree. Ported from the
// developer's records.py FILTERS/FILTER_TITLES/build_filter.
import {
  BASE_ROLL,
  CORRECTION,
  DELETION,
  FOUND,
  MIGRATED,
  NOT_FOUND,
  NOT_STARTED,
  S5_ADDITION,
  S5_CORRECTION,
  S5_DELETION,
} from "./records";

export const FILTERS: Record<string, string> = {
  full: "1 = 1",
  base_roll: BASE_ROLL,
  completed: `${BASE_ROLL} AND verification_status != '${NOT_STARTED}'`,
  pending: `${BASE_ROLL} AND verification_status = '${NOT_STARTED}'`,
  found: `${BASE_ROLL} AND verification_status = '${FOUND}'`,
  not_found: `${BASE_ROLL} AND verification_status = '${NOT_FOUND}'`,
  not_found_shifted: `${BASE_ROLL} AND verification_status = '${NOT_FOUND}' AND sub_category = '${MIGRATED}'`,
  additions: "added_in_field = 1",
  deletions: `sub_category = '${DELETION}'`,
  corrections: `sub_category = '${CORRECTION}'`,
  duplicates: "is_duplicate_epic = 1",
  deleted_in_source: "source_deleted = 'Yes'",
  modified_in_source: "source_modified = 'Yes'",
  // Supplement 5 (ECI) — additions / deletions / corrections the owner
  // identified as missed from the base roll. See migration_009.sql. Each is
  // a card badge, a dashboard tile, its own drill-down, and an export.
  supplement5_additions: `supplement5 = '${S5_ADDITION}'`,
  supplement5_deletions: `supplement5 = '${S5_DELETION}'`,
  supplement5_corrections: `supplement5 = '${S5_CORRECTION}'`,
  // Voters that came from the Feb 2025 - Jun 2026 official roll update
  // rather than the original import — the update file carried no address,
  // so these have no house number yet and won't turn up in a house search.
  // See migration_007.sql.
  source_roll_update_additions: "source_added_update = 'Yes'",
  // The other half of the same update: deletions whose EPIC matches nothing
  // in our roll at all. Name-only matching against existing voters was
  // tried and rejected (common first names produce multiple ambiguous
  // same-part candidates, and a wrong match would falsely mark a real voter
  // deleted) — these are their own rows instead, with no house number
  // either, so the field team can locate and resolve them in person.
  unidentified_deletions: "source_unidentified_deletion = 'Yes'",
  // What the roll becomes after the audit: everything confirmed Found plus
  // field additions, less anything marked for deletion.
  revised_roll: `(((${BASE_ROLL}) AND verification_status = '${FOUND}') OR added_in_field = 1) AND COALESCE(sub_category, '') != '${DELETION}'`,
};

export const FILTER_TITLES: Record<string, string> = {
  full: "Full Roll",
  base_roll: "Base Roll",
  completed: "Verification Completed",
  pending: "Pending",
  found: "Found",
  not_found: "Not Found",
  not_found_shifted: "Not Found – Shifted",
  additions: "Additions",
  deletions: "Deletions",
  corrections: "Corrections",
  duplicates: "Duplicate EPIC numbers",
  deleted_in_source: "Deleted in source roll",
  modified_in_source: "Modified in source roll",
  source_roll_update_additions: "Additions (Feb 2025 - June 2026)",
  unidentified_deletions: "Unidentified Deletions (Feb 2025 - June 2026)",
  supplement5_additions: "Addition in Supplement 5",
  supplement5_deletions: "Deleted in Supplement 5",
  supplement5_corrections: "Corrections in Supplement 5",
  revised_roll: "Revised Roll",
};

export function buildFilter(kind: string, part?: string | null): { where: string; params: any[] } | null {
  const base = FILTERS[kind];
  if (!base) return null;
  const clauses = [`(${base})`];
  const params: any[] = [];
  if (part) {
    clauses.push("part_number = ?");
    params.push(part);
  }
  return { where: clauses.join(" AND "), params };
}
