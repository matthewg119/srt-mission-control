// What makes a Launch Lane checkmark mean something.
//
// ‼️ A STEP IS NOT DONE BECAUSE A BUTTON WAS PRESSED. Every step here answers "what would I look
// at to know this happened", and the answer is written down per step, in code. Same doctrine as
// the Slack lane's step-verify.ts, restated rather than imported, because this lane has no
// threads and half the evidence lives somewhere else.
//
// TWO HONEST TIERS AND NO THIRD:
//
//   system   the app observed real state — rows in a table, an HTTP 200 from the live domain.
//   filed    a person filed an artifact against the step (a screenshot, a note) and the app read
//            that artifact BACK.
//
// The Slack lane calls its second tier `thread` because its artifacts arrive in a Slack thread.
// Here they arrive against a step row, so the value is `filed` and the CHECK constraint in
// docs/2026-09-30-launch-lane.sql names exactly those two.
//
// ‼️ THE TIERS ARE NEVER INTERCHANGEABLE AND THE WORDING NEVER CROSSES OVER.
// A filed-tier line may only describe THE ARTIFACT IT FOUND, never the fact that artifact stands
// for. "a screenshot is filed against this step" is true; "we manage the Business Profile" is not
// something a screenshot proves. The same distinction day_0_source draws between photograph_2
// and manual_step.
//
// ‼️ THERE IS NO OVERRIDE. A step that cannot be confirmed is not ticked and is not worked
// around. A "mark done anyway" button would need a third verified_source value, which means a
// migration, which means reading this first.
//
// ‼️ NEVER CLAIM EVIDENCE THAT WAS NOT CHECKED. A verifier that cannot reach its evidence
// returns `broken`, never `ok`. An absent answer is reported as absent and never guessed.

import { supabaseAdmin } from "@/lib/db";
import { LAUNCH_STEPS, launchStepNumber, type LaunchStepKey } from "@/config/launch-steps";
import { readDay0 } from "@/lib/clients/day-zero";
import { faultsInStoredIntake } from "@/lib/validate/intake-fields";

// ─────────────────────────────────────────────────────────────────────────────
// The verdict
// ─────────────────────────────────────────────────────────────────────────────

export type LaunchVerdict =
  | { ok: true; kind: "system"; evidence: string[] }
  | { ok: true; kind: "filed"; evidence: string[] }
  /** The work has not happened yet. Nothing is broken; there is something to do. */
  | { ok: false; kind: "not_yet"; checked: string; found: string; todo: string }
  /** The evidence PATH is faulty. Not work owed — a bug, with somewhere to send it. */
  | { ok: false; kind: "broken"; checked: string; found: string; fix: string };

const verified = (...evidence: string[]): LaunchVerdict => ({ ok: true, kind: "system", evidence });
const filedOk = (...evidence: string[]): LaunchVerdict => ({ ok: true, kind: "filed", evidence });
const notYet = (checked: string, found: string, todo: string): LaunchVerdict => ({
  ok: false,
  kind: "not_yet",
  checked,
  found,
  todo,
});
const broken = (checked: string, found: string, fix: string): LaunchVerdict => ({
  ok: false,
  kind: "broken",
  checked,
  found,
  fix,
});

export interface LaunchVerifyCtx {
  clientId: string;
  stepKey: LaunchStepKey;
  row: {
    status: string;
    output_ref: string | null;
    error_detail: string | null;
    note: string | null;
    started_at: string | null;
  };
  client: Record<string, unknown>;
}

type LaunchVerifier = (ctx: LaunchVerifyCtx) => Promise<LaunchVerdict>;

const dbUnreachable = (table: string): LaunchVerdict =>
  broken(
    `the ${table} rows for this client`,
    "the database could not be read",
    `Check the Supabase connection and that ${table} exists in this environment. ` +
      "If the table is missing, docs/2026-09-30-launch-lane.sql has not been run here."
  );

// ─────────────────────────────────────────────────────────────────────────────
// Shared probes
// ─────────────────────────────────────────────────────────────────────────────

interface CountFilter {
  col: string;
  eq?: string | boolean;
  notNull?: boolean;
  isNull?: boolean;
  in?: string[];
}

/** Rows for this client matching optional filters, or null when the read itself failed. */
async function countRows(
  table: string,
  clientId: string,
  filters: CountFilter[] = []
): Promise<number | null> {
  let q = supabaseAdmin.from(table).select("id", { count: "exact", head: true }).eq("client_id", clientId);

  for (const f of filters) {
    if (f.notNull) q = q.not(f.col, "is", null);
    else if (f.isNull) q = q.is(f.col, null);
    else if (f.in) q = q.in(f.col, f.in);
    else if (f.eq !== undefined) q = q.eq(f.col, f.eq);
  }

  const { count, error } = await q;
  // ‼️ NULL IS "COULD NOT READ", ZERO IS "NOTHING THERE". Collapsing them is how a database
  // outage renders as honest missing work and a step refuses forever for the wrong reason.
  if (error) return null;
  return count ?? 0;
}

/**
 * Artifacts a person filed against this step.
 *
 * `client_docs.delivery_step_key` is free text and shared by both lanes, so a launch step key
 * files exactly the way a delivery step key does and every existing reader keeps working.
 *
 * ‼️ ORDER BY uploaded_at, NEVER created_at. client_docs HAS NO created_at COLUMN, and one
 * unknown column fails the whole PostgREST select while supabase-js RETURNS the error rather
 * than throwing — which is how a whole feature silently no-op'd here once before.
 */
async function filedArtifacts(
  clientId: string,
  stepKey: string
): Promise<{ filename: string; uploadedAt: string | null }[] | null> {
  const { data, error } = await supabaseAdmin
    .from("client_docs")
    .select("filename, uploaded_at")
    .eq("client_id", clientId)
    .eq("delivery_step_key", stepKey)
    .order("uploaded_at", { ascending: false });

  if (error) return null;
  return (data ?? []).map((r) => ({
    filename: (r.filename as string) ?? "(unnamed)",
    uploadedAt: (r.uploaded_at as string | null) ?? null,
  }));
}

const artifactRefusal = (stepKey: string, what: string, todo: string) =>
  notYet(`artifacts filed against ${stepKey}`, what, todo);

/** The client's public-facing name, for the checks that look for it on a live page. */
function clientName(client: Record<string, unknown>): string {
  return (
    ((client.dba_name as string | null) || (client.legal_name as string | null) || "").trim() || ""
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The verifiers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ‼️ `Record<LaunchStepKey, LaunchVerifier>` IS A COMPILE-TIME PROOF OF COVERAGE.
 * A 17th step in launch-steps.ts breaks the build here until somebody says what evidence
 * confirms it. A step with no verifier could never be ticked, so the failure would otherwise be
 * a step that silently refuses forever and is discovered on a live client.
 */
export const LAUNCH_VERIFIERS: Record<LaunchStepKey, LaunchVerifier> = {
  // ── SET UP ─────────────────────────────────────────────────────────────────

  launch_intake: async (ctx) => {
    const c = ctx.client;
    const missing: string[] = [];
    if (!clientName(c)) missing.push("business name");
    if (!(c.city as string | null)?.trim()) missing.push("city");
    if (!(c.state as string | null)?.trim()) missing.push("state");
    if (!(c.phone as string | null)?.trim()) missing.push("phone");

    // ‼️ THE NICHE IS REQUIRED HERE AND NOWHERE ELSE CAN SUPPLY IT.
    // In the Slack lane clients.vertical_slug is written by the baseline scan OF THEIR WEBSITE
    // (adoptAuditClassification). This lane's clients have no website, so nothing downstream can
    // infer it — and verticalFor() refuses outright on an empty value, because a harvest filed
    // under a guessed vertical poisons the shared question_bank for every real client in it and
    // question_bank has no client_id to unpick it by.
    const vertical = ((c.vertical_slug as string | null) || (c.business_type as string | null) || "").trim();
    if (!vertical) missing.push("what this business actually is (the niche)");

    if (missing.length) {
      return notYet(
        "the client record",
        `missing: ${missing.join(", ")}`,
        "Fill these in on the intake panel. The niche is not optional in this lane: there is no " +
          "website for a scan to classify, so nothing downstream can work it out later."
      );
    }

    // ‼️ PRESENT IS NOT THE SAME AS VALID, AND THIS STEP ONCE WENT GREEN OVER `777777777`.
    // Checking only for a non-empty string confirmed an intake whose city and state were key
    // mashing, and that row is the NAP every directory is later made to match and the JSON-LD on
    // every published page. The same module the form and the route use is re-run here, against
    // what is actually STORED, so a row written before that module existed cannot be ticked
    // either.
    const faults = faultsInStoredIntake(c);
    if (faults.length) {
      return notYet(
        "the shape of what is stored on the client record",
        faults.join("; "),
        "Correct these before ticking. They become the NAP every directory is matched to and the " +
          "structured data on every page, so a wrong value here is wrong in a lot of places later."
      );
    }
    return verified(
      `${clientName(c)} in ${c.city as string}, ${c.state as string}`,
      `niche recorded as "${vertical}"`
    );
  },

  documents_uploaded: async (ctx) => {
    // The four that matter. `sales_letter` and `awareness_ladder` are real kinds but are not
    // part of the foundation set, so their absence is not a refusal.
    const REQUIRED = ["deep_research", "avatar_sheet", "short_offer", "necessary_beliefs"];

    const { data, error } = await supabaseAdmin
      .from("audience_documents")
      .select("kind")
      .eq("client_id", ctx.clientId)
      .is("superseded_at", null);

    if (error) return dbUnreachable("audience_documents");

    const present = new Set((data ?? []).map((r) => r.kind as string));
    const missing = REQUIRED.filter((k) => !present.has(k));

    if (missing.length) {
      return notYet(
        "the four foundation documents on this client",
        present.size === 0
          ? "none uploaded yet"
          : `${present.size} uploaded, missing ${missing.join(", ")}`,
        "Upload the missing documents on this step. They are also what every page this client " +
          "publishes will cite, so a gap here is a gap in every page later."
      );
    }
    return verified(`all four foundation documents are live: ${REQUIRED.join(", ")}`);
  },

  audience_confirmed: async (ctx) => {
    const { data, error } = await supabaseAdmin
      .from("client_audiences")
      .select(
        "label, slug, confirmed_at, vocabulary_source, buyer_noun_singular, offer_noun_singular, business_noun, visit_noun"
      )
      .eq("client_id", ctx.clientId)
      .eq("is_primary", true)
      .maybeSingle();

    if (error) return dbUnreachable("client_audiences");
    if (!data) {
      return notYet(
        "the primary audience row for this client",
        "no audience exists yet",
        "Run the proposal on this step, then confirm it. Nothing downstream knows what to call " +
          "this business's buyer until an audience row says so."
      );
    }
    if (!data.confirmed_at) {
      return notYet(
        "the primary audience row",
        `"${data.label as string}" is proposed but not confirmed`,
        "Read the proposed words and confirm them. They go out under the client's name on their " +
          "own domain, so a person signs off once."
      );
    }

    const nouns = ["buyer_noun_singular", "offer_noun_singular", "business_noun", "visit_noun"] as const;
    const blank = nouns.filter((n) => !((data[n] as string | null) ?? "").trim());
    if (blank.length) {
      return notYet(
        "the vocabulary on the confirmed audience",
        `confirmed, but ${blank.join(", ")} ${blank.length === 1 ? "is" : "are"} empty`,
        "Fill the missing words in. The concierge interpolates these into every sentence it " +
          "speaks, and an empty one reads as a gap in the middle of a reply."
      );
    }

    return verified(
      `audience "${data.label as string}" confirmed`,
      `it calls them a ${data.buyer_noun_singular as string}, sells a ${data.offer_noun_singular as string}, ` +
        `from a ${data.business_noun as string}, booking a ${data.visit_noun as string}`,
      `vocabulary source: ${(data.vocabulary_source as string | null) ?? "unrecorded"}`
    );
  },

  offer_confirmed: async (ctx) => {
    const { data, error } = await supabaseAdmin
      .from("client_offers")
      .select("treatment, outcome_promise, locked_at, is_primary")
      .eq("client_id", ctx.clientId)
      .eq("is_primary", true)
      .maybeSingle();

    if (error) return dbUnreachable("client_offers");
    if (!data) {
      return notYet(
        "the primary offer row",
        "no offer exists yet",
        "Read the short offer document on this step and confirm what it says. The offer is what " +
          "the keywords and every page are built around."
      );
    }
    if (!data.locked_at) {
      return notYet(
        "the primary offer row",
        `"${(data.treatment as string | null) ?? "untitled"}" is proposed but not locked`,
        "Confirm the offer so the keyword and page steps have something stable to build on."
      );
    }
    return verified(
      `offer locked: ${(data.treatment as string | null) ?? "(unnamed)"}`,
      (data.outcome_promise as string | null)
        ? `promise: ${(data.outcome_promise as string).slice(0, 100)}`
        : "no outcome promise recorded"
    );
  },

  domain_bought: async (ctx) => {
    const { data: order, error: orderErr } = await supabaseAdmin
      .from("client_domain_orders")
      .select("domain, status, vercel_error, charged_price_cents")
      .eq("client_id", ctx.clientId)
      .order("requested_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (orderErr) return dbUnreachable("client_domain_orders");
    if (!order) {
      return notYet(
        "a domain order for this client",
        "no domain has been searched or bought yet",
        "Search for a domain on this step and buy the one you want. SRT holds it, so there is no " +
          "client DNS work afterwards."
      );
    }
    if (order.status === "failed") {
      return broken(
        "the most recent domain order",
        `the purchase of ${order.domain as string} failed: ${(order.vercel_error as string | null) ?? "no reason recorded"}`,
        "Check HUB_VERCEL_TOKEN has registrar scope and that the team has a payment method, then " +
          "retry the purchase. Do not buy by hand without recording a row: the ledger is what " +
          "stops a double charge."
      );
    }
    if (order.status !== "bought") {
      return notYet(
        "the most recent domain order",
        `${order.domain as string} is still "${order.status as string}"`,
        "The purchase was requested but has not come back as bought. Re-check before retrying: a " +
          "purchase that succeeded at Vercel and failed to return would be charged twice."
      );
    }

    // ‼️ BOUGHT IS NOT THE SAME AS ATTACHED, AND ONLY ONE OF THEM SERVES A PAGE.
    const { data: host, error: hostErr } = await supabaseAdmin
      .from("client_hosts")
      .select("host, enabled, vercel_attached_at")
      .eq("client_id", ctx.clientId)
      .eq("kind", "site")
      .maybeSingle();

    if (hostErr) return dbUnreachable("client_hosts");
    if (!host || !host.vercel_attached_at) {
      return notYet(
        "the site host row",
        `${order.domain as string} was bought, but it is not attached to the project yet`,
        "Re-run the attach on this step. The purchase is done and will not be repeated."
      );
    }

    return verified(
      `${order.domain as string} bought and attached as ${host.host as string}`,
      order.charged_price_cents
        ? `charged ${((order.charged_price_cents as number) / 100).toFixed(2)} USD`
        : "no charge recorded on the order"
    );
  },

  // ── BUILD ──────────────────────────────────────────────────────────────────

  day_zero_archive: async (ctx) => {
    // ‼️ THIS MUST NOT CHECK clients.day_0_archived_at ON THE WAY IN, AND AN EARLIER VERSION DID.
    //
    // That column is written by stampDay0(), which setLaunchStep calls AFTER the verifier passes.
    // A verifier that required the stamp therefore required the consequence of its own success:
    // it refused, so the stamp never happened, so it refused again. The step could never be
    // ticked by anybody, and the Day-0 wall would have held publishing shut forever with no way
    // through that was not a manual database write.
    //
    // The Slack lane's verifier for this same key gets it right and this mirrors it: look for
    // EVIDENCE the archive was taken, and let the stamp follow. An existing stamp is accepted
    // too, so a re-tick after a waiver or a Slack-lane stamp does not refuse.
    const { day0PhotographFor } = await import("@/lib/clients/photograph");
    const taken = await day0PhotographFor(ctx.clientId).catch(() => null);

    if (taken && taken.answered > 0) {
      return verified(
        `Day-0 is archived: ${taken.questions} tracked questions, ${taken.answered} answered, taken ${taken.takenAt.slice(0, 10)}`,
        "The day 30, 60 and 90 re-tests re-ask exactly those questions, off the archived run"
      );
    }

    const state = await readDay0(ctx.clientId);
    if (state?.archivedAt) {
      return verified(
        `the wall is already open, stamped ${state.archivedAt.slice(0, 10)}`,
        `source: ${state.source ?? "unrecorded"}`,
        ...(state.waivedReason ? [`waived: ${state.waivedReason}`] : [])
      );
    }

    const artifacts = await filedArtifacts(ctx.clientId, ctx.stepKey);
    if (artifacts === null) return dbUnreachable("client_docs");
    if (artifacts.length === 0) {
      return artifactRefusal(
        ctx.stepKey,
        "no archive run exists and nothing is filed against this step",
        "File the archived Day-0 scan against this step before ticking. This is the baseline every " +
          "later number is measured against, and once a page is live it cannot be recovered by " +
          "being careful afterwards. Ticking here stamps day_0_source as manual_step, which is an " +
          "assertion that the archive happened and is never a photograph."
      );
    }

    // Filed tier: it describes the ARTIFACT, never the fact the artifact stands for.
    return filedOk(
      `${artifacts.length} artifact(s) filed against this step`,
      `most recent: ${artifacts[0].filename}`
    );
  },

  site_pasted: async (ctx) => {
    const total = await countRows("client_site_pages", ctx.clientId, [
      { col: "status", eq: "published" },
    ]);
    if (total === null) return dbUnreachable("client_site_pages");
    if (total === 0) {
      return notYet(
        "published rows in client_site_pages",
        "no site pages have been pasted yet",
        "Paste the built HTML page by page on this step. Scripts and event handlers are stripped " +
          "on the way in and what was removed is recorded."
      );
    }

    // A site with no home page is a domain that 404s at its own root.
    const { data: home, error } = await supabaseAdmin
      .from("client_site_pages")
      .select("path")
      .eq("client_id", ctx.clientId)
      .eq("path", "/")
      .eq("status", "published")
      .maybeSingle();

    if (error) return dbUnreachable("client_site_pages");
    if (!home) {
      return notYet(
        "a published home page at /",
        `${total} page(s) published, but none of them is the home page`,
        "Paste the home page. Without it the domain answers 404 at its own root."
      );
    }
    return verified(`${total} site page(s) published, including the home page`);
  },

  site_live: async (ctx) => {
    const { data: host, error } = await supabaseAdmin
      .from("client_hosts")
      .select("host, enabled")
      .eq("client_id", ctx.clientId)
      .eq("kind", "site")
      .maybeSingle();

    if (error) return dbUnreachable("client_hosts");
    if (!host) {
      return notYet(
        "the site host row",
        "no domain is attached for this client",
        "Finish the domain step first."
      );
    }
    if (host.enabled === false) {
      return notYet(
        "the site host row",
        `${host.host as string} is attached but disabled`,
        "Re-enable the host. A disabled row stops serving without deleting the attachment record."
      );
    }

    // ‼️ A REAL REQUEST, NOT A ROW. This is the one step whose whole claim is "a stranger can
    // load this", and only a fetch can say so. Everything else here reads the database.
    const url = `https://${host.host as string}/`;
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "follow",
        headers: { "user-agent": "SRT-LaunchLane/1.0 (+site_live check)" },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      return notYet(
        `an HTTPS request to ${url}`,
        `the request failed: ${(e as Error).message}`,
        "DNS or the certificate may still be settling. Vercel-registered domains are usually " +
          "immediate, so if this persists check the domain is attached to the right project."
      );
    }

    if (!res.ok) {
      return notYet(
        `an HTTPS request to ${url}`,
        `it answered ${res.status}`,
        res.status === 404
          ? "A 404 here usually means the host row exists but no home page is published. Check the previous step."
          : "Check the deployment is healthy and the domain is attached to this project."
      );
    }

    const body = await res.text().catch(() => "");
    const name = clientName(ctx.client);
    if (name && !body.toLowerCase().includes(name.toLowerCase())) {
      // ‼️ 200 IS NOT ENOUGH ON A MULTI-TENANT DEPLOYMENT. Every hostname on this project
      // answers 200 for something. Without this check the step would go green while the domain
      // served another client's page, or our own not-found body.
      return notYet(
        `the body of ${url}`,
        `it answered 200, but "${name}" does not appear anywhere in the page`,
        "The domain is serving something, but not this client's site. Check the client_hosts row " +
          "points at the right client."
      );
    }

    return verified(`${url} answered ${res.status}`, `the page names ${name || "the client"}`);
  },

  concierge_live: async (ctx) => {
    const { data, error } = await supabaseAdmin
      .from("concierge_configs")
      .select("enabled, audience, audience_id, audience_confirmed_at, booking_mode, booking_url, booking_phone")
      .eq("client_id", ctx.clientId)
      .maybeSingle();

    if (error) {
      return /relation|does not exist|schema cache/i.test(error.message)
        ? broken(
            "the concierge_configs row",
            `the table could not be read: ${error.message}`,
            "docs/2026-09-01-concierge.sql has not been run against this database."
          )
        : dbUnreachable("concierge_configs");
    }
    if (!data) {
      return notYet(
        "the concierge_configs row",
        "no row exists for this client",
        "Provision the concierge on this step: it creates the row and points it at the confirmed audience."
      );
    }

    // ‼️ THE AUDIENCE IS CHECKED BEFORE `enabled`, AND THE ORDER IS THE POINT. This is the step
    // that puts the widget in front of real visitors. Without audience_id, loadConciergeConfig()
    // refuses to serve at all rather than guessing — and guessing is how a taco shop got offered
    // a skin report in its own voice on its own domain.
    if (!data.audience_id) {
      return notYet(
        "the audience on the concierge row",
        "the widget is not pointed at this client's audience",
        "Point it at the confirmed audience. Without it the widget refuses to serve, because it " +
          "does not know what to call the buyer."
      );
    }
    if (!data.audience_confirmed_at) {
      return notYet(
        "the audience on the concierge row",
        "an audience is set but nobody has confirmed it",
        "Confirm the audience. It decides which magnets resolve and how the widget speaks."
      );
    }

    const mode = (data.booking_mode as string | null) ?? "none";
    const hasDestination =
      (mode === "link" && !!(data.booking_url as string | null)) ||
      (mode === "calendly" && !!(data.booking_url as string | null)) ||
      !!(data.booking_phone as string | null);
    if (!hasDestination) {
      return notYet(
        "the booking destination on the concierge row",
        `booking_mode is "${mode}" with nothing to send anybody to`,
        "Set a booking link or a phone number. A concierge that gets somebody ready to book and " +
          "then has nowhere to send them is worse than no widget."
      );
    }

    if (data.enabled !== true) {
      return notYet(
        "the enabled flag on the concierge row",
        "everything is configured but the widget is switched off",
        "Switch it on. Turning it on is the last thing in this step, on purpose."
      );
    }

    return verified(
      "the concierge is enabled against a confirmed audience",
      `booking via ${mode}${data.booking_phone ? " with a phone fallback" : ""}`
    );
  },

  keyword_set: async (ctx) => {
    const approved = await countRows("client_keywords", ctx.clientId, [
      { col: "approved", eq: true },
      { col: "dropped_at", isNull: true },
    ]);
    if (approved === null) return dbUnreachable("client_keywords");
    if (approved === 0) {
      return notYet(
        "approved rows in client_keywords",
        "no keywords are approved yet",
        "Build the set from the documents on this step, then approve the ones worth writing for."
      );
    }
    return verified(`${approved} approved keyword(s) for this client`);
  },

  pages_drafted: async (ctx) => {
    const total = await countRows("client_pages", ctx.clientId);
    if (total === null) return dbUnreachable("client_pages");
    if (total === 0) {
      return notYet(
        "rows in client_pages",
        "no pages have been drafted yet",
        "Draft the first pages on this step. They are written against the client library the four " +
          "documents filled, so every claim has a first-party source behind it."
      );
    }
    return verified(`${total} page(s) drafted for this client`);
  },

  pages_published: async (ctx) => {
    const published = await countRows("client_pages", ctx.clientId, [
      { col: "status", eq: "published" },
    ]);
    if (published === null) return dbUnreachable("client_pages");
    if (published === 0) {
      return notYet(
        "published rows in client_pages",
        "nothing is published yet",
        "Publish through the page panel. It goes through publishPage(), so the Day-0 wall and the " +
          "quality gate both still apply."
      );
    }
    return verified(`${published} page(s) published and serving under /answers`);
  },

  // ── LIVE ───────────────────────────────────────────────────────────────────

  gbp_access: async (ctx) => {
    const artifacts = await filedArtifacts(ctx.clientId, ctx.stepKey);
    if (artifacts === null) return dbUnreachable("client_docs");
    if (artifacts.length === 0) {
      return artifactRefusal(
        ctx.stepKey,
        "nothing filed against this step yet",
        "File a screenshot showing SRT as a manager on the Business Profile. There is no Google " +
          "Business Profile API keyed here, so a screenshot is the only evidence available. " +
          "If no profile exists yet, the owner has to create it and pass Google's own " +
          "verification first: that part cannot be done for them."
      );
    }
    // Filed tier: describe the ARTIFACT, never the fact it stands for.
    return filedOk(
      `${artifacts.length} artifact(s) filed against this step`,
      `most recent: ${artifacts[0].filename}`
    );
  },

  gbp_buildout: async (ctx) => {
    const artifacts = await filedArtifacts(ctx.clientId, ctx.stepKey);
    if (artifacts === null) return dbUnreachable("client_docs");
    if (artifacts.length === 0) {
      return artifactRefusal(
        ctx.stepKey,
        "nothing filed against this step yet",
        "File a screenshot of the finished profile: categories, services, photos and seeded Q&A. " +
          "There is no Business Profile API here, so the screenshot is the evidence."
      );
    }
    return filedOk(
      `${artifacts.length} artifact(s) filed against this step`,
      `most recent: ${artifacts[0].filename}`
    );
  },

  reviews_live: async (ctx) => {
    const { data: host, error } = await supabaseAdmin
      .from("client_hosts")
      .select("host, enabled, vercel_attached_at")
      .eq("client_id", ctx.clientId)
      .eq("kind", "reviews")
      .maybeSingle();

    if (error) return dbUnreachable("client_hosts");
    if (!host || !host.vercel_attached_at) {
      return notYet(
        "the reviews host row",
        "the review surface is not attached yet",
        "Attach the reviews hostname for this client so the referral engine has somewhere to live."
      );
    }

    const artifacts = await filedArtifacts(ctx.clientId, ctx.stepKey);
    if (artifacts === null) return dbUnreachable("client_docs");
    if (artifacts.length === 0) {
      return artifactRefusal(
        ctx.stepKey,
        `${host.host as string} is attached, but nothing is filed to say the cards were handed over`,
        "File a photo of the printed cards with the client. The hostname is something we can " +
          "observe; the handover is not."
      );
    }
    // ‼️ MIXED EVIDENCE RESOLVES TO THE WEAKER TIER. Half of this was observed and half was
    // filed, and a verdict may never claim the stronger of the two.
    return filedOk(
      `${host.host as string} is attached`,
      `${artifacts.length} artifact(s) filed against this step, most recent: ${artifacts[0].filename}`
    );
  },

  day_30_date: async (ctx) => {
    // The Slack lane reads a date out of a thread reply. There is no thread here, so the date is
    // typed against the step and stored on the row.
    const written = (ctx.row.output_ref ?? ctx.row.note ?? "").trim();
    if (!written) {
      return notYet(
        "a day-30 date recorded against this step",
        "nothing recorded yet",
        "Record the date the day-30 report is due. It counts from the Day-0 stamp, and this is " +
          "the human record of what was promised."
      );
    }
    const parsed = Date.parse(written);
    if (Number.isNaN(parsed)) {
      return notYet(
        "a day-30 date recorded against this step",
        `"${written.slice(0, 60)}" is recorded, but it is not a date anything can read`,
        "Record it as a real date, for example 2026-10-30."
      );
    }
    return filedOk(`a date is recorded against this step: ${new Date(parsed).toISOString().slice(0, 10)}`);
  },

  hear_about_us: async (ctx) => {
    const artifacts = await filedArtifacts(ctx.clientId, ctx.stepKey);
    if (artifacts === null) return dbUnreachable("client_docs");
    if (artifacts.length === 0) {
      return artifactRefusal(
        ctx.stepKey,
        "nothing filed against this step yet",
        'File a screenshot of the "How did you hear about us?" field live on THEIR OWN site or ' +
          "booking form. Not our pages and not a subdomain we serve: we can add a field to a " +
          "surface we control in an afternoon, so a screenshot of one proves only the easy half. " +
          "Until this is real, the Day-30 report can say traffic moved and can never say where a " +
          "customer came from."
      );
    }
    // ‼️ FILED TIER, SO IT DESCRIBES THE ARTIFACT AND NEVER THE FACT.
    // Nothing here can see their site, so this must not say "the field is live". It says a file
    // was filed and what it was called, exactly as gbp_access does, and a person reading the
    // board knows the difference because the square is blue rather than green.
    return filedOk(
      `${artifacts.length} artifact(s) filed against this step`,
      `most recent: ${artifacts[0].filename}`
    );
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// The entry point
// ─────────────────────────────────────────────────────────────────────────────

export async function verifyLaunchStep(clientId: string, stepKey: string): Promise<LaunchVerdict> {
  const verifier = LAUNCH_VERIFIERS[stepKey as LaunchStepKey];
  if (!verifier) {
    return broken(
      "the verifier for this step",
      `no verifier is registered for "${stepKey}"`,
      "Add one to LAUNCH_VERIFIERS in src/lib/launch/verify.ts. The Record type should have " +
        "refused to compile without it, so this means a cast got past review."
    );
  }

  const { data: row, error: rowErr } = await supabaseAdmin
    .from("client_launch_steps")
    .select("status, output_ref, error_detail, note, started_at")
    .eq("client_id", clientId)
    .eq("step_key", stepKey)
    .maybeSingle();

  if (rowErr) return dbUnreachable("client_launch_steps");
  if (!row) {
    return broken(
      "the step row",
      "no row exists for this client and step",
      "Seed the lane with seedLaunchSteps() before working it."
    );
  }

  const { data: client, error: clientErr } = await supabaseAdmin
    .from("clients")
    .select("*")
    .eq("id", clientId)
    .maybeSingle();

  if (clientErr || !client) return dbUnreachable("clients");

  try {
    return await verifier({
      clientId,
      stepKey: stepKey as LaunchStepKey,
      row: row as LaunchVerifyCtx["row"],
      client: client as Record<string, unknown>,
    });
  } catch (e) {
    // ‼️ A THROWN VERIFIER IS `broken`, NEVER `not_yet`. "There is work to do" and "the check
    // itself fell over" are different sentences and only one of them is the person's problem.
    return broken(
      "the verifier for this step",
      `it threw: ${(e as Error).message}`,
      `Fix the verifier for "${stepKey}" in src/lib/launch/verify.ts. Re-checking will reproduce it.`
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Rendering a verdict
// ─────────────────────────────────────────────────────────────────────────────

/** The one-line proof stored on the row. Never says more than the tier allows. */
export function verdictDetail(v: LaunchVerdict): string {
  return v.ok ? v.evidence.join(" · ") : v.found;
}

/** What to show a person when a tick was refused. */
export function refusalText(v: LaunchVerdict): string {
  if (v.ok) return "";
  return v.kind === "broken"
    ? `Checked ${v.checked}. Found: ${v.found}\n\nFix: ${v.fix}`
    : `Checked ${v.checked}. Found: ${v.found}\n\nNext: ${v.todo}`;
}

/**
 * The mark a resolved step renders with.
 *
 * Kept as words rather than emoji because this lane draws to a web page, not to Slack. The two
 * tiers stay visibly different for the same reason they do there: a reader must be able to tell
 * "the app saw this" from "somebody filed something".
 */
export function verdictMark(source: string | null): "observed" | "filed" | "none" {
  if (source === "system") return "observed";
  if (source === "filed") return "filed";
  return "none";
}

/** Every step number and label, for a board header that does not hardcode a count. */
export function launchStepIndex(): { key: string; number: number; label: string }[] {
  return LAUNCH_STEPS.map((s) => ({
    key: s.key,
    number: launchStepNumber(s.key as LaunchStepKey),
    label: s.label,
  }));
}
