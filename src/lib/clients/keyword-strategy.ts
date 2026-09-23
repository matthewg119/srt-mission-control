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
  SERP_TRIAGE_RULE,
  SHORTLIST_SIZE,
  bestVerdict,
  clusterFinalists,
  isVerdict,
  parseStrategyCommand,
  shortlistOf,
  stageName,
  typedVerdict,
  verdictFrom,
  verdictLine,
  KEYWORDS_SHORTLIST,
  KEYWORDS_SERP,
  KEYWORDS_SERP_TYPED,
  type Finalist,
  type SerpRead,
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
    };
  });

  const extra = await supabaseAdmin
    .from("client_keywords")
    .select("id, intent, merged_into, serp_verdict")
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
    const v = e.serp_verdict as string | null;
    row.verdict = isVerdict(v) ? v : null;
    const intent = e.intent as string | null;
    row.intent = intent === "post" || intent === "service_page" || intent === "merged" ? intent : null;
    row.mergedInto = (e.merged_into as string | null) ?? null;
  }

  return { ok: true, rows, strategyReady: true };
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

  const { error } = await supabaseAdmin.from("keyword_serp_reads").insert({
    client_id: clientId,
    keyword_id: keyword.id,
    phrase: keyword.phrase,
    normalized: keyword.normalized || normalizePhrase(keyword.phrase),
    ai_overview: read?.aiOverview ?? null,
    ai_overview_answers: read?.aiOverviewAnswers ?? null,
    result_shape: read?.resultShape ?? null,
    verdict,
    source,
    // A person is not a legibility score. Recorded as 1 so a typed row never looks like a poor read.
    confidence: source === "typed" ? 1 : (read?.confidence ?? null),
    evidence: read?.evidence ?? (source === "typed" ? "typed in the thread" : null),
    doc_id: input.docId ?? null,
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
  const checked = list.filter((r) => r.verdict && r.verdict !== "unclear").length;

  const lines: string[] = [
    `*The ${list.length} subjects worth checking* for *${clientName}*. ${checked} checked, ${list.length - checked} to go.`,
    "",
    `_${SERP_TRIAGE_RULE}_`,
    "",
  ];

  list.forEach((r, i) => {
    const n = String(i + 1).padStart(2, " ");
    const mark = verdictMark(r.verdict);
    const tail = r.verdict && r.verdict !== "unclear" ? `  _(${r.verdict.replace("_", " ")})_` : "";
    lines.push(`${mark} \`${n}\` ${r.phrase}${tail}`);
  });

  lines.push(
    "",
    "*In this thread:*",
    "  • Google one of them, then paste the screenshot here with `keywords serp 12` in the message.",
    "  • `keywords serp 12: merge` types the answer instead, when a screenshot is more trouble than it is worth.",
    "  • `strategy` once enough of them are checked. It groups them and says what becomes a page.",
    "",
    "_A screenshot is read for what is ON it: whether there is an AI Overview, whether it answers the search in full, and whether the results are articles, listings or products. The triage above is applied to that reading here, not by the model._"
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

  const { readSerp } = await import("./serp-read");
  const read = await readSerp(args.image, found.row.phrase);
  const verdict = verdictFrom(read);

  if (verdict === "unclear") {
    // ‼️ NOTHING IS STORED ON AN UNREADABLE SCREENSHOT. A row saying "unclear" is indistinguishable
    // from a row nobody has looked at, and storing it would make the shortlist claim progress it
    // has not made. The typed form is the way through.
    return {
      message: [
        `:grey_question: I could not tell from that screenshot for *${found.row.phrase}*.`,
        read.evidence ? `_What I saw: ${read.evidence}._` : "",
        "",
        `Nothing was stored. Post a wider screenshot, or type it: \`keywords serp ${args.n}: merge\`, \`: post\`, \`: service\`.`,
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  const res = await recordVerdict({
    clientId: args.clientId,
    keyword: found.row,
    read,
    verdict,
    source: "vision",
    actor: args.by,
    docId: args.docId ?? null,
    model: "claude-haiku-4-5-20251001",
  });
  if (!res.ok) return { message: `:warning: ${res.error}` };

  const lines = [
    `${verdictMark(verdict)} \`${args.n}\` *${found.row.phrase}* is a *${verdict.replace("_", " ")}*.`,
    verdictLine(verdict),
  ];
  if (read.topDomains.length) lines.push(`_Ranking: ${read.topDomains.join(", ")}._`);
  if (read.evidence) lines.push(`_Read: ${read.evidence}._`);
  lines.push("", "`strategy` groups everything checked so far. `keywords serp N: <verdict>` overrides this.");
  return { message: lines.join("\n") };
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

async function isLocked(clientId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("client_keyword_strategy")
    .select("locked_at")
    .eq("client_id", clientId)
    .not("locked_at", "is", null)
    .limit(1);
  if (error) return false;
  return (data ?? []).length > 0;
}

/** Write the proposal down so the numbers on the card survive to the next message. */
async function persistClusters(
  clientId: string,
  clusters: ReturnType<typeof clusterFinalists>["clusters"],
  byId: Map<string, Finalist>
): Promise<void> {
  const wipe = await supabaseAdmin
    .from("keyword_clusters")
    .delete()
    .eq("client_id", clientId)
    .eq("status", "proposed");
  if (wipe.error && missingTable(wipe.error)) return;

  for (const [i, c] of clusters.entries()) {
    const { data, error } = await supabaseAdmin
      .from("keyword_clusters")
      .insert({
        client_id: clientId,
        label: c.label,
        pillar_keyword_id: c.pillarId,
        awareness_entry: c.awarenessEntry,
        awareness_target: c.awarenessTarget,
        page_kind: c.pageKind,
        rationale: c.rationale,
        rank: i + 1,
        status: "proposed",
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
      await supabaseAdmin
        .from("client_keywords")
        .update({ cluster_id: clusterId, intent: "merged", merged_into: pillar?.id ?? null })
        .eq("id", memberId);
    }
  }
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
  await persistClusters(clientId, clusters, byId);

  const now = new Date().toISOString();
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
// What step 21 and the studio read
// ─────────────────────────────────────────────────────────────────────────────

export interface StrategyView {
  locked: boolean;
  /** Keyword ids that must NOT become their own page: merged, or a service page. */
  excludeIds: Set<string>;
  /** Keyword ids that are a cluster pillar, in cluster order. */
  pillarIds: string[];
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
  const empty: StrategyView = { locked: false, excludeIds: new Set(), pillarIds: [] };

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

  const pillarIds = clusters.data
    .map((c) => c.pillar_keyword_id as string | null)
    .filter((id): id is string => Boolean(id) && !excludeIds.has(id as string));

  return { locked: true, excludeIds, pillarIds };
}
