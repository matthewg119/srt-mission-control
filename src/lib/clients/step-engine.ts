// The step engine: one threaded Slack post per step that needs a person.
//
// Runner v3 §3. "Tasks needing me post a threaded message with imperative sentences and the
// EXACT string to search or paste. Never 'check the listing.' Always 'Search Google for:
// Acme Med Spa Greensboro NC'."
//
// That instruction is the whole design. A checklist row saying "Presence sweep, manual
// tier" is a to-do; the same row with eighteen search strings already composed from the
// canonical NAP is work you can actually start. The difference is whether it gets done on a
// Tuesday afternoon.
//
// ‼️ NOTHING HERE AUTO-ADVANCES PAST A HUMAN. §2: manual steps "go 'done' ONLY when I click
// the button. Never infer completion from a file upload." A screenshot landing in the thread
// files evidence and the step WAITS. [Done] reads that evidence to tell you what looks
// missing — and then still waits for you to press it.

import { supabaseAdmin } from "@/lib/db";
import { slack, type SlackBlock } from "@/lib/slack-bot";
import { DELIVERY_STEPS, stepByKey, type DeliveryStep } from "@/lib/clients/delivery-checklist";
import {
  ALL_PLATFORMS,
  CORE_SIX,
  EXTENDED,
  PLATFORM_COUNT,
  platformByKey,
} from "@/config/presence-platforms";
import { DAY_ZERO_STEP_KEY } from "@/config/delivery-steps";
// The channel surface. Everything this module says about a step goes through these, never
// through notifyThread: a step's output belongs in that step's thread.
import {
  anchorTsFor,
  notifyStep,
  postStepAnchor,
  refreshStepAnchor,
} from "@/lib/clients/step-board";
import { pageStudioHint } from "./page-studio";

// ‼️ THE PLATFORM LIST LIVES IN @/config/presence-platforms AND NOWHERE ELSE.
//
// This file used to carry its own copy — two plain string arrays, `CORE_SIX` and `EXTENDED`.
// They agreed with the config list by coincidence and nothing made them keep agreeing, which is
// the setup for the worst kind of drift: the sweep would be RECORDED against eighteen platform
// keys from the config and READ OUT to a person from a different list, and the mismatch would
// surface as a nap_discrepancies row nobody could account for.
//
// Worse, the local copy was only names. It could not compose "search: Acme Med Spa Greensboro NC"
// per platform, so every one of the eighteen lines carried the same generic query — the precise
// thing Runner v3 §3 says not to do ("Never 'check the listing.' Always 'Search Google for: ...'").
// formatSweepCard() in presence-sweep.ts already builds the real thing and was dead code.

interface ClientFacts {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  addressLine1: string | null;
  postalCode: string | null;
  phone: string | null;
}

/** The row the card is being built for. `output_ref` is this step's own artifact. */
interface StepRowFacts {
  outputRef: string | null;
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
}

/**
 * The client board, which is where most of the work a card describes actually happens.
 *
 * ‼️ THE ID, NEVER THE SLUG. `/dashboard/clients/[id]` queries `.eq("id", id)` against a uuid
 * column, so a slug is a cast error rather than a miss: the query throws, the page gets null and
 * calls notFound(). The pinned header had been linking the slug since it shipped and every one
 * of those links was a 404. A card that prints a dead link is worse than one that prints none —
 * see docLink above, which returns null for exactly that reason.
 */
function boardUrl(c: ClientFacts, panel?: string): string {
  return `${appUrl()}/dashboard/clients/${c.id}${panel ? `#${panel}` : ""}`;
}

/**
 * A Slack link to a generated artifact, or null when there is no artifact.
 *
 * ‼️ NULL RATHER THAN A LINK TO NOTHING. `deliverArtifact` writes `output_ref` before it posts
 * to Slack, so a doc id on the row is a real stored file at this URL — but a step that has not
 * run yet has no id, and a card printing a dead link teaches people the links do not work. Every
 * caller says "not generated yet" instead, which is also the more useful sentence.
 */
function docLink(clientId: string, docId: string | null | undefined, label: string): string | null {
  if (!docId) return null;
  return `<${appUrl()}/api/clients/${clientId}/docs/${docId}|${label}>`;
}

/**
 * Every step's `output_ref`, in one query.
 *
 * ‼️ THIS IS WHAT MAKES A CARD ABLE TO SHOW THE ARTIFACT AN EARLIER STEP PRODUCED, AND NOTHING
 * COULD BEFORE (2026-08-25). `instructionsFor` received only `ClientFacts`, so no case in the
 * switch read `client_delivery_steps.output_ref` — the citation cleanup step could not link the
 * cleanup PDF built for it two steps earlier, the first-page step could not link its own page
 * candidates, and the Day-0 archive could not link the scorecard it exists to protect. Matthew
 * had to go and find each one on the board.
 *
 * Matthew's general instruction: every step that CAN be pre-populated from earlier steps should
 * be. He should not have to press Done to find out what is missing.
 */
async function outputRefsFor(clientId: string): Promise<Map<string, string>> {
  const { data } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("step_key, output_ref")
    .eq("client_id", clientId);

  const out = new Map<string, string>();
  for (const r of data ?? []) {
    const ref = r.output_ref as string | null;
    if (ref) out.set(r.step_key as string, ref);
  }
  return out;
}

/**
 * The newest generated document filed against a step, by step key.
 *
 * Separate from `output_ref` on purpose: a document can arrive by being UPLOADED into a step's
 * thread rather than generated, and the AI Visibility Scorecard is exactly that case. It is
 * dropped into step 2's thread by the audit pipeline, so `baseline_scan.output_ref` is null and
 * `client_docs.delivery_step_key` is where it lives.
 */
async function docForStep(
  clientId: string,
  stepKey: string
): Promise<{ id: string; filename: string } | null> {
  const { data } = await supabaseAdmin
    .from("client_docs")
    .select("id, filename")
    .eq("client_id", clientId)
    .eq("delivery_step_key", stepKey)
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return { id: data.id as string, filename: (data.filename as string) ?? "the file" };
}

/** `YYYY-MM-DD` for a date this app computed. Never a date somebody said out loud. */
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The literal instructions for one step.
 *
 * Returns null for a step that needs no extra explanation — the label is the instruction and
 * padding it with boilerplate teaches people to stop reading these posts.
 *
 * ‼️ SIX MANUAL STEPS USED TO RETURN NULL AND SHOULD NEVER HAVE (2026-08-25): call_booked,
 * call_held, gbp_buildout, citation_cleanup, review_request_configured and day_30_date. For
 * those, `blocks()` adds no body section at all, so the card was a label and three buttons —
 * and the label is a summary of the work, not an instruction for doing it. Runner v3 §3 is the
 * standard the rest of this switch is written to: "Never 'check the listing.' Always 'Search
 * Google for: Acme Med Spa Greensboro NC'."
 *
 * `default: return null` stays, because a step whose label really is the whole instruction
 * should not be padded. What is gone is a step needing an instruction and getting silence.
 */
async function instructionsFor(
  step: DeliveryStep,
  c: ClientFacts,
  row: StepRowFacts
): Promise<string[] | null> {
  const where = [c.city, c.state].filter(Boolean).join(" ");
  const q = `${c.name} ${where}`.trim();

  switch (step.key) {
    case "presence_sweep_manual": {
      // formatSweepCard composes the per-platform search string, the open link and the tier
      // note from @/config/presence-platforms — the one list. Falls back to the label alone if
      // the canonical record is incomplete, because a card with a half-built search string in
      // it is worse than a card that says nothing.
      const { canonicalFor, formatSweepCard } = await import("./presence-sweep");
      const canonical = await canonicalFor(c.id);
      if (!canonical) return null;
      return formatSweepCard(
        { name: c.name, city: c.city ?? "", state: c.state ?? "" },
        canonical
      ).split("\n");
    }

    case "competitor_shortlist": {
      // ‼️ This card used to SAY "ten candidates are on the board" while nothing had ever put
      // one there: buildShortlist() existed and had no caller, so competitor_candidates was
      // always empty and findings §3 was permanently blank. It now prints the real list, and
      // when the list is empty it says so instead of describing a board that does not exist.
      const { buildShortlist, loadCandidates, formatShortlistCard, applyDefaultSelection } =
        await import("./competitors");

      // Built HERE rather than by a separate auto step, because this card is posted exactly when
      // its blocker `baseline_scan` clears — which is the first moment audit_runs.recommended
      // has anything in it. Building anywhere earlier would tally an empty run.
      //
      // Idempotent: buildShortlist upserts on (client_id, normalized_name) and never writes
      // `selected`, so re-posting the card refreshes the counts without discarding a choice
      // somebody already made.
      const built = await buildShortlist(c.id);
      if (!built.ok) {
        console.error(`[step-engine] shortlist build failed for ${c.id}: ${built.error}`);
      }

      // ‼️ THE TOP THREE ARE PRE-PICKED, AND THIS IS THE ONLY PLACE THAT HAPPENS.
      // Matthew: "I didnt really pick any competitors, just make sure it auto selects the top 3
      // most mentioned from the audit." applyDefaultSelection no-ops the moment anybody has
      // chosen, so re-posting this card never overwrites a decision — and it does NOT tick the
      // step, so the evidence rule is untouched: he still presses Done, the verifier still
      // counts `selected` rows.
      const defaulted = await applyDefaultSelection(c.id);
      if (!defaulted.ok) {
        console.error(`[step-engine] default competitor pick failed for ${c.id}: ${defaulted.error}`);
      }

      const candidates = await loadCandidates(c.id);
      if (!candidates.length) {
        return [
          "No candidates have been built yet. That happens automatically once the baseline",
          "scan finishes — if the scan is done and this is still empty, the run named nobody,",
          "which is itself worth saying on the call.",
        ];
      }
      return formatShortlistCard(c.name, candidates, 20, boardUrl(c)).split("\n");
    }

    case "avatar_harvest": {
      // ‼️ THIS STEP READS AS A DUPLICATE OF THE AUDIT AND IS NOT ONE. Matthew asked whether it
      // repeats the audit and burns tokens; the card is where that gets answered, permanently,
      // rather than in a conversation nobody can find later.
      const { data: bank } = await supabaseAdmin
        .from("question_bank")
        .select("phrase")
        .eq("source", "harvest")
        .order("commercial_intent_score", { ascending: false })
        .limit(3);

      const brief = docLink(c.id, row.outputRef, "the deep-research brief");

      return [
        "*This does not repeat the audit. It runs ON the audit.*",
        "It reads `audit_runs.citations` — every URL the engines actually cited about this",
        "business — and fetches up to 40 of those pages. *Zero model calls*: the cost is plain",
        "page fetches. The phrases come back as verbatim market wording, typos kept on purpose,",
        "which is the difference from the audit's twenty clean model-written prompts.",
        "",
        "Those twenty cannot replace this: `audit_reports.prompts` is REGENERATED by every audit",
        "run, so quoting them would let a later scan silently rewrite the questions in a report",
        "already sent to a client. The Day-0 tracked set has to be frozen.",
        "",
        ...(bank?.length
          ? ["Sample of what came back:", ...bank.map((b) => `  • "${b.phrase as string}"`), ""]
          : []),
        `*The half that needs you:* ${brief ?? "the deep-research brief (not generated yet)"}.`,
        "Run it, paste the result back into this thread with `research:` in front of it, then Done.",
        "",
        "_The avatar is not decided here._ Avatars live in `niche_briefs`, per vertical, and one",
        "is confirmed at step 11. This step leaves `question_bank.avatar` null on purpose.",
      ];
    }

    case "review_audit": {
      // ‼️ Seeded HERE as well as in the runner, and that is not belt-and-braces.
      // This step is auto_then_manual, so BOTH postReadySteps and runReadyAutoSteps can reach
      // it — postReadySteps skips only `mode === "auto"`. Whichever gets there first has to
      // find rows to describe. seedReviewAudit upserts with ignoreDuplicates and never writes
      // a number, so running it twice refreshes nothing a human typed. Same precedent as
      // competitor_shortlist calling buildShortlist from inside this switch.
      const { seedReviewAudit, loadReviewAudit, formatReviewAuditCard } = await import("./review-audit");
      const { selectedCompetitors } = await import("./competitors");

      const seeded = await seedReviewAudit(c.id);
      if (!seeded.ok) {
        console.error(`[step-engine] review audit seed failed for ${c.id}: ${seeded.error}`);
      }

      const rows = await loadReviewAudit(c.id);
      const competitors = await selectedCompetitors(c.id);

      return [
        // ‼️ MATTHEW CONFLATED THIS WITH STEP 16 AND THE CARDS HAVE TO MAKE THE DIFFERENCE
        // OBVIOUS. Three steps have "review" in the label and they own three different things.
        "*This is the competitor review-COUNT grid.* It is internal and no customer ever sees it.",
        "It feeds findings section 3. The tool a customer uses is step 16; handing it over is step 30.",
        "",
        ...formatReviewAuditCard({
          clientName: c.name,
          city: c.city ?? "",
          state: c.state ?? "",
          competitors: competitors.map((x) => ({ name: x.name })),
          rows,
        }).split("\n"),
        "",
        `Type the counts in on the board: ${boardUrl(c)}`,
      ];
    }

    case "review_tool_preview": {
      const { reviewPreviewUrl } = await import("./review-preview");
      const { data: host } = await supabaseAdmin
        .from("client_hosts")
        .select("host, vercel_attached_at")
        .eq("client_id", c.id)
        .eq("kind", "reviews")
        .maybeSingle();

      return [
        "*This step owns whether the tool RENDERS and is themed.* It is not the review audit",
        "(step 8, an internal competitor grid) and not the handover (step 30).",
        "",
        `Internal preview: ${reviewPreviewUrl(c.id)}`,
        ":lock: *That URL cannot be sent to a client.* It is a `/dashboard/` path and the page",
        "calls `notFound()` without a session, so a logged-out visitor gets a 404 rather than a",
        "login screen. It belongs in this thread, which is internal, and nowhere else.",
        "",
        host?.host
          ? `The client-facing surface is \`${host.host}\`${host.vercel_attached_at ? ", attached" : ", NOT attached to Vercel yet"}.`
          : "The client-facing surface is the `reviews.` host, and no `client_hosts` row exists for it yet.",
      ];
    }

    case "avatar_confirmed": {
      const refs = await outputRefsFor(c.id);
      const brief = docLink(c.id, refs.get("avatar_harvest"), "the deep-research brief from step 9");

      return [
        "The proposal is on the board. Audit avatars are CANDIDATES only, and only when the",
        "cached niche matches this client's vertical — they are cached per niche, not per",
        "business, so every med spa audited this month has the same three. Map one to",
        "a1 / a2 / a3 or reject them all.",
        "",
        brief
          ? `Read first: ${brief}. It is the market's own wording for this business.`
          : "Step 9's deep-research brief has not been generated yet, so there is nothing harvested to read against.",
        "",
        `Confirm on the board: ${boardUrl(c)}`,
        "The custom question set (step 12) and the page candidates (step 13) are both scored",
        "against this choice, so neither means anything until it is made.",
      ];
    }

    case "access_granted": {
      // ‼️ THE GATE LINE GOES ABOVE THE CLICK PATHS, AND THE CLICK PATHS ARE UNCHANGED.
      // They are correct and they are what somebody reads off the phone. What was missing was
      // the sentence explaining why none of them is asked before the client has committed.
      const { paymentRecorded, isRecorded, paymentLine, ACCESS_GATE_REASON } = await import(
        "./payment"
      );
      const pay = await paymentRecorded(c.id);
      const gate = pay.ok && isRecorded(pay.payment);

      return [
        gate
          ? `:white_check_mark: ${paymentLine(pay.payment)}. That is an assertion this board keeps, not evidence of a charge.`
          : `:lock: *No payment recorded, so [Done] refuses.* ${ACCESS_GATE_REASON}`,
        gate
          ? ""
          : `Record it on the board: ${boardUrl(c, "payment")}`,
        "",
        "Per platform, the literal ask:",
        "  • *GBP* — business.google.com, select the clinic, Users, Add, invite us as Manager",
        "  • *Search Console* — search.google.com/search-console, add the domain as a Domain property",
        "  • *Analytics* — analytics.google.com, Admin, Property Access Management, add us as Editor",
        "",
        "If the GBP is unclaimed, claim it together on the call — it is instant and it is a",
        "credibility moment. If an old agency holds it, start Google's ownership request ON",
        "THE CALL: it is a fixed seven-day wait and it is usually the long pole.",
      ];
    }

    case "hub_preview": {
      // ‼️ THIS CARD USED TO BE A LABEL AND THREE BUTTONS. There was no case here at all, so
      // the one step that produces the hostnames and the CNAME values said nothing about
      // either, and the only way to learn the theme was still outstanding was to tick it and
      // watch the NEXT step refuse.
      const { formatDnsRecords, themeConfirmed, themeOverrides, themeLine } = await import(
        "./hub-setup"
      );
      const { loadDnsRows } = await import("./dns-records");
      const { hostsFor } = await import("@/lib/hub/vercel-domains");

      const { data: row } = await supabaseAdmin
        .from("clients")
        .select("domain, subdomain")
        .eq("id", c.id)
        .maybeSingle();

      const domain = (row?.domain as string | null) ?? null;
      if (!domain) return ["No domain on file, so there is no hub to build."];

      const hosts = hostsFor({ subdomain: (row?.subdomain as string | null) ?? null, domain });
      const themed = await themeConfirmed(c.id);
      const overrides = themed ? await themeOverrides(c.id) : [];

      return [
        "The hostnames are attached to Vercel already. What is left is the THEME.",
        "",
        ...hosts.map((h) => `  • \`${h.host}\` (${h.kind})`),
        "",
        ...formatDnsRecords(await loadDnsRows(c.id), domain),
        "",
        themeLine(themed, overrides),
      ];
    }

    case "dns_records": {
      // ‼️ IT PRINTS THE ACTUAL RECORDS NOW. It used to say "the exact values are on the DNS
      // panel", which means the person on the call has to leave the thread, find the board and
      // read three values off a different screen while the client waits in their registrar.
      const { formatDnsRecords } = await import("./hub-setup");
      const { loadDnsRows } = await import("./dns-records");

      const { data: row } = await supabaseAdmin
        .from("clients")
        .select("domain")
        .eq("id", c.id)
        .maybeSingle();

      const domain = (row?.domain as string | null) ?? null;
      if (!domain) return ["No domain on file, so there are no records to add."];

      return [
        ...formatDnsRecords(await loadDnsRows(c.id), domain),
        "",
        "Never ask for registrar credentials. They drive, you read the values out.",
      ];
    }

    // ‼️ STEPS 12 AND 13 COME FROM THE SAME CORPUS AND DO OPPOSITE JOBS, AND NEITHER CARD
    // SAID SO. Matthew asked what the difference between them was, which is the sign that the
    // labels alone were not carrying it: "Custom question set drafted for approval" and "Page
    // candidates scored and ranked for the call" read as two versions of the same task.
    //
    // ‼️ BOTH STEPS ARE mode:"auto", SO postReadySteps SKIPS THEM AND THIS IS DEAD ON THE
    // NORMAL PATH. It is here because it is correct the day either mode changes, and because
    // _debug-post-all-steps.ts posts them directly. The line that actually reaches a person
    // today is the runner note, and for step 13 it is in page-candidates.ts. Step 12's
    // equivalent is owed and is written up in docs/lanes/RESULT-lane-4.md. Same shape the
    // first_page card was in before 2026-08-25, and it is recorded rather than papered over.
    case "custom_question_set": {
      const doc = await docForStep(c.id, "custom_question_set");
      const link = docLink(c.id, doc?.id, doc?.filename ?? "the drafted question set");

      return [
        "*This is the MEASUREMENT set.* 40 or 60 questions, approved on the call, then FROZEN",
        "at Day 0. The day 30, 60 and 90 numbers are scored against exactly these and nothing",
        "else, which is why it is frozen: a set that moved would make the comparison meaningless.",
        "",
        "*Nothing is ever published from it.* That is step 13, which is a different list built",
        "from the same corpus. This one says what we MEASURE. That one says what we WRITE.",
        "",
        link ? `*The draft:* ${link}` : "*Not generated yet.*",
        "",
        `Approve or edit on the board: ${boardUrl(c)}`,
      ];
    }

    case "page_candidates": {
      const doc = await docForStep(c.id, "page_candidates");
      const link = docLink(c.id, doc?.id, doc?.filename ?? "the ranked candidates PDF");

      const { data: counts } = await supabaseAdmin
        .from("page_candidates")
        .select("origin")
        .eq("client_id", c.id);
      const rows = counts ?? [];
      const derived = rows.filter((r) => (r.origin as string | null) === "derived").length;

      return [
        "*This is the PUBLISHING backlog.* The same corpus as step 12, scored for which",
        "questions are worth building a page about, with `currently_named` as a tri-state so a",
        "question the engines already name them for can be skipped.",
        "",
        "*It is not the tracked set.* Step 12 is the measurement set and is frozen at Day 0.",
        "This list is regenerated and is meant to change.",
        "",
        link ? `*The ranked list:* ${link}` : "*Not generated yet.*",
        rows.length
          ? `${rows.length} scored${derived ? `, of which ${derived} are DERIVED ideas we proposed rather than phrases anybody typed` : ""}.`
          : "Nothing scored yet.",
        "",
        `*To turn any of them into a draft:* post \`page ${c.name}\` in ${pageStudioHint()},`,
        "pick a number, then type or send a voice note. Your words go into the page verbatim and",
        "no model touches them unless you ask for that by name.",
      ];
    }

    case "first_page": {
      const refs = await outputRefsFor(c.id);
      const candidates = docLink(c.id, refs.get("page_candidates"), "step 13's ranked page candidates");

      const { listAllForBoard } = await import("@/lib/hub/pages");
      const pages = await listAllForBoard(c.id);
      const drafts = pages.filter((p) => p.status !== "published");
      const published = pages.filter((p) => p.status === "published");

      return [
        "Pages are written and published from the Hub panel on the client board.",
        `Start here: ${candidates ?? "step 13's page candidates (not generated yet)"} — the`,
        "PUBLISHING backlog. Step 12's question set is the MEASUREMENT set and nothing is ever",
        "published from it.",
        "",
        "Two ways in. On the board: pick a question, write the answer, edit it, then Publish.",
        `In Slack: post \`page ${c.name}\` in ${pageStudioHint()}, pick a number, then type or`,
        "send a voice note and your own words land in the page verbatim.",
        "",
        published.length
          ? `*${published.length} published:* ${published.map((p) => `/${p.slug}`).join(", ")}`
          : "*Nothing is published yet*, which is what this step is waiting on.",
        drafts.length
          ? `*${drafts.length} draft${drafts.length === 1 ? "" : "s"} written:* ${drafts.map((p) => `/${p.slug}`).join(", ")}`
          : "No drafts written yet.",
        "",
        ":lock: *Publishing refuses while Day 0 is unarchived.* That is the one hard wall in",
        "this checklist and it is deliberate: once a page is live, the baseline the day 30, 60",
        "and 90 numbers are measured against cannot be recovered.",
        "",
        `Write and publish: ${boardUrl(c)}`,
      ];
    }

    case DAY_ZERO_STEP_KEY: {
      // ‼️ THE SCORECARD PDF, LINKED BY NAME. Matthew asked for this one specifically: the
      // archive this step asserts IS the baseline scan's output, and it was two screens away.
      // It arrives as an UPLOAD into step 2's thread, so it is on client_docs and not on
      // baseline_scan.output_ref — which is why this reads docForStep rather than outputRefsFor.
      const scorecard = await docForStep(c.id, "baseline_scan");
      const link = docLink(c.id, scorecard?.id, scorecard?.filename ?? "the AI Visibility Scorecard");

      return [
        "*The one step that blocks rather than flags.* Nothing may be published until it is",
        "ticked, and ticking it stamps `clients.day_0_archived_at`.",
        "",
        link
          ? `*The before picture:* ${link}`
          : "*No scorecard is filed against the baseline scan yet.* That is what this step archives, so find it before ticking.",
        "",
        "It means: the before picture is captured and stored, so the day 30, 60 and 90 reports",
        "have something honest to be measured against. Tick it only once that is true — the",
        "column records `manual_step`, which is an ASSERTION that the archive happened, not",
        "evidence of it, and no artifact may call that a photograph.",
        "",
        "Post the archived scan into this thread before ticking. That is what [Done] reads.",
      ];
    }

    case "gbp_buildout":
      return [
        "business.google.com, select the profile, then in order:",
        "  • *Categories* — one primary that matches what they actually sell, then every",
        "    secondary that is genuinely true. A wrong primary outranks everything else here.",
        "  • *Services* — every service named, each with a description. Empty service",
        "    descriptions are the most common gap and the cheapest to close.",
        "  • *Photos* — exterior, interior, team, and the work itself. Dated, not stock.",
        "  • *Q&A* — seed the questions buyers actually ask. Post them from the business",
        "    profile and answer them; an empty Q&A gets filled in by strangers eventually.",
        "",
        `Search to check your work: \`${q}\``,
        "",
        "*[Done] reads a screenshot in this thread*, so post one of the finished profile.",
        "Nothing about somebody else's Google profile is observable from here.",
      ];

    case "citation_cleanup": {
      const refs = await outputRefsFor(c.id);
      const list = docLink(c.id, refs.get("citation_cleanup_list"), "step 14's ranked cleanup list");

      const { loadSweep, countByStatus, effectiveStatus, worstFirst } = await import("./presence-sweep");
      const rows = await loadSweep(c.id);
      const counts = countByStatus(rows);

      const needsWork = worstFirst(rows).filter((r) =>
        ["duplicate", "mismatch", "missing"].includes(effectiveStatus(r))
      );

      return [
        list ? `*The list:* ${list}` : "*Step 14's cleanup list has not been generated yet.*",
        "",
        // The verifier refuses on not_checked FIRST, so the card says it first. A card that
        // buried this under the mismatch count would have him fixing listings and still
        // getting refused for a reason he had not read.
        counts.not_checked > 0
          ? `:warning: *${counts.not_checked} of ${rows.length} listings carry no confirmed status.* ` +
            "[Done] refuses on that before it looks at anything else: a row nobody has read is " +
            "not a row that was cleaned. Confirm each one on the Presence sweep panel."
          : `All ${rows.length} listings carry a confirmed status.`,
        `${counts.mismatch} mismatch · ${counts.duplicate} duplicate · ${counts.missing} missing · ${counts.match} match`,
        "",
        ...(needsWork.length
          ? [
              "*Outstanding, worst first:*",
              ...needsWork
                .slice(0, 12)
                .map((r) => `  • ${r.platform} — ${effectiveStatus(r)}${r.listingUrl ? ` — ${r.listingUrl}` : ""}`),
              ...(needsWork.length > 12 ? [`  …and ${needsWork.length - 12} more on the board.`] : []),
              "",
            ]
          : []),
        `Confirm and record on the board: ${boardUrl(c)}`,
      ];
    }

    case "cards_printed": {
      const refs = await outputRefsFor(c.id);
      const pdf = docLink(c.id, refs.get("review_card_pdf"), "step 17's review card PDF");

      const { data: host } = await supabaseAdmin
        .from("client_hosts")
        .select("host, vercel_attached_at")
        .eq("client_id", c.id)
        .eq("kind", "reviews")
        .maybeSingle();

      return [
        pdf ? `*Print this:* ${pdf}` : "*Step 17's card PDF has not been generated yet.*",
        "",
        // ‼️ THE REAL HOST OR NOTHING. review-card.ts already refuses to derive this and says
        // why: somebody fixing a typo on the board must not silently invalidate a thousand
        // printed cards. A card that guessed the hostname here would contradict the PDF.
        host?.host
          ? `The QR points at \`${host.host}\`${host.vercel_attached_at ? ", which is attached and live from the moment the domain resolves" : " — *NOT attached to Vercel yet*, so check step 15 before printing"}.`
          : ":warning: *No reviews host is attached for this client*, so the QR on that PDF has " +
            "nothing behind it. Do not print until step 15 has attached it.",
        "",
        "The cards work before the hub has any pages: the reviews host is independent of them.",
        "",
        "*[Done] reads a photo in this thread.* Post one of the printed cards. Nothing",
        "observable from here says a card exists on a counter.",
      ];
    }

    case "review_request_configured": {
      const { data: client } = await supabaseAdmin
        .from("clients")
        .select("booking_software, review_workflow, review_request_mode, review_owner_name")
        .eq("id", c.id)
        .maybeSingle();

      const workflow = (client?.review_workflow ?? {}) as Record<string, unknown>;
      const destinations = Array.isArray(workflow.destinations)
        ? (workflow.destinations as string[])
        : [];
      const mode = (client?.review_request_mode as string | null) ?? null;
      const booking = (client?.booking_software as string | null) ?? null;

      return [
        "*Two branches and the label allows either.* Pick one, record it, and this step can close.",
        "",
        `  • *booking_system* — switch the automated request on inside ${booking ? `*${booking}*` : "their booking software"},`,
        "    then post a screenshot of the configured request into this thread. Their booking",
        "    software is not something this app can query, so a screenshot is the only evidence.",
        "  • *card_only* — they are not automating it and the printed cards are the whole",
        "    mechanism. That is a real answer, recorded on the row, and it needs no screenshot.",
        "",
        mode
          ? `Recorded so far: *${mode}*.`
          : ":warning: *Nothing is recorded yet, so neither branch has been chosen* and [Done] will refuse.",
        client?.review_owner_name
          ? `The named person on the record is *${client.review_owner_name as string}*.`
          : "No named person is on the record yet. Step 30 wants one.",
        "",
        ...(destinations.length
          ? [`They told us at intake they collect on: ${destinations.join(", ")}.`]
          : []),
        "While you are there, add the *review URLs*. The tool's Post on Google button reads them,",
        "and with nothing set every customer gets a hint telling her to find the page herself.",
        "",
        `Record it on the board: ${boardUrl(c, "review-handover")}`,
      ];
    }

    case "review_tool_handed": {
      const { data: client } = await supabaseAdmin
        .from("clients")
        .select("review_owner_name")
        .eq("id", c.id)
        .maybeSingle();

      const { data: host } = await supabaseAdmin
        .from("client_hosts")
        .select("host")
        .eq("client_id", c.id)
        .eq("kind", "reviews")
        .maybeSingle();

      const owner = (client?.review_owner_name as string | null) ?? null;

      return [
        "*This step owns the HANDOVER.* Step 16 owned whether the tool renders; this is the",
        "conversation where a person is shown it and takes it on.",
        "",
        owner
          ? `The record says the named person is *${owner}*.`
          : "No named person is on the record. Add one on the board so this card can check your work.",
        host?.host
          ? `What you are handing over: \`https://${host.host}\``
          : ":warning: No reviews host is attached, so there is nothing live to hand over yet.",
        "",
        "Hand it to the NAMED person from the call sheet — a name, not \"the front desk\".",
        "Restate once: every patient, own phone at home, nothing offered, nobody prompted",
        "for a name.",
        "",
        "*[Done] reads a reply in this thread.* Say who took it and how they were shown it.",
        "A link emailed to a business address is not a handover.",
      ];
    }

    case "call_booked": {
      // ‼️ THE MEASURE GATE IS REPEATED HERE, not left to the pinned header. The header states
      // it about the run as a whole; this is the card he is looking at when he books, which is
      // the moment the warning is actionable.
      const { data: steps } = await supabaseAdmin
        .from("client_delivery_steps")
        .select("step_key, status")
        .eq("client_id", c.id)
        .in("step_key", ["baseline_scan", "findings_doc"]);

      const missing = ["baseline_scan", "findings_doc"].filter(
        (k) => (steps ?? []).find((s) => s.step_key === k)?.status !== "complete"
      );

      return [
        "Book it, then *reply in this thread with the date*. That reply is the evidence: [Done]",
        "reads the thread for a date and refuses without one, because a booking that exists only",
        "in somebody's calendar is not something this board can see.",
        "",
        ...(missing.length
          ? [
              ":warning: *The baseline is not finished.* " +
                `Still outstanding: ${missing.join(", ")}. The call is where we show them what the ` +
                "engines are saying and agree who we are going after, and both come out of the " +
                "baseline. Held first, it is opinions instead of screenshots.",
              "This flags, it does not block. Booking early is your judgement to make.",
              "",
            ]
          : ["The baseline is finished, so the call has evidence to be about.", ""]),
        "Nothing else on the board is waiting on this one.",
      ];
    }

    case "call_held": {
      const refs = await outputRefsFor(c.id);
      const sheet = docLink(c.id, refs.get("call_sheet"), "the call sheet PDF");
      // ‼️ STEP 20's OWN output_ref, WRITTEN AT STEP 18. generateCallQuestions files the
      // closing questions here rather than posting them, because deliverArtifact would have
      // created THIS anchor two steps early and put a second thing on the board while the call
      // sheet was still the one to work on. This line is where they surface.
      const closing = docLink(c.id, refs.get("call_held"), "the 33 closing questions");

      return [
        sheet ? `*Read off this:* ${sheet}` : "*The call sheet has not been generated yet.*",
        closing
          ? `*Run the conversation off this:* ${closing} — CLOSER order, tick the ones you want, and everything below the divider waits for the card.`
          : "*The closing questions were not generated.* Retry step 18 on the board; they are built from the same reports as the call sheet.",
        "",
        "Five things have to happen on the call, and the label lists them because each one",
        "unblocks something later:",
        "  • *NAP read aloud* — the canonical record is what every listing is corrected to.",
        "  • *Question set approved* — step 12's set is what day 30/60/90 is measured on.",
        "  • *Consent confirmed* — named or anonymized results. It defaults to anonymized.",
        "  • *Preview walked* — the hub and the review tool, on their own screen.",
        "  • *Pages picked* — which of the candidates gets written first.",
        "",
        "*[Done] reads your call notes in this thread.* Paste them: it needs real notes, not a",
        "one-liner, and a message that @mentions the bot is treated as a question instead.",
        "The notes are also what the post-call email and the CRM note are written from.",
      ];
    }

    case "day_30_date": {
      const { data: client } = await supabaseAdmin
        .from("clients")
        .select("day_0_archived_at, intake_completed_at")
        .eq("id", c.id)
        .maybeSingle();

      const day0 = (client?.day_0_archived_at as string | null) ?? null;

      // ‼️ COMPUTED FROM THE DAY-0 STAMP AND NOTHING ELSE. report-reminders.ts falls back to
      // intake_completed_at and SAYS SO in the reminder; a card that quietly did the same would
      // print a date that is wrong by however long the call took to happen.
      const due = day0 ? isoDay(new Date(new Date(day0).getTime() + 30 * 86400000)) : null;

      return [
        day0
          ? `Day 0 was stamped ${isoDay(new Date(day0))}, so *day 30 is ${due}*.`
          : ":warning: *Day 0 is not archived yet*, so there is no date to compute. It counts " +
            "from the Day-0 stamp, never from signup, and quoting a signup-based date here " +
            "would promise the client a report on the wrong day.",
        "",
        "*Reply in this thread with the date you are promising them.* [Done] reads the thread",
        "for a date and refuses without one.",
        "",
        "The reminder rides on the follow-up digest and counts from the Day-0 stamp on its own.",
        "This reply is the human record of what was actually promised, which is the thing that",
        "matters when the two disagree.",
      ];
    }

    case "subdomain_live": {
      const { formatDnsRecords } = await import("./hub-setup");
      const { loadDnsRows } = await import("./dns-records");

      const { data: row2 } = await supabaseAdmin
        .from("clients")
        .select("domain")
        .eq("id", c.id)
        .maybeSingle();

      const domain = (row2?.domain as string | null) ?? null;
      if (!domain) return ["No domain on file, so there is nothing to resolve."];

      const rows = await loadDnsRows(c.id);
      const hub = rows.find((r) => r.record_key === "cname_hub");
      const verified = rows.filter((r) => r.status === "verified").length;

      return [
        `${verified} of ${rows.length} records verified.`,
        "",
        // ‼️ The gate is the HUB CNAME specifically, not "all three" and not the runner's ok
        // flag — which returns true for any client with a domain, because it is also the runner
        // and a runner that failed on propagation would park this step in error.
        hub
          ? hub.status === "verified"
            ? `:white_check_mark: The hub CNAME is verified. That is what this step gates on.`
            : `:hourglass_flowing_sand: The hub CNAME reads \`${hub.status}\`. *That specific record is what [Done] checks*, not the other two.`
          : ":warning: There is no hub CNAME row, so nothing can verify.",
        "",
        ...formatDnsRecords(rows, domain),
        "",
        "Propagation is normally under an hour and can be several. A record added ninety seconds",
        "ago reading `not_found` is the normal state, not a fault, and nothing is written for it.",
      ];
    }

    default:
      return null;
  }
}

/**
 * The refusal for the manual sweep, or null when it may go through.
 *
 * ‼️ THE GATE IS THE SIX CORE PLATFORMS, NOT EIGHTEEN FILES. It used to return PLATFORM_COUNT,
 * so [Done] demanded all eighteen screenshots while the step's own card described the twelve
 * extended directories as "context only. Findings, not week-one cleanup". Matthew filed four and
 * was told "4 of 18". Making the gate agree with what the card already said is his call.
 *
 * And the count alone is not enough: six screenshots that are all Yelp must not satisfy a
 * six-platform gate. Attribution comes from the platform named in the message the screenshot
 * was posted with. A file nobody could attribute is still filed and still kept; it just does
 * not count toward the six, and the refusal says so rather than leaving it a mystery.
 */
async function presenceRefusal(clientId: string, stepKey: string): Promise<string | null> {
  const cover = await presenceCoverageFor(clientId, stepKey);

  if (!cover) {
    return (
      "Could not check. The query for this step's screenshots failed, so nothing can be " +
      "confirmed either way. Try again in a moment rather than ticking past it."
    );
  }

  if (cover.coreMissing.length === 0) return null;

  const lines = [
    `Not yet — ${cover.coreCovered.length} of the ${CORE_SIX.length} core platforms have a screenshot filed against this step.`,
    `Missing: ${cover.coreMissing.join(", ")}.`,
    "Post one screenshot per message with the platform name in the message, then hit Done.",
    "Where a business genuinely has no listing, the screenshot of the empty search result is the evidence.",
    `The ${EXTENDED.length} extended directories never block this step.`,
  ];

  if (cover.unattributed > 0) {
    lines.push(
      `${cover.unattributed} file${cover.unattributed === 1 ? "" : "s"} in this thread name no ` +
        "platform I recognise, so they are filed but not counted. Reply with the platform name " +
        "and re-post, one platform per message."
    );
  }

  return lines.join(" ");
}

/**
 * Slack's hard limit on one section's text. Exceeding it fails the WHOLE message.
 *
 * ‼️ THE SWEEP CARD WAS ALREADY AT 2,988 CHARACTERS FOR A SHORT BUSINESS NAME, and the name is
 * interpolated into all eighteen search strings. Measured on the cascade probe, whose client is
 * called "ZZ Cascade Probe {epoch}": `invalid_blocks`, no card posted at all, and `postStep`
 * returns early on that failure — so the step sat there with an anchor, no instructions and no
 * buttons. A real client named "Greensboro Aesthetic and Wellness Institute" would have hit it
 * on the first run and it would have looked like Slack being flaky.
 *
 * The new cards make this likelier, not less: the citation cleanup card prints up to twelve
 * listings and the shortlist card prints ten candidates with example questions.
 */
const SECTION_LIMIT = 2900;

/**
 * Split a body across as many sections as it needs, ON LINE BOUNDARIES.
 *
 * Never mid-line: these bodies are search strings, URLs and DNS values that get read aloud or
 * pasted, and a value broken across two Slack blocks is a value somebody pastes wrong. A single
 * line longer than the limit is passed through whole and would still fail — but nothing here
 * generates one, and truncating a DNS value to make the message send is the worse failure.
 */
function bodySections(body: string[]): SlackBlock[] {
  const out: SlackBlock[] = [];
  let buf: string[] = [];
  let size = 0;

  const flush = () => {
    if (!buf.length) return;
    out.push({ type: "section", text: { type: "mrkdwn", text: buf.join("\n") } });
    buf = [];
    size = 0;
  };

  for (const line of body) {
    if (buf.length && size + line.length + 1 > SECTION_LIMIT) flush();
    buf.push(line);
    size += line.length + 1;
  }
  flush();
  return out;
}

function blocks(step: DeliveryStep, c: ClientFacts, body: string[]): SlackBlock[] {
  const out: SlackBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${c.name}* · ${step.phase}\n*${step.label}*`,
      },
    },
  ];

  if (body.length) {
    out.push(...bodySections(body));
  }

  out.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "Done" },
        style: "primary",
        action_id: "step_done",
        value: `${c.id}:${step.key}`,
      },
      {
        type: "button",
        text: { type: "plain_text", text: "Skip — not applicable" },
        action_id: "step_skip",
        value: `${c.id}:${step.key}`,
      },
      {
        type: "button",
        text: { type: "plain_text", text: "I hit a problem" },
        action_id: "step_problem",
        value: `${c.id}:${step.key}`,
      },
    ],
  } as SlackBlock);

  return out;
}

async function loadFacts(clientId: string): Promise<ClientFacts | null> {
  const { data } = await supabaseAdmin
    .from("clients")
    .select("id, legal_name, dba_name, city, state, address_line1, postal_code, phone")
    .eq("id", clientId)
    .maybeSingle();

  if (!data) return null;
  return {
    id: data.id as string,
    name: ((data.dba_name as string | null) || (data.legal_name as string)) ?? "this client",
    city: (data.city as string | null) ?? null,
    state: (data.state as string | null) ?? null,
    addressLine1: (data.address_line1 as string | null) ?? null,
    postalCode: (data.postal_code as string | null) ?? null,
    phone: (data.phone as string | null) ?? null,
  };
}

/**
 * Post one step's instruction card and park it in awaiting_me.
 *
 * ‼️ THE CARD IS A REPLY IN THIS STEP'S OWN THREAD, NOT IN ops_thread_ts.
 *
 * It used to thread on clients.ops_thread_ts along with everything else the runner produced,
 * which is how one onboarding put eighteen replies under a single thread in ninety seconds. The
 * anchor (step-board.ts) is the top-level message for the step; this card is the first thing in
 * its thread, and every draft, artifact, screenshot and refusal for the step lands under it.
 *
 * Idempotent on slack_message_ts: a step already posted is edited, never re-posted. §3's
 * "one message per tenant, updated in place" applied per step — a step that posts twice is
 * a step nobody trusts.
 */
export async function postStep(clientId: string, stepKey: string): Promise<void> {
  const channel = process.env.SLACK_CLIENT_ONBOARDING_CHANNEL;
  if (!channel) return;

  const step = stepByKey(stepKey);
  if (!step) return;

  const [facts, { data: row }] = await Promise.all([
    loadFacts(clientId),
    supabaseAdmin
      .from("client_delivery_steps")
      .select("status, slack_message_ts, output_ref")
      .eq("client_id", clientId)
      .eq("step_key", stepKey)
      .maybeSingle(),
  ]);

  if (!facts) return;
  if (row?.status === "complete" || row?.status === "skipped") return;

  // The anchor is created here if it does not exist yet, so the card can never end up at the
  // top level: anchorTsFor posts the anchor rather than falling back to ops_thread_ts.
  const anchorTs = await anchorTsFor(clientId, stepKey);
  if (!anchorTs) {
    console.error(`[step-engine] no anchor for ${stepKey}, card not posted`);
    return;
  }

  const body =
    (await instructionsFor(step, facts, {
      outputRef: (row?.output_ref as string | null) ?? null,
    })) ?? [];
  const kit = blocks(step, facts, body);
  const fallback = `${facts.name} · ${step.label}`;

  if (row?.slack_message_ts) {
    const res = (await slack.updateMessage(
      channel,
      row.slack_message_ts as string,
      fallback,
      kit
    )) as { ok?: boolean; error?: string };
    // slackFetch never throws, so the old `.catch(() => {})` here caught nothing and a failed
    // edit was invisible. Checking the flag is the only way to see it.
    if (!res?.ok) {
      console.error(`[step-engine] card edit failed for ${stepKey}:`, res?.error ?? "unknown");
    }
  } else {
    const res = (await slack.postThreadReply(channel, anchorTs, fallback, kit)) as {
      ok?: boolean;
      ts?: string;
      error?: string;
    };

    if (res?.ok && res.ts) {
      await supabaseAdmin
        .from("client_delivery_steps")
        .update({ slack_message_ts: res.ts, updated_at: new Date().toISOString() })
        .eq("client_id", clientId)
        .eq("step_key", stepKey)
        // The claim: only write the ts if nothing has one, so two concurrent posts cannot
        // both win. Same shape as ops_checklist_ts.
        .is("slack_message_ts", null);
    } else {
      console.error(`[step-engine] card post failed for ${stepKey}:`, res?.error ?? "no ts");
      return;
    }
  }

  await supabaseAdmin
    .from("client_delivery_steps")
    .update({
      status: "awaiting_me",
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("client_id", clientId)
    .eq("step_key", stepKey)
    .in("status", ["pending", "blocked", "ready", "error"]);
}

/**
 * How many files have been filed against this step's thread.
 *
 * §3: "[Done] on an upload task validates the expected file count landed in the thread; if
 * not, it names what's missing and stays open." Note what this does NOT do: it never ticks
 * the step. Evidence arriving is not a person saying they are finished.
 */
export async function uploadsFor(clientId: string, stepKey: string): Promise<number> {
  const { data: row } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("slack_anchor_ts")
    .eq("client_id", clientId)
    .eq("step_key", stepKey)
    .maybeSingle();

  // ‼️ THE ANCHOR TS, NOT THE CARD TS, AND THE OLD VERSION COULD NEVER MATCH ANYTHING.
  //
  // Slack threads are one level deep. Replying "to the card" does not make the card a parent:
  // the reply carries thread_ts of whatever the card itself was replying to. While the card was
  // a reply in ops_thread_ts, every screenshot filed with slack_thread_ts = ops_thread_ts, and
  // this compared it against slack_message_ts — two values that are never equal. So this
  // returned 0 for every client, presence_sweep_manual's precondition could never be satisfied,
  // and [Done] on it refused forever with "0 of 18 screenshots".
  //
  // Now the card is a reply under the step's ANCHOR, so an upload in that thread carries the
  // anchor ts and the comparison is exact.
  const ts = (row?.slack_anchor_ts as string | null) ?? null;
  if (!ts) return 0;

  const { count } = await supabaseAdmin
    .from("client_docs")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("slack_thread_ts", ts);

  return count ?? 0;
}

/**
 * Which PLATFORMS have a screenshot filed against this step, as opposed to how many FILES are
 * in its thread.
 *
 * ‼️ COUNTING FILES WAS THE BUG. The gate used to be "eighteen files in the thread", and the
 * four screenshots the first real run produced were all called image.png, so nothing in the
 * database could say which platform any of them showed. Six screenshots of Yelp would have
 * satisfied a six-platform gate. Attribution comes from the message text the file arrived with
 * (see resolvePlatformsFromText and captureOnboardingFile), and lands on
 * client_docs.presence_platform.
 *
 * Reads slack_thread_ts against the ANCHOR ts for exactly the reason uploadsFor documents
 * above: Slack threads are one level deep, so a reply "to the card" carries the ts of what the
 * card was replying to, and comparing against slack_message_ts matches nothing, ever.
 *
 * Returns null when the query itself failed, so a caller can say "could not check" rather than
 * reporting somebody's finished work as missing. Same reason countRows in step-verify returns
 * null rather than 0.
 */
export interface PresenceCoverage {
  /** Distinct CORE_SIX keys with at least one attributed screenshot. */
  coreCovered: string[];
  /** The core platforms still missing, as labels, for the refusal. */
  coreMissing: string[];
  extendedCovered: string[];
  /** Files in the thread whose message named no platform, or named more than one. */
  unattributed: number;
  /** Every file in the thread, which is the number the old gate counted. */
  files: number;
}

export async function presenceCoverageFor(
  clientId: string,
  stepKey: string
): Promise<PresenceCoverage | null> {
  const { data: row } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("slack_anchor_ts")
    .eq("client_id", clientId)
    .eq("step_key", stepKey)
    .maybeSingle();

  const ts = (row?.slack_anchor_ts as string | null) ?? null;
  if (!ts) {
    return { coreCovered: [], coreMissing: CORE_SIX.map((p) => p.label), extendedCovered: [], unattributed: 0, files: 0 };
  }

  const { data, error } = await supabaseAdmin
    .from("client_docs")
    .select("presence_platform")
    .eq("client_id", clientId)
    .eq("slack_thread_ts", ts);

  if (error) {
    console.error("[step-engine] presence coverage query failed:", error.message);
    return null;
  }

  const rows = data ?? [];
  const seen = new Set(
    rows.map((r) => (r.presence_platform as string | null) ?? "").filter(Boolean)
  );

  return {
    coreCovered: CORE_SIX.filter((p) => seen.has(p.key)).map((p) => p.key),
    coreMissing: CORE_SIX.filter((p) => !seen.has(p.key)).map((p) => p.label),
    extendedCovered: EXTENDED.filter((p) => seen.has(p.key)).map((p) => p.key),
    unattributed: rows.filter((r) => !r.presence_platform).length,
    files: rows.length,
  };
}

export interface Precondition {
  ok: boolean;
  /** Said to the person who pressed the button. Only present when ok is false. */
  message?: string;
}

/**
 * May [Done] go through on this step yet?
 *
 * ‼️ THIS GENERALISES A CHECK THAT USED TO BE ONE HARDCODED `if` IN THE SLACK HANDLER.
 * §3 gives the doctrine for the upload case: "[Done] on an upload task validates the expected
 * file count landed in the thread; if not, it names what's missing and stays open." The
 * principle is not about files, it is about a step whose completion is CHECKABLE — and when
 * it is checkable, a checklist that takes somebody's word for it is a checklist that lies.
 *
 * `hub_preview` is the case that proved it. It was ticked on the pilot with the theme
 * unconfirmed, so `review_tool_preview` refused on the very next line with "the theme has not
 * been confirmed" — a message that reads as a failure of the review tool rather than as the
 * unfinished half of the step just marked done. The refusal belongs on the button that was
 * wrong, at the moment it was pressed.
 *
 * Everything not named here returns ok. Most steps are somebody's word by nature and that is
 * correct: the engine flags, it does not police.
 */
export async function stepPrecondition(clientId: string, stepKey: string): Promise<Precondition> {
  const step = stepByKey(stepKey);
  if (!step) return { ok: true };

  if (step.key === "presence_sweep_manual") {
    const refusal = await presenceRefusal(clientId, stepKey);
    if (refusal) return { ok: false, message: refusal };
  }

  // ‼️ STEP 21 WAITS FOR THE PAYMENT RECORD, AND THE REFUSAL STATES THE REASON.
  //
  // Matthew: "After we receive the payment it unlocks step 21 for GBP manager search console
  // etc." A refusal that states the RULE teaches people to look for the way round it; this one
  // states why asking early costs the call.
  //
  // The REAL gate is step-verify.ts's `access_granted` verifier, because this function is called
  // from the Slack action route and nowhere else, and the client board's checkbox goes straight
  // to setDeliveryStep. This copy exists so the Slack button answers at the press rather than
  // after the cascade has run. Both read the same module.
  if (stepKey === "access_granted") {
    const { paymentRecorded, isRecorded, ACCESS_GATE_REASON, ACCESS_GATE_TODO } = await import(
      "./payment"
    );
    const result = await paymentRecorded(clientId);
    if (result.ok && !isRecorded(result.payment)) {
      return {
        ok: false,
        message: `Not yet — no payment has been recorded. ${ACCESS_GATE_REASON} ${ACCESS_GATE_TODO}`,
      };
    }
  }

  if (stepKey === "hub_preview") {
    const { themeConfirmed } = await import("./hub-setup");
    if (!(await themeConfirmed(clientId))) {
      return {
        ok: false,
        message:
          "Not yet — the theme has not been confirmed, and this step's label says \"themed\". " +
          "Open the client board, Theme panel, then press Confirm. Until you do, the hub and " +
          "the review tool render in SRT's colours on the client's own domain, and " +
          "review_tool_preview will refuse for the same reason. Confirming with NOTHING SET is " +
          "allowed and means you are keeping the defaults on purpose.",
      };
    }
  }

  return { ok: true };
}

/**
 * Post whichever steps are now reachable: the anchor for every one of them, and the
 * instruction card for the ones a person has to work.
 *
 * Called after any step transition. Deliberately conservative: it reaches only steps whose
 * blockers are ALL resolved, so the channel fills in the order the work actually happens
 * rather than dumping 33 messages on day one. Matthew chose this over posting all 33 at
 * intake, so the newest message in the channel is always the thing to work on next.
 *
 * ‼️ EVERY REACHABLE STEP GETS AN ANCHOR, INCLUDING `mode: "auto"` ONES. An auto step still
 * produces output somebody reads (the site and DNS intelligence, the presence PDF), and that
 * output has to have a thread of its own to land in. Without an anchor those notes would have
 * nowhere to go but ops_thread_ts, which is the wall this whole change removes.
 *
 * ‼️ IT MUST RUN **AFTER** runReadyAutoSteps, AND FOR ONE RUN IT DID NOT.
 *
 * postStep parks a row in `awaiting_me`, and runReadyAutoSteps only claims rows in
 * pending/blocked/ready. So when this ran first it posted the card for every `auto_then_manual`
 * step and thereby made that step's own runner unclaimable. registerHubAndSeedDns, runHarvest
 * and checkHubResolving never executed on the normal path — while the hub_preview card this
 * function had just posted told Matthew "the hostnames are attached to Vercel already". The
 * card was asserting the result of the runner it had just starved.
 *
 * The `auto` guard below is what keeps it fixed: an auto_then_manual step is skipped here
 * until its runner has finished and left it at `ready`. Ordering alone would not be enough,
 * because this is also called on its own from other paths.
 */
/**
 * Give every reachable step its top-level message, in DELIVERY_STEPS order.
 *
 * ‼️ THIS EXISTS BECAUSE THE FIRST LIVE RUN CAME OUT IN THE WRONG ORDER: the channel read
 * 1, 3, 4, 15, 2, 5, 19.
 *
 * Slack orders a channel by post time and nothing can reorder it afterwards, so the order the
 * anchors are CREATED in is the order Matthew reads for the life of the job. Before this, they
 * were created lazily by whoever needed one first — an auto runner posting its note, an
 * artifact being delivered, autoCompleteStep ticking — so the sequence followed which runner
 * happened to finish first rather than the step list.
 *
 * Anchoring the whole reachable set up front, in array order, in one pass, is what makes the
 * channel scan top to bottom. It must therefore run BEFORE any runner and before any card.
 *
 * Idempotent: postStepAnchor claims with `.is(null)` and returns the existing ts.
 */
/**
 * Which steps may appear right now. THE single answer, read by all three schedulers.
 *
 * ‼️ EXACTLY ONE WAITING STEP AT A TIME. MATTHEW'S CALL, AND IT COSTS SOMETHING REAL.
 *
 * `ensureReachableAnchors` used to anchor EVERY step whose blockers were clear, which on the
 * first real client meant two messages at intake, then four, then two. Four things to work on
 * is four things to choose between, and the whole point of one-message-per-step was that a step
 * could be worked one at a time.
 *
 * **What it costs:** work that could legitimately happen in parallel is now serialised. The
 * clearest case is `call_booked`, which has no `blockedBy` at all — today it appears at intake
 * and the call can be booked while the scan is still running; under this cursor it does not
 * appear until step 18 resolves. That is not an oversight, it is the trade: Matthew asked for
 * calm over throughput, and a board that shows one thing is calm in a way a board that shows
 * the true dependency graph is not. If the serialisation ever bites, the fix is to widen this
 * function, not to bypass it in one caller.
 *
 * The walk:
 *  - a RESOLVED step is walked past (complete or skipped, the reading every scheduler here uses);
 *  - an unresolved step that is REACHABLE joins the cursor;
 *  - an AUTO step never ends the walk, because it resolves itself inside this same cascade and
 *    stopping on one would deadlock the board before anything had run;
 *  - the first unresolved step that will WAIT FOR A PERSON ends the walk — **whether or not it
 *    is reachable yet**.
 *
 * ‼️ THAT LAST CLAUSE IS THE LOAD-BEARING ONE AND THE OBVIOUS VERSION GETS IT WRONG.
 *
 * Walking PAST a blocked waiting step, on the reasonable-sounding grounds that it is not
 * workable, lets a later step leapfrog it. The live case: at intake, `presence_sweep_manual` is
 * blocked on `nap_sweep`, `competitor_shortlist` is blocked on `baseline_scan`, and everything
 * between them is blocked too — so the walk would run all the way down to `hub_preview`, whose
 * only blocker is `intake_received`, and anchor it. Four messages at intake, which is the
 * behaviour this function exists to stop.
 *
 * Breaking on it instead is right because the blocker is an EARLIER step, so it has already been
 * seen by this same walk and is either in the cursor or is what stopped it. The board is
 * therefore never empty while anything is unresolved, and it never shows two things to do.
 */
export async function reachableCursor(clientId: string): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("step_key, status")
    .eq("client_id", clientId);

  const done = new Set(
    (data ?? [])
      .filter((r) => r.status === "complete" || r.status === "skipped")
      .map((r) => r.step_key as string)
  );

  const cursor = new Set<string>();
  for (const step of DELIVERY_STEPS) {
    if (done.has(step.key)) continue;

    // Blocked steps get no anchor: a top-level message for work that cannot start is the wall
    // coming back. They can still END the walk, which is the point above.
    if (!(step.blockedBy ?? []).some((k) => !done.has(k))) cursor.add(step.key);

    if (step.mode !== "auto") break;
  }
  return cursor;
}

export async function ensureReachableAnchors(clientId: string): Promise<void> {
  const cursor = await reachableCursor(clientId);

  const { data } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("step_key, slack_anchor_ts")
    .eq("client_id", clientId);

  const anchored = new Set(
    (data ?? []).filter((r) => r.slack_anchor_ts).map((r) => r.step_key as string)
  );

  // In DELIVERY_STEPS order, because Slack orders a channel by post time and nothing can
  // reorder it afterwards. See the doc block above this function.
  for (const step of DELIVERY_STEPS) {
    if (!cursor.has(step.key)) continue;
    if (anchored.has(step.key)) continue;

    const res = await postStepAnchor(clientId, step.key);
    if (!res.ok) {
      console.error(`[step-engine] anchor for ${step.key} failed:`, res.error);
      continue;
    }

    // ‼️ STEP 31 GETS A NOTE, NOT A CARD, AND THAT IS THE HONEST SHAPE FOR IT.
    // time_log_entries is `mode: "auto"`, so postReadySteps skips it and no card is ever
    // posted — but nothing about it runs itself either: /api/clients/[id]/time-log ticks it
    // when the first entry is saved. So the anchor said "Time log has entries from day 0" and
    // nothing said where to put them. A [Done] button would be worse: it is a button whose
    // press the verifier can refuse, over work that is not a button press.
    if (step.key === "time_log_entries") {
      await notifyStep(
        clientId,
        step.key,
        [
          "This one ticks itself. There is no button and nothing here is yours to press.",
          "",
          `Log time on the client board: ${appUrl()}/dashboard/clients/${clientId}`,
          "The first entry saved after the Day-0 stamp completes this step.",
          "",
          "It matters because the pilot's cost is measured from this log. An empty log does not",
          "make the pilot free, it makes it unevaluable.",
        ].join("\n")
      ).catch((e) => console.error("[step-engine] time-log note failed:", (e as Error).message));
    }
  }
}

export async function postReadySteps(clientId: string): Promise<void> {
  // Anchors first and in order, always. postReadySteps is called from several places, so the
  // ordering guarantee has to live at the top of this function rather than in the callers.
  await ensureReachableAnchors(clientId);

  // ‼️ GATED ON THE CURSOR, AND IT HAS TO BE. postStep calls anchorTsFor, which CREATES an
  // anchor rather than falling back — so a card posted outside the cursor drags its step's
  // top-level message into the channel with it, and the one-at-a-time rule comes apart one
  // message at a time.
  const cursor = await reachableCursor(clientId);

  const { data } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("step_key, status, slack_message_ts, slack_anchor_ts")
    .eq("client_id", clientId);

  const rows = data ?? [];
  const done = new Set(
    rows.filter((r) => r.status === "complete" || r.status === "skipped").map((r) => r.step_key as string)
  );
  const posted = new Set(
    rows.filter((r) => r.slack_message_ts).map((r) => r.step_key as string)
  );
  const statusOf = new Map(rows.map((r) => [r.step_key as string, r.status as string]));

  for (const step of DELIVERY_STEPS) {
    if (!cursor.has(step.key)) continue;
    if ((step.blockedBy ?? []).some((k) => !done.has(k))) continue;
    if (step.mode === "auto") continue;
    if (done.has(step.key) || posted.has(step.key)) continue;

    // An auto_then_manual step's card describes what the runner produced, so posting it
    // before the runner has run says something untrue AND blocks the runner from ever
    // correcting it. Wait for `ready`, which is what runReadyAutoSteps leaves behind.
    if (step.mode === "auto_then_manual" && statusOf.get(step.key) !== "ready") continue;

    await postStep(clientId, step.key).catch((e) =>
      console.error(`[step-engine] post ${step.key} failed:`, (e as Error).message)
    );
  }
}

/**
 * Run whichever AUTO steps are now runnable and have not run.
 *
 * ‼️ THE COUNTERPART TO postReadySteps, AND THE THING THAT WAS MISSING.
 * postReadySteps skips `mode === "auto"` on the first line of its loop, and nothing else ran
 * those steps either — so five rows rendered `_auto_` in Slack forever while no code behind them
 * existed. This is the other half: manual steps get posted to a person, auto steps get executed.
 *
 * Conservative in the same way postReadySteps is:
 *  - only when every blocker is complete, so work happens in the order it actually happens;
 *  - only when the step has never started, so a re-entrant call cannot run a generator twice;
 *  - claimed with a conditional UPDATE before running, because two step transitions landing at
 *    once would otherwise both see 'ready' and both generate a PDF.
 *
 * An auto step that FAILS goes to 'error' with the reason on the row. It does not retry itself
 * and it does not block: the daily digest surfaces errors, and a human decides. A generator that
 * silently retried would spend an audit's worth of fetches on a client whose website is down.
 *
 * ‼️ A STEP THAT GENERATES SOMETHING BUT STILL NEEDS A PERSON DOES NOT COMPLETE ITSELF.
 * `auto_then_manual` runs its generator and then posts the card and waits, exactly as Runner v3
 * §2 requires: "Never auto-advance past a human." avatar_harvest is the live example — the
 * cited-source harvest is finished, the deep-research brief is not until somebody runs it.
 */
export async function runReadyAutoSteps(clientId: string): Promise<void> {
  const { AUTO_RUNNERS, unreachableAutoSteps } = await import("./artifacts/registry");

  // Blockers that can never complete are dead ends, not waits. See unreachableAutoSteps() for
  // what this was hiding: findings_doc and call_sheet could not generate for any client.
  const unreachable = unreachableAutoSteps();

  // ‼️ GATED ON THE CURSOR TOO, AND THIS IS THE LEAK THAT WOULD HAVE BEEN MISSED.
  // A runner's `note` goes out through notifyStep, which creates the step's anchor. hub_preview
  // is `blockedBy: ["intake_received"]` alone, so without this it runs the moment intake
  // finishes and posts a top-level message for step 15 while step 5 is the one being worked —
  // one-at-a-time defeated by a function that never touches the anchor code.
  const cursor = await reachableCursor(clientId);

  const { data } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("step_key, status")
    .eq("client_id", clientId);

  const rows = data ?? [];
  const done = new Set(
    rows.filter((r) => r.status === "complete" || r.status === "skipped").map((r) => r.step_key as string)
  );
  const byKey = new Map(rows.map((r) => [r.step_key as string, r.status as string]));

  for (const step of DELIVERY_STEPS) {
    const runner = AUTO_RUNNERS[step.key];
    if (!runner) continue;
    if (!cursor.has(step.key)) continue;

    const status = byKey.get(step.key);
    // 'pending', 'blocked' and 'ready' are all startable. 'running', 'awaiting_me', 'complete',
    // 'skipped' and 'error' are not: the first is in flight, the rest have had their turn.
    if (!status || !["pending", "blocked", "ready"].includes(status)) continue;
    const waiting = (step.blockedBy ?? []).filter((k) => !done.has(k) && !unreachable.has(k));
    if (waiting.length) continue;

    const waived = (step.blockedBy ?? []).filter((k) => !done.has(k) && unreachable.has(k));
    if (waived.length) {
      console.warn(
        `[step-engine] running ${step.key} with unreachable blockers waived: ${waived.join(", ")}. ` +
          `Those steps are declared auto and have no implementation, so waiting on them would be a deadlock. ` +
          `The artifact states what is missing rather than pretending it is complete.`
      );
    }

    // The claim. `.in("status", ...)` makes this conditional: the loser of a race updates zero
    // rows and gets no data back, so exactly one caller runs the generator.
    const { data: claimed } = await supabaseAdmin
      .from("client_delivery_steps")
      .update({ status: "running", started_at: new Date().toISOString(), error_detail: null })
      .eq("client_id", clientId)
      .eq("step_key", step.key)
      .in("status", ["pending", "blocked", "ready"])
      .select("id");

    if (!claimed?.length) continue;

    let result: { ok: boolean; error?: string; note?: string };
    try {
      result = await runner(clientId);
    } catch (e) {
      result = { ok: false, error: (e as Error).message };
    }

    if (!result.ok) {
      await supabaseAdmin
        .from("client_delivery_steps")
        .update({ status: "error", error_detail: result.error ?? "unknown", updated_at: new Date().toISOString() })
        .eq("client_id", clientId)
        .eq("step_key", step.key);

      // Into THIS STEP'S thread, not ops_thread_ts. A failure is the single most important
      // thing a step's thread can say, and it used to be a reply in a stream of eighteen.
      await notifyStep(
        clientId,
        step.key,
        `:warning: *${step.label}* failed: ${result.error ?? "unknown"}`
      );
      await refreshStepAnchor(clientId, step.key);

      // ‼️ A FAILED RUNNER'S NOTE IS POSTED TOO, and it used to be thrown away. `note` is the
      // runner's own account of what it found, and on the failure paths that is precisely
      // where the diagnosis lives: registerHubAndSeedDns builds a full readout of which host
      // attached, which did not and why, and then returns ok:false when neither did. Printing
      // one line of `error` and discarding the readout leaves the thread saying a step failed
      // with no way to tell whether the cause is a missing token or a domain someone else owns.
      if (result.note) await notifyStep(clientId, step.key, result.note);
      continue;
    }

    if (result.note) {
      await notifyStep(clientId, step.key, result.note);
    }

    if (step.mode === "auto_then_manual") {
      // Generated, now waiting on a person. Post the card and stop.
      await supabaseAdmin
        .from("client_delivery_steps")
        .update({ status: "ready", updated_at: new Date().toISOString() })
        .eq("client_id", clientId)
        .eq("step_key", step.key);
      await postStep(clientId, step.key).catch((e) =>
        console.error(`[step-engine] card for ${step.key} failed:`, (e as Error).message)
      );
      await refreshStepAnchor(clientId, step.key);
      continue;
    }

    const { autoCompleteStep } = await import("./delivery-checklist");
    await autoCompleteStep(clientId, step.key).catch((e) =>
      console.error(`[step-engine] completing ${step.key} failed:`, (e as Error).message)
    );
  }
}

/**
 * The daily #alerts-infra digest. Runner v3 §3.
 *
 * "Tasks in 'error', and tasks 'awaiting_me' longer than 48h."
 *
 * Two states and no others, on purpose. A digest that lists everything outstanding is a
 * digest nobody reads by week three, and the checklist message already shows what is
 * outstanding. These two are different: an error will never resolve itself, and a step that
 * has been waiting two days has been forgotten rather than deferred.
 */
export async function stepDigest(): Promise<string | null> {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const { data } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("client_id, step_key, status, updated_at, error_detail, clients!inner(legal_name, dba_name)")
    .in("status", ["error", "awaiting_me"]);

  const rows = (data ?? []) as unknown as Array<{
    client_id: string;
    step_key: string;
    status: string;
    updated_at: string;
    error_detail: string | null;
    clients: { legal_name: string; dba_name: string | null };
  }>;

  const errors = rows.filter((r) => r.status === "error");
  const stale = rows.filter((r) => r.status === "awaiting_me" && r.updated_at < cutoff);

  if (!errors.length && !stale.length) return null;

  const name = (r: (typeof rows)[number]) => r.clients.dba_name || r.clients.legal_name;
  const label = (k: string) => stepByKey(k)?.label ?? k;
  const lines: string[] = [];

  if (errors.length) {
    lines.push(`*${errors.length} step${errors.length === 1 ? "" : "s"} in error*`);
    for (const r of errors) {
      lines.push(`  • ${name(r)} — ${label(r.step_key)}${r.error_detail ? `: ${r.error_detail}` : ""}`);
    }
  }

  if (stale.length) {
    if (lines.length) lines.push("");
    lines.push(`*${stale.length} waiting more than 48h*`);
    for (const r of stale) {
      const days = Math.floor((Date.now() - new Date(r.updated_at).getTime()) / 86400000);
      lines.push(`  • ${name(r)} — ${label(r.step_key)} (${days}d)`);
    }
  }

  return lines.join("\n");
}
