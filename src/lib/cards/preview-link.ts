// The per-lead link behind /cards/p, and the one place that decides what the QR points at.
//
// SERVER ONLY. It reaches token.ts, which imports node:crypto; importing this from a client
// component fails the browser bundle with "Module not found" and tsc will not warn you. The page
// resolves the lead on the server and hands the client component plain strings.
//
// ‼️ A SIGNED TOKEN AND NOT A BARE CONTACT ID IN THE URL. The page prints a business name and a
// town off a contacts row, so a bare uuid would make /cards/p a lookup anybody could walk by
// guessing, and uuids leak: they are in Slack messages, in email headers and in anybody's history.
// The `card` scope fails closed in both directions, which is the whole reason token.ts carries
// scopes at all: an onboarding link cannot open this page and this link cannot open the onboarding
// funnel and its business data.
//
// ‼️ AND THE PAGE WORKS WITH NO TOKEN AT ALL. /cards/p is the generic version, which is what
// Matthew records the onboarding video against. It names no business and reads no row.

import { supabaseAdmin } from "@/lib/db";
import {
  isClientLinkSecretConfigured,
  signOnboardingToken,
  verifyOnboardingToken,
} from "@/lib/clients/token";

/**
 * How long a card preview link lives.
 *
 * Fourteen days, borrowed from PREVIEW_TOKEN_TTL_DAYS rather than invented, and for that link's
 * reason: this is minted for one conversation and a link that outlives the conversation is a link
 * somebody forwards. A lead who comes back in three weeks is a lead worth a fresh link and a
 * fresh message from a person.
 */
export const CARD_PREVIEW_TTL_DAYS = 14;

export function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
}

/**
 * What the QR code in the preview resolves to.
 *
 * ‼️ THE SAME PAGE THE BUTTON OPENS, WHICH IS WHAT MAKES "click or scan here" TRUE. A preview
 * whose code goes nowhere is the thing every clinic has already been sent by somebody else; a
 * clinic owner holding a phone over their own laptop and landing on the walkthrough is the entire
 * demonstration. /demo/agent reaches no database and stores nothing, which is why it is safe to
 * put behind a code that strangers may scan.
 *
 * ‼️ AND IT IS NOT WHAT A PRINTED CARD CARRIES. A real card's code points at the clinic's own
 * reviews host on their own domain, minted by review-card.ts off client_hosts. PREVIEW_SCAN.qrNote
 * says so on the screen, because an unsaid version of this is how somebody prints a thousand cards
 * pointing at our demo.
 */
export function cardQrTarget(): string {
  return `${appUrl()}/demo/agent?client=medspa123`;
}

/**
 * What screen two embeds, and what "Open it full screen" opens. `bare` drops the demo ribbon.
 *
 * ‼️ RELATIVE, AND THE QR TARGET ABOVE IS NOT. The difference is who is doing the opening. A
 * phone scanning a code is not on this page and needs an absolute URL; an iframe and a link ARE
 * on it, and a relative path keeps them on whatever host the visitor is actually looking at.
 *
 * ‼️ AND THAT IS A FIX RATHER THAN A TIDY-UP. These were built from appUrl(), which resolves
 * NEXT_PUBLIC_APP_URL, which is set to the PRODUCTION host in the Preview environment too. So
 * every preview deployment of this page embedded production's /demo/agent instead of its own:
 * the frame showed whatever was already live, a branch's changes to the walkthrough were
 * invisible in the one place built to show them off, and ?bare=1 did nothing until the day it
 * reached production. Measured on the first preview, 2026-10-09.
 */
export function insideUrl(bare: boolean): string {
  return `/demo/agent?client=medspa123${bare ? "&bare=1" : ""}`;
}

/** The generic preview, with no lead behind it. The onboarding video's URL. */
export function genericPreviewUrl(): string {
  return `${appUrl()}/cards/p`;
}

/**
 * A preview link for one lead, or null.
 *
 * ‼️ NULL RATHER THAN A BROKEN LINK, which is the same tri-state discipline BOOKING_LINK and
 * reviewShareUrl keep. Signing throws when CLIENT_LINK_SECRET is unset, a real state on a fresh
 * environment, and a Slack reply carrying a URL that 404s is worse than one saying the link could
 * not be minted. The caller says which happened.
 */
export function cardPreviewUrl(contactId: string): string | null {
  if (!contactId) return null;
  if (!isClientLinkSecretConfigured()) return null;
  try {
    const { token } = signOnboardingToken(contactId, CARD_PREVIEW_TTL_DAYS, "card");
    return `${appUrl()}/cards/p/${token}`;
  } catch {
    return null;
  }
}

/** What the page knows about who it is talking to. Everything optional: a lead is mostly gaps. */
export interface CardPreviewLead {
  contactId: string;
  /** What the card is headed with. Never empty: the caller substitutes the placeholder. */
  businessName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  city: string | null;
  website: string | null;
}

/**
 * The lead behind a token, or null for every refusal.
 *
 * ‼️ ONE INDISTINGUISHABLE ANSWER FOR EVERY FAILURE. A bad signature, an expired link and a
 * deleted contact all come back as null and the page renders the generic version. Telling them
 * apart on a public page tells a stranger holding a forged token which half of it was wrong, and
 * there is nothing a real clinic could do with the distinction anyway.
 */
export async function leadFromCardToken(
  token: string | null | undefined
): Promise<CardPreviewLead | null> {
  if (!token) return null;
  const verified = verifyOnboardingToken(token, "card");
  if (!verified.ok) return null;

  const { data } = await supabaseAdmin
    .from("contacts")
    .select("id, first_name, last_name, email, business_name, biz_city, website")
    .eq("id", verified.clientId)
    .maybeSingle();

  if (!data) return null;

  return {
    contactId: data.id as string,
    businessName: (data.business_name as string | null) ?? null,
    firstName: (data.first_name as string | null) ?? null,
    lastName: (data.last_name as string | null) ?? null,
    email: (data.email as string | null) ?? null,
    city: (data.biz_city as string | null) ?? null,
    website: (data.website as string | null) ?? null,
  };
}
