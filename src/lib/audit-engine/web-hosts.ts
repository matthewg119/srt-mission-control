// ─────────────────────────────────────────────────────────────────────────────
// Hosts that are not a business's own website
// ─────────────────────────────────────────────────────────────────────────────
//
// Lifted out of instagram/profile.ts so that mention-match.ts can consult the SAME list. It used
// to live only in the Instagram lane, which meant buildAliases had no idea whether the URL it was
// handed was the business's site or somebody else's platform, and it turned the second kind into
// a matching alias. See the ‼️ note on the bare-domain token in buildAliases for what that cost.
//
// Split into two lists because they fail differently. An AGGREGATOR is a page we can usefully
// open, since the real site is normally one click inside it. A SOCIAL or booking host is a dead
// end: the hook is written from pages the business controls and wrote, and a Calendly or a
// Facebook page is neither.

export const AGGREGATOR_HOSTS = new Set([
  "linktr.ee", "beacons.ai", "linkin.bio", "bio.link", "msha.ke", "withkoji.com",
  "stan.store", "shorby.com", "campsite.bio", "solo.to", "carrd.co", "flowcode.com",
  "linkpop.com", "tap.bio", "lnk.bio", "milkshake.app", "komi.io", "beacons.page",
]);

/**
 * ‼️ BOOKING AND PRACTICE-MANAGEMENT SOFTWARE, WHICH IS A SUBSET OF THE LIST BELOW AND NOT THE
 * SAME THING AS IT. Both are "not their site", and for resolveBioLink that is all that matters.
 * They stop being interchangeable the moment a SENTENCE is built from which one it was:
 * dmReasonLine("booking_only") tells the prospect that the only page an engine can find of theirs
 * "belongs to your booking software, so what it repeats was written to sell appointments rather
 * than written by you". That is true of a Vagaro or an Aesthetic Record page. It is false of a
 * Facebook page, a Yelp listing or a Threads profile, and false in a way the prospect corrects on
 * the first line.
 *
 * Directories and marketplaces (yelp, zocdoc, healthgrades, opentable) are deliberately NOT here
 * even where they take bookings. They are somebody else writing about the business, which is what
 * dmReasonLine("not_surfacing") already describes; calling one "your booking software" would be
 * telling a prospect they pay for something they do not.
 *
 * Spread into NEVER_THEIR_SITE_HOSTS below rather than listed twice, so the two cannot drift.
 */
export const BOOKING_HOSTS = new Set([
  // ‼️ A med spa's Instagram bio link is very often a booking page and nothing else, and the
  // page is real: it loads, it ranks, and it is what a search engine finds. It is still not theirs.
  // Left off these lists entirely, such a link is taken as the business's own website, the crawler
  // reads the vendor's page, and any site finding is a fact about the vendor offered as a fact
  // about the client. It also hands buildAliases a token like "myaestheticrecord", which then
  // matches every answer naming the platform. That is the same defect that scored a clinic 4 of 4
  // off the token "threads".
  "myaestheticrecord.com", "aestheticrecord.com", "zenoti.com", "boulevard.io",
  "getboulevard.com", "janeapp.com", "acuityscheduling.com", "setmore.com",
  "schedulicity.com", "fresha.com", "phorest.com", "glossgenius.com",
  "simplybook.me", "timely.com", "podium.com",
  "calendly.com", "booksy.com", "vagaro.com", "mindbodyonline.com",
  "square.site", "squareup.com",
]);

export const NEVER_THEIR_SITE_HOSTS = new Set([
  "instagram.com", "facebook.com", "fb.com", "m.facebook.com", "tiktok.com", "twitter.com",
  "x.com", "youtube.com", "youtu.be", "linkedin.com", "pinterest.com", "snapchat.com",
  // ‼️ BOTH Threads domains. It shipped on threads.net and moved to threads.com, and for a while
  // only the .net was listed here. A Hairthetics run took the threads.com bio link as their
  // website, crawled it, reported "no LocalBusiness schema on the site" about Meta's page rather
  // than theirs, and handed buildAliases the token "threads" - which then matched every answer
  // mentioning PDO threads or a thread lift and scored the clinic as present in 4 of 4 searches
  // it was almost certainly absent from.
  "threads.net", "threads.com",
  "yelp.com", "google.com", "goo.gl", "maps.app.goo.gl", "wa.me",
  "api.whatsapp.com", "zocdoc.com", "doximity.com", "healthgrades.com",
  "opentable.com", "amazon.com", "shopify.com", "eventbrite.com", "mailchi.mp",
  ...BOOKING_HOSTS,
]);

/** Hostname, lowercased, with a leading www. dropped. Null when the input will not parse. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  const raw = String(url).trim();
  if (!raw) return null;
  try {
    return new URL(raw.startsWith("http") ? raw : `https://${raw}`).hostname
      .replace(/^www\./i, "")
      .toLowerCase();
  } catch {
    return null;
  }
}

/**
 * A platform page, never the business's own site.
 *
 * Subdomains count: `l.threads.com` and `m.facebook.com` are the same dead end as the apex.
 */
export function isNeverTheirSite(url: string | null | undefined): boolean {
  const host = hostOf(url);
  if (!host) return false;
  return (
    NEVER_THEIR_SITE_HOSTS.has(host) ||
    [...NEVER_THEIR_SITE_HOSTS].some((h) => host.endsWith(`.${h}`))
  );
}

/**
 * Is this URL a booking or practice-management page the business pays a vendor for?
 *
 * ‼️ IT IS WHAT LICENSES A CLAIM, not just a routing decision, which is why it is a separate
 * predicate from isNeverTheirSite rather than a flag on it. The booking_only reason line names the
 * software; a false positive here puts a sentence about "your booking software" in front of
 * somebody whose bio link is a Facebook page. Subdomains count, and that is the point:
 * theplumproom.myaestheticrecord.com is the shape these links actually take.
 */
export function isBookingHost(url: string | null | undefined): boolean {
  const host = hostOf(url);
  if (!host) return false;
  return BOOKING_HOSTS.has(host) || [...BOOKING_HOSTS].some((h) => host.endsWith(`.${h}`));
}

/** A link-in-bio page. Openable, and the real site is usually one click inside it. */
export function isAggregatorHost(url: string | null | undefined): boolean {
  const host = hostOf(url);
  return host ? AGGREGATOR_HOSTS.has(host) : false;
}

/**
 * Would a bare-domain token off this URL be somebody else's word rather than the business's name?
 *
 * True for both lists. `threads.com` yields "threads" and `linktr.ee` yields "linktr", and neither
 * is a name the business would be called by in an engine answer.
 */
export function isBorrowedHost(url: string | null | undefined): boolean {
  return isNeverTheirSite(url) || isAggregatorHost(url);
}
