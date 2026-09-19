// The six places a review can be posted, written down once.
//
// ‼️ THIS FILE EXISTS BECAUSE THE SAME SIX PLATFORMS WERE SPELLED OUT IN THREE PLACES AND THE
// COMMENT WARNING ABOUT IT WAS THE ONLY THING HOLDING THEM TOGETHER.
//
// referral-engine.tsx's PLATFORMS carried the note: "ADDING A PLATFORM HERE IS NOT ENOUGH ON ITS
// OWN. The Review handover panel is the only writer of these URLs, and the onboarding2 question
// offers the same six names. All three lists have to agree or a client picks a platform nobody
// can paste a URL for."
//
// That was exactly the live failure. The funnel offered six names and the handover panel had
// two boxes, Google and RealSelf. SRT Agency's own record says `review_destination_primary =
// 'trustpilot'`, so the one platform the client chose was the one platform with nowhere to put
// its link, and the AI Referral Engine rendered no button at all. Nothing errored. The panel looked
// complete, the funnel looked complete, and the customer got the fallback hint telling her to
// go and find the review page herself.
//
// So the list is data now, and the three surfaces read it:
//
//   src/app/hub/[host]/reviews/referral-engine.tsx        which buttons render
//   src/app/api/clients/[id]/review-workflow/route.ts which keys are accepted and validated
//   src/app/dashboard/clients/[id]/review-workflow-form.tsx  which boxes are drawn
//
// A seventh platform is one entry here, and every surface picks it up.
//
// ─────────────────────────────────────────────────────────────────────────────
// ‼️ WHAT THIS FILE STILL DOES NOT DO, AND MUST NOT: BUILD A URL.
//
// `clients.review_destination_primary` is a NAME and never a link, and the note at
// lib/onboarding2/delivery.ts:116 says why: "a link built from a business name sends a real
// patient to somebody else's profile." The name decides ORDER. A destination appears if and
// only if a human pasted the real URL. There is no `searchUrl`, no template, no fallback, and
// adding one would turn "absent beats wrong" into "wrong is fine". ABSENT BEATS WRONG.
// ─────────────────────────────────────────────────────────────────────────────

export interface ReviewPlatform {
  /** Matches `clients.review_destination_primary`, lowercase, and `posted_destination`. */
  key: string;
  /** The `review_workflow` jsonb key holding the URL a human pasted. */
  field: string;
  /** The button on the AI Referral Engine. */
  label: string;
  /** The option in the onboarding2 funnel and the label intake step 4 stores. */
  name: string;
  /** Shown in the empty box on the handover panel, so the shape of a real link is obvious. */
  placeholder: string;
}

/**
 * In the order they are offered when several are configured.
 *
 * The order is only a tiebreak: `review_destination_primary` puts the client's own choice
 * first, and this decides the rest.
 */
export const REVIEW_PLATFORMS: readonly ReviewPlatform[] = [
  {
    key: "google",
    field: "google_url",
    label: "Post on Google",
    name: "Google",
    placeholder: "https://g.page/r/...",
  },
  {
    key: "yelp",
    field: "yelp_url",
    label: "Post on Yelp",
    name: "Yelp",
    placeholder: "https://www.yelp.com/writeareview/biz/...",
  },
  {
    key: "trustpilot",
    field: "trustpilot_url",
    label: "Post on Trustpilot",
    name: "Trustpilot",
    placeholder: "https://www.trustpilot.com/evaluate/...",
  },
  {
    key: "bbb",
    field: "bbb_url",
    label: "Post on BBB",
    name: "BBB",
    placeholder: "https://www.bbb.org/us/.../customer-reviews",
  },
  {
    key: "facebook",
    field: "facebook_url",
    label: "Post on Facebook",
    name: "Facebook",
    placeholder: "https://www.facebook.com/.../reviews",
  },
  {
    key: "realself",
    field: "realself_url",
    label: "Post on RealSelf",
    name: "RealSelf",
    placeholder: "https://www.realself.com/...",
  },
] as const;

/**
 * The hosts each platform's real review pages live on, for telling a pasted link's platform apart.
 *
 * ‼️ THIS RECOGNISES A LINK A HUMAN PASTED. IT DOES NOT MAKE ONE. A host match is how a bare
 * `review link: https://g.page/r/...` in a Slack thread knows it is the Google box, and how a link
 * pasted into the Trustpilot box that is actually a Yelp page gets refused instead of stored.
 * A host not listed here is refused rather than guessed at.
 */
const PLATFORM_HOSTS: Record<string, readonly string[]> = {
  google: ["g.page", "google.com", "maps.app.goo.gl", "goo.gl"],
  yelp: ["yelp.com"],
  trustpilot: ["trustpilot.com"],
  bbb: ["bbb.org"],
  facebook: ["facebook.com", "fb.com", "fb.me"],
  realself: ["realself.com"],
};

function hostMatches(host: string, root: string): boolean {
  return host === root || host.endsWith(`.${root}`);
}

/** The platform a pasted review URL belongs to, by its host, or null when it is none of the six. */
export function platformFromUrl(raw: string): ReviewPlatform | null {
  let host: string;
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
  const key = Object.keys(PLATFORM_HOSTS).find((k) => PLATFORM_HOSTS[k].some((root) => hostMatches(host, root)));
  return key ? platformByKey(key) : null;
}

/**
 * A review destination URL, or the reason it was refused.
 *
 * `https` only. A review link is opened by a customer on her own phone from a page on the
 * client's domain, and an `http://` one would be a mixed-content warning at the exact moment we
 * are asking her to trust the thing. `javascript:` and `data:` are the reason this parses rather
 * than pattern-matching. Moved here from the review-workflow route so the Slack thread, the Slack
 * modal and the preview page refuse exactly the same links.
 */
export function parseReviewUrl(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  // Slack wraps links it recognised as <https://...> or <https://...|label>.
  const s = raw.trim().replace(/^<([^|>]+)(\|[^>]*)?>$/, "$1");
  let parsed: URL;
  try {
    parsed = new URL(s);
  } catch {
    return { ok: false, error: `"${s}" is not a URL. Paste the whole link, including https://.` };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, error: `"${s}" is not https. A review link opens on a customer's phone from the client's own domain.` };
  }
  return { ok: true, value: parsed.toString() };
}

/** Every URL key, for a route that validates what it was sent. */
export const REVIEW_URL_KEYS: readonly string[] = REVIEW_PLATFORMS.map((p) => p.field);

/** The platform a key names, or null. Zero matches and two matches are the same answer. */
export function platformByKey(key: string | null | undefined): ReviewPlatform | null {
  if (!key) return null;
  const wanted = key.trim().toLowerCase();
  return REVIEW_PLATFORMS.find((p) => p.key === wanted) ?? null;
}

/**
 * Which platforms this client actually has a link for, and which they said they wanted.
 *
 * Pure, so the AI Referral Engine, the board panel and a Slack card can all describe the same state in
 * the same words without one of them working it out differently.
 */
export interface DestinationState {
  /** Platforms with a real pasted URL, the client's primary first. */
  configured: ReviewPlatform[];
  /** The platform named by review_destination_primary, whether or not it has a URL. */
  primary: ReviewPlatform | null;
  /**
   * ‼️ THE ONE THAT WAS INVISIBLE. True when the client picked a platform and nobody has pasted
   * its link, which renders as a review page with no button on it and no error anywhere.
   */
  primaryMissingUrl: boolean;
  /** Platforms with no URL yet. */
  missing: ReviewPlatform[];
}

export function destinationState(
  reviewWorkflow: Record<string, unknown> | null | undefined,
  primaryKey: string | null | undefined
): DestinationState {
  const workflow = reviewWorkflow ?? {};
  const has = (p: ReviewPlatform): boolean => {
    const raw = workflow[p.field];
    return typeof raw === "string" && raw.trim().length > 0;
  };

  const primary = platformByKey(primaryKey);
  const withUrl = REVIEW_PLATFORMS.filter(has);

  return {
    configured: [
      ...withUrl.filter((p) => primary !== null && p.key === primary.key),
      ...withUrl.filter((p) => primary === null || p.key !== primary.key),
    ],
    primary,
    primaryMissingUrl: primary !== null && !has(primary),
    missing: REVIEW_PLATFORMS.filter((p) => !has(p)),
  };
}

/**
 * One sentence describing where a client's reviews can go, for a card or a panel header.
 *
 * Written once so the board, the AI Referral Engine's step cards and anything else say the same thing.
 * It states what IS, never what was intended: "nothing set" and "set to the wrong platform" are
 * different sentences because they send you to different places.
 */
export function destinationLine(state: DestinationState): string {
  if (state.configured.length === 0) {
    const named = state.primary ? ` They chose ${state.primary.name}.` : "";
    return (
      `No review link is set, so the review page shows no button and every customer is told to ` +
      `go and find the page herself.${named}`
    );
  }

  const names = state.configured.map((p) => p.name).join(", ");
  if (state.primaryMissingUrl && state.primary) {
    return (
      `${state.configured.length} link${state.configured.length === 1 ? "" : "s"} set (${names}), ` +
      `but their chosen platform is ${state.primary.name} and it has none, so the button they ` +
      `asked for is the one that will not appear.`
    );
  }

  return `${state.configured.length} link${state.configured.length === 1 ? "" : "s"} set: ${names}.`;
}
