// The record of every page this lane produces, kept so the pipeline has something to learn from.
//
// Matthew, 2026-09-14: "everything we need to save the datasets of our posting data from the pages
// that we publish, this way we build a pipeline of drafting and this will be the database for our
// future AI model, this way we can collect the data and soon build workflows etc to create more
// pages, SEO is all about volumen and quality content."
//
// ‼️ APPEND ONLY, ONE ROW PER CAPTURE, NEVER UPDATED IN PLACE. The value of this table is the
// DIFFERENCE between what the model drafted and what actually shipped. A table that overwrote
// itself would keep only the final state, which is the one version that teaches nothing about the
// edit somebody made to it.
//
// ‼️ EVERY WRITE IS FIRE AND FORGET AND NONE OF THEM MAY FAIL A DRAFT. Same shape as the
// recordSource call in page-studio.ts's append(). This is a research artifact; the page is the
// product. If the dataset write throws, the draft still stands and a line goes to the log.
//
// ‼️ NO RANKING OR CITATION COLUMNS, AND THAT IS DELIBERATE. Nothing in this repo measures whether
// a published page was ever cited: weekly-report.ts's ATTRIBUTION_NOT_WIRED says so to the client
// in writing. A column no process can fill would put an invented number into the training set,
// which is worse than an absent one because a later reader cannot tell it was never measured.

import { supabaseAdmin } from "@/lib/db";

/** Why a snapshot exists. Matches the check constraint on page_dataset.captured_reason. */
export type CaptureReason = "drafted" | "edited" | "published";

export interface CaptureInput {
  clientId: string;
  pageId: string | null;
  planRowId?: string | null;
  /** Shared by every page of one batch, so a batch can be reassembled later. */
  batchId?: string | null;
  role?: "pillar" | "support" | null;
  verticalSlug?: string | null;
  reason: CaptureReason;
}

/**
 * Capture one page as it stands right now.
 *
 * ‼️ IT READS THE PAGE ITSELF RATHER THAN TAKING IT AS AN ARGUMENT, and that is the point. A
 * caller that passed the body it just wrote would record what it INTENDED to save; reading it
 * back records what is actually stored, which is the only version anybody will ever serve. The
 * two differ exactly when something went wrong, which is the case worth having in the corpus.
 *
 * Every read here is its own select and every one degrades. A missing column costs a field in the
 * dataset and must never cost the capture, let alone the page.
 */
export async function capturePage(input: CaptureInput): Promise<void> {
  try {
    if (!input.pageId) return;

    const { data: page, error: pageError } = await supabaseAdmin
      .from("client_pages")
      .select("slug, title, question, answer_md, meta_description, evidence_map, status, published_at")
      .eq("id", input.pageId)
      .eq("client_id", input.clientId)
      .maybeSingle();

    if (pageError || !page) {
      console.error(`[page-dataset] page read failed: ${pageError?.message ?? "no row"}`);
      return;
    }

    // Separate, because these are the newest columns in the table and the blast-radius rule in
    // pages.ts applies: one unknown column fails a whole select.
    const outline = await readOne("client_pages", "outline", input.pageId, input.clientId);
    const sectionKeywords = await readOne("client_pages", "section_keywords", input.pageId, input.clientId);

    const plan = input.planRowId ? await readPlan(input.clientId, input.planRowId) : null;
    const gate = await latestVerdict(input.clientId, input.pageId);
    const sourceCount = await countSources(input.clientId, input.pageId);
    const headlineCandidates = plan ? await candidatesFor(input.clientId, plan.headline) : null;

    // ‼️ THE DATASETS THE DRAFT IS A VARIATION OF (2026-09-17). Everything above records what was
    // PRODUCED. Without these the corpus could never answer "what was this written from", which is
    // the only question a model trained on it would need answered. Matthew: "when we have a draft
    // is just a bunch of different variation of all of the required datasets".
    const angle = input.planRowId ? await readAngle(input.clientId, input.planRowId) : null;
    const magnetKey = await readOne("client_pages", "lead_magnet_key", input.pageId, input.clientId);
    const magnetCandidates = input.planRowId
      ? await magnetsFor(input.clientId, input.planRowId, magnetKey as string | null)
      : null;
    // Which attempt this is. Counted from the runs table rather than held on a counter column: a
    // counter is a second source of truth that drifts the first time a row is inserted by hand.
    const { planRunCount } = await import("./page-plan-runs");
    const variantNo = await planRunCount(input.clientId).catch(() => 0);

    const { error } = await supabaseAdmin.from("page_dataset").insert({
      client_id: input.clientId,
      page_id: input.pageId,
      plan_id: input.planRowId ?? null,
      batch_id: input.batchId ?? null,
      role: input.role ?? plan?.role ?? null,
      vertical_slug: input.verticalSlug ?? null,

      slug: (page.slug as string | null) ?? null,
      title: (page.title as string | null) ?? null,
      meta_description: (page.meta_description as string | null) ?? null,

      headline: plan?.headline ?? null,
      headline_candidates: headlineCandidates,

      primary_keyword: plan?.targetKeyword ?? null,
      primary_keyword_id: plan?.targetKeywordId ?? null,
      secondary_keywords: plan?.secondaryKeywords ?? null,
      section_keywords: sectionKeywords,
      outline,

      body_md: (page.answer_md as string | null) ?? null,
      evidence_map: page.evidence_map ?? null,
      source_count: sourceCount,

      research_prompt: null,

      gate_verdict: gate?.verdict ?? null,
      gate_checks: gate?.checks ?? null,

      captured_reason: input.reason,
      published_at: (page.published_at as string | null) ?? null,

      audience_id: plan?.audienceId ?? null,
      offer_id: plan?.offerId ?? null,
      angle_id: angle?.id ?? null,
      angle: angle?.idea ?? plan?.angle ?? null,
      narrative: angle?.narrative ?? null,
      indoctrination: angle?.indoctrination ?? null,
      awareness_entry: angle?.awarenessEntry ?? plan?.awarenessEntry ?? null,
      awareness_target: angle?.awarenessTarget ?? plan?.awarenessTarget ?? null,
      lead_magnet_key: (magnetKey as string | null) ?? null,
      magnet_candidates: magnetCandidates,
      variant_no: variantNo,
    });

    if (error) {
      console.error(
        `[page-dataset] capture failed (${error.message}). If this names page_dataset, the ` +
          `2026-09-14 migration has not been run on this database.`
      );
    }
  } catch (e) {
    console.error("[page-dataset] capture threw:", (e as Error).message);
  }
}

/** One column, on its own, so an unknown one costs a field instead of the row. */
async function readOne(
  table: string,
  column: string,
  id: string,
  clientId: string
): Promise<unknown | null> {
  const { data, error } = await supabaseAdmin
    .from(table)
    .select(column)
    .eq("id", id)
    .eq("client_id", clientId)
    .maybeSingle();

  if (error) {
    console.error(`[page-dataset] ${table}.${column} read failed: ${error.message}`);
    return null;
  }
  return (data as Record<string, unknown> | null)?.[column] ?? null;
}

interface PlanAim {
  headline: string | null;
  targetKeyword: string | null;
  targetKeywordId: string | null;
  secondaryKeywords: string[] | null;
  role: "pillar" | "support" | null;
  audienceId: string | null;
  offerId: string | null;
  angle: string | null;
  awarenessEntry: number | null;
  awarenessTarget: number | null;
}

async function readPlan(clientId: string, planRowId: string): Promise<PlanAim | null> {
  const { data, error } = await supabaseAdmin
    .from("page_plan")
    .select(
      "headline, target_keyword, target_keyword_id, secondary_keywords, role, audience_id, offer_id, angle, awareness_entry, awareness_target"
    )
    .eq("id", planRowId)
    .eq("client_id", clientId)
    .maybeSingle();

  if (error) {
    console.error(`[page-dataset] plan read failed: ${error.message}`);
    return null;
  }
  if (!data) return null;

  return {
    headline: (data.headline as string | null) ?? null,
    targetKeyword: (data.target_keyword as string | null) ?? null,
    targetKeywordId: (data.target_keyword_id as string | null) ?? null,
    secondaryKeywords: Array.isArray(data.secondary_keywords) ? (data.secondary_keywords as string[]) : null,
    role: (data.role as "pillar" | "support" | null) ?? null,
    audienceId: (data.audience_id as string | null) ?? null,
    offerId: (data.offer_id as string | null) ?? null,
    angle: (data.angle as string | null) ?? null,
    awarenessEntry: (data.awareness_entry as number | null) ?? null,
    awarenessTarget: (data.awareness_target as number | null) ?? null,
  };
}

interface CapturedAngle {
  id: string;
  idea: string | null;
  narrative: string | null;
  indoctrination: string | null;
  awarenessEntry: number | null;
  awarenessTarget: number | null;
}

/** The angle the page was actually written from: the approved one for this plan row. */
async function readAngle(clientId: string, planRowId: string): Promise<CapturedAngle | null> {
  const { data, error } = await supabaseAdmin
    .from("page_angles")
    .select("id, idea, narrative, indoctrination, awareness_entry, awareness_target")
    .eq("client_id", clientId)
    .eq("plan_id", planRowId)
    .eq("status", "approved")
    .maybeSingle();

  if (error) {
    console.error(`[page-dataset] angle read failed: ${error.message}`);
    return null;
  }
  if (!data) return null;

  return {
    id: String(data.id),
    idea: (data.idea as string | null) ?? null,
    narrative: (data.narrative as string | null) ?? null,
    indoctrination: (data.indoctrination as string | null) ?? null,
    awarenessEntry: (data.awareness_entry as number | null) ?? null,
    awarenessTarget: (data.awareness_target as number | null) ?? null,
  };
}

/**
 * Every magnet offered for this page, marking which one won.
 *
 * ‼️ THE REJECTS ARE THE POINT, the same reasoning candidatesFor already carries for headlines. A
 * corpus of only the chosen offer shows what a good one looks like and says nothing about what made
 * it better than the two beside it.
 */
async function magnetsFor(
  clientId: string,
  planRowId: string,
  chosenKey: string | null
): Promise<unknown | null> {
  const { data, error } = await supabaseAdmin
    .from("page_magnet_candidates")
    .select("title, promise, cta_label, concierge_entry, status, minted_magnet_key, rationale")
    .eq("client_id", clientId)
    .eq("plan_id", planRowId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error(`[page-dataset] magnet candidates read failed: ${error.message}`);
    return null;
  }

  const rows = (data ?? []).map((r) => ({
    title: (r.title as string | null) ?? null,
    promise: (r.promise as string | null) ?? null,
    ctaLabel: (r.cta_label as string | null) ?? null,
    conciergeEntry: (r.concierge_entry as string | null) ?? null,
    status: String(r.status),
    chosen: Boolean(chosenKey) && r.minted_magnet_key === chosenKey,
    rationale: (r.rationale as string | null) ?? null,
  }));

  return rows.length ? rows : null;
}

/**
 * The headlines that were offered for this page, marking which one won.
 *
 * ‼️ THE REJECTS ARE THE POINT. A corpus of only winners cannot teach a preference: it shows what
 * a good headline looks like and says nothing about what made it better than the two beside it.
 * Same reasoning client_headlines.dropped_at already carries.
 *
 * Matched on the chosen headline's own text rather than on a batch id, because the candidates are
 * written before anything knows which page they will land on.
 */
async function candidatesFor(clientId: string, chosen: string | null): Promise<unknown | null> {
  if (!chosen?.trim()) return null;

  const { data, error } = await supabaseAdmin
    .from("client_headlines")
    .select("headline, origin, approved, dropped_at, used_page_id")
    .eq("client_id", clientId)
    .eq("origin", "keyword")
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) {
    console.error(`[page-dataset] candidates read failed: ${error.message}`);
    return null;
  }

  const rows = (data ?? []).map((r) => ({
    headline: String(r.headline),
    chosen: String(r.headline).trim() === chosen.trim(),
    dropped: r.dropped_at !== null,
  }));

  return rows.length ? rows : null;
}

async function latestVerdict(
  clientId: string,
  pageId: string
): Promise<{ verdict: string; checks: unknown } | null> {
  const { data, error } = await supabaseAdmin
    .from("page_gate_runs")
    .select("verdict, checks")
    .eq("client_id", clientId)
    .eq("page_id", pageId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(`[page-dataset] gate read failed: ${error.message}`);
    return null;
  }
  if (!data) return null;
  return { verdict: String(data.verdict), checks: data.checks ?? null };
}

async function countSources(clientId: string, pageId: string): Promise<number | null> {
  const { count, error } = await supabaseAdmin
    .from("page_sources")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("page_id", pageId);

  if (error) {
    console.error(`[page-dataset] source count failed: ${error.message}`);
    return null;
  }
  return count ?? 0;
}

/**
 * Attach the batch's research prompt to every row of that batch.
 *
 * ‼️ WRITTEN ONCE PER BATCH RATHER THAN CARRIED THROUGH EVERY CAPTURE, because the prompt is a
 * property of the batch and not of any page. This is the ONE update this table takes, and it only
 * ever fills a column that was null: it adds context to a snapshot, it does not revise one.
 */
export async function attachResearchPrompt(args: {
  clientId: string;
  batchId: string;
  prompt: string;
}): Promise<void> {
  const { error } = await supabaseAdmin
    .from("page_dataset")
    .update({ research_prompt: args.prompt })
    .eq("client_id", args.clientId)
    .eq("batch_id", args.batchId)
    .is("research_prompt", null);

  if (error) console.error(`[page-dataset] prompt attach failed: ${error.message}`);
}
