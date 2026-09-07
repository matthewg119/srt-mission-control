// Read a ReachInbox webhook body into the four fields the digest needs, and nothing else.
//
// ‼️ THIS PARSER WAS WRITTEN AGAINST A PAYLOAD SHAPE NOBODY HAS SEEN YET, AND THAT IS WHY IT
// GUESSES WIDELY AND NEVER THROWS. The integration is labelled "Slack Webhook", so the body may
// be ReachInbox's own event JSON, or it may be Slack Block Kit (`{text, blocks}`) with the facts
// only present as English prose. Both are handled. Anything it cannot read becomes
// `event_type: "unknown"` with the raw body still stored, because a row we can re-read later beats
// a 400 that drops the event during an 8-day trial.
//
// Pure on purpose: no DB, no network, no env. scripts/_probe-reachinbox.ts asserts it offline.

import { createHash } from "node:crypto";

export type ReachInboxEventType =
  | "sent"
  | "opened"
  | "clicked"
  | "replied"
  | "bounced"
  | "completed"
  | "unknown";

export interface ParsedReachInboxEvent {
  providerEventId: string;
  eventType: ReachInboxEventType;
  campaignName: string | null;
  campaignId: string | null;
  leadEmail: string | null;
  occurredAt: string;
}

/**
 * Canonical event names.
 *
 * ‼️ ORDER MATTERS AND `replied` MUST BE TESTED BEFORE `sent`. ReachInbox's own label for a reply
 * is "Reply Received", and a Slack-shaped body says things like "a reply was received to the email
 * sent on...". A `sent` test that ran first would match that sentence and quietly file every reply
 * as a send, inflating the denominator and deflating the reply rate at the same time -- the one
 * failure that makes the whole number lie in a direction that looks fine.
 */
const TYPE_PATTERNS: ReadonlyArray<[ReachInboxEventType, RegExp]> = [
  ["bounced", /\bbounc/i],
  ["replied", /\brepl/i],
  ["clicked", /\bclick/i],
  ["opened", /\bopen/i],
  ["completed", /\bcomplet/i],
  ["sent", /\bsent\b|\bsend\b|\bdeliver/i],
];

export function normalizeEventType(raw: string | null | undefined): ReachInboxEventType {
  // ‼️ SEPARATORS BECOME SPACES BEFORE ANY \b TEST. An underscore is a word character, so
  // /\bsent\b/ does not match "email_sent" and /\bbounc/ does not match "EMAIL_BOUNCED" -- the
  // two most likely spellings a machine-readable payload would use. Every event would have
  // parsed as "unknown" and the digest would have had nothing to count.
  const text = (raw ?? "").trim().replace(/[_\-.]+/g, " ");
  if (!text) return "unknown";
  for (const [type, re] of TYPE_PATTERNS) {
    if (re.test(text)) return type;
  }
  return "unknown";
}

/** Keys we will accept for each field, lowercased and stripped of separators before comparison. */
const TYPE_KEYS = ["eventtype", "event", "type", "eventname", "action", "status"];
const CAMPAIGN_NAME_KEYS = ["campaignname", "campaign", "campaigntitle", "sequencename"];
const CAMPAIGN_ID_KEYS = ["campaignid", "campaignuuid", "sequenceid", "cid"];
const EMAIL_KEYS = ["leademail", "email", "to", "recipient", "recipientemail", "prospectemail", "contactemail", "toemail"];
const TIME_KEYS = ["occurredat", "timestamp", "eventtime", "createdat", "date", "time", "sentat"];
const ID_KEYS = ["eventid", "id", "messageid", "uuid", "eventuuid"];

const canon = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Depth-first search for the first primitive value under any of `keys`.
 *
 * Webhook bodies nest their facts differently every time (`{data:{lead:{email}}}`,
 * `{payload:{prospect:{email}}}`), so hunting by key name anywhere in the tree reads more shapes
 * than a fixed path and cannot be broken by an extra wrapper object appearing.
 */
function findByKey(node: unknown, keys: readonly string[], depth = 0): string | null {
  if (depth > 6 || node === null || typeof node !== "object") return null;
  const wanted = new Set(keys);

  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findByKey(item, keys, depth + 1);
      if (hit) return hit;
    }
    return null;
  }

  const obj = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    if (!wanted.has(canon(key))) continue;
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  for (const value of Object.values(obj)) {
    const hit = findByKey(value, keys, depth + 1);
    if (hit) return hit;
  }
  return null;
}

/**
 * The campaign, which is the one field likely to arrive as a nested object rather than a scalar.
 *
 * ‼️ `{campaign: {id, name}}` IS THE OBVIOUS SHAPE AND findByKey CANNOT READ IT. That helper only
 * returns primitives, so a key called `campaign` holding an object is skipped, and recursing into
 * it finds no key called `campaign` either -- the name is just `name`. Adding "name" to the
 * top-level key list would fix this campaign and break attribution generally, because `name` on a
 * lead object is a person. So the nesting is handled here, where the enclosing key has already
 * proved what the inner `name` refers to.
 */
function findCampaign(node: unknown, depth = 0): { name: string | null; id: string | null } {
  const direct = { name: findByKey(node, CAMPAIGN_NAME_KEYS), id: findByKey(node, CAMPAIGN_ID_KEYS) };
  if (direct.name && direct.id) return direct;
  if (depth > 6 || node === null || typeof node !== "object") return direct;

  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findCampaign(item, depth + 1);
      if (hit.name || hit.id) return { name: direct.name ?? hit.name, id: direct.id ?? hit.id };
    }
    return direct;
  }

  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const k = canon(key);
    if ((k !== "campaign" && k !== "sequence") || value === null || typeof value !== "object") continue;
    const inner = value as Record<string, unknown>;
    const pick = (keys: readonly string[]) => {
      for (const [ik, iv] of Object.entries(inner)) {
        if (keys.includes(canon(ik)) && typeof iv === "string" && iv.trim()) return iv.trim();
        if (keys.includes(canon(ik)) && typeof iv === "number") return String(iv);
      }
      return null;
    };
    return {
      name: direct.name ?? pick(["name", "title", "campaignname"]),
      id: direct.id ?? pick(["id", "uuid", "campaignid"]),
    };
  }
  return direct;
}

// Deliberately strict about the trailing character class so a trailing period in prose
// ("...replied to jane@acme.com.") is not swallowed into the address.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/;

/** Every string in the body, flattened, so a Slack-shaped payload can still be read as prose. */
function allText(node: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 8 || node === null) return out;
  if (typeof node === "string") {
    out.push(node);
    return out;
  }
  if (typeof node !== "object") return out;
  for (const value of Object.values(node as Record<string, unknown>)) {
    allText(value, out, depth + 1);
  }
  return out;
}

function parseTime(raw: string | null): string {
  if (!raw) return new Date().toISOString();
  // Unix seconds or milliseconds, which Slack-shaped payloads use for `ts`.
  if (/^\d{9,13}(\.\d+)?$/.test(raw)) {
    const n = Number(raw);
    const ms = raw.replace(/\..*$/, "").length <= 10 ? n * 1000 : n;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const d = new Date(raw);
  // An unparseable timestamp becomes arrival time rather than an error. Being an hour out is
  // survivable; dropping the event is not.
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/**
 * @param body   the parsed JSON body, or null if it was not JSON at all
 * @param rawText the exact bytes received, used for the fallback dedupe id
 */
export function parseReachInboxEvent(body: unknown, rawText: string): ParsedReachInboxEvent {
  const prose = allText(body).join(" \n ");

  const typeRaw = findByKey(body, TYPE_KEYS);
  let eventType = normalizeEventType(typeRaw);
  // No structured type: read the prose. This is the Slack Block Kit case.
  if (eventType === "unknown") eventType = normalizeEventType(prose);

  const { name: campaignName, id: campaignId } = findCampaign(body);

  const emailRaw = findByKey(body, EMAIL_KEYS) ?? prose.match(EMAIL_RE)?.[0] ?? null;
  // A key match can still hand back a display name or a whole "Jane <jane@acme.com>" string, so
  // the address is re-extracted from whatever was found rather than trusted as-is.
  const leadEmail = emailRaw ? (emailRaw.match(EMAIL_RE)?.[0] ?? null) : null;

  const occurredAt = parseTime(findByKey(body, TIME_KEYS));

  const givenId = findByKey(body, ID_KEYS);
  const providerEventId = givenId
    ? `ri:${givenId}`
    : // No id from the provider, so one is derived from the bytes. Identical bytes are a retry;
      // a genuinely new event differs by at least its timestamp.
      `sha:${createHash("sha256").update(rawText).digest("hex").slice(0, 32)}`;

  return {
    providerEventId,
    eventType,
    campaignName: campaignName?.slice(0, 200) ?? null,
    campaignId: campaignId?.slice(0, 200) ?? null,
    leadEmail: leadEmail ? leadEmail.toLowerCase() : null,
    occurredAt,
  };
}
