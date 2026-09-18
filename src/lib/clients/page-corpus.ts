// The first reader of page_dataset. Two writes, no selects, since the table was created.
//
// Matthew, 2026-09-18: "we need to make sure the system learns from each post we make ... so if it
// wants to extract fragments of data to systemize certain 'type of posts' allow it to categorize to
// get as much data as possible in order to make our posts better in the future".
//
// ‼️ IT CANNOT LEARN FROM OUTCOMES AND NOTHING HERE MAY IMPLY OTHERWISE. There is no ranking, no
// traffic and no citation signal in this system, and that absence is refused deliberately in three
// separate places: page-dataset.ts's header refuses ranking and citation columns outright,
// weekly-report.ts carries ATTRIBUTION_NOT_WIRED and tells the CLIENT in writing, and
// suggestions.ts says out loud to the operator that page performance is not measured. A learning
// loop that quietly implied a page "performed" would be the worst thing that could be built on this
// table, because every later reader would treat the implication as measured fact. The nearest
// measured thing is fanout_citations, which suggestions.ts already names as what would measure it.
//
// ‼️ WHAT IT CAN HONESTLY LEARN FROM, AND BOTH ARE ALREADY BEING COLLECTED:
//
//   1. THE DRAFT-TO-PUBLISH DIFF, which is precisely what the append-only design exists for.
//      page-dataset.ts: "The value of this table is the DIFFERENCE between what the model drafted
//      and what actually shipped." Three rows per page and the difference between them is a record
//      of what a person changed about a model's work.
//
//   2. format_dataset.missing PER SHAPE. That column names the required fields nobody answered,
//      per page, per shape. Aggregated it answers "a comparison page always lacks its verdict per
//      axis", which is a fact about OUR PROCESS rather than a claim about a page's performance.
//
// ‼️ PER-CLIENT AND PER-VERTICAL ANSWERS ARE DIFFERENT ANSWERS AND MUST NOT MERGE. "This client's
// comparison pages always lack a verdict" and "comparison pages in general always lack a verdict"
// send somebody to two different places. Every aggregate below carries its scope.
//
// ‼️ EVERY CLAIM CITES A COUNT OF ROWS. D9 binds hardest here, because a suggestion is the most
// actionable thing this system emits.

import { supabaseAdmin } from "@/lib/db";
import { getPostFormat, type PostFormatId } from "@/config/post-formats";

/** One shape, and what pages written in it keep failing to answer. */
export interface ShapeGap {
  postFormat: PostFormatId;
  /** How many captured pages carried this shape. The denominator. */
  pages: number;
  /** field key -> how many of those pages recorded it as missing. */
  missing: Array<{ field: string; count: number; label: string }>;
}

/** What a person changed about a model's work, measured as whole-body difference. */
export interface EditFootprint {
  /** Pages with BOTH a drafted and a published capture. The denominator. */
  pairs: number;
  /** Of those, how many shipped with a body that differs from the drafted one at all. */
  edited: number;
  /** Median share of the drafted body's lines that survived to publication, 0 to 1. */
  medianKept: number;
}

export interface CorpusRead {
  /** Total page_dataset rows in scope. Zero is a real answer and is reported as one. */
  rows: number;
  shapes: ShapeGap[];
  edits: EditFootprint;
  /** Set when the table could not be read at all, which is NOT the same as it being empty. */
  unreadable: string | null;
}

const EMPTY: CorpusRead = {
  rows: 0,
  shapes: [],
  edits: { pairs: 0, edited: 0, medianKept: 1 },
  unreadable: null,
};

interface Row {
  page_id: string | null;
  client_id: string | null;
  vertical_slug: string | null;
  post_format: string | null;
  format_dataset: { format?: string | null; values?: Record<string, unknown>; missing?: string[] } | null;
  captured_reason: string | null;
  body_md: string | null;
}

/**
 * Read the corpus, scoped to one client or to a whole vertical, never both at once.
 *
 * ‼️ ITS OWN TOLERANT SELECT, AND post_format / format_dataset ARE IN IT. One unknown column fails
 * the WHOLE PostgREST select and supabase-js RETURNS the error rather than throwing, so a database
 * without docs/2026-09-18-post-formats.sql would make this silently report an EMPTY corpus, which
 * reads as "nothing has been written yet" rather than "the migration has not run". The error is
 * read and reported as `unreadable`, which is a different fact from `rows: 0`.
 */
export async function readCorpus(scope: { clientId: string } | { verticalSlug: string }): Promise<CorpusRead> {
  const base = supabaseAdmin
    .from("page_dataset")
    .select("page_id, client_id, vertical_slug, post_format, format_dataset, captured_reason, body_md");

  const query =
    "clientId" in scope ? base.eq("client_id", scope.clientId) : base.eq("vertical_slug", scope.verticalSlug);

  const { data, error } = await query;
  if (error) return { ...EMPTY, unreadable: error.message };

  const rows = (data ?? []) as unknown as Row[];
  return { rows: rows.length, shapes: shapeGaps(rows), edits: editFootprint(rows), unreadable: null };
}

/**
 * Which required field each shape keeps not answering.
 *
 * PURE over the rows, so a probe can drive it with fixtures and no database.
 */
export function shapeGaps(rows: Row[]): ShapeGap[] {
  // One page may be captured three times (drafted, edited, published) and counting it three times
  // would treble every gap. The unit is the PAGE, not the capture.
  const seen = new Map<string, { format: PostFormatId; missing: Set<string> }>();

  for (const r of rows) {
    const format = r.post_format;
    if (!format) continue;
    const spec = getPostFormat(format);
    if (!spec) continue;
    const key = r.page_id ?? `${r.client_id}:${format}`;

    const missing = Array.isArray(r.format_dataset?.missing) ? r.format_dataset.missing : [];
    const existing = seen.get(key);
    if (existing) {
      // The LATEST capture wins per field: a gap answered between the draft and the publish is not
      // a gap. Union would report a field as missing for ever once it had been missing once.
      existing.missing = new Set(missing);
    } else {
      seen.set(key, { format: spec.id, missing: new Set(missing) });
    }
  }

  const byFormat = new Map<PostFormatId, { pages: number; counts: Map<string, number> }>();
  for (const { format, missing } of seen.values()) {
    const bucket = byFormat.get(format) ?? { pages: 0, counts: new Map<string, number>() };
    bucket.pages += 1;
    for (const field of missing) bucket.counts.set(field, (bucket.counts.get(field) ?? 0) + 1);
    byFormat.set(format, bucket);
  }

  const out: ShapeGap[] = [];
  for (const [postFormat, bucket] of byFormat) {
    const spec = getPostFormat(postFormat);
    out.push({
      postFormat,
      pages: bucket.pages,
      missing: [...bucket.counts.entries()]
        .map(([field, count]) => ({
          field,
          count,
          label: spec?.dataset.find((f) => f.key === field)?.label ?? field,
        }))
        .sort((a, b) => b.count - a.count),
    });
  }
  return out.sort((a, b) => b.pages - a.pages);
}

/**
 * How much of what the model drafted actually shipped.
 *
 * ‼️ THIS IS A MEASUREMENT OF OUR OWN EDITING, NOT OF THE PAGE'S PERFORMANCE, and the distinction
 * is the entire reason this is safe to compute. "The drafter's comparison pages get rewritten more
 * than its answer pages" is a fact about a model and a person. It says nothing about whether either
 * version was ever read, and nothing here may be rendered as though it did.
 *
 * Whole lines, deliberately crudely: a token diff of prose produces a number nobody can act on.
 */
export function editFootprint(rows: Row[]): EditFootprint {
  const byPage = new Map<string, { drafted?: string; published?: string }>();
  for (const r of rows) {
    if (!r.page_id || !r.body_md) continue;
    const slot = byPage.get(r.page_id) ?? {};
    if (r.captured_reason === "drafted") slot.drafted = r.body_md;
    if (r.captured_reason === "published") slot.published = r.body_md;
    byPage.set(r.page_id, slot);
  }

  const kept: number[] = [];
  let edited = 0;
  for (const { drafted, published } of byPage.values()) {
    if (!drafted || !published) continue;
    const before = new Set(lines(drafted));
    const after = lines(published);
    if (drafted.trim() !== published.trim()) edited += 1;
    const survived = after.filter((l) => before.has(l)).length;
    kept.push(before.size === 0 ? 1 : Math.min(1, survived / before.size));
  }

  if (kept.length === 0) return { pairs: 0, edited: 0, medianKept: 1 };
  kept.sort((a, b) => a - b);
  const mid = Math.floor(kept.length / 2);
  const medianKept = kept.length % 2 === 0 ? (kept[mid - 1] + kept[mid]) / 2 : kept[mid];
  return { pairs: kept.length, edited, medianKept };
}

function lines(body: string): string[] {
  return body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}
