// One Launch Lane client: the seventeen steps, and the panels that do the work.
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
import { signOnboardingToken } from "@/lib/clients/token";
import { PREVIEW_TOKEN_TTL_DAYS } from "@/lib/clients/referral-engine-preview";
import { LaunchBoard, type BoardStep } from "./board";
import { LaunchPanels } from "./panels";

/**
 * A RELATIVE preview link, and the relativeness is load-bearing.
 *
 * ‼️ clientPreviewUrl() BUILDS AN ABSOLUTE URL FROM NEXT_PUBLIC_APP_URL, WHICH IS WRONG HERE.
 * That variable names mission.srtagency.com on every environment including the preview
 * deployments, and production is on main, where src/lib/launch/ does not exist at all. So the
 * absolute link would send you from a board that works to a deployment that 404s it, which is
 * the same env trap that has already published localhost links out of a local rebuild.
 *
 * A relative href opens on whatever origin the board is being read on. It needs CLIENT_LINK_SECRET
 * to sign, and returns null rather than a broken link when that is unset, exactly as
 * clientPreviewUrl does and for the reason it gives.
 */
function launchPreviewHref(clientId: string, kind: "launch" | "site"): string | null {
  try {
    const { token } = signOnboardingToken(clientId, PREVIEW_TOKEN_TTL_DAYS, "preview");
    return `/preview/${token}?kind=${kind}`;
  } catch (e) {
    console.error("[dashboard/launch] preview link not minted:", (e as Error).message);
    return null;
  }
}

/**
 * Which site this client actually HAS, which is not always the one this lane builds.
 *
 * ‼️ `kind=launch` RENDERS client_site_pages AND 404s WHEN THERE ARE NONE.
 * That is correct for a client who arrived with no website: the pages are pasted in at
 * `site_pasted` and the preview shows them. It is wrong for a client who brought their own site,
 * because that step is SKIPPED and the table stays empty for ever, so "Preview the site" led
 * straight to a 404 on the one client most likely to be looked at first. Measured on SRT: 0
 * client_site_pages, 7 client_replica_pages.
 *
 * `kind=site` renders the replica, which is what `site_replica` built from a crawl of their real
 * website. So the button shows whichever of the two this client has, and the honest answer when
 * there is neither is to not offer the button at all.
 */
async function previewKindFor(clientId: string): Promise<"launch" | "site" | null> {
  const [own, replica] = await Promise.all([
    supabaseAdmin
      .from("client_site_pages")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId),
    supabaseAdmin
      .from("client_replica_pages")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId),
  ]);

  if ((own.count ?? 0) > 0) return "launch";
  if ((replica.count ?? 0) > 0) return "site";
  return null;
}

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
  const previewKind = await previewKindFor(client.id as string);
  const previewHref = previewKind ? launchPreviewHref(client.id as string, previewKind) : null;

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
        {/* The conversation is the thing to WORK in; this board is the thing to glance at. It
            leads, because on most visits it is the only control that gets pressed. */}
        <Link
          href={`/dashboard/launch/${client.id as string}/chat`}
          className="rounded-lg bg-[#00C9A7] px-3 py-1.5 text-xs font-medium text-[#0B0B0C] hover:opacity-90"
        >
          Run the onboarding
        </Link>
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
        {/* ‼️ ALWAYS RENDERED, WITH OR WITHOUT A DOMAIN, AND THAT IS THE POINT OF IT.
            The two links above need an attached host, which needs a bought domain, which is the
            only thing in this repository that spends money. Until then there was no URL anywhere
            that showed the site you just pasted: /hub/{host} 404s on every internal host by
            design. This one serves the same pages off a signed token instead of a hostname. */}
        {previewHref && (
          <a
            href={previewHref}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-[rgba(245,166,35,0.35)] bg-[rgba(245,166,35,0.06)] px-3 py-1.5 text-xs text-[#F5A623] hover:text-white"
          >
            {previewKind === "site"
              ? "Preview their current site"
              : host
                ? "Preview (no domain needed)"
                : "Preview the site"}
          </a>
        )}
      </div>
      {/* ‼️ TWO DIFFERENT SILENCES, AND THEY ARE NOT THE SAME PROBLEM. No kind means this client
          has no site pages of either sort yet, which is an ordinary early state. No href with a
          kind means the signing key is missing, which is an environment fault somebody has to go
          and fix. Printing the env message for both sent people hunting a variable that was set. */}
      {!previewKind && (
        <p className="mt-2 text-xs text-[rgba(255,255,255,0.4)]">
          No site to preview yet. Paste one in on the website step, or let the replica build from
          their existing site.
        </p>
      )}
      {previewKind && !previewHref && (
        <p className="mt-2 text-xs text-[rgba(255,255,255,0.4)]">
          No preview link could be signed: CLIENT_LINK_SECRET is not set on this environment.
        </p>
      )}

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
