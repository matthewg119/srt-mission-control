// Sequence categories, and the one place they are defined.
//
// These used to be the funding product lines (mca, sba, loc, cre) and were
// duplicated across the enroll route, the update-category route and the Slack
// action handler. SRT sells AEO, so they are now the shape of the engagement
// rather than a loan product, and every consumer imports from here.

export const SEQUENCE_CATEGORIES = ["aeo", "audit", "reengage", "client"] as const;

export type SequenceCategory = (typeof SEQUENCE_CATEGORIES)[number];

export const DEFAULT_SEQUENCE_CATEGORY: SequenceCategory = "aeo";

export const CATEGORY_LABELS: Record<SequenceCategory, string> = {
  aeo: "🔎 AEO Offer",
  audit: "📊 Audit Follow-Up",
  reengage: "🔁 Re-engagement",
  client: "🤝 Client",
};

export function isSequenceCategory(v: unknown): v is SequenceCategory {
  return typeof v === "string" && (SEQUENCE_CATEGORIES as readonly string[]).includes(v);
}
