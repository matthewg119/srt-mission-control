// One Launch Lane client: the sixteen steps, and the panels that do the work.
//
// ‼️ IT REFUSES TO RENDER A SLACK-LANE CLIENT. Showing this board for a client whose work lives
// on the 41-step board would show an empty lane next to real progress, and the obvious response
// to an empty board is to start doing the work again.

import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/db";
import { launchBoard } from "@/lib/launch/steps";
import { foundationStatus } from "@/lib/launch/documents";
import { currentOffer } from "@/lib/launch/offer";
import { LaunchBoard, type BoardStep } from "./board";
import { LaunchPanels } from "./panels";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

interface Props {
  params: { id: string };
}

export async function generateMetadata({ params }: Props) {
  const { data } = await supabaseAdmin
    .from("clients")
    .select("dba_name, legal_name")
    .eq("id", params.id)
    .maybeSingle();
  const name = (data?.dba_name as string) || (data?.legal_name as string) || "Launch client";
  return { title: `${name} | Launch lane` };
}

export default async function LaunchClientPage({ params }: Props) {
  const { data: client, error } = await supabaseAdmin
    .from("clients")
    .select(
      "id, slug, legal_name, dba_name, city, state, phone, email, website, vertical_slug, onboarding_lane, day_0_archived_at"
    )
    .eq("id", params.id)
    .maybeSingle();

  if (error) throw new Error(`That client could not be read: ${error.message}`);
  if (!client) notFound();

  if (client.onboarding_lane !== "launch") {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-xl font-semibold text-white">This client is not on the launch lane</h1>
        <p className="mt-3 text-sm text-[rgba(255,255,255,0.5)]">
          It is worked on the Slack delivery board, in its own channel. Showing an empty launch board
          beside work that is already done is how the same work gets done twice.
        </p>
        <Link
          href={`/dashboard/clients/${client.id as string}`}
          className="mt-5 inline-block rounded-lg border border-[rgba(255,255,255,0.12)] px-4 py-2 text-sm text-[rgba(255,255,255,0.7)] hover:text-white"
        >
          Open it there
        </Link>
      </div>
    );
  }

  const [board, docs, offer, hostRow, audienceRow] = await Promise.all([
    launchBoard(client.id as string),
    foundationStatus(client.id as string),
    currentOffer(client.id as string),
    supabaseAdmin
      .from("client_hosts")
      .select("host, enabled, vercel_attached_at")
      .eq("client_id", client.id as string)
      .eq("kind", "site")
      .maybeSingle(),
    supabaseAdmin
      .from("client_audiences")
      .select("label, confirmed_at, lane_name, launcher_label, buyer_noun_singular, offer_noun_singular, visit_noun, business_noun, vocabulary_source")
      .eq("client_id", client.id as string)
      .eq("is_primary", true)
      .maybeSingle(),
  ]);

  const steps: BoardStep[] = board.map((e) => ({
    key: e.step.key,
    number: e.number,
    label: e.step.label,
    detail: e.step.detail ?? null,
    phase: e.step.phase,
    gate: e.step.gate === true,
    noWebsiteOnly: e.step.noWebsiteOnly === true,
    status: e.row?.status ?? "pending",
    verifiedSource: e.row?.verified_source ?? null,
    verifiedDetail: e.row?.verified_detail ?? null,
    note: e.row?.note ?? null,
    skippedReason: e.row?.skipped_reason ?? null,
    errorDetail: e.row?.error_detail ?? null,
    waitingOn: e.waitingOn,
  }));

  const name = (client.dba_name as string) || (client.legal_name as string) || (client.slug as string);
  const settled = steps.filter((s) => s.status === "complete" || s.status === "skipped").length;
  const host = (hostRow.data?.host as string | null) ?? null;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <Link href="/dashboard/launch" className="text-xs text-[rgba(255,255,255,0.4)] hover:text-white">
        Launch lane
      </Link>

      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold text-white">{name}</h1>
        <p className="text-sm text-[rgba(255,255,255,0.45)]">
          {settled} of {steps.length} settled
        </p>
      </div>
      <p className="mt-1 text-xs text-[rgba(255,255,255,0.4)]">
        {[
          (client.vertical_slug as string) || "no vertical set",
          [client.city, client.state].filter(Boolean).join(", "),
          host ? `live on ${host}` : "no domain yet",
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>

      {!client.day_0_archived_at && (
        <p className="mt-4 rounded-lg border border-[rgba(245,166,35,0.3)] bg-[rgba(245,166,35,0.05)] px-4 py-3 text-xs text-[#F5A623]">
          The Day-0 wall is shut. Nothing can be published for this client until the archive is
          recorded, in either lane: publishPage() enforces it, not the board.
        </p>
      )}

      {/* ‼️ PAGE DRAFTING IS NOT DUPLICATED HERE. The hub panels on the shared client page already
          draft, gate and publish through publishPage(), which is lane-aware. A second drafting UI
          would be a second place to get the two rails wrong, which is the objection publish-page.ts
          opens with. This is a link, deliberately. */}
      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href={`/dashboard/clients/${client.id as string}`}
          className="rounded-lg border border-[rgba(255,255,255,0.12)] px-3 py-1.5 text-xs text-[rgba(255,255,255,0.7)] hover:text-white"
        >
          Pages, drafts and theme
        </Link>
        {host && (
          <>
            <a
              href={`https://${host}/`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-[rgba(255,255,255,0.12)] px-3 py-1.5 text-xs text-[rgba(255,255,255,0.7)] hover:text-white"
            >
              The site
            </a>
            <a
              href={`https://${host}/answers`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-[rgba(255,255,255,0.12)] px-3 py-1.5 text-xs text-[rgba(255,255,255,0.7)] hover:text-white"
            >
              The answers
            </a>
          </>
        )}
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <LaunchBoard clientId={client.id as string} steps={steps} />
        <LaunchPanels
          clientId={client.id as string}
          documents={docs ?? []}
          offer={offer}
          host={host}
          audience={
            audienceRow.data
              ? {
                  label: (audienceRow.data.label as string) ?? "",
                  confirmedAt: (audienceRow.data.confirmed_at as string | null) ?? null,
                  laneName: (audienceRow.data.lane_name as string | null) ?? null,
                  launcherLabel: (audienceRow.data.launcher_label as string | null) ?? null,
                  buyer: (audienceRow.data.buyer_noun_singular as string | null) ?? null,
                  offer: (audienceRow.data.offer_noun_singular as string | null) ?? null,
                  visit: (audienceRow.data.visit_noun as string | null) ?? null,
                  business: (audienceRow.data.business_noun as string | null) ?? null,
                  source: (audienceRow.data.vocabulary_source as string | null) ?? null,
                }
              : null
          }
        />
      </div>
    </div>
  );
}
