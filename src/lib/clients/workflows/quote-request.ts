// `quote_request`: the blocked claim becomes an email asking somebody for one sentence.
//
// ‼️ THIS IS THE JOIN BETWEEN THE GATE AND THE OFF-SITE LANE, AND IT IS WHY THE GATE IS WORTH
// HAVING. A page refused for `unbacked_claims` or `orphan_numbers` is a page making a claim
// nothing on file supports. The old answer was to soften the sentence until it passed, which
// makes a weaker page. This one asks the person who would know.
//
// ‼️ AND THE REPLY IS EVIDENCE, WHICH IS THE PART THAT PAYS FOR ITSELF. It files as a
// page_source with source_type EXTERNAL_RESEARCH and collected_via 'outreach_reply', so the
// claim it backs stops being unbacked and the page unblocks. The blocker becomes the link
// engine: we now have a reason to email somebody, and somebody who has answered us.
//
// ‼️ IT DRAFTS. IT DOES NOT SEND. Every outreach lane in this repo is a reviewed draft and this
// one is no different: the queue, the mailbox rotation, the pacing, the suppression list and
// the opt-out are all reused as they are.

import type { WorkflowContext, WorkflowResult } from "./registry";
import { supabaseAdmin } from "@/lib/db";
import { callClaudeJSON } from "@/lib/claude-calls";
import { hasBannedDash } from "@/lib/copy-guard";

const MODEL = "claude-sonnet-4-6" as const;

interface BlockedClaim {
  pageId: string;
  slug: string;
  title: string;
  detail: string;
}

/**
 * The claims currently refusing to publish, from the latest verdict per page.
 *
 * ‼️ READ OFF THE STORED VERDICT, NOT RE-RUN. runGate costs a model call per page, and this
 * workflow is about acting on refusals somebody has already seen rather than discovering new
 * ones. A stale verdict is fine here for the same reason it is not fine at publish time: the
 * worst case is drafting an email about a claim that has since been fixed, which a person
 * reading the draft notices immediately.
 */
async function blockedClaims(clientId: string): Promise<BlockedClaim[]> {
  const { data: pages, error } = await supabaseAdmin
    .from("client_pages")
    .select("id, slug, title")
    .eq("client_id", clientId)
    .neq("status", "archived");

  if (error) throw new Error(`[quote-request] pages unavailable: ${error.message}`);
  const rows = (pages ?? []) as Array<{ id: string; slug: string; title: string }>;
  if (rows.length === 0) return [];

  const { latestGateRun } = await import("@/lib/hub/page-gate");
  const out: BlockedClaim[] = [];

  for (const p of rows) {
    const run = await latestGateRun(p.id).catch(() => null);
    if (!run || run.verdict !== "block") continue;
    for (const c of run.checks) {
      if (c.tier !== "block" || c.status !== "fail") continue;
      out.push({ pageId: p.id, slug: p.slug, title: p.title, detail: c.detail });
    }
  }
  return out;
}

const SYSTEM = `You write one short email asking a named expert for ONE quotable sentence.

The situation: a page is being written and it makes a claim nothing on file supports. Rather
than soften the claim, we are asking somebody who would actually know.

RULES, all of them absolute:
- ONE ask. One question, one sentence wanted back. No second request, no meeting, no call.
- Say what the page is about and why THEY are being asked. A stranger who cannot tell why the
  email reached them deletes it.
- Ask for their own words, and say they will be quoted and attributed. Somebody who does not
  want to be quoted has to be able to tell that before they answer.
- NO em dash, anywhere.
- No figure that was not given to you. If you have no number, write the email without one.
- No flattery, no "I hope this finds you well", no "I am reaching out".
- Short. Under a hundred and twenty words before the sign off.

Return JSON: { "subject": string, "body": string, "asking": string }
"asking" is the one sentence you are hoping they send back, in your words, so a person
reviewing this can see whether the ask is worth making.`;

interface Drafted {
  subject: string;
  body: string;
  asking: string;
}

function faults(raw: unknown): string[] {
  const v = raw as Partial<Drafted> | null;
  const f: string[] = [];
  const subject = typeof v?.subject === "string" ? v.subject.trim() : "";
  const body = typeof v?.body === "string" ? v.body.trim() : "";
  const asking = typeof v?.asking === "string" ? v.asking.trim() : "";

  if (!subject) f.push("subject is missing.");
  if (!body) f.push("body is missing.");
  if (!asking) f.push("asking is missing, and it is what makes the draft reviewable.");
  if (hasBannedDash(subject) || hasBannedDash(body) || hasBannedDash(asking)) {
    f.push("an em dash appears. Rewrite the sentence without one.");
  }
  // One ask. The same count the permission lane enforces, and for the same reason.
  const marks = (body.match(/\?/g) ?? []).length;
  if (marks > 1) f.push(`the body asks ${marks} questions. It must ask exactly one.`);
  if (body.split(/\s+/).length > 200) f.push("the body is too long. Under a hundred and twenty words.");
  return f;
}

export async function runQuoteRequest(ctx: WorkflowContext): Promise<WorkflowResult> {
  const claims = await blockedClaims(ctx.clientId);

  if (claims.length === 0) {
    return {
      ok: false,
      error:
        "No page of this client's is currently refused by the quality gate, so there is no " +
        "claim to go and get backing for. Press Check on a page, or run `page_check`, if you " +
        "expected one.",
    };
  }

  // ‼️ ONE CLAIM, NOT ALL OF THEM. Each of these is a different person to email about a
  // different thing, and a workflow that drafted eleven emails at once would produce eleven
  // nobody reads. The first blocked claim is the one being worked on.
  const claim = claims[0];

  let d: Drafted;
  try {
    const res = await callClaudeJSON<Drafted>({
    model: MODEL,
    system: SYSTEM,
    user: [
      `Client: ${ctx.clientName}`,
      `Page: "${claim.title}" (/${claim.slug})`,
      "",
      "The claim the gate refused, in the gate's words:",
      claim.detail,
      "",
      "Write the email asking somebody who would know for one quotable sentence that settles it.",
      "You do not know who they are yet. Address it to the role, and the person sending it fills",
      "in the name.",
    ].join("\n"),
      maxTokens: 1200,
      validate: (v): v is Drafted => faults(v).length === 0,
      describeInvalid: (v) => faults(v).join(" "),
    });
    d = res.data;
  } catch (e) {
    // A refusal says what is missing and what to do about it, never "failed". The one that
    // actually happens here is an unset key, and naming it beats a stack trace.
    return { ok: false, error: `The draft did not come back usable: ${(e as Error).message}` };
  }

  return {
    ok: true,
    output: {
      note: [
        `:mag: *A source for one blocked claim on ${ctx.clientName}.*`,
        "",
        `*Page:* /${claim.slug}`,
        `*The gate said:* ${claim.detail}`,
        "",
        `*What we want back:* ${d.asking}`,
        "",
        `*Subject:* ${d.subject}`,
        "",
        d.body,
        "",
        "Nothing has been sent. Fill in the name, send it from your own mailbox, and when they " +
          "reply file it against the page as EXTERNAL_RESEARCH, collected via `outreach_reply`. " +
          "The claim stops being unbacked and the page unblocks itself.",
        "",
        // ‼️ SAID OUT LOUD, BECAUSE THE PROMPT IMPLIES MORE THAN THIS DELIVERS. A reply filed as
        // EXTERNAL_RESEARCH satisfies no_evidence, unbacked_claims and orphan_numbers, which are
        // the BLOCK tier and are what stops the publish. It does NOT count toward
        // first_party_ratio, which is a WARN: isFirstParty() deliberately excludes external
        // research, because somebody else's sentence is not the client's own words.
        "_A reply clears the block. It does not raise the first-party ratio, which is a warning " +
          "rather than a refusal: an expert's sentence is evidence, and it is not the client's " +
          "own words._",
      ].join("\n"),
      pageId: claim.pageId,
      slug: claim.slug,
      claim: claim.detail,
      subject: d.subject,
      body: d.body,
      asking: d.asking,
      remaining: claims.length - 1,
    },
    summary: `A quote request drafted for /${claim.slug}, ${claims.length - 1} other blocked claims on file`,
  };
}
