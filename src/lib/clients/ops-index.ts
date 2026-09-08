// The one pinned message in a client's channel: everything that can be set up, and where.
//
// Matthew asked for the channel to hold "offers, avatars, workflows, pages, concierge settings,
// lead magnets, and a list of every option so anything can be set up from there".
//
// ─────────────────────────────────────────────────────────────────────────────
// ‼️ ONE MESSAGE, RE-RENDERED, NEVER RE-POSTED. Same pattern as refreshHeader and for the same
// reason: Slack orders a channel by post time, so a delete-and-repost moves the index to the
// bottom permanently, underneath forty-one step anchors. Every change is a chat.update against
// clients.ops_index_ts.
//
// ‼️ IT IS A RENDER OF CURRENT STATE, NOT A LOG. Every line is read at render time from the
// record it describes, so the index cannot say "offer locked" about a client whose offer was
// changed afterwards. Nothing here caches and nothing here remembers.
//
// ‼️ IT IS NOT A SECOND BOARD, and that is the line it must not cross. reachableCursor is the
// single answer to what work may appear, and all three schedulers gate on it. This message
// names the DATASETS that hang off a client and the commands that reach them; it never lists
// steps, never says what to do next and never grows a button. A pinned message that started
// offering work would be an ungated surface dumping the whole backlog, which is precisely what
// the step board replaced.
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { channelFor } from "./step-board";

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
}

export interface IndexResult {
  ok: boolean;
  ts?: string;
  error?: string;
}

interface IndexFacts {
  id: string;
  name: string;
  slug: string | null;
  domain: string | null;
  offerLine: string;
  avatarLine: string;
  pages: number;
  publishedPages: number;
  magnets: number;
  reviewSources: number;
  concierge: string;
}

/**
 * Everything the index states, read at render time.
 *
 * ‼️ EVERY ONE OF THESE IS A COUNT OR A STORED VALUE. Nothing is inferred and nothing is a
 * model's summary, so a line that looks wrong can be checked against the table it came from.
 */
async function facts(clientId: string): Promise<IndexFacts | null> {
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, legal_name, dba_name, slug, domain")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) return null;

  const { loadOffer, offerLine } = await import("./offers");
  const { confirmedAvatarFor } = await import("./avatars");

  const [offer, avatar] = await Promise.all([loadOffer(clientId), confirmedAvatarFor(clientId)]);

  const [pages, publishedPages, magnets, reviewSources] = await Promise.all([
    countRows("client_pages", clientId),
    countRows("client_pages", clientId, "status", "published"),
    // The client's OWN magnets. The seven library rows have client_id null and belong to
    // everybody, so counting them here would tell every client they have seven of something.
    countRows("lead_magnets", clientId),
    countRows("page_sources", clientId, "source_type", "CUSTOMER_REVIEW"),
  ]);

  const { data: concierge } = await supabaseAdmin
    .from("concierge_configs")
    .select("audience, status")
    .eq("client_id", clientId);

  const live = (concierge ?? []).filter((c) => c.status === "live").length;

  return {
    id: clientId,
    name: ((client.dba_name || client.legal_name) as string) ?? "this client",
    slug: (client.slug as string | null) ?? null,
    domain: (client.domain as string | null) ?? null,
    offerLine: offerLine(offer),
    avatarLine: avatar
      ? `*${avatar.label}* (\`${avatar.slug}\`), confirmed.`
      : "*none confirmed.* Every page is written for somebody.",
    pages,
    publishedPages,
    magnets,
    reviewSources,
    concierge: (concierge ?? []).length
      ? `${live} of ${(concierge ?? []).length} live`
      : "not set up",
  };
}

/**
 * A head-only count for one client, optionally narrowed to one column value.
 *
 * ‼️ A QUERY ERROR RETURNS 0 HERE AND THAT IS ACCEPTABLE ONLY BECAUSE THIS IS AN INDEX. Every
 * other counter in this codebase distinguishes "the query failed" from "there are none",
 * because those are opposite claims about a business and one of them ends up in a client PDF.
 * Nothing on this message is evidence, nothing verifies a step against it, and no artifact
 * reads it: it is a signpost in an internal channel. If that ever stops being true, this needs
 * the null-on-error treatment countRows in step-verify.ts has.
 */
async function countRows(
  table: string,
  clientId: string,
  column?: string,
  value?: string
): Promise<number> {
  let q = supabaseAdmin
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId);

  if (column && value !== undefined) q = q.eq(column, value);

  const { count } = await q;
  return count ?? 0;
}

/**
 * The index, as it reads.
 *
 * ‼️ WELL UNDER THE 3,000 CHARACTER CEILING, and it has to stay that way. A message over it
 * fails ENTIRELY rather than being truncated, so an index that grew past it would simply stop
 * existing, silently, on the clients with the most in it. That is why this is a fixed set of
 * lines with counts in them rather than a list of the things being counted.
 */
export function indexText(f: IndexFacts): string {
  const board = `${appUrl()}/dashboard/clients/${f.id}`;

  return [
    `:card_index_dividers: *${f.name}*${f.domain ? ` · ${f.domain}` : ""}`,
    "",
    `*Offer* ${f.offerLine}`,
    `*Avatar* ${f.avatarLine}`,
    "",
    `*Pages* ${f.pages} drafted, ${f.publishedPages} published`,
    `*Lead magnets* ${f.magnets}`,
    `*Customer reviews filed* ${f.reviewSources}`,
    `*Concierge* ${f.concierge}`,
    "",
    "*Set anything up from here*",
    `  • Everything: ${board}`,
    `  • Offer, avatar, keywords, pages, review quotes: type \`page ${f.slug ?? f.name}\` in <#${pageStudio()}>`,
    `  • Theme and design: ${board}#theme`,
    `  • Concierge: ${board}#concierge`,
    `  • Review handover and destinations: ${board}#review-handover`,
    "",
    "_The steps are the messages below this one. This message is the index and never moves._",
  ].join("\n");
}

function pageStudio(): string {
  return process.env.SLACK_PAGE_STUDIO_CHANNEL || "C09QPHZGPUY";
}

/**
 * Render the index, creating and pinning it the first time.
 *
 * ‼️ THE ts IS CLAIMED CONDITIONALLY, the same shape postStepAnchor uses. Two concurrent calls
 * on a client with no index yet would otherwise post two, and the loser's message would sit in
 * the channel forever with nothing pointing at it.
 */
export async function refreshOpsIndex(clientId: string): Promise<IndexResult> {
  const channel = await channelFor(clientId);
  if (!channel) return { ok: false, error: "no_channel" };

  // ‼️ ONLY IN A CHANNEL OF THIS CLIENT'S OWN. In the shared onboarding channel the index would
  // be one of many, pinned alongside every other client's, and "the pinned message" would stop
  // meaning anything. A client on the fallback channel has the pinned HEADER and that is the
  // right amount of furniture for a channel they share.
  const { data: row } = await supabaseAdmin
    .from("clients")
    .select("ops_channel_id, ops_index_ts")
    .eq("id", clientId)
    .maybeSingle();

  if (!row?.ops_channel_id) return { ok: false, error: "no_ops_channel" };

  const f = await facts(clientId);
  if (!f) return { ok: false, error: "client not found" };

  const text = indexText(f);
  const existing = (row.ops_index_ts as string | null) ?? null;

  if (existing) {
    const res = (await slack.updateMessage(channel, existing, text)) as { ok?: boolean; error?: string };
    if (res?.ok) return { ok: true, ts: existing };
    // ‼️ A FAILED EDIT IS NOT A REASON TO POST A SECOND ONE. message_not_found means somebody
    // deleted it by hand, and that is the only case worth recovering from; anything else
    // (rate limits, a bad token, a channel the bot left) is transient and re-posting would
    // leave a duplicate behind once it clears.
    if (res?.error !== "message_not_found") {
      return { ok: false, error: res?.error ?? "index edit failed" };
    }
  }

  const posted = (await slack.postMessage(channel, text)) as { ok?: boolean; ts?: string; error?: string };
  if (!posted?.ok || !posted.ts) return { ok: false, error: posted?.error ?? "index post failed" };

  const { data: claimed } = await supabaseAdmin
    .from("clients")
    .update({ ops_index_ts: posted.ts, updated_at: new Date().toISOString() })
    .eq("id", clientId)
    .is("ops_index_ts", existing ? posted.ts : null)
    .select("id")
    .maybeSingle();

  if (!claimed && !existing) {
    // Somebody else won the race. Their message is the index; remove ours so the channel does
    // not carry two.
    await slack.deleteMessage(channel, posted.ts).catch(() => {});
    return { ok: true };
  }

  // Recovering from a hand-deleted index, or a first post that won: re-point the column.
  if (existing) {
    await supabaseAdmin
      .from("clients")
      .update({ ops_index_ts: posted.ts, updated_at: new Date().toISOString() })
      .eq("id", clientId);
  }

  await slack.pinMessage(channel, posted.ts);
  return { ok: true, ts: posted.ts };
}
