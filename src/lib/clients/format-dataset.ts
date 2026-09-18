// What one written-post shape actually extracted, recorded per page.
//
// Matthew, 2026-09-18: "make sure we craft the path for systemizing that type of post by extracting
// the neccesary dataset from that specific angle, post, type of content."
//
// This is the systemizing half. src/config/post-formats.ts declares, per shape, the fields that
// shape has to carry: a comparison needs two subjects, the axes and a verdict per axis; a list needs
// an N, the items and what ranked them. The outline turns each of those into a GAP carrying a
// `field` key, a person answers the gaps out loud, and this file reads those answers back and files
// them under the key the field declared. That is what turns a post type into a repeatable path
// rather than a label on a page.
//
// ‼️ `missing` IS THE POINT OF THIS FILE AND NOTHING HERE MAY DEFAULT OR INFER A FIELD. A list whose
// rankingBasis was never answered is a list nobody can argue with, and the corpus has to be able to
// SAY that rather than quietly carry an empty string that later reads as an answer. Same doctrine as
// score_measured in the scraper lane and the MxVerdict tri-state: "we could not look" and "there is
// nothing there" are different answers and must never collapse into one.
//
// ‼️ IT READS page_sources, NOT THE BODY. The body is prose written FROM the answers; the answer
// itself is the verbatim source row the studio filed when somebody dictated it. Parsing the field
// back out of the finished page would be inventing structure the person never stated.

import { supabaseAdmin } from "@/lib/db";
import { getPostFormat } from "@/config/post-formats";
import type { PageOutline } from "@/lib/hub/pages";

export interface FormatDataset {
  /** The shape this page was written as. Null when it has none. */
  format: string | null;
  /** field key to the verbatim answer somebody gave. */
  values: Record<string, string>;
  /** REQUIRED field keys with no answer on file. Never inferred, never defaulted. */
  missing: string[];
}

export const EMPTY_FORMAT_DATASET: FormatDataset = { format: null, values: {}, missing: [] };

/**
 * Build the dataset for one page.
 *
 * Degrades to an empty object at every step: this is a research artifact and it may never cost a
 * capture, let alone a page. Same fire-and-forget contract capturePage itself keeps.
 */
export async function formatDatasetFor(args: {
  clientId: string;
  pageId: string;
  postFormat: string | null;
  outline: PageOutline | null;
}): Promise<FormatDataset> {
  const format = getPostFormat(args.postFormat);
  if (!format) return EMPTY_FORMAT_DATASET;

  const declared = new Map(format.dataset.map((f) => [f.key, f]));

  // Which gap answers which field. An outline written before the axis carries no `field` at all,
  // which is not a failure: it resolves to every required field being missing, which is true.
  const gapField = new Map<string, string>();
  for (const gap of args.outline?.gaps ?? []) {
    const field = typeof gap.field === "string" ? gap.field.trim() : "";
    if (field && declared.has(field)) gapField.set(gap.id, field);
  }

  const values: Record<string, string> = {};

  if (gapField.size) {
    try {
      const { data, error } = await supabaseAdmin
        .from("page_sources")
        .select("topic, source_content, created_at")
        .eq("client_id", args.clientId)
        .eq("page_id", args.pageId)
        .order("created_at", { ascending: true });

      if (error) {
        console.error(`[format-dataset] sources read failed: ${error.message}`);
      } else {
        for (const row of data ?? []) {
          const topic = String(row.topic ?? "");
          // The studio files a gap answer under `Gap G3: <the prompt>`, which draft-page.ts's own
          // prompt promises. Read the id off the front rather than matching the prompt text, which
          // is model-written and changes between runs.
          const m = /^Gap\s+(G\d+)\b/i.exec(topic);
          if (!m) continue;
          const field = gapField.get(m[1].toUpperCase());
          if (!field) continue;
          const content = String(row.source_content ?? "").trim();
          if (!content) continue;
          // Oldest wins, so a later re-answer does not silently replace what the page was written
          // from. The page is the product of the answer that existed when it was drafted.
          if (!(field in values)) values[field] = content;
        }
      }
    } catch (e) {
      console.error("[format-dataset] threw:", (e as Error).message);
    }
  }

  const missing = format.dataset
    .filter((f) => f.required && !(f.key in values))
    .map((f) => f.key);

  return { format: format.id, values, missing };
}
