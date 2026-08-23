// Client-facing drafts, posted into the internal ops thread for a human to send.
//
// THE ONE RULE: NOTHING HERE SENDS ANYTHING. The free WhatsApp Business app has no API,
// so there is no send path to write, and there is deliberately no code that pretends
// otherwise. The WhatsApp Business Platform API is not the way around that either: Meta
// begins billing service messages on 2026-10-01 and the free app being unaffected is the
// whole reason this design exists. A draft is posted, a human reads it, a human taps.
//
// THE wa.me LINK IS THE POINT. A draft you have to copy out of Slack, switch app, find
// the contact and paste into is a workflow you abandon by client ten. `wa.me/<digits>?
// text=<urlencoded>` opens WhatsApp with the message already typed, so the same draft is
// one tap. That is the whole difference.
//
// Storage is Supabase, not Slack. See docs/2026-08-20-client-messages.sql for why.

import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { hasBannedDash } from "@/lib/copy-guard";
import { subdomainLabel } from "@/lib/clients/normalize";
import {
  DRAFT_COPY,
  CHANNEL_LINE,
  NO_CUSTOMER_INFO_LINE,
  isUnwritten,
  type DraftCopy,
} from "@/config/client-messages";

export type DraftKind = "send" | "ask" | "notify" | "report";

/**
 * When a draft is offered.
 *
 * The ask/notify split is the useful one. An ASK is something we need from them, so it
 * has to arrive while the step is still outstanding, which means firing when it becomes
 * the NEXT unfinished step. A NOTIFY is news, so it fires when the step COMPLETES.
 * Getting those the wrong way round produces a message asking for DNS records the day
 * after they were added.
 */
export type DraftTrigger = "intake" | "step_next" | "step_complete" | "manual" | "recurring";

export interface DraftDef {
  key: string;
  kind: DraftKind;
  trigger: DraftTrigger;
  /** The delivery step this hangs off, for step_next and step_complete. */
  stepKey?: string;
  /**
   * Which DRAFT_COPY entry to use, when it is not the key.
   *
   * The three monthly reports need three keys, because the unique constraint on
   * (client_id, draft_key) is what stops a draft being posted twice and day 30, 60 and 90
   * are three separate messages. They share ONE piece of copy, differing only by
   * {dayLabel}, so the alternative would be three near-identical blocks for Matthew to
   * keep in step with each other by hand.
   */
  copyKey?: string;
}

/** Day 30, 60 and 90. The re-test schedule the whole engagement is measured on. */
export const REPORT_MILESTONES = [30, 60, 90] as const;

export function reportDraftKey(day: number): string {
  return `report_day_${day}`;
}

export const DRAFTS: DraftDef[] = [
  { key: "intro", kind: "send", trigger: "intake" },
  { key: "ask_gbp_access", kind: "ask", trigger: "step_next", stepKey: "access_granted" },
  { key: "ask_dns", kind: "ask", trigger: "step_next", stepKey: "dns_records" },
  { key: "notify_baseline", kind: "notify", trigger: "step_complete", stepKey: "baseline_scan" },
  { key: "notify_first_page", kind: "notify", trigger: "step_complete", stepKey: "first_page" },
  ...REPORT_MILESTONES.map((day) => ({
    key: reportDraftKey(day),
    kind: "report" as const,
    trigger: "manual" as const,
    copyKey: "report_monthly",
  })),
];

/**
 * The twice-weekly content pair.
 *
 * ‼️ THEIR KEYS CARRY THE WEEK, and that is not decoration. client_messages has a UNIQUE
 * constraint on (client_id, draft_key), which is exactly what stops a step toggled off and
 * on again posting the same message three times. A recurring draft under a bare key would
 * inherit that: it would post once, ever, and then silently never again. Stamping the week
 * into the key makes it idempotent PER WEEK instead of forever, which is what "twice a
 * week" actually needs. Same trick as report_day_30 / 60 / 90, one axis over.
 */
export const RECURRING_DRAFTS = ["ask_stories", "ask_content"] as const;
export type RecurringDraft = (typeof RECURRING_DRAFTS)[number];

/** ISO week, e.g. "2026W34". UTC, so a Sunday evening send cannot land in two weeks. */
export function isoWeekStamp(at: Date = new Date()): string {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  // ISO weeks run Monday to Sunday and belong to the year containing their Thursday.
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const isoYear = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${isoYear}W${String(week).padStart(2, "0")}`;
}

export function recurringDraftKey(base: RecurringDraft, at: Date = new Date()): string {
  return `${base}_${isoWeekStamp(at)}`;
}

/** Split a weekly key back into its base, or null when it is not one. */
function recurringBase(key: string): RecurringDraft | null {
  return RECURRING_DRAFTS.find((b) => new RegExp(`^${b}_\\d{4}W\\d{2}$`).test(key)) ?? null;
}

export function draftByKey(key: string): DraftDef | undefined {
  const found = DRAFTS.find((d) => d.key === key);
  if (found) return found;

  // A weekly key is resolved rather than enumerated: DRAFTS cannot list every week that
  // will ever exist, and a static list would need editing every January.
  const base = recurringBase(key);
  return base ? { key, kind: "ask", trigger: "recurring", copyKey: base } : undefined;
}

/** The draft offered when a given step is the next unfinished one, if any. */
export function askForStep(stepKey: string): DraftDef | undefined {
  return DRAFTS.find((d) => d.trigger === "step_next" && d.stepKey === stepKey);
}

/** The draft offered when a given step completes, if any. */
export function notifyForStep(stepKey: string): DraftDef | undefined {
  return DRAFTS.find((d) => d.trigger === "step_complete" && d.stepKey === stepKey);
}

// ─────────────────────────────────────────────────────────────────────────────
// wa.me
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a click-to-chat link, or null when the number cannot carry one.
 *
 * DIGITS ONLY. No plus, no spaces, no dashes, no parentheses. This is why every phone in
 * the estate is stored E.164 now: a "(336) 833-2303" in the database builds a link that
 * opens a chat with nobody. Returning null rather than a broken link is deliberate, so
 * the card falls back to copyable text and says why instead of offering a dead tap.
 */
export function waLink(phone: string | null | undefined, text: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  // 10 is a US number with the country code lost somewhere, which would build a link to
  // a different country. 15 is the E.164 maximum. Anything outside that is not a number
  // we can safely open a chat with.
  if (digits.length < 11 || digits.length > 15) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Building
// ─────────────────────────────────────────────────────────────────────────────

export type DraftVars = Record<string, string | null | undefined>;

/**
 * Substitute {tokens}.
 *
 * A token with no value renders as nothing rather than as the literal braces, then the
 * whitespace it left behind is collapsed. A client with no city gets a slightly clipped
 * sentence; the alternative is a message that says "{city}" to a paying customer.
 */
function fill(body: string, vars: DraftVars): string {
  return body
    .replace(/\{(\w+)\}/g, (_, key: string) => vars[key]?.trim() ?? "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([,.])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface BuiltDraft {
  key: string;
  kind: DraftKind;
  copy: DraftCopy;
  channel: "whatsapp" | "sms" | "email";
  recipient: string | null;
  body: string;
  waLink: string | null;
  /** The copy is still the TODO placeholder. Nothing may be posted as a message. */
  unwritten: boolean;
  /** An em dash arrived through a token rather than through the copy. */
  dashInVars: boolean;
}

interface ClientRow {
  id: string;
  legal_name?: string | null;
  dba_name?: string | null;
  phone?: string | null;
  email?: string | null;
  domain?: string | null;
  website?: string | null;
  subdomain?: string | null;
  city?: string | null;
  contact_preference?: string | null;
  contact_id?: string | null;
  /** Resolved from the linked contact, not a column on clients. */
  first_name?: string | null;
}

export function clientDisplayName(client: ClientRow): string {
  return client.dba_name || client.legal_name || "this client";
}

/**
 * The tokens every draft can use, derived from the client record.
 *
 * hubHost uses the client's OWN stored subdomain rather than a hardcoded "learn". The
 * convention falls back to guide. when learn. already resolves (see chooseSubdomain in
 * provision.ts), so hardcoding it here would put a hostname in the DNS ask that does not
 * match the one we are actually going to point at them.
 */
function baseVars(client: ClientRow): DraftVars {
  const domain = client.domain || null;
  // Through subdomainLabel, never raw: rows written before that column became label-only
  // still hold a full host, and `${"learn.clinic.com"}.${domain}` is a hostname we would
  // then read out to a paying client over the phone.
  const sub = subdomainLabel(client.subdomain, domain);
  return {
    businessName: clientDisplayName(client),
    // No fallback to the business name. "Hi Bright Smile Dental," reads like a mail merge
    // that failed, which is worse than a message that simply opens without a name. fill()
    // tidies the punctuation an absent token leaves behind.
    firstName: client.first_name ?? null,
    city: client.city ?? null,
    domain,
    hubHost: domain ? `${sub}.${domain}` : null,
    reviewHost: domain ? `reviews.${domain}` : null,
  };
}

export function buildDraft(client: ClientRow, draftKey: string, vars: DraftVars = {}): BuiltDraft | null {
  const def = draftByKey(draftKey);
  const copy = def ? DRAFT_COPY[def.copyKey ?? def.key] : undefined;
  if (!def || !copy) return null;

  const unwritten = isUnwritten(copy.body);
  const merged = { ...baseVars(client), ...vars };

  let body = fill(copy.body, merged);

  // The intro carries two lines nobody may edit out of it. Appended after substitution so
  // they cannot be reworded by a token, and appended rather than woven in so the copy
  // above stays entirely Matthew's.
  if (draftKey === "intro" && !unwritten) {
    body = [body, CHANNEL_LINE, NO_CUSTOMER_INFO_LINE].join("\n\n");
  }

  // guard() catches an em dash somebody TYPED into the copy, at build time. This catches
  // one that ARRIVED through a token at runtime, which is the case guard() structurally
  // cannot see: a headline finding or a page title is not known when the module loads.
  const dashInVars = hasBannedDash(body) && !hasBannedDash(copy.body);

  const preference = (client.contact_preference as BuiltDraft["channel"]) || "whatsapp";
  const channel: BuiltDraft["channel"] =
    preference === "email" ? "email" : preference === "sms" ? "sms" : "whatsapp";
  const recipient = channel === "email" ? (client.email ?? null) : (client.phone ?? null);

  return {
    key: draftKey,
    kind: def.kind,
    copy,
    channel,
    recipient,
    body,
    waLink: channel === "whatsapp" ? waLink(recipient, body) : null,
    unwritten,
    dashInVars,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Posting
// ─────────────────────────────────────────────────────────────────────────────

const KIND_LABEL: Record<DraftKind, string> = {
  send: "SEND",
  ask: "ASK",
  notify: "NOTIFY",
  report: "REPORT",
};

const CHANNEL_LABEL: Record<BuiltDraft["channel"], string> = {
  whatsapp: "WhatsApp",
  sms: "text",
  email: "email",
};

async function loadClient(clientId: string): Promise<ClientRow | null> {
  const { data } = await supabaseAdmin
    .from("clients")
    .select(
      "id, legal_name, dba_name, phone, email, domain, website, subdomain, city, contact_preference, contact_id, ops_thread_ts"
    )
    .eq("id", clientId)
    .maybeSingle();

  const client = (data as ClientRow | null) ?? null;
  if (!client) return null;

  // The owner's first name lives on the linked contact, not on clients: linkToCrm writes
  // it there during provisioning and there has never been a column for it here. A second
  // query rather than a join because contact_id is a SOFT link with no foreign key
  // (deliberately, see the onboarding migration), so PostgREST cannot embed it.
  if (client.contact_id) {
    const { data: contact } = await supabaseAdmin
      .from("contacts")
      .select("first_name")
      .eq("id", client.contact_id)
      .maybeSingle();
    client.first_name = (contact?.first_name as string) ?? null;
  }

  return client;
}

/**
 * Draft a message and put it in the ops thread.
 *
 * Idempotent on (client_id, draft_key) via the unique constraint, and that is doing real
 * work rather than being tidy: a delivery step ticked, unticked and re-ticked while
 * somebody works out what actually happened would otherwise post the same message three
 * times. The insert races and loses quietly.
 *
 * Never throws into a caller. A draft is an assist; failing to produce one must not take
 * down the checklist tick or the intake completion that triggered it.
 */
export async function postDraft(
  clientId: string,
  draftKey: string,
  vars: DraftVars = {},
  /**
   * Which step's thread this draft belongs in.
   *
   * ‼️ A DRAFT IS ABOUT A STEP AND BELONGS UNDER IT. The ask_dns draft is the DNS step's
   * message to the client; reading it three screens away from the record values it is asking
   * them to type is what made the old thread unworkable. Omitted for the drafts that belong
   * to the CLIENT and to no step (`intro`, the day 30/60/90 reports), which stay under the
   * pinned header.
   */
  stepKey?: string | null
): Promise<{ posted: boolean; reason?: string }> {
  const channelId = process.env.SLACK_CLIENT_ONBOARDING_CHANNEL;
  if (!channelId) return { posted: false, reason: "no_channel_env" };

  const client = await loadClient(clientId);
  if (!client) return { posted: false, reason: "no_client" };

  let threadTs = (client as ClientRow & { ops_thread_ts?: string }).ops_thread_ts;
  if (stepKey) {
    const { anchorTsFor } = await import("@/lib/clients/step-board");
    const anchor = await anchorTsFor(clientId, stepKey);
    // No fallback to the header on a step draft. Posting it there would be the old shape
    // creeping back one message at a time, and a missing anchor is a bug worth seeing.
    if (!anchor) return { posted: false, reason: "no_anchor" };
    threadTs = anchor;
  }
  if (!threadTs) return { posted: false, reason: "no_thread" };

  const draft = buildDraft(client, draftKey, vars);
  if (!draft) return { posted: false, reason: "unknown_draft" };

  // Claim first, post second. If the row already exists this draft has been offered
  // before and posting again would be noise.
  const { error: claimError } = await supabaseAdmin.from("client_messages").insert({
    client_id: clientId,
    draft_key: draftKey,
    kind: draft.kind,
    channel: draft.channel,
    recipient: draft.recipient,
    body: draft.body,
    wa_link: draft.waLink,
    vars,
  });

  if (claimError) {
    // 23505 is the unique violation, which is the normal "already drafted" path rather
    // than a failure. Anything else is worth knowing about.
    if (claimError.code !== "23505") {
      console.error("[client-drafts] claim failed:", claimError.message);
    }
    return { posted: false, reason: "already_drafted" };
  }

  const res = (await slack
    .postThreadReply(channelId, threadTs, `Draft: ${draft.copy.label}`, buildBlocks(client, draft) as never)
    .catch((e) => {
      console.error("[client-drafts] post failed:", (e as Error).message);
      return null;
    })) as { ok?: boolean; ts?: string; error?: string } | null;

  if (!res?.ok) {
    // slackFetch returns { ok: false } rather than throwing, so the catch above never fires
    // for an API-level refusal. The claim row is already written, which is correct: the draft
    // exists and is on the client board. Only the Slack copy of it is missing.
    console.error(`[client-drafts] ${draftKey} did not post:`, res?.error ?? "unknown");
  }

  if (res?.ok && res.ts) {
    await supabaseAdmin
      .from("client_messages")
      .update({ slack_ts: res.ts })
      .eq("client_id", clientId)
      .eq("draft_key", draftKey);
  }

  return { posted: true };
}

function buildBlocks(client: ClientRow, draft: BuiltDraft): Array<Record<string, unknown>> {
  const name = clientDisplayName(client);
  const to = draft.recipient || "no address on file";

  // An unwritten draft says so and offers nothing to send. This is the whole reason
  // TODO_MARKER exists: a placeholder that quietly posted itself would eventually be
  // tapped, and the client would receive a note addressed to Matthew.
  if (draft.unwritten) {
    return [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: [
            `:pencil2: *${draft.copy.label}* is due for *${name}*, and the copy has not been written yet.`,
            ``,
            `Write it in \`src/config/client-messages.ts\` under \`${draft.key}\`, then use the button on their board to redraft.`,
          ].join("\n"),
        },
      },
    ];
  }

  const header = [
    `*${KIND_LABEL[draft.kind]}  ·  ${draft.copy.label}*`,
    `To ${name} on ${CHANNEL_LABEL[draft.channel]}, ${to}`,
  ];

  if (draft.channel === "whatsapp" && !draft.waLink) {
    header.push(
      `:warning: No WhatsApp link: that number is not in +1XXXXXXXXXX form, so wa.me cannot use it. Fix the number on their board and redraft.`
    );
  }
  if (draft.dashInVars) {
    header.push(
      `:warning: An em dash came in through the data rather than the copy. Take it out before sending.`
    );
  }

  const blocks: Array<Record<string, unknown>> = [
    { type: "section", text: { type: "mrkdwn", text: header.join("\n") } },
    // The body in a quote block, so what is on screen is exactly what gets sent and a
    // stray Slack format cannot make it look different from the real thing.
    {
      type: "section",
      text: { type: "mrkdwn", text: `>>>${draft.body}`.slice(0, 2900) },
    },
  ];

  const elements: Array<Record<string, unknown>> = [];
  if (draft.waLink) {
    elements.push({
      type: "button",
      action_id: "client_msg_open",
      text: { type: "plain_text", text: "Open in WhatsApp", emoji: true },
      style: "primary",
      url: draft.waLink,
    });
  }
  elements.push({
    type: "button",
    action_id: "client_msg_sent",
    text: { type: "plain_text", text: "Mark sent", emoji: true },
    value: `${client.id}:${draft.key}`,
  });

  blocks.push({ type: "actions", elements });
  return blocks;
}

/** Stamp a draft as actually sent. Called from the Slack action handler. */
export async function markDraftSent(
  clientId: string,
  draftKey: string,
  actor: string | null
): Promise<{ ok: boolean; alreadySent: boolean }> {
  const { data } = await supabaseAdmin
    .from("client_messages")
    .select("sent_at")
    .eq("client_id", clientId)
    .eq("draft_key", draftKey)
    .maybeSingle();

  if (data?.sent_at) return { ok: true, alreadySent: true };

  const { error } = await supabaseAdmin
    .from("client_messages")
    .update({ sent_at: new Date().toISOString(), sent_by: actor })
    .eq("client_id", clientId)
    .eq("draft_key", draftKey)
    .is("sent_at", null);

  return { ok: !error, alreadySent: false };
}

/**
 * Throw away a draft so it can be built again.
 *
 * The unique constraint makes drafting idempotent, which is right until the copy changes
 * or the client's number is corrected. Without this the only way to get a fresh draft
 * would be a hand-written DELETE, and the placeholder path in particular needs a way
 * back: every draft written before the copy exists lands unwritten and must be redoable.
 */
export async function clearDraft(clientId: string, draftKey: string): Promise<void> {
  await supabaseAdmin
    .from("client_messages")
    .delete()
    .eq("client_id", clientId)
    .eq("draft_key", draftKey)
    .is("sent_at", null);
}

/** Draft again from scratch, whatever was there before. Used by the board button. */
export async function redraft(
  clientId: string,
  draftKey: string,
  vars: DraftVars = {}
): Promise<{ posted: boolean; reason?: string }> {
  await clearDraft(clientId, draftKey);
  return postDraft(clientId, draftKey, vars);
}

// ─────────────────────────────────────────────────────────────────────────────
// The DNS call checklist
// ─────────────────────────────────────────────────────────────────────────────
//
// Read down the phone while the client is in their registrar. It is bullets rather than
// prose for the same reason the `call` script in audit-engine is: this is the only output
// in this folder that gets SPOKEN, live, while somebody waits.
//
// It exists because the DNS step is the one that strands a non-technical owner. They say
// yes on the call, then cannot find where records live in GoDaddy, and the whole build
// stalls behind a five minute job. Same PRE-FLIGHT precedent as loom-script.ts: the
// things a script cannot carry, listed before the thing starts.

export function dnsCallChecklist(client: ClientRow): string {
  const v = baseVars(client);
  const hub = v.hubHost ?? "the hub host";
  const review = v.reviewHost ?? "reviews.theirdomain";
  const domain = v.domain ?? "their domain";

  return [
    `*DNS on the call: ${clientDisplayName(client)}*`,
    `Three records. Two CNAMEs and one TXT. They drive, we never ask for the login.`,
    ``,
    `*Before you dial*`,
    `· Have the two CNAME targets and the TXT value open in front of you`,
    `· Ask who the domain is with. GoDaddy, Namecheap, Squarespace, Wix, or "my web guy"`,
    `· If it is the web guy, get them on the call now rather than emailing them after`,
    ``,
    `*Getting them to the right screen*`,
    `· "Log in to where you bought the domain, not your website builder"`,
    `· GoDaddy: My Products, find the domain, DNS, then Manage Zones`,
    `· Namecheap: Domain List, Manage, Advanced DNS`,
    `· Squarespace: Settings, Domains, the domain, DNS Settings`,
    `· Wix: Domains, the domain, Advanced, Edit DNS`,
    `· Cloudflare: pick the site, DNS, Records`,
    `· If they cannot find it: "type your domain into whois.com and read me the registrar"`,
    ``,
    `*Record 1, CNAME, the hub*`,
    `· Type or Host: the part before the dot in ${hub}`,
    `· Points to: the Vercel target`,
    `· Most registrars want the SUBDOMAIN ONLY in the host box, not the full name.`,
    `  If it saves as ${hub}.${domain} they typed too much, delete and redo`,
    ``,
    `*Record 2, CNAME, the review tool*`,
    `· Host: reviews`,
    `· Points to: the same Vercel target`,
    `· They will ask why, since there is nothing there yet. The honest answer is that`,
    `  it goes in now so we never have to get them back in here a second time`,
    ``,
    `*Record 3, TXT, Search Console*`,
    `· Host: @ , which means the domain itself. Some registrars want it blank instead`,
    `· Value: the google-site-verification string, pasted whole`,
    ``,
    `*Before you hang up*`,
    `· Watch them press Save. A typed record that was never saved looks identical`,
    `· Say out loud that it can take up to an hour, so nobody panics in ten minutes`,
    `· Tell them nothing on their existing website changes. That is the fear here`,
    `· Do not tick the DNS step until you have seen it resolve`,
  ].join("\n");
}

/** Put the call checklist in the ops thread. Internal, never sent to a client. */
/**
 * The registrar-by-registrar phone script, in the DNS step's own thread.
 *
 * It is read aloud while the DNS step is open, so it belongs beside that step's record values
 * and nowhere else.
 */
export async function postDnsCallChecklist(clientId: string): Promise<void> {
  const channelId = process.env.SLACK_CLIENT_ONBOARDING_CHANNEL;
  if (!channelId) return;

  const client = await loadClient(clientId);
  if (!client) return;

  const { notifyStep } = await import("@/lib/clients/step-board");
  await notifyStep(clientId, "dns_records", dnsCallChecklist(client));
}
