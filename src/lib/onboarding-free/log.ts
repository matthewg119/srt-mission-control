// Where an /onboardingfree submission is stored, and what the row looks like.
//
// It is a `system_logs` row and not a new table, deliberately. That table already exists
// with exactly the shape needed (`event_type`, `description`, `metadata` jsonb), and
// api/leads/facebook already proves the query pattern with `.eq("metadata->>key", value)`.
// The alternative was a migration for something whose real destination is a Slack card,
// and a migration is a SQL block somebody has to remember to run before the feature works.
//
// One row does three jobs:
//   1. the durable copy of the answers, so a Slack outage cannot lose a submission
//   2. the per-IP rate-limit ledger for the submit route
//   3. the anchor the access route reads its Slack thread ts back out of
//
// ‼️ This constant CANNOT live in either route file. Next's App Router validates route
// module exports against a fixed list, so a `route.ts` that exports anything besides the
// HTTP methods and the known config fields fails `next build` with a type error.

export const ONBOARDING_FREE_EVENT = "onboardingfree_intake";

export interface OnboardingFreeMetadata {
  business: string;
  name: string;
  email: string;
  phone: string;
  answers: Record<string, unknown>;
  verdict: string;
  agrees: boolean;
  disagreement: string | null;
  talent_side: boolean;
  attribution_blind: boolean;
  contact_id: string | null;
  /** Salted hash. Never a raw address: this is a rate-limit ledger, not a visitor log. */
  ip_hash: string;
  /** Patched on after the card posts. Absent when Slack was unreachable or unconfigured. */
  slack_ts?: string;
  slack_channel?: string;
  /** Present once the access screen has been answered. Its presence is the replay guard. */
  access?: Record<string, string>;
}
