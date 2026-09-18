// Scanning for new datasets, so the onboarding gets smarter every week.
//
// Matthew, 2026-09-22: "use the inteligence of the onboarding to always scan for new datasets
// options in order to get smarter everyday ... mostly for datasets to become more specific and ways
// for us to get as much broad context as possible."
//
// ‼️ IT PROPOSES A FIELD. IT NEVER DECLARES ONE. dataset-spec.ts is the only authority on which
// fields exist, and its own rule is that a field declared anywhere else does not exist as far as
// this system is concerned. A row written here is an argument with a count attached; a person
// promotes it by writing the FieldSpec by hand. D7: the tool proposes, a person confirms.
//
// ‼️ THE ARGUMENT COMES FROM format_dataset.missing, WHICH IS A FACT ABOUT OUR PROCESS.
// A required field that pages of one shape keep failing to answer is a field the research prompt
// should start asking for. That is a statement about what nobody collected, not a claim that any
// page performed well or badly, and the difference is what makes this safe to compute at all.
// See the header of page-corpus.ts for what this corpus may and may not be asked.

import { supabaseAdmin } from "@/lib/db";
import { getPostFormat } from "@/config/post-formats";
import { DATASET_FIELDS } from "./dataset-spec";
import { readCorpus, type ShapeGap } from "./page-corpus";

/** How often a shape has to leave a field unanswered before it is worth proposing. */
const PROPOSE_AT = 0.6;

/** And the fewest pages of that shape before the share above means anything at all. */
const MIN_PAGES = 3;

export interface DatasetProposal {
  proposedKey: string;
  label: string;
  dataset: "avatar" | "audience" | "offer";
  basis: string;
  observedCount: number;
  verticalSlug: string | null;
  postFormat: string;
}

/**
 * What the corpus says we keep failing to collect, for one vertical.
 *
 * ‼️ SCOPED TO A VERTICAL AND NEVER TO A CLIENT, and that is the cross-client doctrine rather than
 * a convenience. The unit here is "pages of this shape, in this vertical, keep lacking this field",
 * which is a fact about a shape and a vertical. A per-client version of the same observation is a
 * measurement about one client and must never be written into a shared argument, because
 * dataset_suggestions has no per-client key to unpick a wrong write by.
 */
export async function proposalsForVertical(verticalSlug: string): Promise<{
  proposals: DatasetProposal[];
  rows: number;
  unreadable: string | null;
}> {
  const corpus = await readCorpus({ verticalSlug });
  if (corpus.unreadable) return { proposals: [], rows: 0, unreadable: corpus.unreadable };

  const declared = new Set(DATASET_FIELDS.map((f) => f.key));
  const proposals: DatasetProposal[] = [];

  for (const shape of corpus.shapes) {
    for (const p of proposalsFromShape(shape, verticalSlug, declared)) proposals.push(p);
  }

  return { proposals, rows: corpus.rows, unreadable: null };
}

/**
 * PURE, so the probe can drive it with fixtures and no database.
 *
 * ‼️ A FIELD ALREADY DECLARED IN dataset-spec.ts IS NEVER PROPOSED AGAIN. It is not missing from
 * the registry, it is missing from the PAGES, and those are different problems with different
 * fixes: the first needs a FieldSpec, the second needs somebody to answer the gap. Proposing a
 * field that already exists would send a person to add a duplicate declaration.
 */
export function proposalsFromShape(
  shape: ShapeGap,
  verticalSlug: string | null,
  declared: ReadonlySet<string>
): DatasetProposal[] {
  if (shape.pages < MIN_PAGES) return [];
  const spec = getPostFormat(shape.postFormat);

  return shape.missing
    .filter((m) => m.count / shape.pages >= PROPOSE_AT)
    .filter((m) => !declared.has(m.field))
    .map((m) => ({
      proposedKey: m.field,
      label: m.label,
      // The shape's dataset fields describe the BUYER's situation and the argument a page makes,
      // which is the avatar dataset. A proposal that belongs elsewhere is a person's call to make
      // when they promote it, and the card says so rather than guessing confidently.
      dataset: "avatar" as const,
      basis: `page_dataset: ${m.count} of ${shape.pages} ${spec?.label.toLowerCase() ?? shape.postFormat} page(s) in ${verticalSlug ?? "this vertical"} recorded format_dataset.missing.${m.field}`,
      observedCount: m.count,
      verticalSlug,
      postFormat: shape.postFormat,
    }));
}

/**
 * File the open proposals, skipping any already on file.
 *
 * ‼️ THE UNIQUE INDEX ON (proposed_key) WHERE status = 'open' IS THE REAL GUARD, not this read.
 * The weekly scan re-derives the same arguments from the same corpus every Thursday, so without it
 * the card becomes a list of duplicates by week three. A 23505 here is the expected outcome of a
 * second run, not a fault, and is counted rather than logged as an error.
 */
export async function recordProposals(proposals: DatasetProposal[]): Promise<{ filed: number; already: number }> {
  let filed = 0;
  let already = 0;

  for (const p of proposals) {
    const { error } = await supabaseAdmin.from("dataset_suggestions").insert({
      proposed_key: p.proposedKey,
      label: p.label,
      dataset: p.dataset,
      basis: p.basis,
      observed_count: p.observedCount,
      client_id: null,
      vertical_slug: p.verticalSlug,
      post_format: p.postFormat,
    });

    if (!error) {
      filed += 1;
      continue;
    }
    if (error.code === "23505") {
      already += 1;
      continue;
    }
    console.error("[dataset-suggestions] proposal not filed:", error.message);
  }

  return { filed, already };
}

/**
 * The Thursday half that learns: read the corpus, propose, file, and say so once.
 *
 * ‼️ A PASSENGER ON followup-digest, THURSDAY, THE SAME DAY AS THE GUIDELINE SCAN AND THE TWO
 * EXISTING WEEKLY JOBS. weekly-headlines.ts states the reason they share a day: both are "here is
 * this week's work" and a person reading one is in the frame of mind for the other. Splitting them
 * means two separate interruptions for the same job.
 *
 * ‼️ NOTHING NEW MEANS NOTHING POSTED. The unique index makes a re-run file nothing, so a second
 * Thursday run is silent by construction rather than by a week stamp. Same economy as the guideline
 * scan: a weekly card that always says "no change" stops being read by week three.
 *
 * ‼️ NEVER THROWS. Every caller is a cron passenger where a thrown error is a silent nothing.
 */
export async function runWeeklyCorpusScan(opts?: {
  now?: Date;
  force?: boolean;
  announce?: boolean;
}): Promise<{ verticals: number; filed: number; already: number; posted: boolean; skipped: "weekday" | null }> {
  const nothing = { verticals: 0, filed: 0, already: 0, posted: false, skipped: null as "weekday" | null };
  try {
    const now = opts?.now ?? new Date();
    if (!opts?.force && now.getUTCDay() !== 4) return { ...nothing, skipped: "weekday" };

    const { data, error } = await supabaseAdmin.from("page_dataset").select("vertical_slug");
    if (error) {
      console.error("[dataset-suggestions] corpus unreadable:", error.message);
      return nothing;
    }

    const verticals = [
      ...new Set(
        ((data ?? []) as Array<{ vertical_slug: string | null }>)
          .map((r) => r.vertical_slug)
          .filter((v): v is string => Boolean(v))
      ),
    ];

    let filed = 0;
    let already = 0;
    const lines: string[] = [];

    for (const vertical of verticals) {
      const { proposals, rows } = await proposalsForVertical(vertical);
      if (proposals.length === 0) continue;
      const res = await recordProposals(proposals);
      filed += res.filed;
      already += res.already;
      if (res.filed > 0) {
        lines.push(`*${vertical}*  _read from page_dataset: ${rows} row(s)_`);
        for (const p of proposals.slice(0, 4)) {
          lines.push(`  - \`${p.proposedKey}\` (${p.label})`);
          lines.push(`    _read from: ${p.basis}_`);
        }
      }
    }

    if (filed === 0 && !opts?.announce) return { verticals: verticals.length, filed, already, posted: false, skipped: null };

    const body = [
      filed > 0
        ? `:bulb: *${filed} dataset field${filed === 1 ? "" : "s"} worth declaring.* Every page of a shape keeps leaving the same thing unanswered.`
        : ":bulb: *Nothing new to propose.* Every gap the corpus shows is already declared or already on file.",
      "",
      ...lines,
      ...(filed > 0
        ? [
            "",
            "These are PROPOSALS. `src/lib/clients/dataset-spec.ts` is the only authority on which fields exist,",
            "so accepting one means writing its FieldSpec by hand. Nothing here has been declared or filled.",
            "",
            "_Page performance is NOT MEASURED, so none of this argues from it. These count what nobody answered._",
          ]
        : []),
    ].join("\n");

    const { postToStudio } = await import("./policy-scan");
    const posted = await postToStudio(body);
    return { verticals: verticals.length, filed, already, posted, skipped: null };
  } catch (e) {
    console.error("[dataset-suggestions] weekly scan failed:", (e as Error).message);
    return nothing;
  }
}

/** The open proposals, newest first, for the card. */
export async function openProposals(limit = 5): Promise<DatasetProposal[]> {
  const { data, error } = await supabaseAdmin
    .from("dataset_suggestions")
    .select("proposed_key, label, dataset, basis, observed_count, vertical_slug, post_format")
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[dataset-suggestions] open proposals unreadable:", error.message);
    return [];
  }

  return (data ?? []).map((r) => ({
    proposedKey: String(r.proposed_key),
    label: String(r.label),
    dataset: r.dataset as DatasetProposal["dataset"],
    basis: String(r.basis),
    observedCount: Number(r.observed_count ?? 0),
    verticalSlug: (r.vertical_slug as string | null) ?? null,
    postFormat: String(r.post_format ?? ""),
  }));
}
