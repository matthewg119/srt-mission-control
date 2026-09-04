// Row shapes for the four /onboarding2 tables.
//
// Hand-written, because this repo has no generated database types. Every field is optional or
// nullable in the same way the column is, so a `select("*")` result assigns without a cast and a
// missing column shows up as a type error rather than as undefined at runtime.

import type { AgreementSnapshot } from "./snapshot";

/**
 * One entry per SECTION, in the frozen copy on the signing row.
 *
 * ‼️ ONE INITIAL COVERS A PAGE, SO SEVERAL OF THESE CAN SHARE ONE TYPED ACT. freezeInitials()
 * fans a page row out into one record per section it covered, which is what lets the PDF keep
 * drawing an initial under all nine clauses. `page` is how a reader tells that 4, 5 and 6 came
 * from one initial on page 3 rather than from three separate ones.
 */
export interface InitialRecord {
  n: number;
  key: string;
  initials: string;
  at: string;
  /** The hash of the whole PAGE this section sat on, which is what was checked. */
  sectionSha256: string;
  dwellMs: number | null;
  /** Absent on records frozen before 2026-09-03, where a page was a section. */
  page?: number;
}

export interface Onboarding2SigningRow {
  id: string;
  created_at: string;
  updated_at: string;
  session_token: string;
  status: "open" | "signed" | "abandoned";
  email: string | null;
  /** Screen one, with the email, before the agreement opens. Becomes print_name at signature. */
  contact_name: string | null;
  /**
   * Screen one. Was qualifying question 1 until 2026-09-03.
   *
   * ‼️ intakePatchFrom() DERIVES clients.domain FROM THIS AND NOTHING ELSE. hostsFor(),
   * seedDnsRecords() and the whole hub lane are built from that domain, so an empty website here
   * stalls eight delivery steps.
   */
  website: string | null;
  is_demo: boolean;


  agreement_snapshot: AgreementSnapshot;
  template_version: string;
  agreement_sha256: string;
  initials_snapshot: InitialRecord[] | null;

  signature_typed: string | null;
  print_name: string | null;
  signer_title: string | null;
  business_legal_name: string | null;
  address_line1: string | null;
  address_city: string | null;
  address_state: string | null;
  address_postal: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_phone_typed: string | null;
  signed_date: string | null;
  signed_at: string | null;

  started_ip_hash: string | null;
  signed_ip_hash: string | null;
  signed_user_agent: string | null;

  pdf_path: string | null;
  pdf_sha256: string | null;
  pdf_generated_at: string | null;
  emailed_signer_at: string | null;
  emailed_srt_at: string | null;

  client_id: string | null;
  contact_id: string | null;
  lead_id: string | null;
  slack_channel: string | null;
  slack_thread_ts: string | null;

  chat_turns_pre: number;
  chat_turns_post: number;
  flagged_questions: string[];

  source_url: string | null;
  referrer: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  fbc: string | null;
  fbp: string | null;
  fbclid: string | null;

  ai_visibility_score: number | null;
  competitor_name: string | null;
  user_showed_count: number | null;
  comp_showed_count: number | null;
  report_slug: string | null;
}

/** One of the six, stored verbatim. */
export interface QualifyingAnswer {
  key: string;
  question: string;
  answer: string;
  askedAt: string;
  sourceTurnOrdinals: number[];
}

export interface Onboarding2LeadRow {
  id: string;
  created_at: string;
  updated_at: string;
  email: string;
  phone: string | null;
  business_name: string | null;
  contact_name: string | null;
  signer_title: string | null;
  website: string | null;
  city: string | null;
  state: string | null;
  signing_id: string | null;
  signed_at: string | null;
  is_demo: boolean;
  qualifying: QualifyingAnswer[];
  qualifying_answered: number;
  qualifying_completed_at: string | null;
  booking_offered_at: string | null;
  /**
   * ‼️ NO LONGER WRITTEN BY ANYTHING (2026-09-03). These two describe a CONFIRMED CALENDAR EVENT.
   * The funnel now agrees a day in conversation and there is no calendar in it, so overloading
   * either to mean "they said Thursday afternoon" would be a column telling a lie. Left in place
   * for the day a real booking exists.
   */
  booked_slot_at: string | null;
  calendly_event_uri: string | null;

  /** morning or afternoon. What they said when asked which half of the day suits them. */
  call_daypart: "morning" | "afternoon" | null;
  /** The day they picked. A DATE, because we agreed a day and a half of it, not a clock time. */
  call_day: string | null;
  /** The label they actually tapped, verbatim, e.g. "Thursday morning". */
  call_choice_label: string | null;
  call_chosen_at: string | null;

  /**
   * The zone THEY tapped. IANA, one of four. See docs/2026-09-03-onboarding2-call-invite.sql.
   *
   * ‼️ NOT SCHEDULING_TZ. That one is ours and decides which DAYS are offered; this one decides
   * what the clock says when we get there and what "afternoon" means to the person who tapped it.
   */
  call_timezone: string | null;
  /**
   * The real instant, computed from call_day + call_daypart + call_timezone.
   *
   * ‼️ NEVER PRESENT WITHOUT call_timezone, and a CHECK constraint enforces it. A bare
   * timestamptz cannot tell a later reader whether 18:00Z was somebody's 2pm or somebody else's
   * 11am, which is the unreadable value scheduling.ts's header was written to prevent.
   */
  call_starts_at: string | null;
  /** Microsoft Graph event id. Present iff an invite was actually created. */
  call_event_id: string | null;
  call_invite_sent_at: string | null;
  /**
   * ‼️ THREE STATES. Both null means NO ATTEMPT WAS MADE, which is every row until MS_CALENDAR_*
   * is configured, and it is not the same answer as an attempt that failed.
   */
  call_invite_error: string | null;
  contact_id: string | null;
  client_id: string | null;
  ip_hash: string | null;
  source_url: string | null;
  referrer: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  fbc: string | null;
  fbp: string | null;
  fbclid: string | null;
}

/** What the client sends about where it came from. Every field optional and every one nullable. */
export interface Attribution {
  sourceUrl?: string;
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  fbc?: string;
  fbp?: string;
  fbclid?: string;
  score?: number | null;
  city?: string | null;
  business?: string | null;
  competitor?: string | null;
  userShowed?: number | null;
  compShowed?: number | null;
  reportSlug?: string | null;
}
