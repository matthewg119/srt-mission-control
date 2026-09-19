// Where a customer posts her review, pasted by a person from wherever they happen to be.
//
// ‼️ MEASURED ON SRT, 2026-09-15. Step 20's review card was generated and ticked green. Its QR opens
// reviews.srtagency.com, the four questions work, and at the end there is no button: the record
// names Trustpilot as the client's platform and nobody ever pasted a Trustpilot link. The only box
// that could take one was the Review handover panel on the dashboard, which nobody walking the
// Slack board ever opens. So every printed card led to a page that ends in "go and find the review
// page yourself".
//
// Matthew: keep the four questions and the Post button, and give us the chance to paste the link
// right there. So one writer, three doors:
//
//   `review link: <url>` in the review steps' threads   (handleReviewLinkThreadReply)
//   [Paste review link] on those cards, a Slack modal    (slack/actions reviewLinkModal)
//   the paste box on the AI Referral Engine preview page         (api/clients/[id]/review-workflow)
//
// ‼️ ABSENT BEATS WRONG STILL HOLDS. Nothing here builds a URL. A link is stored only when a person
// pasted it, it is https, and its host is the platform it claims to be. A Yelp link pasted as
// Trustpilot is refused rather than filed under the wrong button.

import { supabaseAdmin } from "@/lib/db";
import {
  REVIEW_PLATFORMS,
  destinationLine,
  destinationState,
  parseReviewUrl,
  platformByKey,
  platformFromUrl,
  type ReviewPlatform,
} from "@/lib/hub/review-destinations";

/**
 * The steps whose threads and cards take a review link.
 *
 * ‼️ offer_locked IS THE PREP CALL AND IT IS FIRST ON PURPOSE (2026-09-16). Matthew: "I need to
 * remember the review link that they want make sure We ask for that in the call where i confirm they're
 * ideal offer ... so we can have all the work ready in the back end by asking the right questions."
 * Until now the first time anybody was asked was step 20, by which point the review card PDF had already
 * been generated with a QR pointing at a page whose Post button goes nowhere, and the step could not tick.
 * The link never needed the card to exist; it needed somebody on a phone call to ask.
 */
export const REVIEW_LINK_STEPS = new Set([
  "offer_locked",
  "referral_engine_preview",
  "review_card_pdf",
  "referral_engine_handed",
]);

export type SetReviewLinkResult =
  | { ok: true; platform: ReviewPlatform; line: string; primarySet: boolean }
  | { ok: false; error: string };

/**
 * Store one review link. Merges into `review_workflow`, never replacing it: intake step 4 owns ten
 * other keys in that bag and the call sheet is built from them.
 */
export async function setReviewLink(args: {
  clientId: string;
  url: string;
  /** When the person picked a platform (the modal). Omitted, the link's host decides. */
  platformKey?: string | null;
  actor: string;
  source: "slack" | "dashboard";
}): Promise<SetReviewLinkResult> {
  const parsed = parseReviewUrl(args.url);
  if (!parsed.ok) return parsed;

  const byHost = platformFromUrl(parsed.value);
  const picked = args.platformKey ? platformByKey(args.platformKey) : null;
  if (args.platformKey && !picked) return { ok: false, error: `"${args.platformKey}" is not a review platform.` };

  if (!byHost) {
    const names = REVIEW_PLATFORMS.map((p) => p.name).join(", ");
    return {
      ok: false,
      error: `That link is not on ${names}. Paste the page where a customer writes the review, for example ${
        (picked ?? REVIEW_PLATFORMS[0]).placeholder
      }`,
    };
  }
  if (picked && picked.key !== byHost.key) {
    return { ok: false, error: `That link is a ${byHost.name} page, not ${picked.name}. Nothing was saved.` };
  }
  const platform = picked ?? byHost;

  const { data: client, error: readError } = await supabaseAdmin
    .from("clients")
    .select("review_workflow, review_destination_primary")
    .eq("id", args.clientId)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!client) return { ok: false, error: "Client not found." };

  const workflow = { ...((client.review_workflow ?? {}) as Record<string, unknown>) };
  workflow[platform.field] = parsed.value;

  // The client's own choice is a decision and is left alone. Only a client that never named one
  // gets the first pasted link as its primary, so the review page has an order at all.
  const primarySet = !client.review_destination_primary;
  const patch: Record<string, unknown> = { review_workflow: workflow, updated_at: new Date().toISOString() };
  if (primarySet) patch.review_destination_primary = platform.key;

  const { error } = await supabaseAdmin.from("clients").update(patch).eq("id", args.clientId);
  if (error) return { ok: false, error: error.message };

  const state = destinationState(workflow, (patch.review_destination_primary as string) ?? client.review_destination_primary);

  const { logClientEvent } = await import("./client-events");
  await logClientEvent({
    clientId: args.clientId,
    stepKey: "review_card_pdf",
    source: args.source,
    kind: "command",
    author: args.actor,
    text: `review link: ${parsed.value}`,
    payload: { handler: "review-link", platform: platform.key, primarySet },
  });

  // The public pages cache the client row; a link that only appears in five minutes reads as broken.
  const { revalidateClientHub } = await import("@/lib/hub/resolve");
  revalidateClientHub();

  return { ok: true, platform, line: destinationLine(state), primarySet };
}

/** The line a review card prints about where reviews go, read fresh. */
export async function reviewDestinationLine(clientId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("clients")
    .select("review_workflow, review_destination_primary")
    .eq("id", clientId)
    .maybeSingle();
  if (!data) return "";
  return destinationLine(
    destinationState(data.review_workflow as Record<string, unknown> | null, data.review_destination_primary as string | null)
  );
}

/** Does this client have at least one real review link? The review card's verifier asks. */
export async function hasReviewLink(clientId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("clients")
    .select("review_workflow, review_destination_primary")
    .eq("id", clientId)
    .maybeSingle();
  if (!data) return false;
  return (
    destinationState(data.review_workflow as Record<string, unknown> | null, data.review_destination_primary as string | null)
      .configured.length > 0
  );
}

const REVIEW_LINK_COMMAND = /^\s*[`*_]*review\s+link\s*:\s*(\S+)\s*[`*_]*\s*$/i;
const REVIEW_PLATFORM_COMMAND = /^\s*[`*_]*review\s+platform\s*:\s*([a-z .]{2,30})\s*[`*_]*\s*$/i;

/**
 * `review platform: Trustpilot`, the answer to the first of the two prep call questions.
 *
 * ‼️ IT RECORDS THE CHOICE WITHOUT A URL, WHICH IS THE POINT. On the call the answer to "where do
 * your reviews go" arrives a minute before anybody has found the page, and the two used to be one
 * command, so the answer was lost and asked again at step 20. Recording it alone lets the card say which
 * platform is still missing its link instead of asking the whole question twice.
 */
async function setReviewPlatform(args: {
  clientId: string;
  name: string;
  actor: string;
}): Promise<{ ok: true; platform: ReviewPlatform } | { ok: false; error: string }> {
  const wanted = args.name.trim().toLowerCase().replace(/[.\s]+/g, "");
  const platform = REVIEW_PLATFORMS.find(
    (p) => p.key === wanted || p.name.toLowerCase().replace(/[.\s]+/g, "") === wanted
  );
  if (!platform) {
    return { ok: false, error: `"${args.name.trim()}" is not one we can post to. ${REVIEW_PLATFORMS.map((p) => p.name).join(", ")}.` };
  }
  const { error } = await supabaseAdmin
    .from("clients")
    .update({ review_destination_primary: platform.key, updated_at: new Date().toISOString() })
    .eq("id", args.clientId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, platform };
}

/** `review link: <url>` in a review step's thread. Null when the text is not that command. */
export async function handleReviewLinkThreadReply(args: {
  clientId: string;
  stepKey: string | null;
  text: string;
  by: string;
}): Promise<{ message: string; after?: () => Promise<void> } | null> {
  if (!args.stepKey || !REVIEW_LINK_STEPS.has(args.stepKey)) return null;

  const chose = REVIEW_PLATFORM_COMMAND.exec(args.text);
  if (chose) {
    const res = await setReviewPlatform({ clientId: args.clientId, name: chose[1], actor: args.by });
    if (!res.ok) return { message: `:warning: ${res.error}` };
    return {
      message:
        `:white_check_mark: *${res.platform.name}* is where their reviews go, ${args.by}. ` +
        `Now the page itself: \`review link: <url>\`, and the card's QR is right the first time it is printed.`,
    };
  }

  const m = REVIEW_LINK_COMMAND.exec(args.text);
  if (!m) return null;

  const res = await setReviewLink({ clientId: args.clientId, url: m[1], actor: args.by, source: "slack" });
  if (!res.ok) return { message: `:warning: ${res.error}` };

  return {
    message: [
      `:white_check_mark: *${res.platform.name}* link saved. The review page now ends with "${res.platform.label}".`,
      res.primarySet ? `No platform was chosen before, so ${res.platform.name} is their primary now.` : "",
      res.line,
    ]
      .filter(Boolean)
      .join("\n"),
    after: async () => {
      const { postStep } = await import("./step-engine");
      const { setDeliveryStep } = await import("./delivery-checklist");
      // The card was ticked (or refused) before the link existed. Re-render it, and give the
      // verifier its second look now that the one thing it waits on is here.
      await setDeliveryStep({
        clientId: args.clientId,
        stepKey: "review_card_pdf",
        transition: "complete",
        actor: args.by,
      }).catch(() => ({ ok: false }));
      await postStep(args.clientId, "review_card_pdf").catch(() => {});
    },
  };
}
