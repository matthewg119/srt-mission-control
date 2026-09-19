// The concierge as a paid add-on: include it on the call, or skip it and install it later.
//
// Matthew, 2026-09-15: "we will charge for this additionally so it can be optional in the onboarding but If I
// skip it I still may be able to come back and install it with some sort of prompts or whatever lets make
// this happen and make it possible."
//
// ‼️ DECLINING IS NOT SKIPPING THE STEP. Step 18 still provisions the config row, because page drafting, page
// magnets, publishing and the site replica all read the catalogue through it (page-gate.ts, pre-call-pages.ts,
// magnet-drafts.ts). A skip would strand all of those. So both buttons record a decision and tick the step;
// `declined` only keeps the widget off every live page, and `concierge install` in any of this client's
// threads undoes it.

import { supabaseAdmin } from "@/lib/db";
import type { AddonStatus } from "@/lib/concierge/config";

/** The line a client pastes before </body> on their own website. */
export function embedSnippet(slug: string): string {
  // Lazy import keeps this file importable from pure probes without the env origin resolver.
  const origin = process.env.CONCIERGE_HOST ? `https://${process.env.CONCIERGE_HOST}` : "https://concierge.srtagency.com";
  return `<script async src="${origin}/embed.js" data-client="${slug}"></script>`;
}

/** The demo: their themed hub with sample text and the corner assistant, on our own host, no DNS needed. */
export async function conciergeDemoUrlFor(clientId: string): Promise<string | null> {
  try {
    const [{ signOnboardingToken }, { PREVIEW_TOKEN_TTL_DAYS }, { previewOrigin }] = await Promise.all([
      import("./token"),
      import("./referral-engine-preview"),
      import("@/lib/concierge/origin"),
    ]);
    const { token } = signOnboardingToken(clientId, PREVIEW_TOKEN_TTL_DAYS, "preview");
    return `${previewOrigin()}/preview/${encodeURIComponent(token)}?kind=concierge`;
  } catch (e) {
    console.error("[concierge-addon] demo link not minted:", (e as Error).message);
    return null;
  }
}

export async function addonStatusFor(clientId: string): Promise<AddonStatus | null> {
  const { data } = await supabaseAdmin.from("concierge_configs").select("addon_status").eq("client_id", clientId).maybeSingle();
  if (!data) return null;
  return data.addon_status === "included" || data.addon_status === "declined" ? data.addon_status : "undecided";
}

export async function setConciergeAddon(args: {
  clientId: string;
  status: Exclude<AddonStatus, "undecided">;
  by: string;
}): Promise<{ ok: true; lines: string[] } | { ok: false; error: string }> {
  const { data: row } = await supabaseAdmin
    .from("concierge_configs")
    .select("client_id, clients!inner(slug)")
    .eq("client_id", args.clientId)
    .maybeSingle();
  if (!row) {
    return { ok: false, error: "this client has no concierge row yet. Step 18 (concierge_preview) creates it; Retry it on the board first." };
  }
  const { error } = await supabaseAdmin
    .from("concierge_configs")
    .update({ addon_status: args.status, addon_decided_at: new Date().toISOString(), addon_decided_by: args.by, updated_at: new Date().toISOString() })
    .eq("client_id", args.clientId);
  if (error) return { ok: false, error: error.message };

  const { revalidateTag } = await import("next/cache");
  try {
    revalidateTag("concierge-config");
  } catch {
    /* outside a request the five minute cache covers it */
  }

  const clients = (row as unknown as { clients: { slug: string } | Array<{ slug: string }> }).clients;
  const slug = Array.isArray(clients) ? clients[0]?.slug : clients?.slug;
  const demo = await conciergeDemoUrlFor(args.clientId);

  const { logClientEvent } = await import("./client-events");
  await logClientEvent({
    clientId: args.clientId,
    stepKey: "concierge_preview",
    source: "slack",
    kind: "command",
    author: args.by,
    text: `concierge ${args.status}`,
    payload: { handler: "concierge-addon", status: args.status },
  });

  return {
    ok: true,
    lines:
      args.status === "included"
        ? [
            `:white_check_mark: *AI concierge included* by ${args.by}. It goes live on their pages at the \`concierge_live\` step, after the call.`,
            demo ? `Demo on a sample page: ${demo}` : "",
            slug ? `For their own website, the one line before </body>:\n\`\`\`${embedSnippet(slug)}\`\`\`` : "",
          ].filter(Boolean)
        : [
            `:no_entry_sign: *AI concierge not included* (${args.by}). Nothing appears on their pages. Their pages, magnets and plan are unaffected.`,
            "To add it later, type `concierge install` in any of this client's step threads.",
          ],
  };
}

const INSTALL = /^\s*[`*_]*concierge\s+(install|include|decline|remove)\s*[`*_]*\s*$/i;

/** `concierge install` / `concierge decline` in any step thread of this client. */
export async function handleConciergeAddonThreadReply(args: {
  clientId: string;
  stepKey: string | null;
  text: string;
  by: string;
}): Promise<{ message: string; after?: () => Promise<void> } | null> {
  const m = INSTALL.exec(args.text);
  if (!m) return null;
  const status = /install|include/i.test(m[1]) ? "included" : "declined";
  const res = await setConciergeAddon({ clientId: args.clientId, status, by: args.by });
  if (!res.ok) return { message: `:warning: ${res.error}` };
  return {
    message: res.lines.join("\n"),
    after: async () => {
      const { postStep } = await import("./step-engine");
      await postStep(args.clientId, "concierge_preview").catch(() => {});
    },
  };
}
