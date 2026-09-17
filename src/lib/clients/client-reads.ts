// Everything about one client, read in one place, for whoever is asking.
//
// Matthew, 2026-09-11: "to be able to pull any info I need from our current chatbot in Mission
// Control." The chatbot could not: measured that day, every tool it had read the CRM (contacts,
// lead_activities, lead_tasks, deals) and NOT ONE read `clients` or any client table. The
// read-only role behind query_database had no grant on them either, so there was no back door
// through SQL. The whole delivery side of this business was invisible to the assistant.
//
// ‼️ THESE READS ARE SHARED WITH THE WORKFLOWS ON PURPOSE. A workflow that writes a client's Google
// Business posts needs the offer, the plan, the keywords and the evidence; the chatbot answering
// "what is SRT's page plan" needs the same rows. Two readers would drift, and the drift would show
// up as a workflow quietly building on a different picture of the client than the one a person was
// just shown.
//
// ‼️ READ ONLY. Nothing in this file writes anything, and nothing here may start.

import { supabaseAdmin } from "@/lib/db";
import { DELIVERY_STEPS, stepNumber, type StepKey } from "@/config/delivery-steps";

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ClientRef {
  id: string;
  name: string;
  slug: string | null;
  domain: string | null;
}

export type ResolveResult =
  | { ok: true; client: ClientRef }
  /** More than one match. Named rather than guessed. */
  | { ok: false; candidates: ClientRef[]; error: string };

function toRef(row: Record<string, unknown>): ClientRef {
  return {
    id: row.id as string,
    name: ((row.dba_name as string | null) || (row.legal_name as string | null)) ?? "this client",
    slug: (row.slug as string | null) ?? null,
    domain: (row.domain as string | null) ?? null,
  };
}

const REF_COLUMNS = "id, legal_name, dba_name, slug, domain";

/**
 * Find a client by id, slug, domain or name.
 *
 * ‼️ TWO MATCHES IS THE SAME ANSWER AS ZERO, and the page studio already learned this the hard
 * way: guessing opens work against the wrong client's hub and the mistake only surfaces when
 * something is live on somebody's real domain. Both cases list what was found and refuse.
 *
 * ‼️ SLUG BEFORE NAME, ALWAYS. docs/lanes/CONTRACT.md: SRT has been re-onboarded twice, so every
 * id written down for it in this repo is dead and the slug is the durable claim.
 */
export async function resolveClient(ref: string): Promise<ResolveResult> {
  const query = (ref ?? "").trim();
  if (!query) return { ok: false, candidates: [], error: "no client was named" };

  if (UUID.test(query)) {
    const { data } = await supabaseAdmin.from("clients").select(REF_COLUMNS).eq("id", query).maybeSingle();
    if (data) return { ok: true, client: toRef(data) };
    return { ok: false, candidates: [], error: `no client with id ${query}` };
  }

  const bySlug = await supabaseAdmin.from("clients").select(REF_COLUMNS).eq("slug", query).maybeSingle();
  if (bySlug.data) return { ok: true, client: toRef(bySlug.data) };

  const like = `%${query}%`;
  const { data: found, error } = await supabaseAdmin
    .from("clients")
    .select(REF_COLUMNS)
    .or(`legal_name.ilike.${like},dba_name.ilike.${like},slug.ilike.${like},domain.ilike.${like}`)
    .limit(10);

  if (error) return { ok: false, candidates: [], error: `clients could not be read: ${error.message}` };

  const rows = (found ?? []).map(toRef);
  if (rows.length === 1) return { ok: true, client: rows[0] };
  if (rows.length === 0) return { ok: false, candidates: [], error: `no client matches "${query}"` };

  return {
    ok: false,
    candidates: rows,
    error: `"${query}" matches ${rows.length} clients. Name one by slug.`,
  };
}

export interface StepState {
  number: number;
  key: string;
  label: string;
  phase: string;
  status: string;
  completedAt: string | null;
  verifiedSource: string | null;
  errorDetail: string | null;
}

/**
 * The board, in board order, with the number a person sees on the card.
 *
 * Numbers come from stepNumber() and never from a stored value: a position is an array index, so
 * inserting a step renumbers everything after it, and a written-down number goes quietly wrong.
 */
export async function clientSteps(clientId: string): Promise<StepState[]> {
  const { data, error } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("step_key, status, completed_at, verified_source, error_detail")
    .eq("client_id", clientId);

  if (error) {
    console.error("[client-reads] steps could not be read:", error.message);
    return [];
  }

  const byKey = new Map((data ?? []).map((r) => [r.step_key as string, r]));

  return DELIVERY_STEPS.map((step) => {
    const row = byKey.get(step.key);
    return {
      // stepNumber() rather than the index, because that is the one definition of a step's
      // position and the rule is that any copy naming a number calls it. The cast is sound by
      // construction: this key came out of DELIVERY_STEPS, which is what StepKey is derived from.
      // DELIVERY_STEPS is exported as readonly DeliveryStep[], which widens `key` back to string.
      number: stepNumber(step.key as StepKey),
      key: step.key,
      label: step.label,
      phase: step.phase,
      status: (row?.status as string) ?? "pending",
      completedAt: (row?.completed_at as string | null) ?? null,
      verifiedSource: (row?.verified_source as string | null) ?? null,
      errorDetail: (row?.error_detail as string | null) ?? null,
    };
  });
}

export interface ClientProfile {
  client: ClientRef;
  legalName: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  vertical: string | null;
  businessType: string | null;
  tier: string | null;
  billingStatus: string | null;
  language: string | null;
  intakeCompletedAt: string | null;
  offer: {
    line: string;
    locked: boolean;
    treatment: string | null;
    proposedTreatment: string | null;
    positioning: string | null;
    terms: string[];
    anchorMagnet: string | null;
  };
  avatar: { label: string; slug: string | null; slot: string | null; confirmedAt: string | null } | null;
  day0: { archivedAt: string | null; source: string | null; waivedReason: string | null };
  /** What intake actually answered, by bag. Credentials are never included; see below. */
  intake: Record<string, unknown>;
  steps: { done: number; total: number; next: StepState | null; errored: StepState[] };
  boardUrl: string;
  planUrl: string;
}

export async function clientProfile(clientId: string): Promise<ClientProfile | { error: string }> {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select(
      "id, legal_name, dba_name, slug, domain, website, city, state, phone, email, language, " +
        "vertical_slug, business_type, tier_scope, billing_status, intake_completed_at, " +
        "services, ideal_patient, review_workflow, " +
        "day_0_archived_at, day_0_source, day_0_waived_reason"
    )
    .eq("id", clientId)
    .maybeSingle();

  if (error) return { error: `clients could not be read: ${error.message}` };
  if (!data) return { error: "client not found" };

  // ‼️ READ AS A PLAIN RECORD. The select list is wide enough that supabase-js gives up inferring a
  // row type and hands back GenericStringError, so every field access below would be a type error
  // on a query that works perfectly. call-sheet.ts hit the same wall and says the same thing.
  // Through `unknown`, because TypeScript refuses the direct conversion: GenericStringError and a
  // record do not overlap. step-verify.ts casts CLIENT_COLUMNS' result the same way, for the same
  // reason, and says so at the call site.
  const row = data as unknown as Record<string, unknown>;

  const { loadOffer, offerLine, isLocked } = await import("./offers");
  const { confirmedAvatarFor } = await import("./avatars");

  const [offer, avatar, steps] = await Promise.all([
    loadOffer(clientId),
    confirmedAvatarFor(clientId),
    clientSteps(clientId),
  ]);

  const done = steps.filter((s) => s.status === "complete" || s.status === "skipped").length;
  const next = steps.find((s) => s.status !== "complete" && s.status !== "skipped") ?? null;

  return {
    client: toRef(row),
    legalName: (row.legal_name as string | null) ?? null,
    city: (row.city as string | null) ?? null,
    state: (row.state as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    website: (row.website as string | null) ?? null,
    vertical: (row.vertical_slug as string | null) ?? null,
    businessType: (row.business_type as string | null) ?? null,
    tier: (row.tier_scope as string | null) ?? null,
    billingStatus: (row.billing_status as string | null) ?? null,
    language: (row.language as string | null) ?? null,
    intakeCompletedAt: (row.intake_completed_at as string | null) ?? null,
    offer: {
      line: offerLine(offer),
      locked: isLocked(offer),
      treatment: offer.treatment,
      proposedTreatment: offer.proposedTreatment,
      positioning: offer.positioning,
      terms: offer.terms,
      anchorMagnet: offer.magnetKey,
    },
    avatar: avatar
      ? { label: avatar.label, slug: avatar.slug ?? null, slot: avatar.slot ?? null, confirmedAt: avatar.confirmedAt ?? null }
      : null,
    day0: {
      archivedAt: (row.day_0_archived_at as string | null) ?? null,
      source: (row.day_0_source as string | null) ?? null,
      waivedReason: (row.day_0_waived_reason as string | null) ?? null,
    },
    // ‼️ access_inventory IS DELIBERATELY ABSENT. It is intake step 5, "who has the login", and it
    // carries a `credentials` key. Nothing about answering "what is this client's offer" needs it,
    // and a tool that returns it puts somebody's passwords into a chat transcript.
    intake: {
      services: row.services ?? {},
      ideal_patient: row.ideal_patient ?? {},
      review_workflow: row.review_workflow ?? {},
    },
    steps: {
      done,
      total: steps.length,
      next,
      errored: steps.filter((s) => s.status === "error"),
    },
    boardUrl: `${appUrl()}/dashboard/clients/${clientId}`,
    planUrl: `${appUrl()}/dashboard/clients/${clientId}/plan`,
  };
}

/** The approved keyword set, with the counts that say whether it is finished. */
export async function clientKeywords(args: {
  clientId: string;
  use?: "query" | "hook";
  approvedOnly?: boolean;
  category?: string | null;
  limit?: number;
}): Promise<
  | {
      total: number;
      approved: number;
      byCategory: Record<string, number>;
      rows: Array<{
        rank: number | null;
        phrase: string;
        category: string;
        use: string;
        origin: string;
        score: number;
        currentlyNamed: boolean | null;
        approved: boolean;
      }>;
    }
  | { error: string }
> {
  const { loadKeywords } = await import("./client-keywords");
  const loaded = await loadKeywords(args.clientId);
  if ("error" in loaded) return { error: loaded.error };

  const live = loaded.rows.filter((r) => !r.dropped);
  const use = args.use ?? "query";
  let rows = live.filter((r) => r.use === use);
  if (args.approvedOnly !== false) rows = rows.filter((r) => r.approved);
  if (args.category) rows = rows.filter((r) => r.category === args.category);

  const byCategory: Record<string, number> = {};
  for (const r of rows) byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;

  return {
    total: live.filter((r) => r.use === use).length,
    approved: live.filter((r) => r.use === use && r.approved).length,
    byCategory,
    rows: rows
      .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9))
      .slice(0, Math.min(Math.max(args.limit ?? 40, 1), 300))
      .map((r) => ({
        rank: r.rank,
        phrase: r.phrase,
        category: r.category,
        use: r.use,
        origin: r.origin,
        score: Math.round(r.score * 100) / 100,
        currentlyNamed: r.currentlyNamed,
        approved: r.approved,
      })),
  };
}

/** The page plan: one pillar, its supports, and where each one has got to. */
export async function clientPlan(clientId: string): Promise<
  | {
      planUrl: string;
      treatment: string | null;
      terms: string[];
      anchor: string | null;
      keywordCounts: { written: number; approved: number } | null;
      rows: Array<{
        rank: number;
        role: string | null;
        question: string;
        keyword: string | null;
        title: string | null;
        theme: string | null;
        status: string;
        pageStatus: string | null;
      }>;
    }
  | { error: string }
> {
  const { planMapData } = await import("./plan-map");
  const map = await planMapData(clientId);
  if ("error" in map) return { error: map.error };

  const { loadPlan } = await import("./page-plan");
  const plan = await loadPlan(clientId);
  if ("error" in plan) return { error: plan.error };

  return {
    planUrl: `${appUrl()}/dashboard/clients/${clientId}/plan`,
    treatment: map.treatment,
    terms: map.terms,
    anchor: map.anchorTitle,
    keywordCounts: map.keywordCounts,
    rows: plan.rows.map((r) => ({
      rank: r.rank,
      role: r.role ?? null,
      question: r.question,
      keyword: r.targetKeyword ?? null,
      title: r.workingTitle ?? null,
      theme: r.theme ?? null,
      status: r.status,
      pageStatus: r.pageStatus ?? null,
    })),
  };
}

/** Their pages, drafts included. Drafts are the normal state before Day 0. */
export async function clientPages(clientId: string): Promise<
  Array<{ id: string; slug: string; title: string | null; question: string | null; status: string; publishedAt: string | null }>
> {
  const { data, error } = await supabaseAdmin
    .from("client_pages")
    .select("id, slug, title, question, status, published_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[client-reads] pages could not be read:", error.message);
    return [];
  }

  return (data ?? []).map((p) => ({
    id: p.id as string,
    slug: p.slug as string,
    title: (p.title as string | null) ?? null,
    question: (p.question as string | null) ?? null,
    status: p.status as string,
    publishedAt: (p.published_at as string | null) ?? null,
  }));
}

/** How a report came to be about this lead. A domain match is not the same claim as a link. */
export type AuditLinkedBy = "client_id" | "contact_id" | "domain";

export interface LeadAudit {
  id: string;
  runLabel: string | null;
  kind: string;
  status: string;
  score: number | null;
  questions: number;
  answered: number;
  engines: string[];
  createdAt: string;
  callNotes: string | null;
  reportUrl: string;
  /** Which identity matched. `client_id` outranks the other two when a report matches more than one. */
  linkedBy: AuditLinkedBy;
  /** `fired_for_client` or `backfilled_by_domain`, straight off the row. Null on the 89 older reports. */
  linkSource: string | null;
}

const AUDIT_COLUMNS = "id, slug, run_label, status, score, prompts, engines, created_at, call_notes, client_link_source";

/**
 * Every audit that is ABOUT this lead, by link and by host, newest first.
 *
 * ‼️ RESOLVING BY DOMAIN FINDS AN AUDIT THAT WAS FIRED BEFORE THE CLIENT EXISTED. Three of SRT's
 * fifteen carry `backfilled_by_domain`, so this path is how they were found in the first place.
 *
 * ‼️ AND ON THE ONE REAL CLIENT IT CURRENTLY ADDS NOTHING, MEASURED 2026-09-17. 104 reports exist
 * and 89 carry no client_id, but ZERO of those 89 name srtagency.com: they are prospect audits of
 * other businesses. The 89 are not hidden reports about this lead, and a comment claiming they were
 * would send the next reader hunting for data that is not there. The domain arm earns its place on
 * the NEXT client onboarded after a prospect audit, not on this one.
 *
 * Every row still says which identity matched, because "this report is about you and nothing links
 * it to you" is a finding, not an implementation detail.
 *
 * ‼️ ONE QUERY PER IDENTITY RATHER THAN AN `or` FILTER, the rule adopt-audit.ts states at its head:
 * PostgREST's `or` with embedded commas inside an ilike pattern is a parsing hazard and a domain can
 * legitimately contain one. Three small selects beat one clever one that breaks on a hostname.
 *
 * ‼️ IT DOES NOT WRITE. adoptPriorAudit() is what LINKS a report, with its own "never steal a linked
 * audit" re-check at the write. This only reads, so a report seen here by host is still unlinked
 * afterwards and the count does not drift just because somebody looked.
 */
export async function auditsForLead(args: {
  clientId: string;
  domain?: string | null;
  contactId?: string | null;
  limit?: number;
}): Promise<LeadAudit[]> {
  const cap = Math.min(Math.max(args.limit ?? 10, 1), 50);
  const base = () =>
    supabaseAdmin.from("audit_reports").select(AUDIT_COLUMNS).order("created_at", { ascending: false }).limit(cap);

  const found: Array<Record<string, unknown> & { __linkedBy: AuditLinkedBy }> = [];
  const collect = async (linkedBy: AuditLinkedBy, apply: (q: ReturnType<typeof base>) => ReturnType<typeof base>) => {
    const { data, error } = await apply(base());
    if (error) {
      console.error(`[client-reads] audits by ${linkedBy} could not be read:`, error.message);
      return;
    }
    for (const row of data ?? []) {
      // First wins, and the order of the calls below is the precedence: a report that is linked is
      // reported as linked even when its host also matches.
      if (!found.some((f) => f.id === row.id)) found.push({ ...row, __linkedBy: linkedBy });
    }
  };

  await collect("client_id", (q) => q.eq("client_id", args.clientId));
  if (args.contactId) await collect("contact_id", (q) => q.eq("contact_id", args.contactId as string));
  if (args.domain) await collect("domain", (q) => q.ilike("website", `%${args.domain}%`));

  found.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  const rows = found.slice(0, cap);
  if (!rows.length) return [];

  // ‼️ ONE SELECT FOR EVERY REPORT'S RUN COUNT, NOT ONE PER REPORT. This was a count() inside a
  // Promise.all over up to 50 reports, so a lead context assembling the audit slice paid 50 round
  // trips to learn 50 integers.
  const answered = new Map<string, number>();
  const ids = rows.map((r) => r.id as string);
  const RUN_CAP = 20000;
  const { data: runs, error: runErr } = await supabaseAdmin
    .from("audit_runs")
    .select("report_id")
    .in("report_id", ids)
    .eq("status", "ok")
    .limit(RUN_CAP);
  if (runErr) {
    console.error("[client-reads] audit_runs tally could not be read:", runErr.message);
  } else {
    // A tally that silently hit the row cap would under-report `answered` on every report at once,
    // and an answered count lower than the truth reads as a half-finished audit. Say so instead.
    if ((runs ?? []).length >= RUN_CAP) {
      console.error(`[client-reads] audit_runs tally hit the ${RUN_CAP} row cap; answered counts are not reliable`);
    }
    for (const r of runs ?? []) {
      const key = String((r as { report_id: string }).report_id);
      answered.set(key, (answered.get(key) ?? 0) + 1);
    }
  }

  const { isSuppliedRun } = await import("@/lib/audit-engine/run-labels");

  return rows.map((r) => {
    const label = (r.run_label as string | null) ?? null;
    return {
      id: r.id as string,
      runLabel: label,
      kind: isSuppliedRun({ run_label: label })
        ? "a run we fired for this client, not their baseline"
        : "the client's baseline photograph",
      status: r.status as string,
      score: (r.score as number | null) ?? null,
      questions: Array.isArray(r.prompts) ? (r.prompts as unknown[]).length : 0,
      answered: answered.get(r.id as string) ?? 0,
      engines: (r.engines as string[] | null) ?? [],
      createdAt: r.created_at as string,
      callNotes: (r.call_notes as string | null) ?? null,
      reportUrl: `${appUrl()}/r/${r.slug as string}`,
      linkedBy: r.__linkedBy,
      linkSource: (r.client_link_source as string | null) ?? null,
    };
  });
}

/**
 * Their audit runs, baseline and measurements alike, newest first.
 *
 * ‼️ THE LABEL IS RETURNED AND THE DIFFERENCE IS STATED. A `prospect_audit` and a `photograph_2`
 * are different kinds of fact about a business (A2 D-P14), and an answer that lists them together
 * without saying which is which invites exactly the comparison the label exists to prevent.
 *
 * ‼️ LINKED AUDITS ONLY, AND THAT IS WHY IT STILL EXISTS. Its two callers (the chatbot tool and the
 * post-call email) mean "this client's audits", so widening them to host matches would quietly put
 * a stranger's audit in a client email. auditsForLead() is the wider read and names its own scope.
 */
export async function clientAudits(clientId: string, limit = 10): Promise<LeadAudit[]> {
  return auditsForLead({ clientId, limit });
}

/** Documents filed against this client: uploads and generated artifacts alike. */
export async function clientDocs(clientId: string): Promise<
  Array<{ id: string; filename: string; stepKey: string | null; source: string; uploadedAt: string; url: string }>
> {
  const { listOnboardingDocs } = await import("./onboarding-docs");
  const docs = await listOnboardingDocs(clientId);
  return docs.map((d) => ({
    id: d.id,
    filename: d.filename,
    stepKey: d.stepKey,
    source: d.source,
    uploadedAt: d.uploadedAt,
    url: `${appUrl()}/api/clients/${clientId}/docs/${d.id}`,
  }));
}
