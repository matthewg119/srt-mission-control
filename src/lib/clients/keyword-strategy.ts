// The keyword strategy, the half that talks to the database and Slack.
//
// keyword-strategy-rules.ts holds the rules (the triage, the shortlist, the clustering, the grammar)
// and proves them without a network. This file stores what was decided and prints it.
//
// ‼️ EVERY READ HERE IS TOLERANT AND NAMES ITS MIGRATION. The strategy columns are deliberately NOT
// in KW_COLUMNS: that select is documented to fail loudly, and PostgREST fails a WHOLE select on one
// unknown column, so adding them there would take step 12 down between a deploy and the SQL. A
// database without docs/2026-09-26-keyword-strategy.sql reads as "no strategy yet", which is what it
// is, and every command says which file to run.
//
// ‼️ THE STRATEGY DIES WITH THE OFFER AND THE VERDICTS DO NOT. resetForNewOffer hard-deletes
// non-manual client_keywords rows, taking cluster_id, intent and merged_into with them, which is
// correct: a clustering of one offer is not a clustering of another. keyword_serp_reads is a
// separate table because a SERP is a fact about Google on a day, still true after we re-word what we
// sell.

import { supabaseAdmin } from "@/lib/db";
import { stepNumber } from "@/config/delivery-steps";
import { normalizePhrase } from "./phrase-quality";
import { isAwarenessStage, type AwarenessStage } from "@/lib/audit-engine/awareness";
import {
  AEO_ROUTING_RULE,
  SERP_TRIAGE_RULE,
  SHORTLIST_SIZE,
  bestVerdict,
  blockLine,
  citationValueFrom,
  clickValueFrom,
  clusterFinalists,
  gateClusters,
  intentFrom,
  isRecommendedAsset,
  isRoute,
  isVerdict,
  pageTypeFrom,
  parseStrategyCommand,
  pictured,
  routeFrom,
  routeLine,
  shortlistOf,
  stageName,
  typedVerdict,
  verdictFrom,
  verdictLine,
  KEYWORDS_SHORTLIST,
  KEYWORDS_SERP,
  KEYWORDS_SERP_TYPED,
  MAGNET_SET,
  SERP_CARDS,
  type ClusterGate,
  type Finalist,
  type SerpRead,
  type SerpReadRow,
  type Verdict,
} from "./keyword-strategy-rules";

/** Named in every refusal, so nobody has to guess which file is owed. */
const STRATEGY_SQL = "docs/2026-09-26-keyword-strategy.sql";
const SERP_SQL = "docs/2026-09-26-keyword-serp.sql";

export interface StrategyReply {
  message: string;
  after?: () => Promise<void>;
}

function missingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return (
    err.code === "42P01" ||
    err.code === "PGRST205" ||
    err.code === "42703" ||
    /does not exist|schema cache|column .* does not exist/i.test(err.message ?? "")
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading the finalists
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Approved query rows, with whatever strategy has been decided about them.
 *
 * ‼️ TWO SELECTS, NOT ONE, AND THE SECOND IS ALLOWED TO FAIL. The base columns are the ones
 * loadKeywords already relies on; the strategy columns may not exist yet. This is the sixth
 * instance of the tolerant-merge pattern page-plan.ts runs five times.
 */
async function loadFinalists(
  clientId: string
): Promise<{ ok: true; rows: Finalist[]; strategyReady: boolean } | { ok: false; error: string }> {
  const base = await supabaseAdmin
    .from("client_keywords")
    .select("id, phrase, normalized, category, score, rank, awareness_stage")
    .eq("client_id", clientId)
    .eq("use", "query")
    .eq("approved", true)
    .is("dropped_at", null)
    .order("rank", { ascending: true })
    .range(0, 2999);

  if (base.error) return { ok: false, error: base.error.message };

  const rows: Finalist[] = (base.data ?? []).map((r) => {
    const stage = r.awareness_stage as number | null;
    return {
      id: r.id as string,
      phrase: r.phrase as string,
      normalized: r.normalized as string,
      category: (r.category as string) ?? "other",
      score: Number(r.score ?? 0),
      rank: Number(r.rank ?? 0),
      awarenessStage: stage && isAwarenessStage(stage) ? (stage as AwarenessStage) : null,
      verdict: null,
      intent: null,
      mergedInto: null,
      pictured: false,
      route: null,
      clickValue: null,
      citationValue: null,
      magnetSpace: null,
      magnetIdea: null,
      magnetBy: null,
      recommendedAsset: null,
      readEvidence: null,
      docId: null,
      slackFileId: null,
    };
  });

  const extra = await supabaseAdmin
    .from("client_keywords")
    .select("id, intent, merged_into")
    .eq("client_id", clientId)
    .range(0, 2999);

  if (extra.error) {
    if (missingTable(extra.error)) return { ok: true, rows, strategyReady: false };
    return { ok: false, error: extra.error.message };
  }

  const by = new Map(rows.map((r) => [r.id, r]));
  for (const e of extra.data ?? []) {
    const row = by.get(e.id as string);
    if (!row) continue;
    const intent = e.intent as string | null;
    row.intent = intent === "post" || intent === "service_page" || intent === "merged" ? intent : null;
    row.mergedInto = (e.merged_into as string | null) ?? null;
  }

  await attachReadings(clientId, rows);
  return { ok: true, rows, strategyReady: true };
}

/**
 * The readings themselves, from the evidence table, merged onto the finalists.
 *
 * ‼️ THIS REPLACES READING client_keywords.serp_verdict, AND THAT COLUMN WAS A BUG WEARING A CACHE.
 * recordVerdict overwrites it on EVERY reading regardless of source, so a re-run of the vision pass
 * silently replaced a correction a person had typed ten minutes earlier. bestVerdict() exists
 * precisely to stop that, its docstring says so in capitals, and it had NO production caller at all:
 * verdictsFor() was written, exported, and never called by anything but the probe. The rule was
 * documented, tested, and not in force.
 *
 * ‼️ KEYED ON `normalized`, NOT ON keyword_id, and the migration explains why: resetForNewOffer
 * hard-deletes keyword rows when the offer changes, so keyword_id goes null while the reading stays
 * true. `normalized` is what re-attaches a SERP fact to the phrase it was about.
 *
 * ‼️ TOLERANT, AND A MISSING TABLE IS "NO READINGS", NOT AN ERROR. Same contract as the select above
 * it. Before the migration runs, every finalist reads as unchecked and unpictured, which is exactly
 * what it is.
 */
async function attachReadings(clientId: string, rows: Finalist[]): Promise<void> {
  const reads = await supabaseAdmin
    .from("keyword_serp_reads")
    .select(
      "normalized, source, created_at, verdict, doc_id, evidence, click_value, citation_value, route, recommended_asset, magnet_space, magnet_idea, magnet_by"
    )
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .range(0, 2999);

  if (reads.error || !reads.data?.length) return;

  const byPhrase = new Map<string, SerpReadRow[]>();
  for (const r of reads.data) {
    const key = (r.normalized as string) ?? "";
    const verdict = r.verdict as string | null;
    if (!key || !isVerdict(verdict)) continue;
    const list = byPhrase.get(key) ?? [];
    list.push({
      source: (r.source as "vision" | "typed") ?? "vision",
      createdAt: (r.created_at as string) ?? "",
      verdict,
      docId: (r.doc_id as string | null) ?? null,
      evidence: (r.evidence as string | null) ?? null,
      clickValue: numOrNull(r.click_value),
      citationValue: numOrNull(r.citation_value),
      route: isRoute(r.route) ? r.route : null,
      recommendedAsset: isRecommendedAsset(r.recommended_asset) ? r.recommended_asset : null,
      magnetSpace: numOrNull(r.magnet_space),
      magnetIdea: (r.magnet_idea as string | null) ?? null,
      magnetBy: magnetByOf(r.magnet_by),
    });
    byPhrase.set(key, list);
  }

  const docIds = new Set<string>();

  for (const row of rows) {
    const list = byPhrase.get(row.normalized);
    if (!list?.length) continue;

    // ‼️ TWO DIFFERENT QUESTIONS ASKED OF THE SAME ROWS, AND THEY GET DIFFERENT ANSWERS ON PURPOSE.
    // bestVerdict picks the reading we TRUST, preferring a person over a screenshot. pictured asks
    // whether a screenshot is ON FILE at all, which a typed verdict can never satisfy however much
    // more we trust it. See pictured() in keyword-strategy-rules.ts.
    const best = bestVerdict(list);
    row.pictured = pictured(list);

    if (best) {
      row.verdict = best.verdict;
      row.readEvidence = best.evidence;
    }

    // The scores and the magnet come from the newest reading that HAS them, which is not always the
    // one bestVerdict picked: a typed `keywords serp 9: merge` outranks the vision read for routing
    // and carries no scores of its own, and throwing away the screenshot's numbers because somebody
    // later corrected its verdict would blank the card for no reason.
    const scored = list.find((r) => r.clickValue !== null || r.citationValue !== null);
    if (scored) {
      row.clickValue = scored.clickValue;
      row.citationValue = scored.citationValue;
      row.route = scored.route;
      row.recommendedAsset = scored.recommendedAsset;
    }
    const magnet = list.find((r) => r.magnetBy !== null);
    if (magnet) {
      row.magnetSpace = magnet.magnetSpace;
      row.magnetIdea = magnet.magnetIdea;
      row.magnetBy = magnet.magnetBy;
    }

    // The newest picture, for the contact sheet. Not necessarily the trusted verdict's.
    const shot = list.find((r) => r.source === "vision" && r.docId);
    if (shot?.docId) {
      row.docId = shot.docId;
      docIds.add(shot.docId);
    }
  }

  await attachSlackFiles(rows, docIds);
}

/**
 * The Slack file id behind each screenshot, so the card can show the picture you already posted.
 *
 * ‼️ THE FILE ID AND NOT A SIGNED URL, AND THE TTL IS THE REASON. signedDocUrl mints a link that
 * lives 600 seconds, and Slack re-fetches an image_url when it renders a message: a contact sheet
 * built from signed URLs would be broken pictures ten minutes after it was posted, and it would have
 * looked fine when it went up. The bytes are already in Slack, uploaded by the person who pasted
 * them. Referring to them is free, permanent, and needs no bucket at all.
 */
async function attachSlackFiles(rows: Finalist[], docIds: Set<string>): Promise<void> {
  if (!docIds.size) return;

  const docs = await supabaseAdmin
    .from("client_docs")
    .select("id, slack_file_id")
    .in("id", [...docIds]);
  if (docs.error || !docs.data) return;

  const fileByDoc = new Map<string, string>();
  for (const d of docs.data) {
    const fileId = d.slack_file_id as string | null;
    if (fileId) fileByDoc.set(d.id as string, fileId);
  }

  for (const row of rows) {
    if (row.docId) row.slackFileId = fileByDoc.get(row.docId) ?? null;
  }
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function magnetByOf(v: unknown): "model" | "person" | null {
  return v === "model" || v === "person" ? v : null;
}

/** The shortlist as the card numbers it. Deterministic, so `keywords serp 12` means one row. */
export async function finalistsFor(
  clientId: string
): Promise<{ ok: true; list: Finalist[]; strategyReady: boolean } | { ok: false; error: string }> {
  const loaded = await loadFinalists(clientId);
  if (!loaded.ok) return loaded;
  return { ok: true, list: shortlistOf(loaded.rows), strategyReady: loaded.strategyReady };
}

// ─────────────────────────────────────────────────────────────────────────────
// Recording a verdict
// ─────────────────────────────────────────────────────────────────────────────

export interface RecordVerdictInput {
  clientId: string;
  keyword: Finalist;
  read: SerpRead | null;
  verdict: Verdict;
  source: "vision" | "typed";
  actor: string;
  docId?: string | null;
  model?: string | null;
  /** The magnet judgement, when one was made. Absent is not the same as "there is nothing". */
  magnet?: { space: number | null; idea: string | null; by: "model" | "person" } | null;
  device?: "mobile" | "desktop" | null;
}

/**
 * The scores and the route for one reading. Pure, and derived here so every writer agrees.
 *
 * ‼️ COMPUTED ON THE WAY IN AND STORED, RATHER THAN COMPUTED ON EVERY READ. The alternative is that
 * the card and the gate each re-derive them from the raw observations, which is fine until the
 * scoring changes and two stored decisions disagree about what a keyword was. Storing the numbers
 * means a re-score is a deliberate backfill that can be seen, the way the scraper's re-score is.
 */
function scoresFor(
  read: SerpRead | null,
  verdict: Verdict,
  magnet: RecordVerdictInput["magnet"]
): {
  click: number | null;
  cite: number | null;
  route: string | null;
  asset: string | null;
  intent: string | null;
  pageType: string | null;
} {
  // A typed verdict carries no reading, so it carries no scores. Inventing them from a single word
  // would put numbers on the card that nobody measured.
  if (!read) return { click: null, cite: null, route: null, asset: null, intent: null, pageType: null };

  const click = clickValueFrom(read);
  const cite = citationValueFrom(read);
  const routed = routeFrom({
    verdict,
    clickValue: click,
    citationValue: cite,
    magnetSpace: magnet?.space ?? null,
    magnetIdea: magnet?.idea ?? null,
    magnetBy: magnet?.by ?? null,
  });

  return {
    click,
    cite,
    route: routed.route,
    asset: routed.asset,
    intent: intentFrom(read),
    pageType: pageTypeFrom(read),
  };
}

/**
 * Append the reading, then denormalise the current verdict onto the keyword row.
 *
 * ‼️ APPEND FIRST, DENORMALISE SECOND, AND NEVER THE OTHER WAY. The history is the evidence; the
 * column on client_keywords is a convenience for the card. If the append fails there is nothing to
 * denormalise, and a column claiming a verdict with no row behind it is a verdict nobody can audit.
 */
export async function recordVerdict(input: RecordVerdictInput): Promise<{ ok: boolean; error?: string }> {
  const { clientId, keyword, read, verdict, source, actor } = input;

  const s = scoresFor(read, verdict, input.magnet);

  const { error } = await supabaseAdmin.from("keyword_serp_reads").insert({
    client_id: clientId,
    keyword_id: keyword.id,
    phrase: keyword.phrase,
    normalized: keyword.normalized || normalizePhrase(keyword.phrase),
    ai_overview: read?.aiOverview ?? null,
    ai_overview_answers: read?.aiOverviewAnswers ?? null,
    ai_overview_satisfies: read?.aiOverviewSatisfies ?? null,
    result_shape: read?.resultShape ?? null,
    local_pack: read?.localPack ?? null,
    paa_present: read?.paaPresent ?? null,
    ads_above_fold: read?.adsAboveFold ?? null,
    // ‼️ READ SINCE THE FIRST COMMIT AND STORED SINCE NEVER. readSerp has always returned both of
    // these, this function printed them into the Slack reply, and neither had a column to land in,
    // so the SERP's competitor list was recomputed from nothing every time somebody asked for it.
    top_domains: read?.topDomains?.length ? read.topDomains : null,
    forum_ranks: read?.forumRanks ?? null,
    paa_questions: read?.paaQuestions?.length ? read.paaQuestions : null,
    vocabulary: read?.vocabulary?.length ? read.vocabulary : null,
    verdict,
    click_value: s.click,
    citation_value: s.cite,
    dominant_intent: s.intent,
    dominant_page_type: s.pageType,
    route: s.route,
    recommended_asset: s.asset,
    magnet_space: input.magnet?.space ?? null,
    magnet_idea: input.magnet?.idea ?? null,
    // ‼️ NULL MEANS THE JUDGEMENT NEVER RAN, WHICH IS NOT "THERE IS NOTHING HERE". routeFrom reads
    // the difference: a failed magnet call asks for `magnet N:` on the card, and a person saying
    // there is nothing routes the keyword to SKIP. An outage must never be able to make that call.
    magnet_by: input.magnet?.by ?? null,
    source,
    // A person is not a legibility score. Recorded as 1 so a typed row never looks like a poor read.
    confidence: source === "typed" ? 1 : (read?.confidence ?? null),
    evidence: read?.evidence ?? (source === "typed" ? "typed in the thread" : null),
    doc_id: input.docId ?? null,
    device: input.device ?? null,
    model: input.model ?? null,
    actor,
  });

  if (error) {
    if (missingTable(error)) {
      return { ok: false, error: `nothing was stored: run ${SERP_SQL} on this database first.` };
    }
    return { ok: false, error: error.message };
  }

  // Best effort. A missing column here costs the card its sort order, never the evidence.
  const denorm = await supabaseAdmin
    .from("client_keywords")
    .update({ serp_verdict: verdict, serp_checked_at: new Date().toISOString() })
    .eq("id", keyword.id);
  if (denorm.error && !missingTable(denorm.error)) {
    console.error("[clients/keyword-strategy] verdict denormalise failed:", denorm.error.message);
  }

  const { recordKeywordDecisions } = await import("./keyword-dataset");
  await recordKeywordDecisions({
    clientId,
    action: "serp_verdict",
    actor,
    rows: [
      {
        id: keyword.id,
        phrase: keyword.phrase,
        category: keyword.category,
        use: "query" as const,
        origin: "manual" as const,
        rank: keyword.rank,
        score: keyword.score,
      },
    ],
    context: { verdict, source },
  }).catch(() => {});

  return { ok: true };
}

/** The reading history for one phrase, newest first, so bestVerdict can prefer a typed one. */
export async function verdictsFor(
  clientId: string,
  normalized: string
): Promise<Array<{ source: "vision" | "typed"; createdAt: string; verdict: Verdict }>> {
  const { data, error } = await supabaseAdmin
    .from("keyword_serp_reads")
    .select("source, created_at, verdict")
    .eq("client_id", clientId)
    .eq("normalized", normalized)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error || !data) return [];
  return data
    .filter((r) => isVerdict(r.verdict))
    .map((r) => ({
      source: (r.source as "vision" | "typed") ?? "vision",
      createdAt: (r.created_at as string) ?? "",
      verdict: r.verdict as Verdict,
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// The cards
// ─────────────────────────────────────────────────────────────────────────────

function verdictMark(v: Verdict | null): string {
  if (v === "post") return ":white_check_mark:";
  if (v === "merge") return ":arrow_heading_up:";
  if (v === "service_page") return ":office:";
  if (v === "unclear") return ":grey_question:";
  return ":black_small_square:";
}

/** The shortlist card: the ~25 subjects worth googling, numbered. */
export function shortlistLines(list: readonly Finalist[], clientName: string): string[] {
  const pictures = list.filter((r) => r.pictured).length;

  const lines: string[] = [
    `*The ${list.length} subjects worth checking* for *${clientName}*. ${pictures} with a picture on file, ${list.length - pictures} to go.`,
    "",
    // ‼️ BOTH RULES, ALWAYS TOGETHER. The first says what to look at on a results page; the second
    // says what the answer is worth to a business that sells appointments rather than ad
    // impressions. Quoting one without the other is how the publisher's advice gets followed.
    `_${SERP_TRIAGE_RULE}_`,
    `_${AEO_ROUTING_RULE}_`,
    "",
  ];

  list.forEach((r, i) => {
    const n = String(i + 1).padStart(2, " ");
    const mark = r.pictured ? verdictMark(r.verdict) : ":black_small_square:";
    let tail = "";
    if (r.clickValue !== null || r.citationValue !== null) {
      const magnet = r.magnetSpace !== null ? ` magnet ${r.magnetSpace}` : "";
      const route = r.route && r.recommendedAsset ? ` -> ${routeLine(r.route, r.recommendedAsset)}` : "";
      tail = `  _(click ${r.clickValue ?? 0} cite ${r.citationValue ?? 0}${magnet}${route})_`;
    } else if (!r.pictured) {
      tail = `  _(${blockLine(r.docId ? "unreadable" : r.verdict ? "typed_only" : "no_reading")})_`;
    }
    lines.push(`${mark} \`${n}\` ${r.phrase}${tail}`);
  });

  lines.push(
    "",
    "*In this thread:*",
    "  • Google one of them, then paste the screenshot here with `keywords serp 12` in the message.",
    "  • `keywords serp 12: merge` types the answer instead. It routes the keyword and does NOT clear the picture requirement.",
    "  • `magnet 12: the front desk script` names what we would give away, `magnet 12: none` says there is nothing.",
    "  • `strategy` groups them, `serp cards` puts the pictures and the scores in this thread to approve.",
    "",
    "_A screenshot is read for what is ON it: whether there is an AI Overview, how completely it answers, and whether the results are articles, listings or products. The scores are worked out from that reading here, not by the model._",
    "_No keyword is used, and no sub category is created under a pillar, until its picture is on file._"
  );

  return lines;
}

/** The strategy card: the clusters, what merged under what, and what each becomes. */
export function strategyLines(
  clusters: ReturnType<typeof clusterFinalists>["clusters"],
  unplaced: readonly Finalist[],
  byId: Map<string, Finalist>,
  clientName: string,
  locked: boolean
): string[] {
  const lines: string[] = [
    `*Keyword strategy for ${clientName}.* ${clusters.length} cluster${clusters.length === 1 ? "" : "s"}${locked ? ", locked" : ", not locked yet"}.`,
    "",
  ];

  clusters.forEach((c, i) => {
    const pillar = byId.get(c.pillarId);
    const kind = c.pageKind === "service_page" ? "Service page" : "Post";
    lines.push(`*${i + 1}. ${c.label}*  _(${kind})_`);
    if (pillar) lines.push(`      Keyword: \`${pillar.phrase}\``);
    if (c.awarenessEntry && c.awarenessTarget) {
      lines.push(
        `      Reader: ${stageName(c.awarenessEntry)} (${c.awarenessEntry}), leaves ${stageName(c.awarenessTarget)} (${c.awarenessTarget})`
      );
    }
    lines.push(`      ${c.rationale}`);
    for (const id of c.memberIds) {
      const m = byId.get(id);
      if (m) lines.push(`      Under it: ${m.phrase}`);
    }
    lines.push("");
  });

  if (unplaced.length) {
    lines.push(
      `*Not placed:* ${unplaced.length} subject${unplaced.length === 1 ? "" : "s"} with no verdict yet. \`keywords shortlist\` lists them with their numbers.`,
      ""
    );
  }

  lines.push(
    "`strategy merge 12 under 4` puts one under another. `strategy pillar 9` promotes one to its own cluster.",
    "`strategy service 6` makes it a service page, `strategy post 6` reverses it. `strategy new` re-groups from the verdicts.",
    "`strategy approve` locks it, and the page plan draws from it instead of re-deciding subjects."
  );

  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// The thread
// ─────────────────────────────────────────────────────────────────────────────

async function clientNameFor(clientId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("clients")
    .select("legal_name, dba_name")
    .eq("id", clientId)
    .maybeSingle();
  return ((data?.dba_name as string) || (data?.legal_name as string) || "this client").trim();
}

/** `keywords shortlist`, `keywords serp N: <verdict>`, and every `strategy ...` verb. */
export async function handleStrategyThreadReply(input: {
  clientId: string;
  stepKey: string | null;
  text: string;
  by: string;
}): Promise<StrategyReply | null> {
  if (input.stepKey !== "keyword_set") return null;
  const text = input.text.trim();

  if (KEYWORDS_SHORTLIST.test(text)) return shortlistCommand(input.clientId);

  if (SERP_CARDS.test(text)) return serpCardsCommand(input.clientId);

  const magnet = MAGNET_SET.exec(text);
  if (magnet) return magnetCommand(input.clientId, Number(magnet[1]), magnet[2], input.by);

  const typed = KEYWORDS_SERP_TYPED.exec(text);
  if (typed) return serpTypedCommand(input.clientId, Number(typed[1]), typed[2], input.by);

  // `keywords serp 12` with no verdict and no screenshot: say what to do rather than nothing.
  const bare = KEYWORDS_SERP.exec(text);
  if (bare) {
    return {
      message: [
        `:camera: Paste the Google screenshot for \`${bare[1]}\` **in the same message** as that command and I will read it.`,
        "Or type the answer: `keywords serp " + bare[1] + ": merge`, `: post`, `: service`.",
      ].join("\n"),
    };
  }

  const cmd = parseStrategyCommand(text);
  if (!cmd) return null;

  switch (cmd.kind) {
    case "show":
    case "new":
      return strategyCommand(input.clientId, cmd.kind === "new");
    case "approve":
      return approveStrategyCommand(input.clientId, input.by);
    case "merge":
      return mergeCommand(input.clientId, cmd.from, cmd.under, input.by);
    case "pillar":
      return pillarCommand(input.clientId, cmd.n, input.by);
    case "kind":
      return kindCommand(input.clientId, cmd.n, cmd.pageKind, input.by);
  }
}

async function shortlistCommand(clientId: string): Promise<StrategyReply> {
  const res = await finalistsFor(clientId);
  if (!res.ok) return { message: `:warning: The keyword set could not be read: ${res.error}` };
  if (!res.list.length) {
    return {
      message: `:warning: No approved queries yet, so there is nothing to shortlist. \`keywords approve\` on step ${stepNumber("keyword_set")} first.`,
    };
  }
  const name = await clientNameFor(clientId);
  return { message: shortlistLines(res.list, name).join("\n") };
}

async function resolveRow(
  clientId: string,
  n: number
): Promise<{ ok: true; row: Finalist } | { ok: false; message: string }> {
  const res = await finalistsFor(clientId);
  if (!res.ok) return { ok: false, message: `:warning: The keyword set could not be read: ${res.error}` };
  const row = res.list[n - 1];
  if (!row) {
    return {
      ok: false,
      message: `:warning: There is no \`${n}\` on the shortlist. It has ${res.list.length} rows. \`keywords shortlist\` reprints them.`,
    };
  }
  return { ok: true, row };
}

async function serpTypedCommand(clientId: string, n: number, word: string, by: string): Promise<StrategyReply> {
  const verdict = typedVerdict(word);
  if (!verdict) return { message: `:warning: "${word}" is not one of post, merge, service or unclear.` };

  const found = await resolveRow(clientId, n);
  if (!found.ok) return { message: found.message };

  const res = await recordVerdict({
    clientId,
    keyword: found.row,
    read: null,
    verdict,
    source: "typed",
    actor: by,
  });
  if (!res.ok) return { message: `:warning: ${res.error}` };

  return {
    message: [
      `${verdictMark(verdict)} \`${n}\` *${found.row.phrase}* recorded as *${verdict.replace("_", " ")}* (${by}).`,
      verdictLine(verdict),
      "",
      "`strategy` groups everything checked so far.",
    ].join("\n"),
  };
}

/** Read a screenshot, apply the rule, store both. Called from the events route, not from a verb. */
export async function recordSerpScreenshot(args: {
  clientId: string;
  n: number;
  image: { media_type: string; data: string };
  by: string;
  docId?: string | null;
}): Promise<{ message: string }> {
  const found = await resolveRow(args.clientId, args.n);
  if (!found.ok) return { message: found.message };

  const { readSerp, SERP_MODEL } = await import("./serp-read");
  const read = await readSerp(args.image, found.row.phrase);
  const verdict = verdictFrom(read);

  if (verdict === "unclear") {
    // ‼️ THE RULE IS UNCHANGED AND IS NOW PRECISE: AN UNCLEAR ROW IS STORED ONLY WHEN THERE IS A
    // PICTURE BEHIND IT.
    //
    // The original rule stored nothing at all, because a stored "unclear" is indistinguishable from
    // a keyword nobody has looked at, and a shortlist that claims progress it has not made is worse
    // than one that admits it. That reasoning still holds for a reading with no evidence.
    //
    // But under the screenshot gate it created a deadlock: a keyword cannot be used until a picture
    // is on file, and refusing to store the one that WAS posted meant one blurry screenshot became
    // a permanent block with no visible cause. So the two cases are separated by the thing that
    // actually distinguishes them. A row with a doc_id says "a picture was filed and it did not
    // read", which is a third state, and the card prints it as one and asks for a re-shoot. A
    // reading with no doc_id still stores nothing, exactly as before.
    if (!args.docId) {
      return {
        message: [
          `:grey_question: I could not tell from that screenshot for *${found.row.phrase}*.`,
          read.evidence ? `_What I saw: ${read.evidence}._` : "",
          "",
          `Nothing was stored, because the picture was not filed either. Post it again, or type it: \`keywords serp ${args.n}: merge\`, \`: post\`, \`: service\`.`,
        ]
          .filter(Boolean)
          .join("\n"),
      };
    }

    const kept = await recordVerdict({
      clientId: args.clientId,
      keyword: found.row,
      read,
      verdict,
      source: "vision",
      actor: args.by,
      docId: args.docId,
      model: SERP_MODEL,
    });
    if (!kept.ok) return { message: `:warning: ${kept.error}` };

    return {
      message: [
        `:grey_question: I could not read that screenshot for *${found.row.phrase}*.`,
        read.evidence ? `_What I saw: ${read.evidence}._` : "",
        "",
        `The picture is on file and the reading is recorded as unreadable, so this keyword shows as *blocked* rather than as unchecked. Post a wider screenshot to clear it, or type \`keywords serp ${args.n}: merge\`, \`: post\`, \`: service\` to route it without one.`,
        "_A typed verdict routes the keyword. It does not clear the block: the gate wants the picture._",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  // ── The magnet judgement, on the rows whose fate it decides ───────────────
  //
  // ‼️ A SECOND CALL, AND NOT A SECOND FIELD ON THE FIRST ONE. serp-read.ts is forbidden from
  // deciding what anything means; this asks for a judgement, and the two must not be the same call
  // or the reader is being asked to break its own rule. shouldAskMagnet keeps it off the ~18 rows in
  // 25 where the answer changes nothing.
  const click = clickValueFrom(read);
  const cite = citationValueFrom(read);
  let magnet: { space: number | null; idea: string | null; by: "model" | "person" } | null = null;

  const { shouldAskMagnet } = await import("./magnet-space");
  if (shouldAskMagnet({ verdict, clickValue: click, citationValue: cite })) {
    const { readMagnetSpace } = await import("./magnet-space");
    const ctx = await magnetContext(args.clientId);
    const judged = await readMagnetSpace({ phrase: found.row.phrase, read, ctx });
    // A failed call leaves `magnet` null, which stores magnet_by null, which routeFrom reads as
    // "the check has not run" rather than as "there is nothing here". An outage may not skip a
    // keyword.
    if (judged.magnetSpace !== null || judged.magnetIdea) {
      magnet = { space: judged.magnetSpace, idea: judged.magnetIdea, by: "model" };
    }
  }

  const res = await recordVerdict({
    clientId: args.clientId,
    keyword: found.row,
    read,
    verdict,
    source: "vision",
    actor: args.by,
    docId: args.docId ?? null,
    model: SERP_MODEL,
    magnet,
  });
  if (!res.ok) return { message: `:warning: ${res.error}` };

  const routed = routeFrom({
    verdict,
    clickValue: click,
    citationValue: cite,
    magnetSpace: magnet?.space ?? null,
    magnetIdea: magnet?.idea ?? null,
    magnetBy: magnet?.by ?? null,
  });

  const lines = [
    `${verdictMark(verdict)} \`${args.n}\` *${found.row.phrase}*`,
    `*click ${click}*  ·  *cite ${cite}*${magnet?.space !== null && magnet?.space !== undefined ? `  ·  *magnet ${magnet.space}*` : ""}  ->  *${routeLine(routed.route, routed.asset)}*`,
    routed.why,
  ];
  if (magnet?.idea) lines.push(`_Give away: ${magnet.idea}_`);
  if (read.topDomains.length) lines.push(`_Ranking: ${read.topDomains.join(", ")}._`);
  if (read.evidence) lines.push(`_Read: ${read.evidence}._`);
  lines.push(
    "",
    "`strategy` groups everything checked so far. `keywords serp N: <verdict>` overrides the verdict, `magnet N: <what we give away>` overrides the magnet."
  );
  return { message: lines.join("\n") };
}

/** What the magnet drafter needs to know about the client. Everything here exists by step 12. */
async function magnetContext(clientId: string): Promise<import("./magnet-space").MagnetContext> {
  const name = await clientNameFor(clientId);
  const base = {
    clientName: name,
    vertical: null as string | null,
    avatar: null as string | null,
    offerName: null as string | null,
    outcome: null as string | null,
    existingMagnets: [] as string[],
  };

  // Tolerant, and its own select: the offer half and the magnet half live in different tables and a
  // missing column in either must not cost the other one. One unknown column fails a whole
  // PostgREST select, which is the rule this repo states everywhere and keeps relearning.
  const { keywordContext } = await import("./client-keywords");
  const ctx = await keywordContext(clientId).catch(() => null);
  if (ctx?.ok) {
    base.vertical = ctx.ctx.vertical ?? null;
    base.avatar = ctx.ctx.avatarLabel ?? null;
    base.offerName = ctx.ctx.treatment ?? null;
    base.outcome = ctx.ctx.positioning ?? null;
  }

  // ‼️ THE LIBRARY ROWS PLUS THIS CLIENT'S OWN, which is the shape candidatesFor() in
  // concierge/magnets.ts already uses: a null client_id is a shared magnet, not an orphan. The point
  // of handing these over is that the drafter REUSES one where it fits, because a fifth magnet
  // nobody asked for is worse than the right one said again.
  const magnets = await supabaseAdmin
    .from("lead_magnets")
    .select("title")
    .eq("active", true)
    .or(`client_id.is.null,client_id.eq.${clientId}`)
    .limit(12);
  if (!magnets.error && magnets.data) {
    base.existingMagnets = magnets.data
      .map((m) => (m.title as string | null) ?? "")
      .filter((t): t is string => Boolean(t));
  }

  return base;
}

/**
 * `serp cards`: draw the contact sheet for every cluster, pictures and all.
 *
 * ‼️ IT DRAWS WHAT IS PROPOSED, INCLUDING THE CLUSTERS THAT CANNOT BE APPROVED. The blocked ones are
 * the entire reason to look: a card that only showed the ready clusters would hide the list of what
 * still has to be googled, which is the one piece of work the card exists to hand over.
 */
async function serpCardsCommand(clientId: string): Promise<StrategyReply> {
  const loaded = await loadFinalists(clientId);
  if (!loaded.ok) return { message: `:warning: The keyword set could not be read: ${loaded.error}` };
  if (!loaded.strategyReady) {
    return { message: `:warning: The strategy columns are not on this database yet. Run \`${STRATEGY_SQL}\`, then try again.` };
  }

  const list = shortlistOf(loaded.rows);
  const { clusters } = clusterFinalists(list);
  if (!clusters.length) {
    return {
      message: [
        ":mag: Nothing to draw yet, because no subject has a verdict.",
        "",
        `_${SERP_TRIAGE_RULE}_`,
        `_${AEO_ROUTING_RULE}_`,
        "",
        "`keywords shortlist` lists the subjects with their numbers. Google one and paste the screenshot with `keywords serp 4` in the message.",
      ].join("\n"),
    };
  }

  const byId = new Map(list.map((r) => [r.id, r]));
  const gates = gateClusters(clusters, byId);

  // The stored cluster ids, so a card can be EDITED next time rather than posted again. A cluster
  // with no row yet gets a card with no buttons and a line saying to run `strategy` first: posting
  // buttons whose value has no id behind it is how a press does nothing and nobody knows why.
  const stored = await storedClusterIds(clientId);

  const { clusterCard } = await import("./serp-cards");
  const cards = gates.map((gate, i) =>
    clusterCard({
      clientId,
      clusterId: stored.get(gate.cluster.label) ?? null,
      gate,
      byId,
      position: i + 1,
      index: i,
    })
  );

  const blocked = gates.reduce((n, g) => n + g.blocked.length, 0);
  const lines = [
    `:frame_with_picture: Drawing ${cards.length} cluster card${cards.length === 1 ? "" : "s"} below.`,
    blocked
      ? `${blocked} keyword${blocked === 1 ? " is" : "s are"} still owed a picture, and each is named on the card that wants it.`
      : "Every keyword on every cluster has a picture on file.",
    "",
    "_Nothing auto-approves. The buttons are yours._",
  ];

  // ‼️ THE POSTING RUNS IN `after`, WHICH THE EVENTS ROUTE HANDS TO waitUntil. Ten cards is ten Slack
  // calls, and every handler in that chain is awaited BEFORE the ack: Slack re-delivers an event it
  // has not heard back from within three seconds, so doing this inline would post the whole sheet
  // twice. Same shape the offer re-aim and the keyword runner already use, and the reason
  // StrategyReply carries an `after` at all.
  return {
    message: lines.join("\n"),
    after: async () => {
      const { postClusterCards } = await import("./serp-cards");
      const res = await postClusterCards({ clientId, cards });
      if (!res.failed.length) return;

      // ‼️ A FAILURE IS SAID OUT LOUD IN THE THREAD, NOT LOGGED. slack-bot's helpers return
      // {ok:false} rather than throwing, so a refused card is silent by default: the sheet would
      // simply be missing a cluster and look complete. That is the exact failure this gate exists to
      // prevent, so it may not be how the gate itself fails.
      const { notifyStep } = await import("./step-board");
      await notifyStep(
        clientId,
        "keyword_set",
        [
          `:warning: ${res.failed.length} cluster card${res.failed.length === 1 ? "" : "s"} could not be posted, so ${res.failed.length === 1 ? "it is" : "they are"} not on screen above:`,
          ...res.failed.map((f) => `  • ${f.label}: ${f.error}`),
          "",
          "_`serp cards` again once that is fixed. Nothing was approved either way._",
        ].join("\n")
      ).catch(() => {});
    },
  };
}

/** Cluster id by label, so a redraw edits the card it drew last time. */
async function storedClusterIds(clientId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const { data, error } = await supabaseAdmin
    .from("keyword_clusters")
    .select("id, label")
    .eq("client_id", clientId)
    .neq("status", "dropped");
  if (error || !data) return out;
  for (const c of data) out.set((c.label as string) ?? "", c.id as string);
  return out;
}

/**
 * `magnet 7: the front desk script` and `magnet 7: none`.
 *
 * ‼️ `none` IS A DECISION SOMEBODY TYPES, NOT A FIELD LEFT EMPTY, and the difference decides the
 * keyword. Under a high AI Overview score a keyword with no magnet is SKIPPED, so "there is nothing
 * to give away here" has to be sayable out loud and attributable to a person. A blank means the
 * check never ran, which is a different fact, and routeFrom reads them differently.
 *
 * ‼️ IT APPENDS A READING RATHER THAN UPDATING ONE. keyword_serp_reads is append only, for the reason
 * its migration gives: a second look is a second fact, not a correction of the first. The verdict
 * and the screenshot travel with it so the row stays a complete reading rather than a fragment that
 * only makes sense next to its neighbour.
 */
async function magnetCommand(clientId: string, n: number, said: string, by: string): Promise<StrategyReply> {
  const found = await resolveRow(clientId, n);
  if (!found.ok) return { message: found.message };
  const row = found.row;

  if (!row.verdict) {
    return {
      message: `:warning: *${row.phrase}* has no reading yet, so there is nothing for a magnet to change. Paste the screenshot with \`keywords serp ${n}\` first.`,
    };
  }

  const text = said.trim();
  const none = /^(none|nothing|no)$/i.test(text);
  const idea = none ? null : text;

  if (!none && idea && idea.length < 4) {
    return { message: `:warning: "${idea}" is too short to be a thing somebody would hand over. Name the artifact, or say \`magnet ${n}: none\`.` };
  }

  const { hasBannedDash } = await import("@/lib/copy-guard");
  if (idea && hasBannedDash(idea)) {
    return { message: ":warning: That carries an em dash, an en dash or a double hyphen. Say it again without one." };
  }

  const res = await recordVerdict({
    clientId,
    keyword: row,
    // The reading is unchanged; this row records the magnet decision against the same verdict. Null
    // read means no scores are recomputed from it, and loadFinalists takes the scores from the
    // newest row that HAS them, which is still the screenshot's.
    read: null,
    verdict: row.verdict,
    source: "typed",
    actor: by,
    // ‼️ A PERSON SAYING "none" IS A 0 WITH AN AUTHOR, NEVER A NULL. Null is "the check has not run".
    magnet: { space: none ? 0 : 5, idea, by: "person" },
  });
  if (!res.ok) return { message: `:warning: ${res.error}` };

  return {
    message: none
      ? [
          `:no_entry_sign: \`${n}\` *${row.phrase}*: nothing to give away (${by}).`,
          "It is a SKIP now, and the reason is recorded rather than inferred. `serp cards` redraws its cluster.",
        ].join("\n")
      : [
          `:magnet: \`${n}\` *${row.phrase}* gives away: *${idea}* (${by}).`,
          "`serp cards` redraws its cluster with the new route.",
        ].join("\n"),
  };
}

async function strategyCommand(clientId: string, regroup: boolean): Promise<StrategyReply> {
  const loaded = await loadFinalists(clientId);
  if (!loaded.ok) return { message: `:warning: The keyword set could not be read: ${loaded.error}` };
  if (!loaded.strategyReady) {
    return { message: `:warning: The strategy columns are not on this database yet. Run \`${STRATEGY_SQL}\`, then try again.` };
  }

  const list = shortlistOf(loaded.rows);
  const { clusters, unplaced } = clusterFinalists(list);
  const byId = new Map(list.map((r) => [r.id, r]));

  if (!clusters.length) {
    return {
      message: [
        ":mag: Nothing is grouped yet, because no subject has a verdict.",
        "",
        `_${SERP_TRIAGE_RULE}_`,
        "",
        "`keywords shortlist` lists the subjects with their numbers. Google one, paste the screenshot with `keywords serp 4` in the message, or type `keywords serp 4: post`.",
      ].join("\n"),
    };
  }

  const name = await clientNameFor(clientId);
  const locked = await isLocked(clientId);
  const message = strategyLines(clusters, unplaced, byId, name, locked).join("\n");

  if (!regroup) return { message };
  return { message, after: async () => void (await persistClusters(clientId, clusters, byId)) };
}

/**
 * Is the strategy locked FOR THE OFFER AS IT STANDS NOW?
 *
 * ‼️ SCOPED BY offer_fingerprint, AND WITHOUT THAT IT LIED. The lock table is one row per client per
 * fingerprint precisely so a re-lock after an offer change is a new row and the old one stays
 * readable. This read ignored the fingerprint entirely, so a strategy locked against "lip filler"
 * made the card say "locked" after the offer became "Botox", while resetForNewOffer had already
 * deleted the keywords underneath it. The card asserted a decision about phrases that no longer
 * existed.
 */
async function isLocked(clientId: string): Promise<boolean> {
  const fingerprint = await fingerprintFor(clientId);
  if (!fingerprint) return false;

  const { data, error } = await supabaseAdmin
    .from("client_keyword_strategy")
    .select("locked_at")
    .eq("client_id", clientId)
    .eq("offer_fingerprint", fingerprint)
    .not("locked_at", "is", null)
    .limit(1);
  if (error) return false;
  return (data ?? []).length > 0;
}

/**
 * Write the proposal down so the numbers on the card survive to the next message.
 *
 * ‼️ GATED. A cluster whose PILLAR has no screenshot is not written at all, and an unpictured CHILD
 * is left out of the one that is. See src/lib/clients/serp-gate.ts. The refusal is thrown, not
 * swallowed: a caller that wrote a smaller strategy and said nothing would be the invisible failure
 * this gate exists to stop.
 *
 * ‼️ IT NO LONGER WIPES A CLUSTER SOMEBODY MADE BY HAND. `strategy pillar 9` inserts a cluster at
 * rank 999, and this function used to delete EVERY `proposed` row before re-inserting from
 * clusterFinalists, so the next `strategy` or `strategy approve` destroyed it silently, along with
 * every `strategy merge` and `strategy service` edit made since the last regroup. Only rows this
 * function wrote (origin='derived') are its to delete.
 */
async function persistClusters(
  clientId: string,
  clusters: ReturnType<typeof clusterFinalists>["clusters"],
  byId: Map<string, Finalist>
): Promise<void> {
  const gates = gateClusters(clusters, byId);

  // Every keyword about to be written, checked against the evidence table in one query.
  const writable = gates.filter((g) => !g.pillarBlocked);
  const wanted = writable.flatMap((g) => [g.cluster.pillarId, ...g.cluster.memberIds]);
  const { assertPictured } = await import("./serp-gate");
  await assertPictured(
    clientId,
    wanted
      .map((id) => byId.get(id))
      .filter((r): r is Finalist => Boolean(r))
      // Children that gateClusters already knows are blocked are dropped from the write rather than
      // thrown over: the cluster is still legitimate without them, and the card lists them.
      .filter((r) => r.pictured)
  );

  const wipe = await supabaseAdmin
    .from("keyword_clusters")
    .delete()
    .eq("client_id", clientId)
    .eq("status", "proposed")
    .eq("origin", "derived");
  if (wipe.error && missingTable(wipe.error)) return;

  const fingerprint = await fingerprintFor(clientId);

  for (const [i, g] of writable.entries()) {
    const c = g.cluster;
    const { data, error } = await supabaseAdmin
      .from("keyword_clusters")
      .insert({
        client_id: clientId,
        // ‼️ WRITTEN AT LAST. The column has existed since the migration was drafted and nothing
        // ever set it, so the staleness check its own header argues for could never fire and a
        // cluster written for the previous offer was indistinguishable from a current one.
        offer_fingerprint: fingerprint,
        label: c.label,
        pillar_keyword_id: c.pillarId,
        awareness_entry: c.awarenessEntry,
        awareness_target: c.awarenessTarget,
        page_kind: c.pageKind,
        rationale: c.rationale,
        rank: i + 1,
        status: "proposed",
        origin: "derived",
        missing_pictures: g.blocked.length,
      })
      .select("id")
      .maybeSingle();
    if (error || !data) continue;

    const clusterId = data.id as string;
    const pillar = byId.get(c.pillarId);
    await supabaseAdmin
      .from("client_keywords")
      .update({ cluster_id: clusterId, intent: c.pageKind, merged_into: null })
      .eq("id", c.pillarId);

    for (const memberId of c.memberIds) {
      // An unpictured child is not written into the cluster. It stays unplaced and visible.
      if (!byId.get(memberId)?.pictured) continue;
      await supabaseAdmin
        .from("client_keywords")
        .update({ cluster_id: clusterId, intent: "merged", merged_into: pillar?.id ?? null })
        .eq("id", memberId);
    }
  }
}

/**
 * The pillar keyword of every hand-made cluster still waiting to be approved.
 *
 * Its own tolerant select, because `origin` arrives with the same migration as the gate and a
 * database without it must read as "no manual clusters" rather than failing the approve.
 */
async function proposedManualPillars(clientId: string): Promise<Array<{ id: string; phrase: string }>> {
  const { data, error } = await supabaseAdmin
    .from("keyword_clusters")
    .select("pillar_keyword_id, label")
    .eq("client_id", clientId)
    .eq("status", "proposed")
    .eq("origin", "manual");
  if (error || !data) return [];
  return data
    .map((c) => ({ id: (c.pillar_keyword_id as string | null) ?? "", phrase: (c.label as string) ?? "" }))
    .filter((c) => Boolean(c.id));
}

/** The offer this strategy is being written for, so a stale cluster can be seen rather than inferred. */
async function fingerprintFor(clientId: string): Promise<string | null> {
  const { keywordContext } = await import("./client-keywords");
  const ctx = await keywordContext(clientId).catch(() => null);
  return ctx?.ok ? ctx.ctx.fingerprint : null;
}

async function approveStrategyCommand(clientId: string, by: string): Promise<StrategyReply> {
  const loaded = await loadFinalists(clientId);
  if (!loaded.ok) return { message: `:warning: The keyword set could not be read: ${loaded.error}` };
  if (!loaded.strategyReady) {
    return { message: `:warning: The strategy columns are not on this database yet. Run \`${STRATEGY_SQL}\`, then try again.` };
  }

  const list = shortlistOf(loaded.rows);
  const { clusters, unplaced } = clusterFinalists(list);
  if (!clusters.length) {
    return { message: ":warning: Nothing to approve: no subject has a verdict yet. `keywords shortlist` is where to start." };
  }

  const byId = new Map(list.map((r) => [r.id, r]));

  // ── THE GATE ─────────────────────────────────────────────────────────────
  //
  // ‼️ CHECKED BEFORE ANYTHING IS WRITTEN, AND IT NAMES THE KEYWORDS. Approving is the moment a
  // shortlist becomes the plan every page for this client is chosen from, so it is the one place a
  // missing screenshot must be loud. The refusal prints the shortlist number beside each phrase,
  // because a refusal a person cannot act on without looking something up is a refusal that gets
  // worked around.
  const gates = gateClusters(clusters, byId);
  const blockedPillars = gates.filter((g) => g.pillarBlocked);
  const blockedChildren = gates.flatMap((g) => (g.pillarBlocked ? [] : g.blocked));

  // ‼️ AND THE HAND-MADE CLUSTERS, WHICH clusterFinalists NEVER SEES. `strategy pillar 9` writes a
  // cluster straight into the table, and the promote-to-approved update below flips EVERY proposed
  // row, so gating only the derived ones would approve a manual cluster nobody had a picture for.
  // Gated at creation too, but a row written before that gate shipped would still be sitting there.
  const manual = await proposedManualPillars(clientId);
  const manualBlocked: Array<{ id: string; phrase: string; reason: "no_reading" | "typed_only" | "unreadable" }> = [];
  if (manual.length) {
    const { picturedIds } = await import("./serp-gate");
    const shot = await picturedIds(clientId, manual.map((m) => m.id));
    if (!shot.ok) {
      return { message: `:warning: The screenshots could not be read back, so nothing was approved: ${shot.error}` };
    }
    for (const m of manual) {
      if (shot.pictured.has(m.id)) continue;
      const row = byId.get(m.id);
      manualBlocked.push({
        id: m.id,
        phrase: row?.phrase ?? m.phrase,
        reason: row?.docId ? "unreadable" : row?.verdict ? "typed_only" : "no_reading",
      });
    }
  }

  if (blockedPillars.length || blockedChildren.length || manualBlocked.length) {
    const numberOf = (id: string) => {
      const i = list.findIndex((r) => r.id === id);
      return i >= 0 ? i + 1 : null;
    };
    const missing = [
      ...blockedPillars.flatMap((g) => g.blocked),
      ...blockedChildren,
      ...manualBlocked,
    ];
    const { SerpGateError, refusalLines } = await import("./serp-gate");
    const err = new SerpGateError(
      `${missing.length} keyword${missing.length === 1 ? " has" : "s have"} no screenshot on file, across ` +
        `${gates.filter((g) => g.blocked.length).length} cluster${gates.filter((g) => g.blocked.length).length === 1 ? "" : "s"}.`,
      missing.map((m) => ({ keywordId: m.id, phrase: m.phrase, reason: m.reason }))
    );
    return { message: refusalLines(err, numberOf).join("\n") };
  }

  await persistClusters(clientId, clusters, byId);

  const now = new Date().toISOString();

  // ‼️ THE PREVIOUS APPROVED SET IS RETIRED FIRST, AND WITHOUT THIS A SECOND APPROVE DOUBLED EVERY
  // PILLAR. persistClusters only ever deletes `proposed` rows, so the old approved ones survived,
  // the freshly proposed ones were then promoted alongside them, and strategyView reads every row
  // with status='approved'. Two runs of `strategy approve` produced two of each cluster and the page
  // plan drew from both. Retired rather than deleted: what was locked last week is still readable.
  await supabaseAdmin
    .from("keyword_clusters")
    .update({ status: "dropped", updated_at: now })
    .eq("client_id", clientId)
    .eq("status", "approved");

  await supabaseAdmin
    .from("keyword_clusters")
    .update({ status: "approved", approved_at: now, approved_by: by, updated_at: now })
    .eq("client_id", clientId)
    .eq("status", "proposed");

  const { keywordContext } = await import("./client-keywords");
  const ctx = await keywordContext(clientId);
  const fingerprint = ctx.ok ? ctx.ctx.fingerprint : "unknown";

  const lock = await supabaseAdmin
    .from("client_keyword_strategy")
    .upsert(
      {
        client_id: clientId,
        offer_fingerprint: fingerprint,
        locked_at: now,
        locked_by: by,
        summary: { clusters: clusters.length, unplaced: unplaced.length },
      },
      { onConflict: "client_id,offer_fingerprint" }
    );
  if (lock.error && !missingTable(lock.error)) {
    return { message: `:warning: The clusters were saved but the lock was not: ${lock.error.message}` };
  }

  const posts = clusters.filter((c) => c.pageKind === "post").length;
  const services = clusters.length - posts;

  return {
    message: [
      `:lock: *Strategy locked* (${by}). ${clusters.length} cluster${clusters.length === 1 ? "" : "s"}: ${posts} post${posts === 1 ? "" : "s"}, ${services} service page${services === 1 ? "" : "s"}.`,
      unplaced.length
        ? `${unplaced.length} subject${unplaced.length === 1 ? " is" : "s are"} still unchecked and were left out rather than guessed at.`
        : "Every shortlisted subject has a verdict.",
      "",
      `The page plan at step ${stepNumber("pre_call_pages")} now draws from these clusters instead of re-deciding subjects. \`strategy\` reprints it, \`strategy new\` re-groups from the verdicts.`,
    ].join("\n"),
  };
}

async function clusterAt(clientId: string, n: number): Promise<{ id: string; label: string } | null> {
  const { data, error } = await supabaseAdmin
    .from("keyword_clusters")
    .select("id, label, rank")
    .eq("client_id", clientId)
    .neq("status", "dropped")
    .order("rank", { ascending: true });
  if (error || !data) return null;
  const row = data[n - 1];
  return row ? { id: row.id as string, label: row.label as string } : null;
}

async function mergeCommand(clientId: string, from: number, under: number, by: string): Promise<StrategyReply> {
  const a = await clusterAt(clientId, from);
  const b = await clusterAt(clientId, under);
  if (!a || !b) return { message: `:warning: \`strategy\` lists the clusters and their numbers. ${!a ? from : under} is not one of them.` };

  // The merged cluster's keywords move under the surviving pillar and become `merged`.
  const { data: pillarRow } = await supabaseAdmin
    .from("keyword_clusters")
    .select("pillar_keyword_id")
    .eq("id", b.id)
    .maybeSingle();

  await supabaseAdmin
    .from("client_keywords")
    .update({ cluster_id: b.id, intent: "merged", merged_into: (pillarRow?.pillar_keyword_id as string) ?? null })
    .eq("client_id", clientId)
    .eq("cluster_id", a.id);

  await supabaseAdmin.from("keyword_clusters").update({ status: "dropped", updated_at: new Date().toISOString() }).eq("id", a.id);

  const { recordKeywordDecisions } = await import("./keyword-dataset");
  await recordKeywordDecisions({ clientId, action: "merge", actor: by, rows: [], context: { from: a.label, under: b.label } }).catch(() => {});

  return { message: `:arrow_heading_up: *${a.label}* now sits under *${b.label}* (${by}). \`strategy\` reprints the plan.` };
}

async function pillarCommand(clientId: string, n: number, by: string): Promise<StrategyReply> {
  const res = await finalistsFor(clientId);
  if (!res.ok) return { message: `:warning: ${res.error}` };
  const row = res.list[n - 1];
  if (!row) return { message: `:warning: There is no \`${n}\` on the shortlist. \`keywords shortlist\` reprints it.` };

  // ‼️ GATED AT CREATION, NOT ONLY AT APPROVAL, AND THAT IS NOT BELT AND BRACES. Promoting a phrase
  // to a pillar IS the decision that it becomes a page; a cluster is exactly the "sub category under
  // a pillar" the rule names. And the approval gate alone would not have caught it: that check runs
  // over the clusters clusterFinalists DERIVES, while this writes one straight into the table, and
  // the promote-to-approved update flips every proposed row regardless of where it came from. Two
  // doors, one of them was ajar.
  if (!row.pictured) {
    const { blockLine } = await import("./keyword-strategy-rules");
    const reason = row.docId ? "unreadable" : row.verdict ? "typed_only" : "no_reading";
    return {
      message: [
        `:no_entry: *${row.phrase}* has no screenshot on file, so it cannot be made a pillar.`,
        `_${blockLine(reason)}._`,
        "",
        `Google it, then paste the picture here with \`keywords serp ${n}\` in the same message.`,
      ].join("\n"),
    };
  }

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("keyword_clusters")
    .insert({
      client_id: clientId,
      label: row.phrase,
      pillar_keyword_id: row.id,
      awareness_entry: row.awarenessStage,
      awareness_target: row.awarenessStage && isAwarenessStage(row.awarenessStage) ? Math.max(1, row.awarenessStage - 1) : null,
      page_kind: row.verdict === "service_page" ? "service_page" : "post",
      rationale: `Promoted by ${by}.`,
      rank: 999,
      status: "proposed",
      // ‼️ MANUAL, SO THE NEXT REGROUP DOES NOT DELETE IT. persistClusters wipes the proposed rows it
      // owns before re-inserting, and it used to wipe every proposed row, so this cluster lived
      // exactly until somebody typed `strategy` or `strategy approve` and then vanished with no
      // message. A person pointing at a phrase is a decision; a regroup is a recalculation, and a
      // recalculation may not eat a decision.
      origin: "manual",
      offer_fingerprint: await fingerprintFor(clientId),
      updated_at: now,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    if (missingTable(error)) return { message: `:warning: Run \`${STRATEGY_SQL}\` on this database first.` };
    return { message: `:warning: ${error.message}` };
  }

  await supabaseAdmin
    .from("client_keywords")
    .update({ cluster_id: data?.id ?? null, intent: row.verdict === "service_page" ? "service_page" : "post", merged_into: null })
    .eq("id", row.id);

  return { message: `:round_pushpin: *${row.phrase}* is its own cluster now (${by}). \`strategy\` reprints the plan.` };
}

async function kindCommand(
  clientId: string,
  n: number,
  pageKind: "post" | "service_page",
  by: string
): Promise<StrategyReply> {
  const c = await clusterAt(clientId, n);
  if (!c) return { message: `:warning: \`strategy\` lists the clusters and their numbers. ${n} is not one of them.` };

  const { error } = await supabaseAdmin
    .from("keyword_clusters")
    .update({ page_kind: pageKind, updated_at: new Date().toISOString() })
    .eq("id", c.id);
  if (error) return { message: `:warning: ${error.message}` };

  await supabaseAdmin.from("client_keywords").update({ intent: pageKind }).eq("client_id", clientId).eq("cluster_id", c.id);

  const { recordKeywordDecisions } = await import("./keyword-dataset");
  await recordKeywordDecisions({
    clientId,
    action: pageKind === "service_page" ? "mark_service_page" : "mark_post",
    actor: by,
    rows: [],
    context: { cluster: c.label },
  }).catch(() => {});

  const word = pageKind === "service_page" ? "a service page" : "a post";
  return { message: `:pencil2: *${c.label}* is ${word} now (${by}). \`strategy\` reprints the plan.` };
}

// ─────────────────────────────────────────────────────────────────────────────
// The gate card's buttons
//
// ‼️ THESE ARE THE ONLY THINGS THAT APPROVE A CLUSTER, AND NOTHING AUTO-APPROVES. The scores are a
// proposal and the pictures are the evidence; the decision is a person pressing a button next to
// both. That is the entire reason the sheet is in the thread rather than in a table.
// ─────────────────────────────────────────────────────────────────────────────

/** `[Approve cluster]`. Gated: the button is not drawn when it would refuse, and it refuses anyway. */
export async function approveClusterAction(clientId: string, clusterId: string, by: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("keyword_clusters")
    .select("id, label, pillar_keyword_id, status")
    .eq("id", clusterId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (error || !data) return ":warning: That cluster is not on this client any more. `strategy` reprints what is.";
  if (data.status === "approved") return `:white_check_mark: *${data.label}* was already approved.`;

  const pillarId = (data.pillar_keyword_id as string | null) ?? null;
  if (!pillarId) {
    return `:warning: *${data.label}* has lost its pillar keyword, so there is nothing to approve. \`strategy new\` re-groups from the verdicts.`;
  }

  // ‼️ RE-CHECKED AT THE PRESS, NOT TRUSTED FROM THE CARD. The card may have been drawn an hour ago,
  // and the thing it is asserting is that a picture exists. Same argument assertGatePassed makes for
  // re-hashing the page body rather than believing what its caller loaded.
  const { picturedIds } = await import("./serp-gate");
  const shot = await picturedIds(clientId, [pillarId]);
  if (!shot.ok) return `:warning: The screenshots could not be read back, so nothing was approved: ${shot.error}`;
  if (!shot.pictured.has(pillarId)) {
    return [
      `:no_entry: *${data.label}* still has no screenshot for its pillar, so it was not approved.`,
      "Paste the Google result here with `keywords serp N` in the same message, then press it again.",
    ].join("\n");
  }

  const now = new Date().toISOString();
  const up = await supabaseAdmin
    .from("keyword_clusters")
    .update({ status: "approved", approved_at: now, approved_by: by, updated_at: now })
    .eq("id", clusterId);
  if (up.error) return `:warning: ${up.error.message}`;

  const { recordKeywordDecisions } = await import("./keyword-dataset");
  await recordKeywordDecisions({
    clientId,
    action: "approve_cluster",
    actor: by,
    rows: [],
    context: { cluster: data.label },
  }).catch(() => {});

  return [
    `:white_check_mark: *${data.label}* approved (${by}).`,
    `The page plan at step ${stepNumber("pre_call_pages")} draws from it now.`,
  ].join("\n");
}

/** `[Reject]`. Nothing is deleted: the keywords stay, the cluster stops being a plan. */
export async function rejectClusterAction(clientId: string, clusterId: string, by: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("keyword_clusters")
    .select("id, label")
    .eq("id", clusterId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (error || !data) return ":warning: That cluster is not on this client any more.";

  const now = new Date().toISOString();
  const up = await supabaseAdmin
    .from("keyword_clusters")
    .update({ status: "rejected", rejected_at: now, rejected_by: by, updated_at: now })
    .eq("id", clusterId);
  if (up.error) return `:warning: ${up.error.message}`;

  // ‼️ THE KEYWORDS ARE LEFT ALONE, DELIBERATELY. Rejecting a grouping is a statement about the
  // grouping. The phrases underneath it are still approved phrases somebody chose, and their SERP
  // readings are still facts about Google. `strategy new` re-groups them.
  const { recordKeywordDecisions } = await import("./keyword-dataset");
  await recordKeywordDecisions({
    clientId,
    action: "reject_cluster",
    actor: by,
    rows: [],
    context: { cluster: data.label },
  }).catch(() => {});

  return [
    `:x: *${data.label}* rejected (${by}). Its keywords are untouched and still approved.`,
    "`strategy new` re-groups them from the verdicts.",
  ].join("\n");
}

/** `[Drop]` on one row. Drops the KEYWORD, which is the unit the decision is about. */
export async function dropKeywordAction(clientId: string, keywordId: string, by: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("client_keywords")
    .select("id, phrase, category, rank, score, origin, use")
    .eq("id", keywordId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (error || !data) return ":warning: That keyword is not on this client any more.";

  const now = new Date().toISOString();
  const up = await supabaseAdmin
    .from("client_keywords")
    .update({ dropped_at: now, cluster_id: null, intent: null, merged_into: null, updated_at: now })
    .eq("id", keywordId);
  if (up.error) return `:warning: ${up.error.message}`;

  const { recordKeywordDecisions } = await import("./keyword-dataset");
  await recordKeywordDecisions({
    clientId,
    action: "drop",
    actor: by,
    rows: [
      {
        id: data.id as string,
        phrase: data.phrase as string,
        category: (data.category as string) ?? "other",
        use: "query" as const,
        origin: (data.origin as "manual") ?? "manual",
        rank: Number(data.rank ?? 0),
        score: Number(data.score ?? 0),
      },
    ],
    context: { from: "gate card" },
  }).catch(() => {});

  return `:wastebasket: *${data.phrase}* dropped (${by}). \`serp cards\` redraws without it.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// What step 21 and the studio read
// ─────────────────────────────────────────────────────────────────────────────

export interface StrategyView {
  locked: boolean;
  /** Keyword ids that must NOT become their own page: merged, or a service page. */
  excludeIds: Set<string>;
  /** Keyword ids that are a cluster pillar, in cluster order. */
  pillarIds: string[];
  /**
   * Pillars that were LEFT OUT because their screenshot is not on file.
   *
   * ‼️ RETURNED RATHER THAN SWALLOWED. This is the leak the gate exists to close: strategyView is
   * the only way a strategy reaches page selection (pre-call-pages.ts imports it), so anything
   * unverified that gets this far has already escaped. Filtering silently would hand the page plan
   * a shorter list that looks complete, which is the same invisible failure in a quieter coat. The
   * caller says what it left out.
   */
  unverified: string[];
}

/**
 * The strategy, as a filter.
 *
 * ‼️ A FILTER AND A PRE-SET ROLE, NEVER A SELECTOR, AND THIS IS THE WHOLE DESIGN. There are already
 * two page pickers in this repo (selectPlan for the studio's twenty, selectOfferPlan for the
 * pre-call seven) and both are probe-pinned. A third would have to agree with both forever. Instead
 * the strategy removes merged and service-page keywords from the POOL and marks the pillars, and
 * selectOfferPlan's existing preference for `role` does the rest.
 *
 * ‼️ NO STRATEGY IS A NO-OP, ITEM FOR ITEM. That is what makes this safe to deploy before the SQL.
 */
export async function strategyView(clientId: string): Promise<StrategyView> {
  const empty: StrategyView = { locked: false, excludeIds: new Set(), pillarIds: [], unverified: [] };

  const clusters = await supabaseAdmin
    .from("keyword_clusters")
    .select("id, pillar_keyword_id, page_kind, rank, status")
    .eq("client_id", clientId)
    .eq("status", "approved")
    .order("rank", { ascending: true });
  if (clusters.error || !clusters.data?.length) return empty;

  const kw = await supabaseAdmin
    .from("client_keywords")
    .select("id, intent")
    .eq("client_id", clientId)
    .is("dropped_at", null)
    .range(0, 2999);
  if (kw.error) return empty;

  const excludeIds = new Set<string>();
  for (const r of kw.data ?? []) {
    const intent = r.intent as string | null;
    if (intent === "merged" || intent === "service_page") excludeIds.add(r.id as string);
  }

  const candidates = clusters.data
    .map((c) => c.pillar_keyword_id as string | null)
    .filter((id): id is string => Boolean(id) && !excludeIds.has(id as string));

  // ── THE GATE, THIRD AND LAST ─────────────────────────────────────────────
  //
  // ‼️ approveStrategyCommand ALREADY REFUSES AN UNPICTURED CLUSTER, SO THIS SHOULD NEVER FIRE, AND
  // IT IS HERE BECAUSE "should never" IS NOT A GUARANTEE. A cluster approved before this gate
  // shipped, or one written straight into the table, reaches page selection through exactly this
  // function and nothing else would ever look at it again. Cheap, and it closes the door rather than
  // trusting the corridor.
  //
  // ‼️ A FAILED CHECK RETURNS THE EMPTY VIEW, NOT THE UNCHECKED LIST. The empty view is already the
  // documented no-op for "no strategy yet", so degrading into it costs today's behaviour and
  // nothing more, whereas degrading into "pass them all through" would hand the page plan exactly
  // what the gate was built to withhold.
  const { picturedIds } = await import("./serp-gate");
  const shot = await picturedIds(clientId, candidates);
  if (!shot.ok) {
    console.error("[clients/keyword-strategy] strategyView could not verify screenshots:", shot.error);
    return empty;
  }

  const pillarIds = candidates.filter((id) => shot.pictured.has(id));
  const unverified = candidates.filter((id) => !shot.pictured.has(id));
  if (unverified.length) {
    console.error(
      `[clients/keyword-strategy] ${unverified.length} approved pillar(s) have no screenshot and were withheld from page selection for client ${clientId}`
    );
  }

  return { locked: true, excludeIds, pillarIds, unverified };
}
