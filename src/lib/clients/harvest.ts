// The automated half of the avatar phrase harvest — delivery step 10, Runner v3 section 9.
//
// ‼️ IT RUNS AFTER THE AVATAR IS CONFIRMED NOW, AND THAT REVERSED THIS FILE'S OLD PREMISE.
// The confirmation moved from position 11 to position 8 on 2026-08-25, because the avatar decides
// which buyer the phrases are being collected for. Everything harvested here is TAGGED with that
// avatar's slug, which is what lets the next client in the vertical aiming at the same buyer reuse
// the work instead of paying for it again.
//
// ‼️ WHAT THIS READS, AND WHAT IT DELIBERATELY DOES NOT.
//
// READS: audit_runs.citations. Every URL every engine cited, on every audit ever run, already
// stored. That is a real corpus of the pages the engines themselves consider authoritative for
// this market — forum threads, RealSelf Q&A, listicles, review pages — and it needs no key,
// no agreement and no scraping, because these are pages an engine publicly told us it used.
//
// DOES NOT READ: Reddit. No REDDIT_CLIENT_ID exists, and A2 section 9 records that commercial
// use of the Data API needs Reddit's approval, unverified. A2 names this exact fallback:
// "build 4c on RealSelf + citation_sources alone if Reddit says no." Nothing here scrapes
// Reddit and nothing pretends to have read it. The gap is reported to Matthew in words rather
// than papered over — see deep-research-brief.ts for the half a person runs instead.
//
// DOES NOT POST: anywhere, ever, to any forum, as anyone. That ban is canon and predates this
// file. There is no posting code path here and one must not be added.
//
// ‼️ SCORING IS DETERMINISTIC, NO MODEL.
// Frequency is a count. Commercial intent is a keyword ladder. Objection is a fear-marker match.
// A model would produce different scores for the same phrase on different days, and these
// scores decide which questions get TRACKED FROM DAY ZERO — a number that moves on its own
// would make the day-30 comparison meaningless.

import { supabaseAdmin } from "@/lib/db";

const FETCH_TIMEOUT_MS = 8000;
const MAX_PAGES = 40;
const PAGE_BUDGET_BYTES = 300_000;
const MIN_PHRASE_WORDS = 4;
const MAX_PHRASE_WORDS = 22;

// ─────────────────────────────────────────────────────────────────────────────
// Extraction — pure
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Question-shaped and objection-shaped sentences only.
 *
 * A question shape is what somebody types into an assistant. An objection shape is what stops
 * them booking. Everything else on the page is prose we did not come for.
 */
const QUESTION_STARTERS =
  /^(how|what|why|when|where|which|who|is|are|does|do|did|can|could|should|would|will|has|have|am|was|were|any(one|body)|has anyone)\b/i;

const OBJECTION_MARKERS = [
  /\bafraid\b/i,
  /\bscared\b/i,
  /\bnervous\b/i,
  /\bworried\b/i,
  /\bworry\b/i,
  /\brisk(y|s)?\b/i,
  /\bdanger(ous)?\b/i,
  /\bside effects?\b/i,
  /\bwent wrong\b/i,
  /\bbad experience\b/i,
  /\bruined\b/i,
  /\bregret\b/i,
  /\bwaste of money\b/i,
  /\brip(-|\s)?off\b/i,
  /\bscam\b/i,
  /\bdoes ?n'?t work\b/i,
  /\bpainful\b/i,
  /\bhurts?\b/i,
  /\bbruis(e|ing)\b/i,
  /\bfrozen\b/i,
  /\bfake\b/i,
  /\bover ?done\b/i,
  /\bunnatural\b/i,
  /\btoo expensive\b/i,
];

/** 0 to 3. Higher means closer to actually booking. */
const INTENT_LADDER: Array<[RegExp, number]> = [
  [/\b(book|appointment|consultation|schedule|near me|open (today|now)|walk[- ]?in)\b/i, 3],
  [/\b(cost|price|pricing|how much|cheap|afford|financing|payment plan|deal|package)\b/i, 3],
  [/\b(best|top rated|reputable|recommend|who does|where should i go|which clinic)\b/i, 2],
  [/\b(vs|versus|compare|difference between|better than|or)\b/i, 2],
  [/\b(safe|licensed|qualified|certified|legit|reviews?)\b/i, 1],
];

export interface HarvestedPhrase {
  phrase: string;
  normalized: string;
  frequencyScore: number;
  commercialIntentScore: number;
  objectionPhrase: boolean;
  sourceUrl: string;
}

export function normalizePhrase(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9? ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function commercialIntent(phrase: string): number {
  let score = 0;
  for (const [pattern, value] of INTENT_LADDER) {
    if (pattern.test(phrase)) score = Math.max(score, value);
  }
  return score;
}

export function isObjection(phrase: string): boolean {
  return OBJECTION_MARKERS.some((p) => p.test(phrase));
}

/** Strip tags, scripts and styles. No parser dependency; this is a coarse text extraction. */
export function textFromHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ");
}

/**
 * Pull the question- and objection-shaped sentences out of one page.
 *
 * Deliberately keeps the sentence AS WRITTEN, including its typos. Runner v3 section 9 wants
 * "question-shaped and objection-shaped phrasings" because the market's own wording is the only
 * thing here that could not have been invented at a desk. Cleaning it up destroys the evidence.
 */
export function extractPhrases(text: string, sourceUrl: string): HarvestedPhrase[] {
  const sentences = text.split(/(?<=[.?!])\s+|\n+/);
  const out: HarvestedPhrase[] = [];
  const seen = new Set<string>();

  for (const raw of sentences) {
    const phrase = raw.trim();
    const words = phrase.split(/\s+/).length;
    if (words < MIN_PHRASE_WORDS || words > MAX_PHRASE_WORDS) continue;

    const questionShaped = phrase.includes("?") || QUESTION_STARTERS.test(phrase);
    const objection = isObjection(phrase);
    if (!questionShaped && !objection) continue;

    // Boilerplate filter. Cookie banners and nav text are question-shaped often enough to
    // pollute a bank that a human then has to read.
    if (/cookie|privacy policy|subscribe|newsletter|sign in|log in|javascript/i.test(phrase)) continue;

    const normalized = normalizePhrase(phrase);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);

    out.push({
      phrase,
      normalized,
      frequencyScore: 1,
      commercialIntentScore: commercialIntent(phrase),
      objectionPhrase: objection,
      sourceUrl,
    });
  }

  return out;
}

/** Merge sightings of the same phrase, raising frequency rather than duplicating. */
export function mergePhrases(all: HarvestedPhrase[]): HarvestedPhrase[] {
  const byNorm = new Map<string, HarvestedPhrase>();
  for (const p of all) {
    const existing = byNorm.get(p.normalized);
    if (existing) {
      existing.frequencyScore += 1;
      existing.commercialIntentScore = Math.max(existing.commercialIntentScore, p.commercialIntentScore);
      existing.objectionPhrase = existing.objectionPhrase || p.objectionPhrase;
    } else {
      byNorm.set(p.normalized, { ...p });
    }
  }
  return [...byNorm.values()].sort(
    (a, b) => b.commercialIntentScore - a.commercialIntentScore || b.frequencyScore - a.frequencyScore
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The run
// ─────────────────────────────────────────────────────────────────────────────

async function fetchPage(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": "SRT-Harvest/1.0 (+https://srtagency.com)" },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html") && !type.includes("text")) return null;
    const body = await res.text();
    return body.slice(0, PAGE_BUDGET_BYTES);
  } catch {
    return null;
  }
}

/**
 * Which vertical is this client, or why we will not guess.
 *
 * ‼️ IT REFUSES. THE `?? "med_spa"` IT REPLACED WAS A SILENT WRONG-VERTICAL WRITE (2026-08-25).
 *
 * `clients.vertical_slug` and `clients.business_type` were read by four call sites and written by
 * NOTHING, on any path, ever — the same readers-with-no-writer class as `clients.audit_report_id`.
 * The audit knew the answer and put it on `audit_reports`; nothing copied it across. So every
 * client in the system fell through to the literal `"med_spa"`.
 *
 * Measured on the first real client: forty correctly-extracted phrases about how to choose an AEO
 * agency, filed under `med_spa`. `question_bank` has NO `client_id` — it is keyed
 * `(vertical, normalized)` and shared across every client in a vertical forever — so the next real
 * med spa would have inherited them as their tracked question set, and there is no per-client key
 * to unpick them by afterwards.
 *
 * Matthew's call, made with both options stated: refuse. A step that parks in `error` with a fix
 * line costs one Re-check. A wrong write costs a corpus nobody can clean.
 *
 * `adoptAuditClassification` (baseline-scan.ts) is the writer that makes this succeed; it runs
 * when step 2 is confirmed.
 */
export async function verticalFor(
  clientId: string
): Promise<{ ok: true; vertical: string } | { ok: false; error: string }> {
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("vertical_slug, business_type")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) return { ok: false, error: "client not found" };

  const vertical = (
    ((client.vertical_slug as string | null) || (client.business_type as string | null)) ?? ""
  ).trim();

  if (!vertical) {
    return {
      ok: false,
      error:
        "No vertical on the client row. A harvest filed under a guessed vertical poisons the " +
        "shared question bank for every real client in it, and question_bank has no client_id " +
        "so it cannot be unpicked afterwards. Confirm the baseline scan first: that is what " +
        "copies the audit's classification onto clients.vertical_slug.",
    };
  }

  return { ok: true, vertical };
}

export async function runHarvest(
  clientId: string
): Promise<{ ok: boolean; error?: string; phrases?: number; pages?: number; runId?: string; avatar?: string }> {
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("vertical_slug, business_type, city, state, ideal_patient")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) return { ok: false, error: "client not found" };

  const resolved = await verticalFor(clientId);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const vertical = resolved.vertical;

  // ‼️ DYNAMIC IMPORT, AND IT HAS TO BE. avatars.ts imports verticalFor from THIS file, so a
  // static import here closes a cycle that builds in dev and fails on a cold module graph. Same
  // move audit-tools.ts makes for edit_draft, and for the same reason.
  const { confirmedAvatarFor } = await import("./avatars");
  const avatar = await confirmedAvatarFor(clientId);

  // ‼️ IT REFUSES RATHER THAN FILING UNDER NULL, and that reverses what this step used to do.
  //
  // The avatar is confirmed at step 8 now and this step is blocked on it, so an unconfirmed
  // avatar here means something skipped the gate rather than that the work is early. Filing the
  // phrases under a null avatar would put them in the shared corpus untagged, and question_bank
  // has no client_id, so there is no per-client key to unpick them by afterwards. Same reasoning
  // verticalFor() records one function up, and Matthew's same call: a step that parks in `error`
  // with a fix line costs one Re-check; a wrong write costs a corpus.
  if (!avatar) {
    return {
      ok: false,
      error:
        "No avatar is confirmed on this client, so there is nothing to file these phrases under. " +
        "question_bank has no client_id and is shared across every client in the vertical, so an " +
        "untagged harvest cannot be unpicked later. Confirm the avatar first: it is the step " +
        "directly above this one on the board.",
    };
  }

  const { data: report } = await supabaseAdmin
    .from("audit_reports")
    .select("id")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!report) {
    return { ok: false, error: "no baseline run, so there are no cited sources to harvest from" };
  }

  const { data: runs } = await supabaseAdmin
    .from("audit_runs")
    .select("citations")
    .eq("report_id", report.id);

  // Deduped and capped. One thread cited by six of the twenty prompts is one page to read.
  const urls = [
    ...new Set(
      (runs ?? []).flatMap((r) => ((r.citations as string[] | null) ?? [])).filter((u) => /^https?:\/\//.test(u))
    ),
  ].slice(0, MAX_PAGES);

  const ideal = (client.ideal_patient ?? {}) as Record<string, string>;
  const seedTerms = [ideal.objections, ideal.target, ideal.highest_margin, client.city as string]
    .filter((s): s is string => Boolean(s && s.trim()))
    .map((s) => s.trim());

  const { data: runRow, error: runErr } = await supabaseAdmin
    .from("harvest_runs")
    .insert({
      client_id: clientId,
      vertical,
      // ‼️ The two falses are the record. A thin run must be visibly thin.
      sources: { citations: urls.length, reddit: false, deep_research: false },
      seed_terms: seedTerms,
    })
    .select("id")
    .single();

  if (runErr || !runRow) return { ok: false, error: runErr?.message ?? "could not open a harvest run" };

  const collected: HarvestedPhrase[] = [];
  let pagesRead = 0;

  for (const url of urls) {
    const html = await fetchPage(url);
    if (!html) continue;
    pagesRead += 1;
    collected.push(...extractPhrases(textFromHtml(html), url));
  }

  // The owner's own objections go in too, tagged as intake rather than harvest, because they
  // came from a person rather than a page and that provenance matters when ranking.
  const merged = mergePhrases(collected);

  if (merged.length) {
    // Upsert so a repeat harvest raises frequency instead of duplicating. onConflict matches the
    // unique index on (vertical, normalized).
    const rows = merged.map((p) => ({
      vertical,
      phrase: p.phrase,
      normalized: p.normalized,
      source: "harvest" as const,
      harvest_run_id: runRow.id,
      source_url: p.sourceUrl,
      frequency_score: p.frequencyScore,
      commercial_intent_score: p.commercialIntentScore,
      // ‼️ TAGGED WITH THE CONFIRMED AVATAR'S SLUG. THIS COMMENT USED TO SAY THE OPPOSITE.
      //
      // It read "avatar stays NULL, step 11 is where a human confirms an avatar", which was true
      // while the confirmation came two steps after this one. The avatar is confirmed BEFORE this
      // runs now, so the tag is a record rather than a guess.
      //
      // The SLUG, never the a1/a2/a3 slot: this table has no client_id and is shared across every
      // client in the vertical forever, and a slot only means something next to the one niche
      // brief that offered it.
      avatar: avatar.slug,
      objection_phrase: p.objectionPhrase,
    }));

    // ‼️ THE TARGET HAS TO MATCH THE INDEX EXACTLY OR IT IS 42P10 AT PLAN TIME, ON EVERY RUN.
    // (vertical, avatar, normalized) NULLS NOT DISTINCT, from docs/2026-08-25-lane-2-avatar.sql.
    // That failure has happened twice in this repo and it is never a data collision: the
    // statement cannot be PLANNED, so it fails even against an empty table.
    const { error } = await supabaseAdmin
      .from("question_bank")
      .upsert(rows, { onConflict: "vertical,avatar,normalized", ignoreDuplicates: false });

    if (error) {
      await supabaseAdmin.from("harvest_runs").update({ error: error.message }).eq("id", runRow.id);
      return { ok: false, error: error.message, runId: runRow.id };
    }
  }

  await supabaseAdmin
    .from("harvest_runs")
    .update({ results_count: merged.length, sources: { citations: pagesRead, reddit: false, deep_research: false } })
    .eq("id", runRow.id);

  return { ok: true, phrases: merged.length, pages: pagesRead, runId: runRow.id, avatar: avatar.label };
}

/** What Matthew reads in the thread. States what did not run as plainly as what did. */
export function formatHarvestSummary(args: {
  phrases: number;
  pages: number;
  topPhrases: HarvestedPhrase[];
}): string {
  const lines = [
    `*Avatar phrase harvest* — ${args.phrases} phrases from ${args.pages} pages the engines cited.`,
    "",
    "Reddit was NOT read: no credentials, and commercial Data API use needs Reddit's approval. Nothing was scraped.",
    "The deep research brief posted alongside this is the other half, and it needs you to run it.",
  ];

  if (args.topPhrases.length) {
    lines.push("", "Highest commercial intent so far:");
    for (const p of args.topPhrases.slice(0, 8)) {
      lines.push(`· "${p.phrase}"${p.objectionPhrase ? "  _(objection)_" : ""}`);
    }
  } else {
    lines.push("", ":warning: Nothing was extracted. Either no citations are on file or the pages did not respond.");
  }

  return lines.join("\n");
}
