// The six places a review can be posted, written down once.
//
// ‼️ THIS FILE EXISTS BECAUSE THE SAME SIX PLATFORMS WERE SPELLED OUT IN THREE PLACES AND THE
// COMMENT WARNING ABOUT IT WAS THE ONLY THING HOLDING THEM TOGETHER.
//
// review-tool.tsx's PLATFORMS carried the note: "ADDING A PLATFORM HERE IS NOT ENOUGH ON ITS
// OWN. The Review handover panel is the only writer of these URLs, and the onboarding2 question
// offers the same six names. All three lists have to agree or a client picks a platform nobody
// can paste a URL for."
//
// That was exactly the live failure. The funnel offered six names and the handover panel had
// two boxes, Google and RealSelf. SRT Agency's own record says `review_destination_primary =
// 'trustpilot'`, so the one platform the client chose was the one platform with nowhere to put
// its link, and the review tool rendered no button at all. Nothing errored. The panel looked
// complete, the funnel looked complete, and the customer got the fallback hint telling her to
// go and find the review page herself.
//
// So the list is data now, and the three surfaces read it:
//
//   src/app/hub/[host]/reviews/review-tool.tsx        which buttons render
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
  /** The button on the review tool. */
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
 * Pure, so the review tool, the board panel and a Slack card can all describe the same state in
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
 * Written once so the board, the review tool's step cards and anything else say the same thing.
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
