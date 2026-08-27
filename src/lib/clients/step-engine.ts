// The step engine: one threaded Slack post per step that needs a person.
//
// Runner v3 §3. "Tasks needing me post a threaded message with imperative sentences and the
// EXACT string to search or paste. Never 'check the listing.' Always 'Search Google for:
// Acme Med Spa Greensboro NC'."
//
// That instruction is the whole design. A checklist row saying "Presence sweep, manual
// tier" is a to-do; the same row with nineteen search strings already composed from the
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
  PLATFORM_COUNT,
  SWEEP_GATE_COUNT,
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
      const { confirmedAvatarFor, avatarBriefFor } = await import("./avatars");
      const { verticalFor } = await import("./harvest");

      const avatar = await confirmedAvatarFor(c.id);
      const resolved = await verticalFor(c.id);
      const cached =
        avatar && resolved.ok ? await avatarBriefFor(resolved.vertical, avatar.slug) : null;

      const { data: bank } = await supabaseAdmin
        .from("question_bank")
        .select("phrase")
        .eq("source", "harvest")
        .order("commercial_intent_score", { ascending: false })
        .limit(3);

      const report = docLink(c.id, row.outputRef, "the research PDF");

      // ‼️ THE REUSE OFFER IS THE HALF HE ASKED FOR BY NAME: "this way if another client has the
      // same LHR client, we can use the same prompt saved in the databse and make it optional to
      // run deep research again." avatar_briefs is keyed (vertical, avatar_slug) and NOT by
      // client, which is the entire mechanism.
      const reuse = cached?.researchText
        ? [
            "",
            `:recycle: *This avatar already has research from ${cached.createdAt.slice(0, 10)}*` +
              (cached.timesReused > 0
                ? `, reused by ${cached.timesReused} client${cached.timesReused === 1 ? "" : "s"} since.`
                : "."),
            "Reuse it and the phrases are filed against this client without running anything, or",
            "run it again and a fresh report lands here. Buttons below.",
          ]
        : [];

      return [
        avatar
          ? `*Researching: ${avatar.label}.* That is the avatar confirmed at the step above, and it`
          : "*No avatar is confirmed*, so this step has nothing to research. Confirm one at the step",
        avatar
          ? "is what this whole step is about."
          : "above and un-tick this one.",
        "",
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
        ...reuse,
        "",
        "*The deep research runs itself.* It used to hand you three messages to paste into",
        "ChatGPT; it now researches the eight sections in parallel with web search and files the",
        avatar
          ? `report here as a PDF, aimed at *${avatar.label}* specifically.`
          : "report here as a PDF.",
        `${report ? `It is filed: ${report}.` : "It has not been generated yet."}`,
        "",
        "*What needs you: read it, then press Done.* Nothing advances to the next step until you",
        "do — that is the point of the gate, not an accident of it. Sections that did not come",
        "back whole say so in the PDF rather than being filled in, so a thin report reads as thin.",
        "",
        "Type `prompt` in this thread and it hands back the single prompt it ran, if you want to",
        "run it yourself somewhere else. `research:` followed by a paste still works too, and so",
        "does dropping a PDF straight in — both file phrases against this avatar.",
        "",
        "_[Skip] still works_, and what it costs is stated when you press it: the universal twenty",
        "still run, so the Day-0 measurement is intact, but the tracked set will not carry this",
        "avatar's own wording.",
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
        "It feeds findings section 3. The tool a customer uses is the review tool preview; handing",
        "it over is step 30.",
        "",
        ...formatReviewAuditCard({
          clientName: c.name,
          city: c.city ?? "",
          state: c.state ?? "",
          competitors: competitors.map((x) => ({ name: x.name })),
          rows,
        }).split("\n"),
        "",
        `Drop the screenshots in this thread, or type the counts on the board: ${boardUrl(c)}`,
      ];
    }

    case "review_tool_preview": {
      const { reviewPreviewUrl, clientPreviewUrl, previewLinkLine } = await import("./review-preview");
      const { data: host } = await supabaseAdmin
        .from("client_hosts")
        .select("host, vercel_attached_at")
        .eq("client_id", c.id)
        .eq("kind", "reviews")
        .maybeSingle();

      return [
        "*This step owns whether the tool RENDERS and is themed.* It is not the review audit",
        "(the review audit, an internal competitor grid) and not the handover (step 30).",
        "",
        `Internal preview: ${reviewPreviewUrl(c.id)}`,
        ":lock: *That URL cannot be sent to a client.* It is a `/dashboard/` path and the page",
        "calls `notFound()` without a session, so a logged-out visitor gets a 404 rather than a",
        "login screen. It belongs in this thread, which is internal, and nowhere else.",
        "It is still the one to use HERE, because it shows drafts and this one does not.",
        "",
        ...previewLinkLine(clientPreviewUrl(c.id, "reviews"), "The review tool").split("\n"),
        "Anything typed into it from either preview is discarded rather than stored: the submit",
        "route takes the client only from `x-hub-host`, and middleware strips that header on our",
        "own hostnames. Type into it freely on the call.",
        "",
        host?.host
          ? `The client-facing surface is \`${host.host}\`${host.vercel_attached_at ? ", attached" : ", NOT attached to Vercel yet"}.`
          : "The client-facing surface is the `reviews.` host, and no `client_hosts` row exists for it yet.",
      ];
    }

    case "avatar_confirmed": {
      // ‼️ THIS CARD USED TO SAY "The proposal is on the board" AND THERE WAS NO SUCH PANEL.
      // clients.primary_avatar had two readers and zero writers anywhere in the codebase, so on
      // the first real client this step came out `skipped`: no human being could have ticked it.
      // There is a panel now, and three buttons on this card.
      const { avatarCandidatesFor, confirmedAvatarFor } = await import("./avatars");
      const found = await avatarCandidatesFor(c.id);
      const already = await confirmedAvatarFor(c.id);

      const head = [
        "*Which customer is this whole build aimed at?* Everything after this is scored against",
        "the answer: step 10 researches THIS buyer, the custom question set is built from their",
        "wording, and the page candidates are ranked for them.",
        "",
      ];

      if (!found.ok) {
        return [
          ...head,
          `:warning: ${found.error}`,
          "",
          `Type one instead, or set it on the board: ${boardUrl(c)}#avatar`,
        ];
      }

      const body = found.candidates.length
        ? [
            // ‼️ THE CAVEAT STAYS. These are cached per NICHE, not per business, so every client
            // audited in this niche this month has the same three. They are candidates and never
            // a default, and rejecting all three is an available answer.
            `Three candidates from the \`${found.nicheKey}\` brief. They are cached per NICHE, not`,
            "per business, so every client audited in this niche this month has the same three.",
            "Candidates, never a default. Rejecting all three is a real answer.",
            "",
            ...found.candidates.flatMap((a) => [
              `*${a.slot} — ${a.label}*`,
              ...(a.ticket ? [`     ${a.ticket}`] : []),
              ...(a.why ? [`     ${a.why}`] : []),
            ]),
          ]
        : [
            "No niche brief carries candidates for this vertical, so there are no three to offer.",
            "Type the one you want; that is a supported answer rather than a workaround.",
          ];

      return [
        ...head,
        ...body,
        "",
        "*Pick one with a button below*, or reply in this thread with your own:",
        "`avatar: laser hair removal`",
        "The slot is a1/a2/a3 and the label is whatever you type, so a new one needs nothing but",
        "the words. For a med spa that is laser hair removal, filler, HIFU, BBL, whichever one",
        "this client actually makes money on.",
        "",
        already
          ? `Currently confirmed: *${already.label}* (${already.slot}). Confirming again replaces it and the old one is kept in the history.`
          : "Nothing is confirmed yet, so step 10 has nothing to research.",
        `Or on the board: ${boardUrl(c)}#avatar`,
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
      const { clientPreviewUrl, previewLinkLine } = await import("./review-preview");
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
        // Matthew asked for this one by name: "Step 15 needs to give me the link to confirm the
        // theme in mission control." It is the anchor on the Identity and theme panel, so the
        // board opens scrolled to the control this step is waiting on rather than at the top.
        `Confirm the theme: ${boardUrl(c)}#theme`,
        "",
        ...previewLinkLine(clientPreviewUrl(c.id, "hub"), "The hub").split("\n"),
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
        "pick a number, then `ask`. It walks the questions only this business can answer and",
        "files every reply VERBATIM as evidence. `draft` then writes the page from that and says",
        "what each claim rests on. No model touches your words unless you ask for that by name.",
        "",
        "That evidence is not optional: a page with nothing behind it cannot be published.",
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
        // ‼️ THE EVIDENCE STEP IS NAMED FIRST BECAUSE THE GATE REFUSES WITHOUT IT.
        // A person following this card in order used to reach Publish and meet a refusal that
        // sent them back to the beginning of the page. `ask` is not an optional extra any more:
        // a page with no source behind it cannot be published at all.
        `*Start in Slack.* Post \`page ${c.name}\` in ${pageStudioHint()}, pick a number, then`,
        "`ask`. It walks the questions only they can answer: how they answer it in the room,",
        "what they see in their own patients, pricing ranges, who they turn away, what people",
        "get wrong. Talk or send voice notes. Every answer is filed VERBATIM as evidence and",
        "nothing is written by a model.",
        "",
        "Then `draft` writes the page from that evidence and says what each claim rests on,",
        "`polish` just tidies what you already wrote, and `check` runs the quality gate.",
        "",
        "On the board you can do the same by hand: pick a question, write it, Check, Publish.",
        "",
        published.length
          ? `*${published.length} published:* ${published.map((p) => `/${p.slug}`).join(", ")}`
          : "*Nothing is published yet*, which is what this step is waiting on.",
        drafts.length
          ? `*${drafts.length} draft${drafts.length === 1 ? "" : "s"} written:* ${drafts.map((p) => `/${p.slug}`).join(", ")}`
          : "No drafts written yet.",
        "",
        // ‼️ BOTH WALLS, NAMED. This used to say Day 0 was "the one hard wall", which stopped
        // being true on 2026-08-26. A card that names one of two refusals sends somebody to fix
        // the first and meet the second, which reads as the fix not having worked.
        ":lock: *Publishing refuses on two things, and both are deliberate.*",
        "  1. *Day 0 unarchived.* Once a page is live, the baseline the day 30, 60 and 90",
        "     numbers are measured against cannot be recovered.",
        "  2. *The quality gate.* It refuses a claim with no source behind it, a number no",
        "     source contains, a near-duplicate of a live page, and a page that does not answer",
        "     its own question. Thin or generic only warns. A verdict counts for the exact body",
        "     it read, so edit the page and `check` it again.",
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

      // ‼️ THE AVATAR AND THE QUESTION SET ARE PRINTED HERE BECAUSE THIS IS THE LAST MOMENT THEY
      // CAN CHANGE. Matthew: "So avatar can be changed in the call so make sure we ask follow up
      // question regarding the avatar and the questions we want to run in the AI for day 0 scan."
      // Ticking this step stamps day_0_archived_at and both are frozen from then on, so a card
      // that did not show them would be asking somebody to freeze something they cannot see.
      const { confirmedAvatarFor } = await import("./avatars");
      const avatar = await confirmedAvatarFor(c.id);

      const { data: qset } = await supabaseAdmin
        .from("client_question_sets")
        .select("version, status, questions")
        .eq("client_id", c.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const questionCount = Array.isArray(qset?.questions) ? (qset!.questions as unknown[]).length : 0;

      return [
        "*What this scan will be measured against, and this is the last moment either can change:*",
        avatar
          ? `  • Avatar: *${avatar.label}* (${avatar.slot})`
          : "  • Avatar: *none confirmed*, so the tracked set was built without one",
        qset
          ? `  • Question set: *${qset.version}* (${qset.status}), ${questionCount} questions`
          : "  • Question set: none drafted yet",
        "",
        "Change the avatar from here by replying `avatar: laser hair removal`, and the custom",
        "question set is regenerated against it as a new version. Reply `questions:` with what you",
        "want changed and it goes in this thread against that set.",
        ":lock: *Both refuse once this step is ticked.* The stamp is what the day 30, 60 and 90",
        "numbers are measured against, and a target changed afterwards leaves the case study",
        "comparing two different questions. The universal twenty stay in place underneath either way.",
        "",
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
            "not a row that was cleaned. Step 14 reads the sweep screenshots and posts what it " +
            "proposes with a *Confirm all as read* button on it, which is one tap for the batch. " +
            "Row by row instead on the Presence sweep panel."
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
 * ‼️ THE GATE IS ANY FOUR DISTINCT PLATFORMS HE CHOSE, NOT FOUR NAMED ONES AND NOT FILES.
 *
 * Matthew: "instead of being core 6 make it core 4 also let it let me post the 6 of my
 * preference and dont force me to do those specifically." So there is nothing left to NAME as
 * missing, which is why this copy changed shape completely: it used to list the outstanding
 * core platforms, and with a free choice that list does not exist. It says how many distinct
 * platforms are filed, which ones they are, and how many more would close it.
 *
 * The count alone is still not enough and never was: four screenshots that are all Yelp must
 * not satisfy a four-platform gate. Every pasted Slack screenshot is called image.png, so the
 * platform comes from the message text or from the address bar in the picture, and a file
 * nothing could attribute is still filed and still kept. It just does not count, and this says
 * so rather than leaving it a mystery.
 *
 * ‼️ THE EMPTY-SEARCH-RESULT LINE STAYS. It is why "missing" is a FINDING rather than a gap:
 * without it, a business with no listing on a platform looks identical to a platform nobody
 * checked, and those are opposite claims.
 */
async function presenceRefusal(clientId: string, stepKey: string): Promise<string | null> {
  const cover = await presenceCoverageFor(clientId, stepKey);

  if (!cover) {
    return (
      "Could not check. The query for this step's screenshots failed, so nothing can be " +
      "confirmed either way. Try again in a moment rather than ticking past it."
    );
  }

  if (cover.short === 0) return null;

  const lines = [
    `Not yet — ${cover.distinct} of the ${cover.needed} distinct platforms this step needs have a screenshot filed against it.`,
    cover.distinct > 0
      ? `Filed so far: ${describeCoverage(cover)}.`
      : `Nothing is attributed yet. Any ${cover.needed} of the ${PLATFORM_COUNT} platforms close this step, and they are your choice.`,
    cover.distinct > 0
      ? `${cover.short} more, any platform on the list, and this closes.`
      : "",
    "Post one platform per message with its name in the message, or leave the Chrome address bar in the shot and it reads the URL itself.",
    "Where a business genuinely has no listing, the screenshot of the empty search result is the evidence for \"missing\".",
  ].filter(Boolean);

  if (cover.unattributed > 0) {
    lines.push(
      `${cover.unattributed} file${cover.unattributed === 1 ? "" : "s"} in this thread could not be ` +
        "attributed from either the message or the address bar, so they are filed but not counted. " +
        "Reply with the platform name, one platform per message."
    );
  }

  return lines.join(" ");
}

/**
 * Slack's hard limit on one section's text. Exceeding it fails the WHOLE message.
 *
 * ‼️ THE SWEEP CARD WAS ALREADY AT 2,988 CHARACTERS FOR A SHORT BUSINESS NAME, and the name is
 * interpolated into all nineteen search strings. Measured on the cascade probe, whose client is
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

/**
 * Buttons a specific step's card carries BESIDE Done / Skip / I hit a problem.
 *
 * ‼️ ADDITIVE, AND THE THREE STANDARD BUTTONS ARE UNTOUCHED IN BOTH ORDER AND MEANING. A step
 * whose whole content is a choice between three named things needs those three things to be
 * pressable where the card is, and telling somebody to open a dashboard to press one of three
 * buttons is how a step ends up `skipped`, which is exactly what happened to avatar_confirmed on
 * the first real client.
 *
 * Slack allows 25 elements in one actions block, so three plus three is not near anything.
 */
type StepAction = { label: string; actionId: string; value: string };

function blocks(
  step: DeliveryStep,
  c: ClientFacts,
  body: string[],
  extra: StepAction[] = []
): SlackBlock[] {
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
      ...extra.map((e) => ({
        type: "button",
        text: { type: "plain_text", text: e.label },
        action_id: e.actionId,
        value: e.value,
      })),
    ],
  } as SlackBlock);

  return out;
}

/**
 * The per-step extras. One step has any today and the switch says which.
 *
 * Kept out of instructionsFor because that returns the BODY and a button is not a line of text;
 * kept out of blocks() because blocks() is synchronous and this needs a database read.
 */
async function extraActionsFor(step: DeliveryStep, c: ClientFacts): Promise<StepAction[]> {
  // ‼️ [Reuse it] IS ONLY OFFERED WHEN THERE IS SOMETHING TO REUSE. A button that says research
  // exists, over an avatar_briefs row carrying only a prompt, would be a promise the next press
  // cannot keep. Both halves are checked: a row AND research_text on it.
  if (step.key === "avatar_harvest") {
    const { confirmedAvatarFor, avatarBriefFor } = await import("./avatars");
    const { verticalFor } = await import("./harvest");
    const avatar = await confirmedAvatarFor(c.id);
    const resolved = await verticalFor(c.id);
    if (!avatar || !resolved.ok) return [];
    const cached = await avatarBriefFor(resolved.vertical, avatar.slug);
    if (!cached?.researchText) return [];
    return [
      { label: "Reuse it", actionId: "avatar_reuse_research", value: `${c.id}` },
      { label: "Run it again", actionId: "avatar_rerun_research", value: `${c.id}` },
    ];
  }

  if (step.key !== "avatar_confirmed") return [];

  const { avatarCandidatesFor } = await import("./avatars");
  const found = await avatarCandidatesFor(c.id);

  // A label over 75 characters is rejected by Slack, and these come from a niche brief that
  // routinely writes "The New-Build Neighborhood HOA Property Manager". Truncated for the BUTTON
  // only; the card body prints every one of them in full.
  return found.candidates.map((cand) => ({
    label: cand.label.length > 70 ? `${cand.label.slice(0, 67)}...` : cand.label,
    actionId: "avatar_pick",
    value: `${c.id}:${cand.slot}:${cand.label}`.slice(0, 2000),
  }));
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
  const kit = blocks(step, facts, body, await extraActionsFor(step, facts));
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
  /**
   * Distinct platform keys with at least one attributed screenshot, ANY TIER, in list order.
   *
   * ‼️ RENAMED FROM coreCovered, NOT REPURPOSED. The old field meant "of the core six" and the
   * gate no longer asks that question. Leaving a field called coreMissing holding a different
   * set is how a caller keeps reading it as if it still meant the old thing.
   */
  covered: string[];
  /** covered.length. What the gate compares, and it is PLATFORMS, never files. */
  distinct: number;
  /** SWEEP_GATE_COUNT, carried here so a caller never restates the number. */
  needed: number;
  /** How many more distinct platforms would close the step. Zero once the gate is met. */
  short: number;
  /**
   * The same keys split by remediation tier.
   *
   * Reported because the tiers still MEAN what they meant: citation-cleanup.ts sorts core-six
   * first and presence-pdf.ts renders them separately. The gate does not read this.
   */
  byTier: { core: string[]; extended: string[] };
  /**
   * The same keys split by HOW they were attributed.
   *
   * ‼️ TWO TIERS OF EVIDENCE AND THE COPY HAS TO SAY WHICH. A screenshot whose address bar was
   * READ is weaker than one a person NAMED, and a thread-tier line may only describe the
   * artifact it found.
   */
  bySource: { named: string[]; read: string[] };
  /** Files in the thread nothing could attribute: no platform named and no URL read. */
  unattributed: number;
  /** Every file in the thread, which is the number the very first gate counted. */
  files: number;
}

/**
 * Which PLATFORMS have a screenshot filed against this step, as opposed to how many FILES are
 * in its thread.
 *
 * ‼️ COUNTING FILES WAS THE ORIGINAL BUG AND IT STAYS FIXED. Every pasted Slack screenshot is
 * called image.png, so four shots of Yelp must never satisfy a four-platform gate. Attribution
 * comes from the platform named in the message (resolvePlatformsFromText) or, failing that,
 * from the URL read off the address bar (attributeFromScreenshot), and lands on
 * client_docs.presence_platform either way.
 *
 * Reads slack_thread_ts against the ANCHOR ts for the reason uploadsFor documents above: Slack
 * threads are one level deep, so a reply "to the card" carries the ts of what the card was
 * replying to, and comparing against slack_message_ts matches nothing, ever.
 *
 * Returns null when the query itself failed, so a caller can say "could not check" rather than
 * reporting somebody's finished work as missing.
 */
export async function presenceCoverageFor(
  clientId: string,
  stepKey: string
): Promise<PresenceCoverage | null> {
  const empty: PresenceCoverage = {
    covered: [],
    distinct: 0,
    needed: SWEEP_GATE_COUNT,
    short: SWEEP_GATE_COUNT,
    byTier: { core: [], extended: [] },
    bySource: { named: [], read: [] },
    unattributed: 0,
    files: 0,
  };

  const { data: row } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("slack_anchor_ts")
    .eq("client_id", clientId)
    .eq("step_key", stepKey)
    .maybeSingle();

  const ts = (row?.slack_anchor_ts as string | null) ?? null;
  if (!ts) return empty;

  const { data, error } = await supabaseAdmin
    .from("client_docs")
    .select("presence_platform, presence_attributed_by")
    .eq("client_id", clientId)
    .eq("slack_thread_ts", ts);

  if (error) {
    console.error("[step-engine] presence coverage query failed:", error.message);
    return null;
  }

  const rows = data ?? [];
  const seen = new Set<string>();
  const readKeys = new Set<string>();

  for (const r of rows) {
    const key = (r.presence_platform as string | null) ?? "";
    if (!key) continue;
    seen.add(key);
    // ‼️ A NULL presence_attributed_by IS A MESSAGE-TEXT ATTRIBUTION, not an unknown one, and
    // that is a fact about the history rather than a guess: until the screenshot reader shipped,
    // the text path was the ONLY writer of presence_platform. The thirteen rows already on the
    // live client predate the column being filled in.
    if ((r.presence_attributed_by as string | null) === "screenshot_url") readKeys.add(key);
  }

  const covered = ALL_PLATFORMS.filter((p) => seen.has(p.key)).map((p) => p.key);
  const distinct = covered.length;

  return {
    covered,
    distinct,
    needed: SWEEP_GATE_COUNT,
    short: Math.max(0, SWEEP_GATE_COUNT - distinct),
    byTier: {
      core: covered.filter((k) => platformByKey(k)?.tier === "core_six"),
      extended: covered.filter((k) => platformByKey(k)?.tier === "extended"),
    },
    bySource: {
      named: covered.filter((k) => !readKeys.has(k)),
      read: covered.filter((k) => readKeys.has(k)),
    },
    unattributed: rows.filter((r) => !r.presence_platform).length,
    files: rows.length,
  };
}

/**
 * The two tiers of evidence, written out for a card or a verdict.
 *
 * "Google Business Profile, Yelp (named in the message); Trustpilot, BBB (read off the address
 * bar in the screenshot)". Returns an empty string when nothing is filed, so a caller can
 * concatenate it without testing.
 */
export function describeCoverage(cover: PresenceCoverage): string {
  const label = (k: string) => platformByKey(k)?.label ?? k;
  const parts: string[] = [];
  if (cover.bySource.named.length) {
    parts.push(`${cover.bySource.named.map(label).join(", ")} (named in the message)`);
  }
  if (cover.bySource.read.length) {
    parts.push(
      `${cover.bySource.read.map(label).join(", ")} (read off the address bar in the screenshot)`
    );
  }
  return parts.join("; ");
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
/**
 * Read the address bar on every screenshot in the sweep thread that nothing has attributed.
 *
 * ‼️ TEXT FIRST, VISION ONLY ON A MISS. `.is("presence_platform", null)` inside
 * attributeUnreadScreenshots is what makes that true: a file whose message named a platform is
 * never looked at, so the common case costs nothing and a person's word is never overridden by
 * a model's reading.
 *
 * ‼️ IT RUNS FROM A DELIBERATE ACT, NEVER ON A TIMER. captureOnboardingUploads calls it when
 * screenshots land, and stepPrecondition calls it on [Done] and on [Re-check], which are the
 * two moments somebody is asking whether this step is finished. Nineteen platforms is nineteen
 * model calls if this ever fires unconditionally.
 *
 * Failures are swallowed into the thread note. A screenshot that could not be read leaves the
 * step exactly where it was, which is where it already was.
 */
async function readUnattributedSweepShots(clientId: string, stepKey: string): Promise<void> {
  const { data: row } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("slack_anchor_ts")
    .eq("client_id", clientId)
    .eq("step_key", stepKey)
    .maybeSingle();

  const ts = (row?.slack_anchor_ts as string | null) ?? null;
  if (!ts) return;

  const { attributeUnreadScreenshots, formatAttributionNote } = await import("./onboarding-docs");
  const results = await attributeUnreadScreenshots({ clientId, threadTs: ts });
  if (!results.length) return;

  const note = formatAttributionNote(results);
  if (!note) return;

  await notifyStep(clientId, stepKey, note).catch((e) =>
    console.error("[step-engine] attribution note failed:", (e as Error).message)
  );
}


export async function stepPrecondition(clientId: string, stepKey: string): Promise<Precondition> {
  const step = stepByKey(stepKey);
  if (!step) return { ok: true };

  if (step.key === "presence_sweep_manual") {
    // Before deciding, look at the pictures nobody named. Matthew screenshots from Chrome with
    // the address bar in shot, so on the live client five of eighteen files carry a URL that
    // says which platform they are while the message says nothing.
    await readUnattributedSweepShots(clientId, stepKey);

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

  // ‼️ [Done] WANTS THE RESEARCH BACK, AND [Skip] IS UNTOUCHED.
  //
  // Matthew: "If I click done I should paste back the PDF that It gave me for the deep research,
  // not just allow me to skip it since we need this phrases for the in depth ai visibility audit
  // (day 0 official run) with more strategic questions, but leave it skippable since we already
  // have the main 20 but if client doesnt like them we can re run them."
  //
  // So this refuses [Done] and says what is missing; it does not refuse the step. Skip still
  // works and the refusal states its cost rather than hiding it: the universal twenty still run,
  // so the Day-0 measurement is intact, but the tracked set will not carry this avatar's own
  // wording.
  //
  // TWO WAYS TO SATISFY IT, because there are two ways the answer arrives: a `research:` paste
  // and a PDF dropped in the thread both end in question_bank under this avatar, and a document
  // filed against the step counts on its own for the case where the phrases came back thin.
  if (step.key === "avatar_harvest") {
    const { confirmedAvatarFor } = await import("./avatars");
    const { verticalFor } = await import("./harvest");

    const avatar = await confirmedAvatarFor(clientId);
    const resolved = await verticalFor(clientId);

    if (avatar && resolved.ok) {
      const { count } = await supabaseAdmin
        .from("question_bank")
        .select("id", { count: "exact", head: true })
        .eq("vertical", resolved.vertical)
        .eq("avatar", avatar.slug)
        .eq("source", "deep_research");

      const filed = await uploadsFor(clientId, stepKey);

      if ((count ?? 0) === 0 && filed === 0) {
        return {
          ok: false,
          message:
            `Not yet — nothing has come back from the deep research for *${avatar.label}*. ` +
            "The research runs itself on this step, so an empty question bank means the run " +
            "failed rather than that it is waiting on you: check the thread above for what it " +
            "said. Re-running the step retries it. You can also bring the answer in by hand — " +
            "paste it with `research:` in front of it, or drop a PDF straight into this thread. " +
            "If you genuinely do not want it, [Skip] still works: the universal twenty " +
            "still run so the Day-0 measurement is intact, but the tracked question set will " +
            "not carry this avatar's own wording, which is the half a client recognises as " +
            "their own market talking.",
        };
      }
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
