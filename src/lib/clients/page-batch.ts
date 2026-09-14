// One batch of pages, decided end to end before any research fires.
//
// ‼️ THE ORDER IS DECISION D3 AND IT IS THE WHOLE DESIGN: pillar, then a headline per page, then a
// skeleton per page, then ONE research for the batch, then draft them all. Every choice for every
// page is made BEFORE the research, which is what makes the research one shot. Reordering any of
// these turns 14 paste-backs a day into 98.
//
// ‼️ THE DRAFTING CHANNEL ASKS WHICH PILLAR, THE ONBOARDING CHANNEL NEVER DOES (D2). An onboarding
// always starts 1 pillar + 6 supports, so there is nothing to ask: runPreCallPlan keeps the
// behaviour it has. A later batch in the drafting channel may be supports under a pillar that
// already exists, so that one asks first.
//
// ‼️ NO STATE TABLE, AND THE STAGE IS DERIVED. A batch's stage is a question its own artifacts
// already answer: no headline on a plan row means the headline stage, no outline on its page means
// the skeleton stage, and so on. A stored stage is a second source of truth that goes stale the
// moment somebody edits a row on the board, and then the card and the database disagree about
// where the work is.

import { supabaseAdmin } from "@/lib/db";
import { loadPlan, type PlanRow } from "./page-plan";
import { readPageOutline, type PageOutline } from "@/lib/hub/pages";

/**
 * `batch`, `batch new`, `batch under 3`, `batch approve`.
 *
 * Anchored at both ends, like everything in the studio dispatch. "batch" alone is a word somebody
 * could dictate, so it is only a command as the WHOLE message.
 */
export const BATCH_COMMAND = /^batch(?:\s+(new|approve|under\s+[0-9]{1,2}))?$/i;

/** `headline 3 pick 2`, `headline 3 more`. */
export const HEADLINE_COMMAND = /^headline\s+([0-9]{1,2})\s+(?:pick\s+([0-9]{1,2})|(more))$/i;

/** `skeleton`, `skeleton 3 more`. */
export const SKELETON_COMMAND = /^skeleton(?:\s+([0-9]{1,2})\s+more)?$/i;

/** Where a batch has got to. Derived, never stored. */
export type BatchStage = "no_plan" | "headlines" | "skeletons" | "research" | "drafting" | "done";

export interface BatchState {
  stage: BatchStage;
  rows: PlanRow[];
  pillar: PlanRow | null;
  supports: PlanRow[];
  outlines: Map<string, PageOutline | null>;
  /** Plan rows with no headline yet. */
  needHeadline: PlanRow[];
  /** Plan rows with a headline and no skeleton. */
  needSkeleton: PlanRow[];
  /** Plan rows whose page has a body. */
  drafted: PlanRow[];
}

/**
 * The batch id, for the dataset.
 *
 * ‼️ IT IS THE PILLAR'S OWN PLAN ROW ID, NOT A NEW UUID, AND THAT IS DELIBERATE. A batch is
 * "a pillar and the supports under it", which page_plan.pillar_id already records. Minting a
 * separate id would need somewhere to store it, and a stored id is a second way of saying the
 * same thing that can disagree with the first. Everything in one batch shares this, which is all
 * page_dataset.batch_id is for.
 */
export function batchIdFor(state: BatchState): string | null {
  return state.pillar?.id ?? null;
}

/**
 * Read where the batch is from what exists.
 *
 * The rows are the pre-call plan: a row with a role, approved or claimed. That is the same filter
 * pre-call-pages.ts's approvedRows uses, deliberately, so the batch card and the drafter can never
 * disagree about which pages are in play.
 */
export async function readBatch(clientId: string): Promise<BatchState | { error: string }> {
  const plan = await loadPlan(clientId);
  if ("error" in plan) return { error: plan.error };

  const rows = plan.rows
    .filter((r) => r.role && (r.status === "approved" || r.status === "claimed"))
    .sort((a, b) => a.rank - b.rank);

  if (!rows.length) {
    return {
      stage: "no_plan",
      rows: [],
      pillar: null,
      supports: [],
      outlines: new Map(),
      needHeadline: [],
      needSkeleton: [],
      drafted: [],
    };
  }

  const outlines = new Map<string, PageOutline | null>();
  for (const row of rows) {
    outlines.set(row.id, row.pageId ? await readPageOutline(clientId, row.pageId) : null);
  }

  const headlines = await headlinesOnPlan(clientId, rows.map((r) => r.id));
  const bodies = await pagesWithBodies(clientId, rows.map((r) => r.pageId).filter((id): id is string => Boolean(id)));

  const needHeadline = rows.filter((r) => !headlines.get(r.id));
  const needSkeleton = rows.filter((r) => headlines.get(r.id) && !outlines.get(r.id));
  const drafted = rows.filter((r) => r.pageId && bodies.has(r.pageId));

  const stage: BatchStage = needHeadline.length
    ? "headlines"
    : needSkeleton.length
      ? "skeletons"
      : drafted.length === rows.length
        ? "done"
        : drafted.length
          ? "drafting"
          : "research";

  return {
    stage,
    rows,
    pillar: rows.find((r) => r.role === "pillar") ?? null,
    supports: rows.filter((r) => r.role === "support"),
    outlines,
    needHeadline,
    needSkeleton,
    drafted,
  };
}

/**
 * page_plan.headline per row.
 *
 * ‼️ ITS OWN SELECT, degrading to an empty map. Same blast-radius rule as everywhere else that
 * touches this column: PostgREST fails a whole select on one unknown column, and `headline` is
 * newer than the rest of page_plan. Without the 2026-09-12 migration this reports "no headlines
 * yet" rather than taking the batch card down.
 */
async function headlinesOnPlan(clientId: string, ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;

  const { data, error } = await supabaseAdmin
    .from("page_plan")
    .select("id, headline")
    .eq("client_id", clientId)
    .in("id", ids as string[]);

  if (error) {
    console.error(
      `[page-batch] headline read failed (${error.message}). If this names headline, ` +
        `docs/2026-09-12-client-headlines.sql has not been run.`
    );
    return out;
  }

  for (const row of data ?? []) {
    const h = ((row.headline as string | null) ?? "").trim();
    if (h) out.set(String(row.id), h);
  }
  return out;
}

async function pagesWithBodies(clientId: string, pageIds: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!pageIds.length) return out;

  const { data, error } = await supabaseAdmin
    .from("client_pages")
    .select("id, answer_md")
    .eq("client_id", clientId)
    .in("id", pageIds as string[]);

  if (error) {
    console.error(`[page-batch] body read failed: ${error.message}`);
    return out;
  }

  for (const row of data ?? []) {
    if (((row.answer_md as string | null) ?? "").trim()) out.add(String(row.id));
  }
  return out;
}

/**
 * Pillars this client already has, for `batch under N`.
 *
 * A pillar is a plan row with role 'pillar'. It does not have to be published or even drafted:
 * page_plan.pillar_id is a pointer between plan rows, and the supports under a draft pillar are
 * perfectly plannable. What plan-links.ts refuses to do is LINK to an unpublished pillar, which is
 * a separate decision made at render time.
 */
export async function existingPillars(clientId: string): Promise<PlanRow[]> {
  const plan = await loadPlan(clientId);
  if ("error" in plan) return [];
  return plan.rows.filter((r) => r.role === "pillar").sort((a, b) => a.rank - b.rank);
}

// ─────────────────────────────────────────────────────────────────────────────
// The cards
//
// ‼️ ONE CARD FOR THE WHOLE BATCH, NUMBERED (D7). Seven cards is seven notifications for one
// decision, and the numbering is what makes `headline 3 pick 2` mean anything. The numbers are
// POSITIONAL against rank order, the same numbering buildBatchResearchPrompt's [Pn] tags use, so
// a person reading the card and a researcher reading the prompt are looking at the same page 3.
// ─────────────────────────────────────────────────────────────────────────────

export function pillarQuestionLines(pillars: readonly PlanRow[]): string[] {
  if (!pillars.length) {
    return [
      "*Starting a batch.* This client has no pillar yet, so this one starts a new one.",
      "`batch new` writes a pillar and six supports from the approved keywords.",
    ];
  }

  return [
    "*Starting a batch.* Is this a new pillar, or supports under one that exists?",
    "",
    ...pillars.map((p, i) => `  ${i + 1}. ${p.workingTitle || p.question}`),
    "",
    "`batch new` starts a new pillar with six supports.",
    "`batch under 1` puts this batch under the pillar numbered above.",
  ];
}

/** The headline card: every page, its three options, numbered. */
export function headlineCardLines(
  rows: readonly PlanRow[],
  options: ReadonlyMap<string, readonly string[]>
): string[] {
  const lines = [`*Headlines for ${rows.length} pages.* Pick one per page.`, ""];

  rows.forEach((row, i) => {
    const n = i + 1;
    lines.push(`*P${n}. ${row.workingTitle || row.question}*`);
    if (row.targetKeyword) lines.push(`_aimed at: ${row.targetKeyword}_`);
    const opts = options.get(row.id) ?? [];
    if (!opts.length) lines.push("  (none written yet)");
    else opts.forEach((h, j) => lines.push(`  ${j + 1}. ${h}`));
    lines.push("");
  });

  lines.push("`headline 3 pick 2` takes option 2 for page 3. `headline 3 more` writes three new ones.");
  return lines;
}

/** The skeleton card: every page, its headings and how many gaps it will ask about. */
export function skeletonCardLines(
  rows: readonly PlanRow[],
  outlines: ReadonlyMap<string, PageOutline | null>
): string[] {
  const lines = [`*Skeletons for ${rows.length} pages.*`, ""];
  let gaps = 0;

  rows.forEach((row, i) => {
    const outline = outlines.get(row.id) ?? null;
    lines.push(`*P${i + 1}. ${row.headline || row.workingTitle || row.question}*`);
    if (!outline) {
      lines.push("  (not written yet)");
    } else {
      outline.sections.forEach((s) => lines.push(`  ${s.heading}${s.keyword ? `  _${s.keyword}_` : ""}`));
      gaps += outline.gaps.length;
      lines.push(`  _${outline.sections.length} sections, ${outline.gaps.length} questions for the business_`);
    }
    lines.push("");
  });

  // ‼️ THE QUESTION COUNT BEFORE THE PROMPT IS RUN, not after the answer comes back. It is the
  // difference between pasting a prompt and knowing whether what returns is the right size.
  lines.push(`*${gaps} questions across ${rows.length} pages*, which is ONE research prompt.`);
  lines.push("`skeleton 3 more` rewrites page 3's. `batch approve` builds the prompt.");
  return lines;
}

/** Where the batch is, in one line, for the top of any card. */
export function stageLine(state: BatchState): string {
  switch (state.stage) {
    case "no_plan":
      return "No approved plan rows yet. `plan` proposes them and `plan approve` locks them in.";
    case "headlines":
      return `${state.needHeadline.length} of ${state.rows.length} pages still need a headline.`;
    case "skeletons":
      return `${state.needSkeleton.length} of ${state.rows.length} pages still need a skeleton.`;
    case "research":
      return `${state.rows.length} pages planned and outlined. \`batch approve\` builds the one research prompt.`;
    case "drafting":
      return `${state.drafted.length} of ${state.rows.length} pages drafted.`;
    case "done":
      return `All ${state.rows.length} pages drafted.`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The work, shared by both doors
//
// ‼️ ONE IMPLEMENTATION, TWO DOORS, THE PRECEDENT PLAN_COMMAND SET. The batch is reachable from
// the drafting channel (a page studio session) and from step 21's own thread in the client's
// onboarding channel. Those two post through completely different machinery, so what is shared is
// the WORK and what differs is only how the text gets out.
//
// Writing this twice is how the two doors end up disagreeing about what `headline 3 pick 2` does,
// and a person would be right either time.
// ─────────────────────────────────────────────────────────────────────────────

/** Three new candidates for one page, filed and claimed for it. */
export async function writeHeadlinesFor(
  clientId: string,
  row: PlanRow
): Promise<{ ok: true; headlines: string[] } | { ok: false; error: string }> {
  if (!row.targetKeyword?.trim()) {
    return { ok: false, error: `page ${row.rank} has no target keyword, so there is nothing to aim a headline at` };
  }

  const { generateKeywordHeadlines, storeHeadlines } = await import("./client-headlines");

  const got = await generateKeywordHeadlines({ clientId, keyword: row.targetKeyword });
  if (!got.ok) return got;

  const stored = await storeHeadlines({ clientId, headlines: got.headlines, origin: "keyword" });
  if (!stored.ok) return stored;

  // ‼️ CLAIMED FOR THIS PLAN ROW IMMEDIATELY, which is what makes the card's per-page numbering
  // mean anything. used_page_id holds the PLAN ROW id, the same id approveHeadlineForPage writes,
  // so a claimed-but-unapproved row is "an option offered for this page" and an approved one is
  // "the option taken". One column, two states, no second table.
  for (const h of stored.stored) {
    await supabaseAdmin
      .from("client_headlines")
      .update({ used_page_id: row.id })
      .eq("id", h.id)
      .eq("client_id", clientId);
  }

  return { ok: true, headlines: stored.stored.map((h) => h.headline) };
}

/**
 * The options offered for each page, read back from the bank.
 *
 * ‼️ READ FROM client_headlines RATHER THAN HELD IN A THREAD. A Slack thread is not storage: the
 * numbering has to survive a restart, a second person opening the thread, and the hours between
 * writing the options and picking one. At 14 onboardings a day that gap is normal, not an edge.
 */
export async function optionsFor(
  clientId: string,
  rows: readonly PlanRow[]
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const { data, error } = await supabaseAdmin
    .from("client_headlines")
    .select("id, headline, used_page_id")
    .eq("client_id", clientId)
    .eq("origin", "keyword")
    .is("dropped_at", null)
    .order("created_at", { ascending: true });

  if (error) {
    console.error(`[page-batch] options read failed: ${error.message}`);
    for (const row of rows) out.set(row.id, []);
    return out;
  }

  for (const row of rows) {
    out.set(
      row.id,
      (data ?? []).filter((r) => r.used_page_id === row.id).map((r) => String(r.headline))
    );
  }
  return out;
}

/** Take option `pick` (1-based) for one page. */
export async function pickHeadlineFor(
  clientId: string,
  row: PlanRow,
  pick: number,
  by: string
): Promise<{ ok: true; headline: string } | { ok: false; error: string }> {
  const options = (await optionsFor(clientId, [row])).get(row.id) ?? [];
  const chosen = options[pick - 1];
  if (!chosen) {
    return {
      ok: false,
      error: `page ${row.rank} has ${options.length} option${options.length === 1 ? "" : "s"}, so there is no ${pick}`,
    };
  }

  const { data: match } = await supabaseAdmin
    .from("client_headlines")
    .select("id")
    .eq("client_id", clientId)
    .eq("headline", chosen)
    .maybeSingle();

  if (!match?.id) return { ok: false, error: "that headline is no longer on file" };

  const { approveHeadlineForPage } = await import("./client-headlines");
  return approveHeadlineForPage({
    clientId,
    headlineId: String(match.id),
    planRowId: row.id,
    by,
  });
}

/**
 * Write the skeleton for each of `rows`, opening a page for any row that has none yet.
 *
 * Returns one note per row that failed, so a caller can report the failures without losing the
 * ones that worked. A batch where six of seven skeletons landed is six pages further on, and
 * failing the whole call would throw those away.
 */
export async function writeSkeletonsFor(
  clientId: string,
  rows: readonly PlanRow[]
): Promise<{ written: number; failures: string[] }> {
  const { draftOutline } = await import("@/lib/hub/draft-page");
  const { setPageOutline, startPageDraft } = await import("@/lib/hub/pages");

  let written = 0;
  const failures: string[] = [];

  for (const row of rows) {
    let pageId = row.pageId;

    if (!pageId) {
      const started = await startPageDraft({
        clientId,
        question: row.question,
        title: row.workingTitle,
      });
      if (!started.ok) {
        failures.push(`page ${row.rank}: ${started.error}`);
        continue;
      }
      pageId = started.id;
      // Linked and claimed now, so the page stays tied to its plan row even if the outline call
      // below dies. Same reasoning draftOne's markClaimed carries.
      await supabaseAdmin
        .from("page_plan")
        .update({ page_id: pageId, status: "claimed" })
        .eq("id", row.id)
        .eq("client_id", clientId);
    }

    const outline = await draftOutline(clientId, row.question, {
      pageId,
      context: {
        workingTitle: row.workingTitle,
        targetKeyword: row.targetKeyword,
        angle: row.angle,
      },
    });
    if (!outline.ok) {
      failures.push(`page ${row.rank}: ${outline.error}`);
      continue;
    }

    const saved = await setPageOutline(clientId, pageId, outline.outline);
    if (!saved.ok) {
      failures.push(`page ${row.rank}: ${saved.error}`);
      continue;
    }
    written += 1;
  }

  return { written, failures };
}

/**
 * The one research prompt for the whole batch.
 *
 * ‼️ IT RETURNS A PROMPT. IT DOES NOT RUN ONE (D10). Matthew was asked directly on 2026-09-14 and
 * chose the manual paste-back over automating this by API, because he reads every answer. Nothing
 * on this path calls a research model, and nothing should be added that does.
 */
export async function buildBatchPrompt(
  clientId: string
): Promise<{ ok: true; prompt: string; questions: number; pages: number } | { ok: false; error: string }> {
  const state = await readBatch(clientId);
  if ("error" in state) return { ok: false, error: state.error };

  if (state.needHeadline.length || state.needSkeleton.length) {
    const parts: string[] = [];
    if (state.needHeadline.length) parts.push(`${state.needHeadline.length} need a headline`);
    if (state.needSkeleton.length) parts.push(`${state.needSkeleton.length} need a skeleton`);
    return { ok: false, error: `not yet: ${parts.join(", ")}` };
  }

  const { loadBatchPages, buildBatchResearchPrompt } = await import("./batch-research");
  const pages = await loadBatchPages(clientId, state.rows.map((r) => r.id));

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("legal_name, dba_name, city, state")
    .eq("id", clientId)
    .maybeSingle();

  const { loadOffer } = await import("./offers");
  const offer = await loadOffer(clientId).catch(() => null);
  const { confirmedAvatarFor } = await import("./avatars");
  const avatar = await confirmedAvatarFor(clientId).catch(() => null);

  const built = buildBatchResearchPrompt({
    clientName: ((client?.dba_name as string) || (client?.legal_name as string)) ?? "this client",
    city: (client?.city as string | null) ?? null,
    state: (client?.state as string | null) ?? null,
    avatarLabel: avatar?.label ?? "the buyer",
    offer: offer?.treatment ?? null,
    pages,
  });

  if (!built.ok) return built;

  // The prompt belongs to the batch, so it is attached to every dataset row of that batch rather
  // than carried through each capture. See attachResearchPrompt.
  const batchId = batchIdFor(state);
  if (batchId) {
    const { attachResearchPrompt } = await import("./page-dataset");
    void attachResearchPrompt({ clientId, batchId, prompt: built.prompt });
  }

  return { ok: true, prompt: built.prompt, questions: built.questions, pages: pages.length };
}
