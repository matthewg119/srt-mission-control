// The buttons under a reply, and the reason the model cannot write one.
//
// ‼️ THE WIDGET OPENED ON THREE DOORS AND THEN HAD NONE. Matthew's ask, off the Expedia virtual
// agent: a visitor should always be able to tap rather than type. /api/concierge/start already
// returns quick actions for the FIRST bubble; this is the same idea for every bubble after it.
//
// ‼️ chipsFor() TAKES NO REPLY TEXT, AND THAT IS THE WHOLE DESIGN. Nothing here can be influenced
// by what the model wrote, because the model's words are not an argument to it. Every chip comes
// off a row in the database or off a counter that was already there:
//
//   - the magnet comes from allowedMagnet(), the EXACT function offer_magnet uses, so a chip can
//     only ever offer the thing the executor would have offered next, and the already-delivered
//     exclusion applies unchanged;
//   - the pages are the client's own published pages, ordered the way the hub orders them;
//   - the call is offered only when bookingGate() says it may be.
//
// A model that could name its own buttons would be writing the interface, and the first thing it
// would write is the button it wanted pressed. tools.ts already refuses to hand it business names
// and numbers for the same reason.
//
// ‼️ IT IMPORTS NO MODEL. scripts/_probe-concierge-lane.ts asserts that, and it is the difference
// between "we believe the chips are deterministic" and "the chips cannot be anything else".

import { supabaseAdmin } from "@/lib/db";
import { siteUrl, hubDestination } from "@/lib/hub/destinations";
import { listPublished } from "@/lib/hub/pages";
import { allowedMagnet, bookingGate } from "./engine";
import { deliveryUrlFor, pillLabel } from "./magnets";
import type { ConciergeConfig } from "./config";
import type { ConciergeSession } from "./session";

/** At most this many buttons under one reply. Four is a menu; three is a suggestion. */
const MAX_CHIPS = 3;

/** How many of the client's own pages may appear as chips in one turn. */
const MAX_PAGE_CHIPS = 2;

export interface TurnChip {
  kind: "magnet" | "page" | "booking";
  /** Stable identifier for the thing offered. Not shown. */
  key: string;
  label: string;
  /** Present for anything that opens somewhere. Absent for a chip the frame handles itself. */
  url?: string;
}

/**
 * Deliberately NOT ExecutorContext.
 *
 * chipsFor is called by the turn route AFTER runConciergeTurn returns, not from inside the
 * executor, so that this module imports engine.ts and engine.ts does not import this one. A
 * circular import between the two would be resolved at runtime by whichever side loaded first,
 * which is not a thing to leave to chance in a file whose job is to be predictable.
 *
 * Calling it afterwards is also what makes the counts right: recordDelivered() writes
 * session.magnetsDelivered back onto the object during the turn, so a magnet handed over in this
 * very reply is already excluded from the chip under it.
 */
export interface ChipInput {
  config: ConciergeConfig;
  session: ConciergeSession;
  /** Computed from the visitor's own words by asksToBook(), before the model ran. */
  visitorAskedToBook: boolean;
}

/**
 * Where the client's pages live, as WIRED rather than as derived.
 *
 * Same rule review-card.ts states over the same table: client_hosts holds what was actually
 * attached, and constructing `learn.{domain}` from a domain column would produce a confident link
 * to a hostname that may never have been set up. No row means no page chips, which is a widget
 * with one fewer button rather than a widget offering a dead one.
 *
 * ‼️ THIS WAS A PRIVATE FOURTH READER OF client_hosts AND IS NOW hubDestination(). It read the
 * host column and composed `https://${host}/${slug}` per chip, which is right on a subdomain
 * and wrong on a subfolder. The read it replaced returned any hub row; this one is the
 * SUBDOMAIN hub specifically, so a subfolder-only client gets no page chips rather than chips
 * pointing at a hostname their visitors never see. That is the same "no row, no chips" trade
 * this helper has always made, and it stops being a limitation when a page carries its own
 * destination.
 */
async function hubDest(clientId: string) {
  try {
    return await hubDestination(clientId);
  } catch (e) {
    console.error(`[concierge/chips] host read failed: ${(e as Error).message}`);
    return null;
  }
}

/**
 * The buttons for the turn that just ended.
 *
 * Returns [] on any failure. Chips are an affordance on a reply that was already sent and read
 * fine without them; a throw here would take down a turn the visitor has already had.
 */
export async function chipsFor(input: ChipInput): Promise<TurnChip[]> {
  try {
    const chips: TurnChip[] = [];

    // 1. The next free thing, chosen by the executor's own rule.
    const magnet = await allowedMagnet({ config: input.config, session: input.session });
    if (magnet) {
      const url = await deliveryUrlFor(magnet);
      if (url) {
        chips.push({
          kind: "magnet",
          key: magnet.magnetKey ?? magnet.id,
          label: pillLabel(magnet),
          url,
        });
      }
    }

    // 2. The client's own published pages. "Other posts", in Matthew's words: the reason the
    //    widget is worth putting on every page of a site rather than only on the review page.
    const destination = await hubDest(input.config.clientId);
    if (destination) {
      const pages = await listPublished(input.config.clientId);
      for (const page of pages.slice(0, MAX_PAGE_CHIPS)) {
        chips.push({
          kind: "page",
          key: page.id,
          label: page.question || page.title,
          url: siteUrl(destination, page.slug),
        });
      }
    }

    // 3. The call, and only when the stacking rule allows it.
    //
    // ‼️ THE GATE IS NOT BYPASSED, IT IS SATISFIED. A visitor who typed something asksToBook()
    // recognised has asked, and bookingGate already returns `offered` for that case. Offering a
    // call from a chip while the model is still being told to hand over two free things first
    // would be two different policies on one screen.
    if (bookingGate(input.session.magnetsDelivered.length, input.visitorAskedToBook).offered) {
      chips.push({ kind: "booking", key: "booking", label: "Book a call" });
    }

    return chips.slice(0, MAX_CHIPS);
  } catch (err) {
    console.error(`[concierge/chips] ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}
