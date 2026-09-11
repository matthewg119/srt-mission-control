// Google Business Profile posts and social captions, from what the client already approved.
//
// Matthew, 2026-09-11: "make sure for the posts we focus on this questions: price, fears,
// comparisons, how it works." Those four are the `focus` categories in keyword-expansion.ts, the
// same ones the page plan fills its supports from first, so the posts and the pages are aimed at
// the same buying questions rather than at two different guesses.
//
// ‼️ IT WRITES FROM WHAT IS ON FILE AND NOTHING ELSE. The offer as locked on the prep call, the
// approved keywords, the approved plan, and the numbered evidence the drafter and the gate already
// share. A post that invents a number or a promise goes onto a client's real Google profile under
// their name, which is the same exposure draft-page.ts's rules exist for.
//
// ‼️ DRAFTS. Nothing here posts to Google, and there is no code path that could: the output goes
// into the ops thread for a person to copy.

import { callClaudeJSON } from "@/lib/claude-calls";
import { hasBannedDash } from "@/lib/copy-guard";
import { COMPLIANCE_RULES, STYLE_RULES } from "@/lib/audit-engine/email-assistant";
import type { WorkflowContext, WorkflowResult } from "./registry";

/** Google's own limit is 1,500 characters. A post that overruns is rejected by them, not by us. */
const GBP_MAX = 1500;

const MODEL = "claude-sonnet-4-6" as const;

interface DraftedPost {
  question: "price" | "fears" | "comparisons" | "how it works";
  keyword: string;
  gbp: string;
  social: string;
  /** Which numbered sources this post rests on. Empty is allowed; an invented one is not. */
  sources: string[];
}

interface PostSet {
  posts: DraftedPost[];
}

const QUESTIONS: Array<DraftedPost["question"]> = ["price", "fears", "comparisons", "how it works"];

function looksLikePostSet(v: unknown): v is PostSet {
  if (!v || typeof v !== "object") return false;
  const posts = (v as PostSet).posts;
  if (!Array.isArray(posts) || posts.length === 0) return false;
  return posts.every(
    (p) =>
      p &&
      typeof p.gbp === "string" &&
      p.gbp.trim().length > 0 &&
      p.gbp.length <= GBP_MAX &&
      typeof p.social === "string" &&
      typeof p.keyword === "string" &&
      QUESTIONS.includes(p.question) &&
      // ‼️ THE DASH RULE IS ENFORCED IN VALIDATION, NOT BY REWRITING THE OUTPUT AFTERWARDS. A
      // rewrite that swaps an em dash for a comma leaves the sentence built around a dash, and
      // callClaudeJSON's correction retry exists precisely so the model writes it properly instead.
      !hasBannedDash(p.gbp) &&
      !hasBannedDash(p.social) &&
      Array.isArray(p.sources)
  );
}

function whyInvalid(v: unknown): string {
  const posts = (v as PostSet)?.posts;
  if (!Array.isArray(posts)) return "the payload had no `posts` array";
  const tooLong = posts.find((p) => typeof p?.gbp === "string" && p.gbp.length > GBP_MAX);
  if (tooLong) return `a Google Business post is ${tooLong.gbp.length} characters and the limit is ${GBP_MAX}`;
  const dashed = posts.find((p) => hasBannedDash(p?.gbp ?? "") || hasBannedDash(p?.social ?? ""));
  if (dashed) return "a post uses an em dash, an en dash or ' - ' as a connector, which is banned in all copy";
  const wrongQuestion = posts.find((p) => !QUESTIONS.includes(p?.question));
  if (wrongQuestion) return `"${String(wrongQuestion?.question)}" is not one of the four buying questions`;
  return "a post was missing its text, its keyword or its sources array";
}

export async function runGbpSocialPosts(ctx: WorkflowContext): Promise<WorkflowResult> {
  const reads = await import("../client-reads");

  const profile = await reads.clientProfile(ctx.clientId);
  if ("error" in profile) return { ok: false, error: profile.error };

  // ‼️ THE LOCK, NOT THE PROPOSAL. offer_proposed is a reading of an intake field; offer_locked is
  // a person having asked them on the prep call. Posts written against a proposal are posts about
  // whatever the top line of their services menu happened to say.
  if (!profile.offer.locked || !profile.offer.treatment) {
    return {
      ok: false,
      error:
        "the offer is not locked yet, so there is nothing to write posts about. It is locked on the " +
        "prep call, by replying `offer:` in that step's thread.",
    };
  }

  const [keywords, plan] = await Promise.all([
    reads.clientKeywords({ clientId: ctx.clientId, use: "query", approvedOnly: true, limit: 60 }),
    reads.clientPlan(ctx.clientId),
  ]);

  const approved = "error" in keywords ? [] : keywords.rows;
  if (approved.length === 0) {
    return {
      ok: false,
      error:
        "no approved keywords. The keyword step writes them and a person approves them with " +
        "`keywords approve`; posts drawn from unapproved phrases are posts nobody chose.",
    };
  }

  const planRows = "error" in plan ? [] : plan.rows.filter((r) => r.status === "approved" || r.pageStatus);

  const { loadNumberedEvidence } = await import("../page-evidence");
  const evidence = await loadNumberedEvidence(ctx.clientId, null);

  const facts = [
    `Business: ${profile.client.name}${profile.city ? `, ${profile.city}${profile.state ? `, ${profile.state}` : ""}` : ""}.`,
    `The offer, locked on the prep call: ${profile.offer.treatment}.`,
    profile.offer.positioning ? `How they want to be known for it: ${profile.offer.positioning}.` : "",
    profile.offer.terms.length ? `What their customers call it: ${profile.offer.terms.join(", ")}.` : "",
    profile.avatar ? `The customer this is aimed at: ${profile.avatar.label}.` : "",
    "",
    "APPROVED KEYWORDS (a person chose these; use them verbatim as the target phrase):",
    ...approved.slice(0, 40).map((k) => `  - ${k.phrase}  [${k.category}]`),
    "",
    planRows.length
      ? `PAGES ALREADY PLANNED (do not duplicate their angle, complement it):\n${planRows
          .slice(0, 9)
          .map((r) => `  - ${r.title ?? r.question} (${r.keyword ?? "no keyword"})`)
          .join("\n")}`
      : "No page plan yet.",
    "",
    evidence.length
      ? `EVIDENCE ON FILE. Every claim must rest on one of these, cited by its ref:\n${evidence
          .map((e) => `  ${e.ref} [${e.label}] ${e.content.slice(0, 400)}`)
          .join("\n")}`
      : "NO EVIDENCE ON FILE. Write only what the offer itself states, and claim nothing beyond it.",
  ]
    .filter(Boolean)
    .join("\n");

  const system = [
    "You write Google Business Profile posts and social captions for a local business.",
    "",
    "You are given the business's locked offer, the keywords a person approved, and the evidence on",
    "file. Write TWO posts for each of the four buying questions: price, fears, comparisons, how it",
    "works. Each post gets a Google Business post (under 1500 characters) and a shorter social",
    "caption saying the same thing.",
    "",
    "RULES:",
    "Every post targets ONE approved keyword, used verbatim, and says so in the keyword field.",
    "Every factual claim rests on the evidence given, cited by its ref (S1, S2) in the sources array.",
    "A post with nothing to cite must say only what the offer itself states. An invented number, a",
    "made-up review, a statistic nobody gave you: those go onto this business's real Google profile",
    "under their name, so there is no version of this where you guess.",
    "Never promise an outcome, a result, a number of customers, or a timeframe.",
    "Write like the owner talking to a customer, not like marketing copy.",
    "",
    COMPLIANCE_RULES,
    "",
    STYLE_RULES,
  ].join("\n");

  let drafted: PostSet;
  try {
    const res = await callClaudeJSON<PostSet>({
      model: MODEL,
      system,
      user: facts,
      maxTokens: 4000,
      temperature: 0.6,
      schemaHint:
        '{"posts":[{"question":"price|fears|comparisons|how it works","keyword":"the approved phrase, verbatim","gbp":"the Google Business post","social":"the caption","sources":["S1"]}]}',
      validate: looksLikePostSet,
      describeInvalid: whyInvalid,
      timeoutMs: 180_000,
    });
    drafted = res.data;
  } catch (e) {
    return { ok: false, error: `the drafting call failed: ${(e as Error).message}` };
  }

  // A ref the model invented is worse than no ref: it is an unsupported claim wearing a citation.
  // Same rule page-evidence.ts states for a page's evidence map.
  const known = new Set(evidence.map((e) => e.ref));
  const invented = drafted.posts.flatMap((p) => p.sources.filter((s) => !known.has(s)));

  const byQuestion = QUESTIONS.map((q) => ({
    question: q,
    posts: drafted.posts.filter((p) => p.question === q),
  }));

  const summary = [
    `${drafted.posts.length} posts, on the four buying questions.`,
    ...byQuestion.map((g) => `  *${g.question}*: ${g.posts.length}`),
    "",
    ...drafted.posts.slice(0, 4).map((p) => `> *${p.question}* (${p.keyword})\n> ${p.gbp.slice(0, 300)}`),
    "",
    invented.length
      ? `:warning: ${invented.length} citation(s) point at evidence that does not exist (${[...new Set(invented)].join(", ")}). Read those posts before using them.`
      : "Every citation points at evidence on file.",
    "These are drafts. Nothing has been posted to Google or anywhere else.",
  ].join("\n");

  return {
    ok: true,
    output: { posts: drafted.posts, invented, evidenceCount: evidence.length },
    summary,
  };
}
