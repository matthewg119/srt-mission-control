// The onboarding intake question set. ONE definition, read by both sides.
//
// The funnel renders from this and the save route validates against it, so a question
// cannot exist on screen without a place to land, and a stored key cannot drift from
// what was asked. That is the same reason src/lib/medspa/validate.ts is isomorphic.
//
// SOURCE OF TRUTH: SRT-AEO-Onboarding-v1.1.md "The onboarding funnel, question set"
// (steps 1 to 6), plus the three additions in SRT-AEO-Onboarding-v2-PILOT.md §6:
//   - step 4 gains "what booking / patient-messaging software do you use?", asked
//     SEPARATELY from the review-asking tool, because a clinic that books in one
//     system and asks for reviews in another needs a different install
//   - step 4 gains RealSelf as a destination
//   - step 4 gains the incentive and lobby-tablet questions. Either one answered yes
//     is a conversation on the call, and per §6 it stops there
//   - step 6 gains the consent block (§16.4) before booking
//
// COPY NOTE. §16.4 and §16.2 both use em dashes. src/lib/copy-guard.ts throws at module
// evaluation on those, so the wording here uses colons and periods. Every guard() call
// below is what proves no dash slipped back in during an edit.
//
// NOTHING PRICED. There is no amount, tier, or upgrade anywhere in this file, and it
// imports no price constant. A pilot must not be able to see one (PILOT §1).

import { guard } from "@/lib/copy-guard";

export type FieldKind =
  | "text"
  | "textarea"
  | "tel"
  | "email"
  | "url"
  | "select"
  | "multiselect"
  | "yesno";

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  help?: string;
  placeholder?: string;
  options?: string[];
  /**
   * Render this field only when another field on the same step holds a given value.
   * Hidden fields are never required and are not validated, so a conditional that never
   * appears cannot block the form.
   */
  showWhen?: { field: string; equals: string };
}

export interface StepDef {
  /** 1-indexed, matches clients.intake_step. */
  step: number;
  title: string;
  blurb?: string;
  /** Column on `clients` that this step's answers are stored in, when it is a jsonb bag. */
  bag?: "services" | "ideal_patient" | "review_workflow" | "access_inventory";
  fields: FieldDef[];
}

// Google first and always: it is the one universal destination, and the save route
// special-cases it as the default primary. The rest are a menu, not a taxonomy. The
// vertical-specific ones stay in the list rather than being branched on, because a
// hardcoded `if (vertical === ...)` is the thing the audit engine explicitly forbids
// itself and there is no reason for this file to be less disciplined.
export const REVIEW_DESTINATIONS = [
  "Google",
  "Facebook",
  "Yelp",
  "BBB",
  "RealSelf",
  "Healthgrades",
  "Trustpilot",
  "Industry directory (tell us which)",
  "Other",
];

export const INTAKE_STEPS: StepDef[] = [
  {
    step: 1,
    title: guard("step1 title", "Your business details"),
    blurb: guard(
      "step1 blurb",
      "Exactly as they should appear everywhere. We will read these back to you on the call, and then make every directory match them."
    ),
    fields: [
      { key: "legal_name", label: "Exact legal business name", kind: "text", required: true },
      { key: "dba_name", label: "Public facing name, if different", kind: "text" },
      { key: "address_line1", label: "Street address", kind: "text", required: true },
      { key: "address_line2", label: "Suite or unit", kind: "text" },
      { key: "city", label: "City", kind: "text", required: true },
      { key: "state", label: "State", kind: "text", required: true },
      { key: "postal_code", label: "ZIP", kind: "text", required: true },
      { key: "phone", label: "Primary public phone number", kind: "tel", required: true },
      { key: "email", label: "Business email", kind: "email", required: true },
      { key: "website", label: "Website", kind: "url", required: true },
      {
        key: "hours",
        label: "Hours, including your holiday policy",
        kind: "textarea",
        required: true,
        placeholder: "Mon to Thu 9 to 5, Fri 9 to 3, closed weekends and federal holidays",
      },
    ],
  },
  {
    step: 2,
    title: guard("step2 title", "Services and market"),
    bag: "services",
    fields: [
      {
        key: "services_list",
        label: "Everything you offer, in your own words",
        kind: "textarea",
        required: true,
        help: "Not marketing copy. The words you would use with a customer.",
      },
      {
        key: "service_area",
        label: "Service area",
        kind: "textarea",
        required: true,
        placeholder: "On site only, or the towns you travel to",
      },
      { key: "payment_types", label: "Payment types accepted", kind: "textarea" },
      {
        key: "credentials",
        label: "Credentials and experience",
        kind: "textarea",
        required: true,
        help: "Licenses, certifications, insurance, awards, years in business.",
      },
      {
        key: "competitors",
        label: "Top 3 competitors you believe you lose business to",
        kind: "textarea",
        required: true,
      },
    ],
  },
  {
    step: 3,
    title: guard("step3 title", "Who you want walking in"),
    blurb: guard(
      "step3 blurb",
      "This is the block that decides which questions we test and what we write. Take your time here."
    ),
    bag: "ideal_patient",
    fields: [
      {
        key: "target",
        label: "What type of customer do you want to attract?",
        kind: "textarea",
        required: true,
        help: "Describe them like a person, not a demographic.",
      },
      {
        key: "highest_margin",
        label: "Which service is your highest margin?",
        kind: "text",
        required: true,
        help: "Not highest volume. These are usually different.",
      },
      { key: "not_wanted", label: "Who do you not want calling you?", kind: "textarea" },
      {
        key: "objections",
        label: "Top 3 objections you hear before someone books",
        kind: "textarea",
        required: true,
        help: "Their words, not a summary.",
      },
      {
        key: "tried_before",
        label: "What does a customer usually try before they come to you?",
        kind: "textarea",
      },
    ],
  },
  {
    step: 4,
    title: guard("step4 title", "How you ask for reviews today"),
    bag: "review_workflow",
    fields: [
      {
        key: "asks",
        label: "Do you currently ask for reviews?",
        kind: "select",
        required: true,
        options: [
          "Never",
          "Sometimes, verbally",
          "Text",
          "Email",
          "QR code or card",
          "Third party tool",
        ],
      },
      {
        key: "who",
        label: "Who asks?",
        kind: "select",
        required: true,
        options: ["Owner", "Front desk", "Whoever did the work", "Automated", "Nobody"],
      },
      {
        key: "when",
        label: "When in the job or visit?",
        kind: "select",
        required: true,
        options: [
          "During the job",
          "At checkout or on completion",
          "Same day, after",
          "Days later",
          "No set time",
        ],
      },
      { key: "tool", label: "What tool do you use to ask, if any?", kind: "text" },
      {
        // PILOT §6: separate from the review tool question, deliberately. This is where
        // the automated request will eventually live (D-P8), so it is not optional.
        key: "booking_software",
        label: "What booking, scheduling or customer messaging software do you use?",
        kind: "text",
        required: true,
        help: "The system your front desk or dispatcher actually lives in.",
      },
      { key: "volume", label: "Roughly how many requests per month?", kind: "text" },
      {
        key: "destinations",
        label: "Where do you send them?",
        kind: "multiselect",
        required: true,
        options: REVIEW_DESTINATIONS,
      },
      {
        // Either yes here sets review_incentive_flag and becomes a conversation on the
        // call. Offering anything for a review is an FTC problem, and a lobby tablet is
        // a gating problem. Both stop before they are built on.
        key: "incentive",
        label: "Do you currently offer anything in exchange for a review?",
        kind: "yesno",
        required: true,
      },
      {
        key: "lobby_tablet",
        label: "Is there a tablet or QR code in the lobby, or on the invoice, for reviews?",
        kind: "yesno",
        required: true,
      },
      {
        key: "blockers",
        label: "What has stopped this from working so far?",
        kind: "textarea",
      },
    ],
  },
  {
    step: 5,
    title: guard("step5 title", "Access inventory"),
    blurb: guard(
      "step5 blurb",
      "Just what exists and who holds it. We do not need a single password, now or ever."
    ),
    bag: "access_inventory",
    fields: [
      {
        key: "gbp",
        label: "Do you have a Google Business Profile, and who has the login?",
        kind: "text",
        required: true,
        help: "This is the listing that shows up with your hours and reviews. We will ask to be added as a manager so we can fix it. We never need your password.",
      },
      {
        key: "yelp",
        label: "Your Yelp or main industry listing",
        kind: "text",
        help: "Paste the link to it, if you have one. Just the web address, not a login.",
      },
      {
        key: "registrar",
        label: "Where is your domain registered?",
        kind: "text",
        required: true,
        help: "Whoever you pay for the web address each year. GoDaddy, Namecheap, Squarespace, Google Domains.",
      },
      {
        key: "platform",
        label: "What is your website built on, and who built it?",
        kind: "text",
        required: true,
        help: "WordPress, Wix, Squarespace, Webflow, or the name of the person or agency who made it. This is a different thing from where the domain is registered.",
      },
      {
        key: "analytics",
        label: "Do you have Google Analytics or Search Console set up?",
        kind: "text",
        help: "Two free Google tools that show who finds your website. Not sure is a perfectly good answer.",
      },
      {
        key: "prior_agencies",
        label: "Any previous SEO or marketing agencies who may still hold access",
        kind: "textarea",
        help: "Old access is the most common reason a listing will not update.",
      },
    ],
  },
  {
    step: 6,
    title: guard("step6 title", "Permission, and the language your customers read"),
    fields: [
      {
        key: "consent_results",
        label: "Using what we measure",
        kind: "select",
        required: true,
        help: guard(
          "consent help",
          "We would like to use your results to show other business owners what this looks like."
        ),
        options: [
          guard(
            "consent anonymized",
            "Anonymized: city and industry, no business name, no screenshots that identify you"
          ),
          guard("consent named", "Named: business name, city, screenshots"),
          guard("consent none", "Neither, please do not use my results"),
        ],
      },
      {
        key: "language",
        label: "Language for your customers' review tool",
        kind: "select",
        required: true,
        options: ["English", "Spanish", "Both", "Other"],
      },
      {
        // Shown only when Language is Other. The stored `language` column stays one of
        // en/es/both, so this is the free text that tells us what to actually build.
        key: "language_other",
        label: "Which language?",
        kind: "text",
        showWhen: { field: "language", equals: "Other" },
      },
    ],
  },
];

/** §16.4's default. Named is an opt-in and revocable going forward (D-P6). */
export const CONSENT_VALUE_BY_LABEL: Record<string, "anonymized" | "named" | "none"> = {
  [INTAKE_STEPS[5].fields[0].options![0]]: "anonymized",
  [INTAKE_STEPS[5].fields[0].options![1]]: "named",
  [INTAKE_STEPS[5].fields[0].options![2]]: "none",
};

export const LANGUAGE_VALUE_BY_LABEL: Record<string, "en" | "es" | "both"> = {
  English: "en",
  Spanish: "es",
  Both: "both",
};

export const TOTAL_STEPS = INTAKE_STEPS.length;

/**
 * The "what happens next" screen.
 *
 * Deliberately shorter than §16.2, and deliberately promises nothing. The spec version
 * commits to first pages inside two weeks and a monthly re-run before the client has
 * even had the call, which is a timeline we would then be measured against on day one.
 * This asks for the one thing we actually need next, which is two times to talk.
 *
 * It also cannot say "the last screen books the call", because booking is not built:
 * that needs Graph calendar write, which does not exist.
 */
export const COMPLETION_COPY = {
  heading: guard("completion heading", "Thanks. That is everything we need."),
  body: guard(
    "completion body",
    "Please reply to our email with two times you are free today or tomorrow, and we will " +
      "schedule your onboarding call."
  ),
};
