// The initials log. Append only, one row per initial typed.
//
// ‼️ ONE ROW IS ONE PAGE, AND A PAGE COVERS A RANGE OF SECTIONS (2026-09-03). Nine clauses lay
// out as four pages, so a complete signature is four rows rather than nine. page_sections carries
// the literal list of section numbers that one initial covered, and coverageOf() unions them,
// which is what keeps missingSections() and the /sign coverage check working unchanged. A row
// written before this has page_sections null, and back then a page WAS a section, so falling back
// to [section_no] is not a compatibility shim, it is that row's actual meaning.
//
// ‼️ A RE-INITIAL IS A SECOND ROW, NOT AN EDIT. Somebody who goes back to re-read page 3 and
// initials it again has done something worth recording. The PDF prints the newest attempt per
// section; the log keeps that there was an earlier one.
//
// ‼️ WRITING THESE INCREMENTALLY IS THE WHOLE POINT. Four initials posted in one payload at the
// end are four claims made in a single request with client-asserted times. One at a time, the
// timestamps are the server's, the dwell is measurable, and somebody who abandons on page 3
// leaves evidence of exactly how far they read.

import { supabaseAdmin } from "@/lib/db";
import type { InitialRecord } from "./types";

export interface InitialRow {
  id: string;
  signing_id: string;
  created_at: string;
  /** The page's FIRST section. Kept populated so the existing index and older readers work. */
  section_no: number;
  section_key: string;
  initials: string;
  section_sha256: string;
  dwell_ms: number | null;
  client_nonce: string;

  /** Null on rows written before 2026-09-03. */
  page_no: number | null;
  /** Every section number this one initial covered. Null on pre-2026-09-03 rows. */
  page_sections: number[] | null;
  /** The hash of the whole page as painted. Null on pre-2026-09-03 rows. */
  page_sha256: string | null;
}

/**
 * Initials, as typed.
 *
 * One to six characters, starting with a letter. Unicode-aware, because a name is not always
 * Latin. NOT uppercased and NOT trimmed to two characters: the record is what they wrote.
 */
export const INITIALS_RE = /^[\p{L}][\p{L} .'-]{0,5}$/u;

export function validInitials(v: string): boolean {
  return INITIALS_RE.test(v);
}

/**
 * Append one initial.
 *
 * ‼️ A 23505 ON THE NONCE KEY IS A RETRY, NOT AN ERROR. The browser mints one uuid per submit,
 * so a flaky mobile connection re-sending the same request collides and we report the same
 * success. Going back and re-initialling mints a NEW nonce and legitimately writes a second row.
 * That is why there is no attempt counter anywhere to keep in sync.
 */
export async function recordInitial(args: {
  signingId: string;
  pageNo: number;
  /** Every section this initial covers, taken from the SNAPSHOT page, never from a request body. */
  pageSections: number[];
  pageSha256: string;
  /** The page's first section, for section_no, section_key and section_sha256. */
  firstSectionNo: number;
  firstSectionKey: string;
  firstSectionSha256: string;
  initials: string;
  dwellMs: number | null;
  clientNonce: string;
}): Promise<{ ok: boolean; duplicate: boolean }> {
  const { error } = await supabaseAdmin.from("onboarding2_initials").insert({
    signing_id: args.signingId,
    // The page's first section, so onboarding2_initials_signing_idx and anything still reading
    // section_no keep meaning something rather than being handed a null.
    section_no: args.firstSectionNo,
    section_key: args.firstSectionKey,
    section_sha256: args.firstSectionSha256,
    page_no: args.pageNo,
    page_sections: args.pageSections,
    page_sha256: args.pageSha256,
    initials: args.initials,
    dwell_ms: args.dwellMs,
    client_nonce: args.clientNonce,
  });

  if (!error) return { ok: true, duplicate: false };
  if (error.code === "23505") return { ok: true, duplicate: true };

  console.error("[onboarding2/initials] insert failed:", error.message);
  return { ok: false, duplicate: false };
}

/** Every initial for a signing, oldest first. */
export async function loadInitials(signingId: string): Promise<InitialRow[]> {
  const { data } = await supabaseAdmin
    .from("onboarding2_initials")
    .select("*")
    .eq("signing_id", signingId)
    .order("created_at", { ascending: true });
  return (data as InitialRow[]) ?? [];
}

/**
 * Which sections have been initialled at least once.
 *
 * ‼️ ONE ROW CAN COVER SEVERAL SECTIONS, AND EXPANDING page_sections HERE IS THE ONLY PLACE IN
 * THE CODEBASE THAT KNOWS IT. Everything downstream still deals in SECTION numbers:
 * missingSections(), the coverage check at /sign, the `initialled` array the client derives its
 * position from. That is why per-page initials cost one changed function and no changed call
 * sites, and why the check at signature did not have to be relaxed to accommodate them.
 *
 * A null page_sections is a row from before pages existed, when one initial covered exactly one
 * section. [section_no] is that row's real meaning, not a fallback.
 *
 * Derived from the rows every time rather than kept as a counter, so it cannot drift. Nine
 * sections and a handful of retries, so the set is tiny.
 */
export function coverageOf(rows: InitialRow[]): Set<number> {
  const out = new Set<number>();
  for (const r of rows) {
    const covered = r.page_sections?.length ? r.page_sections : [r.section_no];
    for (const n of covered) out.add(n);
  }
  return out;
}

/** Which PAGES have been initialled. What the agreement screen ticks off. */
export function pageCoverageOf(rows: InitialRow[]): Set<number> {
  return new Set(rows.map((r) => r.page_no ?? r.section_no));
}

/**
 * Sections in the snapshot with no initial against them.
 *
 * ‼️ THIS IS THE CHECK THAT MAKES PER-PAGE INITIALS MEAN ANYTHING. Without it a hand-crafted
 * POST straight to /sign produces a signed agreement that nobody ever paged through, and every
 * initial in the PDF would be decoration.
 */
export function missingSections(rows: InitialRow[], sectionNumbers: number[]): number[] {
  const have = coverageOf(rows);
  return sectionNumbers.filter((n) => !have.has(n));
}

/**
 * The frozen copy: newest attempt per SECTION, in section order.
 *
 * Written once, into initials_snapshot, in the same statement that stamps signed_at.
 *
 * ‼️ IT FANS ONE PAGE ROW OUT INTO ONE RECORD PER SECTION THAT PAGE COVERED, AND THAT IS WHY
 * agreement-pdf.ts AND card.ts NEEDED NO CHANGES AT ALL. The PDF builds
 * `new Map(initials.map(r => [r.n, r]))` and draws an initial line under every section;
 * initialLine() returns quietly on undefined, so a four-entry array would have left five clauses
 * with a blank where an initial belongs and nothing would have thrown. card.ts prints
 * `initials N of 9` and would have read "4 of 9" for a complete signature. Fanning out here keeps
 * one shape for every reader and loses nothing: `page` records which single act produced these
 * records, so it stays visible that 4, 5 and 6 were initialled together, once, on page 3.
 *
 * The section key comes from the snapshot, because a row only stores its FIRST section's key.
 */
export function freezeInitials(
  rows: InitialRow[],
  sections: Array<{ n: number; key: string }>
): InitialRecord[] {
  const keyOf = new Map(sections.map((s) => [s.n, s.key]));

  // Newest attempt per SECTION, walking each row's covered list.
  const newest = new Map<number, InitialRow>();
  for (const r of rows) {
    const covered = r.page_sections?.length ? r.page_sections : [r.section_no];
    for (const n of covered) {
      const prev = newest.get(n);
      if (!prev || r.created_at >= prev.created_at) newest.set(n, r);
    }
  }

  return Array.from(newest.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([n, row]) => ({
      n,
      key: keyOf.get(n) ?? row.section_key,
      initials: row.initials,
      at: row.created_at,
      // The hash of the whole page this section was initialled on, which is what was actually
      // checked before the row was written. A pre-2026-09-03 row has no page hash, and there the
      // section hash WAS the page hash.
      sectionSha256: row.page_sha256 ?? row.section_sha256,
      dwellMs: row.dwell_ms,
      page: row.page_no ?? n,
    }));
}
