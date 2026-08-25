// One client: the eight-stage board, what they told us at intake, and the timing log.
//
// tier_scope IS rendered here, and that is correct: this page is behind auth and is for
// us. It must never leak into anything the clinic sees.

import Link from "next/link";
import { notFound } from "next/navigation";
import { BarChart3 } from "lucide-react";
import { supabaseAdmin } from "@/lib/db";
import { INTAKE_STEPS } from "@/config/client-intake";
import { ONBOARDING_STAGES } from "@/lib/clients/provision";
import { DELIVERY_STEPS } from "@/lib/clients/delivery-checklist";
import { DRAFTS } from "@/lib/clients/client-drafts";
import { DRAFT_COPY, isUnwritten } from "@/config/client-messages";
import { reportsOutstanding } from "@/lib/clients/report-reminders";
import { DNS_RECORDS, fqdn } from "@/lib/clients/dns-records";
import { subdomainLabel } from "@/lib/clients/normalize";
import { TimeLogForm } from "./time-log-form";
import { DeliveryChecklistForm } from "./delivery-checklist-form";
import { DraftsForm, type DraftRow } from "./drafts-form";
import { DnsForm, type DnsRowView } from "./dns-form";
import { HubForm, type HubHostView, type HubPageView, type AuditPromptView } from "./hub-form";
import { ThemeForm, type ThemeView } from "./theme-form";
import { BaselineForm } from "./baseline-form";
import { CompetitorForm } from "./competitor-form";
import { ReviewAuditForm } from "./review-audit-form";
import { ReviewWorkflowForm, type ReviewWorkflowView } from "./review-workflow-form";
import { PresenceSweepForm } from "./presence-sweep-form";
import { AvatarForm } from "./avatar-form";
import { avatarCandidatesFor, confirmedAvatarFor } from "@/lib/clients/avatars";
import { PaymentForm, type PaymentView } from "./payment-form";
import { loadCandidates, REQUIRED_SELECTIONS } from "@/lib/clients/competitors";
import { loadReviewAudit, reviewPlatformLabel } from "@/lib/clients/review-audit";
import { loadSweep } from "@/lib/clients/presence-sweep";
import { platformByKey } from "@/config/presence-platforms";
import { readTheme } from "@/lib/hub/theme";
import { listOnboardingDocs } from "@/lib/clients/onboarding-docs";
import { stepByKey } from "@/lib/clients/delivery-checklist";
import { hostsFor, vercelConfig } from "@/lib/hub/vercel-domains";

/**
 * Tokens a human types on the board. Everything else on a draft is derived from the
 * client record, and letting those be typed would mean a business name on a message
 * disagreeing with the one on the record it was drafted from.
 */
const FREE_TEXT_TOKENS = new Set(["headline", "pageUrl", "firstName"]);

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const STAGE_LABEL: Record<string, string> = {
  start: "Start",
  intake: "Intake",
  photograph_1: "Photograph I",
  call: "The call",
  photograph_2: "Photograph II",
  build: "Build",
  rhythm: "Rhythm",
  renew: "Renew",
};

const CATEGORY_LABEL: Record<string, string> = {
  baseline_retest: "Baseline retest",
  pages_new: "Pages, new",
  pages_refresh: "Pages, refresh",
  review_tool_setup: "Review tool setup",
  review_responses: "Review responses",
  outreach: "Outreach",
  reporting_video: "Reporting video",
  client_comms: "Client comms",
  implementation: "Implementation",
};

function hours(minutes: number): string {
  return (minutes / 60).toFixed(1);
}

/**
 * Which channel this client's drafts get addressed to, and whether that address is
 * actually usable. Amber means it is not: a wa.me link is built from digits, so a phone
 * that never normalized to E.164 produces a link that opens nothing.
 */
function ContactLine({
  preference,
  phone,
  email,
}: {
  preference: string;
  phone: string | null;
  email: string | null;
}) {
  const e164 = phone ? /^\+1\d{10}$/.test(phone) : false;

  if (preference === "email") {
    return <span className={email ? undefined : "text-[#F5A623]"}>Email {email || "not on file"}</span>;
  }

  const label = preference === "sms" ? "Text" : "WhatsApp";
  if (!phone) return <span className="text-[#F5A623]">{label}, no number on file</span>;
  if (!e164) return <span className="text-[#F5A623]">{label} {phone} (not E.164, links will fail)</span>;
  return <span>{label} {phone}</span>;
}

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [
    { data: client },
    { data: steps },
    { data: entries },
    { data: delivery },
    { data: messages },
    { data: dnsRecords },
    { data: hostRows },
    { data: pageRows },
  ] = await Promise.all([
      supabaseAdmin.from("clients").select("*").eq("id", id).maybeSingle(),
      supabaseAdmin
        .from("client_onboarding_steps")
        .select("stage, status, completed_at")
        .eq("client_id", id),
      supabaseAdmin
        .from("time_log")
        .select("id, task_category, minutes, logged_at, note")
        .eq("client_id", id)
        .order("logged_at", { ascending: false })
        .limit(50),
      supabaseAdmin
        .from("client_delivery_steps")
        .select("step_key, status, error_detail")
        .eq("client_id", id),
      supabaseAdmin
        .from("client_messages")
        .select("draft_key, sent_at, generated_at")
        .eq("client_id", id),
      supabaseAdmin
        .from("client_dns_records")
        .select("record_key, record_type, host, value, status, observed, last_checked_at, verified_at, note")
        .eq("client_id", id),
      supabaseAdmin
        .from("client_hosts")
        .select("host, kind, vercel_attached_at, vercel_verified, vercel_misconfigured, vercel_checked_at, vercel_error")
        .eq("client_id", id),
      supabaseAdmin
        .from("client_pages")
        .select("id, slug, title, question, status, published_at")
        .eq("client_id", id)
        .order("updated_at", { ascending: false }),
    ]);

  const docs = await listOnboardingDocs(id);

  // The three grids a person fills in: the presence sweep (steps 4, 5 and 25), the competitor
  // pick (step 7) and the review audit. Every one of them writes a column that had a
  // reader and no writer until 2026-08-24, which is why three delivery steps could never be
  // confirmed and citation_cleanup returned a green tick over work nobody had done.
  const [sweepRows, candidates, reviewRows, avatarCandidates, avatarConfirmed] = await Promise.all([
    loadSweep(id),
    loadCandidates(id),
    loadReviewAudit(id),
    // Step 8, and the fourth column in that list: clients.primary_avatar had a reader and no
    // writer of any kind, so the step it gates could never be ticked by anybody.
    avatarCandidatesFor(id),
    confirmedAvatarFor(id),
  ]);

  const sweepViews = sweepRows.map((r) => ({
    id: r.id,
    platform: r.platform,
    platformLabel: platformByKey(r.platform)?.label ?? r.platform,
    tier: r.tier,
    status: r.status,
    rawName: r.rawName,
    rawAddress: r.rawAddress,
    rawPhone: r.rawPhone,
    listingUrl: r.listingUrl,
    skipReason: r.skipReason,
    confirmedStatus: r.confirmedStatus,
    checkedBy: r.checkedBy,
    checkedAt: r.checkedAt,
  }));

  const reviewViews = reviewRows.map((r) => ({
    id: r.id,
    subjectType: r.subjectType,
    subjectName: r.subjectName,
    platform: r.platform,
    platformLabel: reviewPlatformLabel(r.platform),
    reviewCount: r.reviewCount,
    averageRating: r.averageRating,
    mostRecentReviewAt: r.mostRecentReviewAt,
    ownerResponseRate: r.ownerResponseRate,
    negativeThemes: r.negativeThemes,
    checkedBy: r.checkedBy,
    checkedAt: r.checkedAt,
  }));

  if (!client) notFound();

  // Steps 29 and 30. `review_workflow` is intake step 4's bag; the two URL keys are added to it
  // by the Review handover panel and are read by destinationsFor() in the hub's review tool.
  const reviewWorkflowBag = (client.review_workflow ?? {}) as Record<string, unknown>;
  const reviewWorkflowView: ReviewWorkflowView = {
    mode: (client.review_request_mode as ReviewWorkflowView["mode"]) ?? null,
    ownerName: (client.review_owner_name as string | null) ?? null,
    googleUrl: typeof reviewWorkflowBag.google_url === "string" ? reviewWorkflowBag.google_url : null,
    realselfUrl:
      typeof reviewWorkflowBag.realself_url === "string" ? reviewWorkflowBag.realself_url : null,
    intakeDestinations: Array.isArray(reviewWorkflowBag.destinations)
      ? (reviewWorkflowBag.destinations as string[])
      : [],
    bookingSoftware: (client.booking_software as string | null) ?? null,
  };

  // What unlocks delivery step 21. `clients.select("*")` already carries the four columns, so
  // this is a read of the row rather than a query. It is an ASSERTION this board keeps, never
  // evidence of a charge, and payment.ts owns the one approved wording.
  const paymentView: PaymentView = {
    recordedAt: (client.payment_recorded_at as string | null) ?? null,
    recordedBy: (client.payment_recorded_by as string | null) ?? null,
    terms: (client.payment_terms as string | null) ?? null,
    note: (client.payment_note as string | null) ?? null,
    accessOutstanding:
      (delivery ?? []).find((d) => d.step_key === "access_granted")?.status !== "complete",
  };

  // The twenty questions this client's most recent audit actually ran, which are what a
  // page gets written to answer. `audit_reports.client_id` is the link and it is populated;
  // the contact_id and domain fallbacks below are for a report that ran BEFORE the client row
  // existed, which is the normal case for a prospect who converted. (This comment used to say
  // audit_reports had no client_id at all, forty lines above a query that filters on it.)
  const auditFilter = client.contact_id
    ? { column: "contact_id", value: client.contact_id as string }
    : client.domain
      ? { column: "website", value: `%${client.domain as string}%` }
      : null;

  const { data: latestReport } = auditFilter
    ? await (auditFilter.column === "contact_id"
        ? supabaseAdmin
            .from("audit_reports")
            .select("id, prompts")
            .eq("contact_id", auditFilter.value)
        : supabaseAdmin
            .from("audit_reports")
            .select("id, prompts")
            .ilike("website", auditFilter.value)
      )
        // ‼️ "done", NOT "complete". audit_reports.status is
        // classifying | awaiting_city | running | done | failed, and finishReport writes
        // "done" — so this filter matched NOTHING, for every client, since the board was
        // built. The symptom was not an error: the hub page's question picker simply had no
        // questions in it and looked like a client whose audit had not run.
        .eq("status", "done")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  // The newest BASELINE, which is a different row from the one above: that one is whatever
  // audit this client's contact has ever had, this one is the run fired FOR them by
  // startBaselineScan. `measured` is what says the photograph is real, and it is read rather
  // than inferred from the step being ticked, because the step being ticked is exactly the
  // thing that turned out not to mean anything.
  const { data: baselineRow } = await supabaseAdmin
    .from("audit_reports")
    .select("id, created_at")
    .eq("client_id", id)
    .eq("status", "done")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const baselineMeasured = baselineRow
    ? ((
        await supabaseAdmin
          .from("audit_runs")
          .select("id", { count: "exact", head: true })
          .eq("report_id", baselineRow.id as string)
          .eq("status", "ok")
      ).count ?? 0)
    : null;

  const stageStatus = new Map(
    (steps ?? []).map((s) => [s.stage as string, s.status as string])
  );

  const completedSteps = (delivery ?? [])
    .filter((d) => d.status === "complete")
    .map((d) => d.step_key as string);
  // Steps a runner failed on. runReadyAutoSteps will not claim an `error` row, so without a
  // control here the step is parked forever. The checklist renders a Retry beside each one.
  const erroredSteps: Record<string, string | null> = {};
  for (const d of delivery ?? []) {
    if (d.status === "error") erroredSteps[d.step_key as string] = (d.error_detail as string | null) ?? null;
  }
  const deliveryTotal = DELIVERY_STEPS.length;

  // 'implementation' is excluded from the subscription total in EVERY rollup. It is
  // one-time cleanup, logged as a confound in the case study, and folding it in would
  // overstate what ongoing delivery costs.
  const log = entries ?? [];
  const subscriptionMinutes = log
    .filter((e) => e.task_category !== "implementation")
    .reduce((sum, e) => sum + (e.minutes as number), 0);
  const implementationMinutes = log
    .filter((e) => e.task_category === "implementation")
    .reduce((sum, e) => sum + (e.minutes as number), 0);

  const name = (client.dba_name as string) || (client.legal_name as string);

  // What has been drafted, what has actually been sent, and which reports are owed.
  // Reports are the only ones that go stale on their own, so they carry a "due" flag from
  // the same milestone arithmetic the daily reminder uses. Everything else is here so a
  // draft can be reissued once its copy is written or a number is corrected.
  const sentByKey = new Map(
    (messages ?? []).map((m) => [
      m.draft_key as string,
      { sentAt: (m.sent_at as string) ?? null, draftedAt: (m.generated_at as string) ?? null },
    ])
  );
  const dueDays = new Set(
    (
      await reportsOutstanding({
        id: id,
        legal_name: client.legal_name as string,
        dba_name: client.dba_name as string,
        intake_completed_at: (client.intake_completed_at as string) ?? null,
      })
    ).map((r) => r.day)
  );

  // ── Hub ──
  // wanted is what the hostnames SHOULD be, composed from the record; hostRows is what
  // Vercel has actually been told about. Rendering both is the point: the gap between them
  // is exactly the "nothing serves this yet" state the panel exists to make visible.
  const hubWanted = hostsFor({
    subdomain: (client.subdomain as string) ?? null,
    domain: (client.domain as string) ?? null,
  }).map((h) => ({ host: h.host, kind: h.kind }));

  const hubHosts: HubHostView[] = (hostRows ?? []).map((r) => ({
    host: r.host as string,
    kind: r.kind as "hub" | "reviews",
    attached: Boolean(r.vercel_attached_at),
    verified: (r.vercel_verified as boolean | null) ?? null,
    misconfigured: (r.vercel_misconfigured as boolean | null) ?? null,
    checkedAt: (r.vercel_checked_at as string | null) ?? null,
    error: (r.vercel_error as string | null) ?? null,
  }));

  const hubPages: HubPageView[] = (pageRows ?? []).map((r) => ({
    id: r.id as string,
    slug: r.slug as string,
    title: r.title as string,
    question: (r.question as string) ?? "",
    status: r.status as string,
    publishedAt: (r.published_at as string | null) ?? null,
  }));

  const auditPrompts: AuditPromptView[] = Array.isArray(latestReport?.prompts)
    ? (latestReport!.prompts as Array<Record<string, unknown>>).flatMap((p) => {
        const text = typeof p === "string" ? p : ((p?.text ?? p?.prompt) as string | undefined);
        if (!text) return [];
        return [
          {
            text,
            block: typeof p === "object" ? ((p?.block as string) ?? null) : null,
            reportId: (latestReport!.id as string) ?? null,
          },
        ];
      })
    : [];

  // The DNS rows, ordered by DNS_RECORDS rather than by the database so the panel always
  // reads hub, reviews, TXT. The label-only host and the fully qualified name are both
  // sent: one to type into the registrar, one to read aloud.
  const clientDomain = (client.domain as string) || null;
  const dnsByKey = new Map((dnsRecords ?? []).map((r) => [r.record_key as string, r]));
  const dnsRows: DnsRowView[] = DNS_RECORDS.flatMap((def) => {
    const row = dnsByKey.get(def.key);
    if (!row) return [];
    const host = row.host as string;
    return [
      {
        key: def.key,
        label: def.label,
        type: def.type,
        host,
        fqdn: clientDomain ? fqdn(host, clientDomain) : host,
        why: def.why,
        value: (row.value as string) ?? null,
        status: (row.status as string) ?? "pending",
        observed: (row.observed as string) ?? null,
        lastCheckedAt: (row.last_checked_at as string) ?? null,
        // The column has existed since the panel was built and was never rendered. It is the
        // ONLY place writeCnameTarget can report that Vercel wants a different value than the
        // one a human already committed to, so not rendering it meant the system detected the
        // disagreement, wrote it down, and told nobody.
        note: (row.note as string) ?? null,
        external: Boolean(def.valueIsExternal),
      },
    ];
  });

  const draftRows: DraftRow[] = DRAFTS.map((d) => {
    const copy = DRAFT_COPY[d.copyKey ?? d.key];
    const milestone = /^report_day_(\d+)$/.exec(d.key);
    const row = sentByKey.get(d.key);
    return {
      key: d.key,
      label: copy?.label ?? d.key,
      // dayLabel is derived server-side from the key, never typed, so it cannot end up
      // saying "day 30" on the day-90 message.
      inputs: (copy?.tokens ?? []).filter((t) => FREE_TEXT_TOKENS.has(t)),
      sentAt: row?.sentAt ?? null,
      draftedAt: row?.draftedAt ?? null,
      due: milestone ? dueDays.has(Number(milestone[1])) : false,
      unwritten: copy ? isUnwritten(copy.body) : false,
    };
  });

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/dashboard/clients" className="text-xs text-[rgba(255,255,255,0.4)] hover:text-white">
        Clients
      </Link>

      <div className="mb-6 mt-2">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-medium text-white">{name}</h1>
          {/* Traffic. The one number this whole hub exists to move, one click away. */}
          <Link
            href={`/dashboard/clients/${id}/metrics`}
            title="Traffic"
            aria-label="Traffic"
            className="flex items-center gap-1.5 rounded-lg border border-[rgba(255,255,255,0.07)] px-2.5 py-1.5 text-xs text-[rgba(255,255,255,0.5)] hover:bg-[rgba(255,255,255,0.03)] hover:text-white"
          >
            <BarChart3 className="h-4 w-4" aria-hidden />
            Traffic
          </Link>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-[rgba(255,255,255,0.4)]">
          <span>{client.website as string}</span>
          {/* Legacy, see the note on the clients list. Retired 2026-08-20, kept so the
              one client that had a channel still shows that it did. */}
          {client.slack_channel_name && (
            <span>#{client.slack_channel_name as string} (legacy Slack)</span>
          )}
          {/* How we reach them. Every draft in the ops thread is addressed off these two
              values, so a wrong one is worth spotting here rather than after a message
              has gone to a stranger. A phone that is not E.164 is shown in amber: wa.me
              takes digits only, so an unparsed number builds a link to nowhere. */}
          <ContactLine
            preference={(client.contact_preference as string) ?? "whatsapp"}
            phone={(client.phone as string) ?? null}
            email={(client.email as string) ?? null}
          />
          {/* The column stores the LABEL, so the full host is composed here. This is the
              one place that wants the whole name: it is read, not typed into a registrar. */}
          {client.subdomain && client.domain && (
            <span>
              {subdomainLabel(client.subdomain as string, client.domain as string)}.
              {client.domain as string}
            </span>
          )}
          <span>Scope: {(client.tier_scope as string) ?? "not set"} (internal)</span>
          {client.pilot_ends_at && (
            <span>Pilot ends {new Date(client.pilot_ends_at as string).toLocaleDateString()}</span>
          )}
        </div>
        {client.market_conflict === true && (
          <p className="mt-2 text-xs text-[#F5A623]">
            Market overlaps another live client. Someone needs to decide.
          </p>
        )}
        {client.review_incentive_flag === true && (
          <p className="mt-2 text-xs text-[#F5A623]">
            They offer something for reviews, or have a lobby tablet or QR. Conversation on
            the call before anything is built on it.
          </p>
        )}
      </div>

      {/* ── The eight stages ── */}
      <div className="mb-8 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ONBOARDING_STAGES.map((stage) => {
          const status = stageStatus.get(stage) ?? "pending";
          const done = status === "complete";
          return (
            <div
              key={stage}
              className={
                "rounded-xl border px-3 py-2.5 " +
                (done
                  ? "border-[rgba(0,201,167,0.35)] bg-[rgba(0,201,167,0.07)]"
                  : "border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)]")
              }
            >
              <p className={"text-sm " + (done ? "text-[#00C9A7]" : "text-white")}>
                {STAGE_LABEL[stage]}
              </p>
              <p className="mt-0.5 text-[11px] text-[rgba(255,255,255,0.35)]">
                {done ? "Done" : "Pending"}
              </p>
            </div>
          );
        })}
      </div>

      {/* ── The internal delivery checklist ── */}
      <div className="mb-8 rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-white">Delivery</h2>
          <span className="text-xs text-[rgba(255,255,255,0.4)]">
            {completedSteps.length} of {deliveryTotal} done
            {client.ops_checklist_ts ? " · mirrored in Slack" : ""}
          </span>
        </div>
        <DeliveryChecklistForm clientId={id} completed={completedSteps} errored={erroredSteps} />

        <div className="mt-5 border-t border-[rgba(255,255,255,0.07)] pt-4">
          <p className="mb-2 text-[10px] uppercase tracking-widest text-[rgba(255,255,255,0.3)]">
            Photograph I
          </p>
          <BaselineForm
            clientId={id}
            website={(client.website as string | null) ?? null}
            measured={baselineMeasured}
            scannedAt={(baselineRow?.created_at as string | null) ?? null}
          />
        </div>
      </div>

      {/* ── Measure: the three grids a person fills in, in DELIVERY_STEPS order ── */}

      {/* Step 4, 5 and 25. Nothing wrote confirmed_status before this panel existed. */}
      <div className="mb-8 rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-white">Presence sweep</h2>
          <span className="text-xs text-[rgba(255,255,255,0.4)]">
            {sweepRows.filter((r) => r.confirmedStatus !== null).length} of {sweepRows.length}{" "}
            confirmed
          </span>
        </div>
        <PresenceSweepForm clientId={id} rows={sweepViews} />
      </div>

      {/* Step 7. Nothing wrote competitor_candidates.selected before this panel existed. */}
      <div className="mb-8 rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-white">Competitors</h2>
          <span className="text-xs text-[rgba(255,255,255,0.4)]">
            {candidates.filter((c) => c.selected).length} of {REQUIRED_SELECTIONS} picked
          </span>
        </div>
        <CompetitorForm
          clientId={id}
          candidates={candidates}
          required={REQUIRED_SELECTIONS}
        />
      </div>

      {/* Step 8. Nothing wrote review_audit_rows.review_count before this panel existed. */}
      <div className="mb-8 rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-white">Review audit</h2>
          <span className="text-xs text-[rgba(255,255,255,0.4)]">
            {reviewRows.filter((r) => r.reviewCount !== null && r.checkedAt !== null).length} of{" "}
            {reviewRows.length} measured
          </span>
        </div>
        <ReviewAuditForm clientId={id} rows={reviewViews} />
      </div>

      {/*
        Step 8. ‼️ THIS PANEL IS THE WRITER clients.primary_avatar NEVER HAD. Its card told
        Matthew "the proposal is on the board" and there was no such control, so the step came out
        `skipped` on the first real client. Placed above the review handover because the avatar is
        decided before the call and the handover after it.
      */}
      <div
        id="avatar"
        className="mb-8 rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] p-5"
      >
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-white">Avatar</h2>
          <span className="text-xs text-[rgba(255,255,255,0.4)]">step 8</span>
        </div>
        <AvatarForm
          clientId={id}
          candidates={avatarCandidates.candidates}
          confirmed={avatarConfirmed}
          nicheKey={avatarCandidates.nicheKey}
          matchedBy={avatarCandidates.matchedBy}
          frozen={Boolean(client.day_0_archived_at)}
          loadError={avatarCandidates.ok ? null : avatarCandidates.error ?? null}
        />
      </div>

      {/*
        Steps 29 and 30. ‼️ Nothing wrote clients.review_request_mode, clients.review_owner_name
        or review_workflow.google_url / .realself_url before this panel existed, so step 29 could
        never be confirmed by anybody and the review tool's "Post on Google" button has never
        appeared for a single client. Read the route header before changing what it writes.
      */}
      <div
        id="review-handover"
        className="mb-8 rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] p-5"
      >
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-white">Review handover</h2>
          <span className="text-xs text-[rgba(255,255,255,0.4)]">
            steps 29 and 30
          </span>
        </div>
        <ReviewWorkflowForm clientId={id} view={reviewWorkflowView} />
      </div>

      {/*
        Step 21's gate. ‼️ It records an ASSERTION, not a charge: nothing in this app talks
        to a payment processor, so the copy is "payment recorded by X on DATE" and never
        "payment received". Same distinction day_0_source draws between photograph_2 and
        manual_step. The refusal itself lives in step-verify.ts's `access_granted` verifier,
        which is what every surface goes through.
      */}
      <div
        id="payment"
        className="mb-8 rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] p-5"
      >
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-white">Payment</h2>
          <span className="text-xs text-[rgba(255,255,255,0.4)]">
            {paymentView.recordedAt ? "recorded, step 21 is open" : "not recorded, step 21 is held"}
          </span>
        </div>
        <PaymentForm clientId={id} view={paymentView} />
      </div>

      {/* ── DNS ── */}
      <div className="mb-8 rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-white">DNS</h2>
          <span className="text-xs text-[rgba(255,255,255,0.4)]">
            {dnsRows.filter((r) => r.status === "verified").length} of {DNS_RECORDS.length} resolving
          </span>
        </div>
        <DnsForm
          clientId={id}
          rows={dnsRows}
          domain={clientDomain}
          provider={(client.dns_provider as string) ?? null}
          nameservers={(client.dns_nameservers as string[]) ?? []}
        />
      </div>

      {/* ── Identity: the name the schema carries, and the look ── */}
      {/* id="theme" so step 15's card can link straight here. It is the one panel a step card
          names by anchor, and hub_preview refuses until the theme is confirmed on it. */}
      <div
        id="theme"
        className="mb-8 rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] p-5"
      >
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-white">Identity and theme</h2>
          <span className="text-xs text-[rgba(255,255,255,0.4)]">
            {readTheme(client.theme).confirmedAt ? "theme confirmed" : "theme not confirmed"}
          </span>
        </div>
        <ThemeForm
          clientId={id}
          legalName={(client.legal_name as string) ?? ""}
          dbaName={(client.dba_name as string | null) ?? null}
          hasWebsite={Boolean(client.website || client.domain)}
          theme={readTheme(client.theme) as ThemeView}
        />
      </div>

      {/* ── Hub ── */}
      <div className="mb-8 rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-white">Hub</h2>
          <span className="text-xs text-[rgba(255,255,255,0.4)]">
            {hubHosts.filter((h) => h.attached).length} of {hubWanted.length || 2} hostnames attached
          </span>
        </div>
        <HubForm
          clientId={id}
          domain={clientDomain}
          wanted={hubWanted}
          hosts={hubHosts}
          vercelConfigured={vercelConfig() !== null}
          dnsVerified={dnsRows.filter((r) => r.status === "verified").length}
          dnsTotal={DNS_RECORDS.length}
          themeConfirmedAt={readTheme(client.theme).confirmedAt ?? null}
          pages={hubPages}
          prompts={auditPrompts}
          day0ArchivedAt={(client.day_0_archived_at as string | null) ?? null}
          day0Source={(client.day_0_source as string | null) ?? null}
        />
      </div>

      {/* ── Evidence ── */}
      <div className="mb-8 rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-white">Evidence</h2>
          <span className="text-xs text-[rgba(255,255,255,0.4)]">
            {docs.length} file{docs.length === 1 ? "" : "s"}
          </span>
        </div>

        {docs.length === 0 ? (
          <p className="text-sm text-[rgba(255,255,255,0.5)]">
            Nothing filed yet. Reply to this client&apos;s thread in{" "}
            <code>#onboarding-srt-aeo</code> with a screenshot and it lands here on its own —
            no uploading, no naming, no folder. That is how the presence sweep&apos;s nineteen
            platforms become the evidence behind the findings doc.
          </p>
        ) : (
          <ul className="space-y-2">
            {docs.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/5 pb-2"
              >
                <div className="min-w-0">
                  <a
                    href={`/api/clients/${id}/docs/${d.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-white hover:underline"
                  >
                    {d.filename}
                  </a>
                  <div className="text-xs text-[rgba(255,255,255,0.4)]">
                    {d.stepKey
                      ? (stepByKey(d.stepKey)?.label ?? d.stepKey)
                      : "not tied to a step"}
                  </div>
                </div>
                <span className="text-xs text-[rgba(255,255,255,0.35)]">
                  {new Date(d.uploadedAt).toLocaleDateString()}
                  {d.sizeBytes ? ` · ${Math.round(d.sizeBytes / 1024)} KB` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Client messages ── */}
      <div className="mb-8 rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-white">Messages</h2>
          <span className="text-xs text-[rgba(255,255,255,0.4)]">
            {draftRows.filter((d) => d.sentAt).length} sent
          </span>
        </div>
        <DraftsForm clientId={id} drafts={draftRows} />
      </div>

      {/* ── Timing log ── */}
      <div className="mb-8 rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] p-5">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-white">Timing log</h2>
          <span className="text-xs text-[rgba(255,255,255,0.4)]">
            {hours(subscriptionMinutes)} h subscription
            {implementationMinutes > 0 && ` · ${hours(implementationMinutes)} h implementation`}
          </span>
        </div>

        <TimeLogForm clientId={id} />

        {log.length > 0 && (
          <ul className="mt-4 space-y-1.5 border-t border-[rgba(255,255,255,0.07)] pt-4">
            {log.slice(0, 12).map((e) => (
              <li key={e.id as string} className="flex justify-between gap-3 text-xs">
                <span className="text-[rgba(255,255,255,0.6)]">
                  {CATEGORY_LABEL[e.task_category as string] ?? (e.task_category as string)}
                  {e.note ? ` · ${e.note as string}` : ""}
                </span>
                <span className="shrink-0 text-[rgba(255,255,255,0.35)]">
                  {e.minutes as number} min ·{" "}
                  {new Date(e.logged_at as string).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── What they told us ── */}
      <div className="rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] p-5">
        <h2 className="mb-4 text-sm font-medium text-white">Intake</h2>

        {!client.intake_completed_at && (
          <p className="mb-4 text-xs text-[rgba(255,255,255,0.4)]">
            {(client.intake_step as number) > 0
              ? `In progress, through step ${client.intake_step as number} of 6.`
              : "Not started yet."}
          </p>
        )}

        <dl className="space-y-4">
          {INTAKE_STEPS.map((step) => {
            const bag = step.bag
              ? ((client[step.bag] as Record<string, unknown> | null) ?? null)
              : null;

            const answers = step.fields
              .map((field) => {
                const raw =
                  step.step === 1 ? client[field.key] : step.step === 6 ? null : bag?.[field.key];
                const value = Array.isArray(raw) ? raw.join(", ") : (raw as string | null);
                return value ? { label: field.label, value } : null;
              })
              .filter(Boolean) as Array<{ label: string; value: string }>;

            if (step.step === 6) {
              answers.push(
                { label: "Results permission", value: (client.consent_results as string) ?? "anonymized" },
                { label: "Review tool language", value: (client.language as string) ?? "en" }
              );
            }

            if (answers.length === 0) return null;

            return (
              <div key={step.step}>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-[rgba(255,255,255,0.35)]">
                  {step.title}
                </p>
                {answers.map((a) => (
                  <div key={a.label} className="mb-1.5 grid gap-0.5 sm:grid-cols-[220px_1fr]">
                    <dt className="text-xs text-[rgba(255,255,255,0.4)]">{a.label}</dt>
                    <dd className="whitespace-pre-wrap text-xs text-white/85">{a.value}</dd>
                  </div>
                ))}
              </div>
            );
          })}
        </dl>
      </div>
    </div>
  );
}
