export const DEFAULTS = {
  zohoLeadSource: "Meta Ads",
  zohoLeadStatus: "New",
  submissionsFromAddress: "submissions@srtagency.com",
};

// ‼️ `underwritingFromAddress` AND `approvalAmountThreshold` WERE REMOVED (2026-09-27), and neither had
// a reader anywhere in src/. They were the MCA underwriting mailbox and the dollar figure above which an
// advance needed a second approval. Funding is decommissioned, so they are deleted rather than left
// inert: a config key nothing reads is the same class of dead wire the column scan exists to find, and
// leaving one named `approvalAmountThreshold` invites somebody to wire it to an AEO price.
//
// `submissionsFromAddress` STAYS and is genuinely read, by audit-engine/lead-pitch.ts. submissions@ is
// an AEO outreach mailbox now; it is not the lender-submission mailbox the name once meant.
