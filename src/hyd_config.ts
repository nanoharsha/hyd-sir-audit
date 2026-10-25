// Constituency settings, read from hyd.config.json so the Worker and the Python
// importers cannot disagree about the part mapping. Change the JSON, not this file.
//
// Everything here is derived, not restated: the old->new part map is built from
// part_offset rather than written out again, which is what kept drifting before.
import raw from "../hyd.config.json";

export const AC = raw.ac;
export const ROLLS = raw.rolls;

/** Base-roll (2025) parts that are in scope at all: searchable, with status tiles. */
export const AUDIT_MIN: number = raw.parts.audit_min;
export const AUDIT_MAX: number = raw.parts.audit_max;

/** Base parts the team is canvassing: the part picker and progress dashboard. */
export const FOCUS_PARTS: number[] = raw.parts.focus;

/** Base parts whose matching draft roll is actually loaded. */
export const DRAFT_HELD: number[] = raw.parts.draft_held;

export const CRITICAL_MANUAL: number[] = raw.parts.critical_manual;

/** Base parts we hold no notice list for — their "cleared" counts are provisional. */
export const MISSING_NOTICE_PARTS: number[] = raw.import.missing_notice_parts;

const OFFSET: number = raw.rolls.part_offset;

/** Base-roll part -> draft-roll part. */
export const toNewPart = (oldPart: number): number => oldPart + OFFSET;
/** Draft-roll part -> base-roll part. */
export const toOldPart = (newPart: number): number => newPart - OFFSET;

/**
 * Label for a base part that names BOTH numbering schemes. A surveyor in the
 * field holds 2026 paperwork while this code filters on 2025 numbers, so a bare
 * number is ambiguous — never build one without going through here.
 */
export function partLabel(oldPart: number): string {
  return `${ROLLS.draft_year} booth ${toNewPart(oldPart)} · ${ROLLS.base_year} part ${oldPart}`;
}

/** Old/new part maps, for code that wants a lookup rather than arithmetic. */
export const OLD_TO_NEW: Record<string, string> = {};
export const NEW_TO_OLD: Record<string, string> = {};
for (let p = AUDIT_MIN; p <= AUDIT_MAX; p++) {
  OLD_TO_NEW[String(p)] = String(toNewPart(p));
  NEW_TO_OLD[String(toNewPart(p))] = String(p);
}
