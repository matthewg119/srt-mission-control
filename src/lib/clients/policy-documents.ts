// The context database: published external guidance, versioned and append-only.
//
// Matthew, 2026-09-18: "How can we build the context database and how are we going to communicate
// with the context database? i say ideally in the srt aeo drafting channel that is the one that
// should say 'scan for latest XYZ' once per week at least".
//
// ‼️ THIS TABLE IS NOT A CACHE AND IT IS NOT knowledge_entries. docs/2026-09-22-policy-documents.sql
// carries the full argument for why all three obvious homes were wrong. The short version: a cache
// replaces on conflict and so cannot answer "what changed since last week", which is the entire
// point; and knowledge_entries is read in full into the Office Manager's system prompt on every
// message, so filing a corpus there bills a lane that has no use for it, for ever.
//
// ‼️ NOTHING HERE REACHES A MODEL. src/config/guideline-rules.ts is what binds. This is the
// reference a person reads when deciding whether those rules changed.

import crypto from "crypto";
import { supabaseAdmin } from "@/lib/db";

/** How long a stored version may be. Google's longest guidance page is well inside this. */
const MAX_BYTES = 400_000;

const TIMEOUT_MS = 8000;

/**
 * A declared agent, the same shape robots-check.ts sends.
 *
 * Google's own documentation, read by a tool that says what it is. There is no reason to pretend
 * to be a browser here and a good reason not to.
 */
const USER_AGENT = "SRT-PolicyScan/1.0 (+https://srtagency.com)";

/**
 * Thrown to decline storing an answer we did not get.
 *
 * ‼️ A FAILURE IS NEVER STORED, AND THE THROW IS WHAT ENFORCES IT. robots-check.ts states the rule
 * this copies: caching our own timeout would answer every later read of this source with it. A
 * failed fetch writes no version, and the card says which source could not be read rather than
 * quietly reporting "no change".
 */
export class PolicyUnreadable extends Error {
  constructor(public readonly why: string) {
    super(why);
    this.name = "PolicyUnreadable";
  }
}

export interface PolicyVersion {
  id: string;
  kind: string;
  sourceUrl: string | null;
  title: string | null;
  content: string;
  contentHash: string;
  source: "fetched" | "pasted";
  fetchedAt: string;
}

/**
 * Whitespace-collapsed, so a reflow is not a change.
 *
 * Same normalisation hashBody uses on a page body, and for the same reason: a version is a
 * statement about what the page SAID. A single re-wrapped paragraph posting a diff card every
 * Thursday is how the card stops being read.
 */
export function normalizePolicyText(raw: string): string {
  return raw.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export function hashPolicyText(normalized: string): string {
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

/** The live version of one source, or null when it has never been read. */
export async function liveVersion(kind: string): Promise<PolicyVersion | null> {
  const { data, error } = await supabaseAdmin
    .from("policy_documents")
    .select("id, kind, source_url, title, content, content_hash, source, fetched_at")
    .eq("kind", kind)
    .is("superseded_at", null)
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[policy-documents] live version unreadable:", error.message);
    return null;
  }
  if (!data) return null;
  return toVersion(data as Record<string, unknown>);
}

function toVersion(r: Record<string, unknown>): PolicyVersion {
  return {
    id: String(r.id),
    kind: String(r.kind),
    sourceUrl: (r.source_url as string | null) ?? null,
    title: (r.title as string | null) ?? null,
    content: String(r.content ?? ""),
    contentHash: String(r.content_hash ?? ""),
    source: (r.source as PolicyVersion["source"]) ?? "fetched",
    fetchedAt: String(r.fetched_at ?? ""),
  };
}

export type StoreResult =
  /** The bytes match what is already live. Nothing was written and nothing should be said. */
  | { outcome: "unchanged"; live: PolicyVersion }
  /** A new version landed. `previous` is null the first time a source is ever read. */
  | { outcome: "stored"; version: PolicyVersion; previous: PolicyVersion | null }
  /** These exact bytes are already on file as an older version: the source went back. */
  | { outcome: "reverted"; live: PolicyVersion | null }
  | { outcome: "failed"; why: string };

/**
 * File one version of one source, if and only if its bytes are new.
 *
 * ‼️ AN UNCHANGED FETCH WRITES NOTHING AND RETURNS "unchanged". The content hash is the whole
 * economy of the weekly scan: silence is the correct output six weeks in seven, and a card that
 * says "no change" every Thursday is the pace card wearing a new hat.
 */
export async function storeVersion(args: {
  kind: string;
  sourceUrl: string | null;
  title: string | null;
  content: string;
  source: "fetched" | "pasted";
  by?: string | null;
}): Promise<StoreResult> {
  const content = normalizePolicyText(args.content);
  if (!content) return { outcome: "failed", why: "the source came back empty" };

  const contentHash = hashPolicyText(content);
  const live = await liveVersion(args.kind);
  if (live && live.contentHash === contentHash) return { outcome: "unchanged", live };

  const { data, error } = await supabaseAdmin
    .from("policy_documents")
    .insert({
      kind: args.kind,
      source_url: args.sourceUrl,
      title: args.title,
      content: content.slice(0, MAX_BYTES),
      content_hash: contentHash,
      source: args.source,
      created_by: args.by ?? null,
    })
    .select("id, kind, source_url, title, content, content_hash, source, fetched_at")
    .maybeSingle();

  if (error) {
    // ‼️ 23505 IS NOT A FAULT, IT IS AN ANSWER. The unique index is (kind, content_hash), so a
    // collision means these exact bytes are already on file as an OLDER version: the page went
    // back to something we have seen. Worth saying on the card and worth not writing, because an
    // append-only table with two rows carrying the same bytes cannot say which one is current.
    if (error.code === "23505") return { outcome: "reverted", live };
    console.error("[policy-documents] version not stored:", error.message);
    return { outcome: "failed", why: error.message };
  }
  if (!data) return { outcome: "failed", why: "the insert returned no row" };

  // Supersede the previous one AFTER the new row exists, never before. The other order leaves a
  // source with no live version whenever the insert fails, which is the failure mode
  // supersede_audience_document() was made atomic to avoid.
  if (live) {
    const { error: supersedeError } = await supabaseAdmin
      .from("policy_documents")
      .update({ superseded_at: new Date().toISOString() })
      .eq("id", live.id);
    if (supersedeError) console.error("[policy-documents] previous version not superseded:", supersedeError.message);
  }

  return { outcome: "stored", version: toVersion(data as Record<string, unknown>), previous: live };
}

/**
 * Read one source's text off the live web.
 *
 * Copies robots-check.ts's shape exactly: a declared agent, an AbortController timeout, a byte cap,
 * redirect follow, and a THROW rather than a null-shaped answer so a failure can never be stored.
 *
 * ‼️ THE TEXT, NEVER THE HTML. harvest.ts: "What the page SAID is a fact and keeps; what we make of
 * it is recomputed every run." Storing markup would freeze a page's answers to whichever extraction
 * ruleset was current the day it was first read, and the extraction is live code.
 */
export async function fetchPolicyText(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "user-agent": USER_AGENT, accept: "text/html,text/plain,*/*" },
    });
    clearTimeout(timer);

    if (!res.ok) throw new PolicyUnreadable(`the page answered ${res.status}`);

    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!type.includes("html") && !type.includes("text")) {
      throw new PolicyUnreadable(`the page is ${type || "an unknown type"} rather than text`);
    }

    const body = (await res.text()).slice(0, MAX_BYTES);
    const { textFromHtml } = await import("./harvest");
    const text = normalizePolicyText(textFromHtml(body));
    if (text.length < 200) throw new PolicyUnreadable("the page came back with almost no text");
    return text;
  } catch (e) {
    clearTimeout(timer);
    if (e instanceof PolicyUnreadable) throw e;
    throw new PolicyUnreadable((e as Error).name === "AbortError" ? "it timed out" : (e as Error).message);
  }
}

/**
 * What changed between two versions, as whole lines.
 *
 * PURE, and deliberately crude: this is read by a person deciding whether to edit GUIDELINE_RULES,
 * not by a machine. A word-level diff of a policy page is noise, and the question the card asks is
 * "did the rules change", which whole lines answer.
 */
export function diffLines(
  before: string,
  after: string,
  limit = 12
): { added: string[]; removed: string[]; addedTotal: number; removedTotal: number } {
  const beforeSet = new Set(before.split("\n").map((l) => l.trim()).filter(Boolean));
  const afterSet = new Set(after.split("\n").map((l) => l.trim()).filter(Boolean));

  const added = [...afterSet].filter((l) => !beforeSet.has(l));
  const removed = [...beforeSet].filter((l) => !afterSet.has(l));

  return {
    added: added.slice(0, limit),
    removed: removed.slice(0, limit),
    addedTotal: added.length,
    removedTotal: removed.length,
  };
}
