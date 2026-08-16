// One client: the eight-stage board, what they told us at intake, and the timing log.
//
// tier_scope IS rendered here, and that is correct: this page is behind auth and is for
// us. It must never leak into anything the clinic sees.

import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/db";
import { INTAKE_STEPS } from "@/config/client-intake";
import { ONBOARDING_STAGES } from "@/lib/clients/provision";
import { TimeLogForm } from "./time-log-form";

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

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [{ data: client }, { data: steps }, { data: entries }] = await Promise.all([
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
  ]);

  if (!client) notFound();

  const stageStatus = new Map(
    (steps ?? []).map((s) => [s.stage as string, s.status as string])
  );

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

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/dashboard/clients" className="text-xs text-[rgba(255,255,255,0.4)] hover:text-white">
        Clients
      </Link>

      <div className="mb-6 mt-2">
        <h1 className="text-xl font-medium text-white">{name}</h1>
        <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-[rgba(255,255,255,0.4)]">
          <span>{client.website as string}</span>
          {client.slack_channel_name && <span>#{client.slack_channel_name as string}</span>}
          {client.subdomain && <span>{client.subdomain as string}</span>}
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
