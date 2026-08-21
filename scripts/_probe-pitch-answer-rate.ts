// THROWAWAY read-only probe. Measures the cold-pitch answer rate for the
// "<Business> + ChatGPT" subject convention since 2026-07-24.
// Writes nothing: no DB, no files.
//
//   bunx tsx --env-file=.env.local scripts/_probe-pitch-answer-rate.ts
//
// Paginates itself rather than using microsoft.listMessages, because that helper
// hardcodes $orderby=receivedDateTime desc and Graph rejects a filter on one date
// property sorted by another (InefficientFilter) -- see followup-operator/sent-sweep.ts.
// It also only reads one named folder, and replies get filed anywhere.

import { microsoft } from "../src/lib/microsoft";

const SINCE = "2026-07-24T00:00:00Z";
const MAX_PAGES = 200;

type Addr = { emailAddress?: { address?: string; name?: string } };
type Msg = {
  id: string;
  conversationId?: string;
  subject?: string;
  sentDateTime?: string;
  receivedDateTime?: string;
  bodyPreview?: string;
  from?: Addr;
  toRecipients?: Addr[];
  ccRecipients?: Addr[];
};

const GRAPH = "https://graph.microsoft.com/v1.0";

async function pageAll(url: string, label: string): Promise<Msg[]> {
  const token = await microsoft.getAccessToken();
  const out: Msg[] = [];
  let next: string | null = url;
  let pages = 0;
  while (next) {
    const res: Response = await fetch(next, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`Graph ${res.status} on ${label}: ${await res.text()}`);
    const json = (await res.json()) as { value?: Msg[]; "@odata.nextLink"?: string };
    out.push(...(json.value ?? []));
    next = json["@odata.nextLink"] ?? null;
    pages++;
    if (pages >= MAX_PAGES) {
      console.log(`\n!! PAGE CAP HIT on ${label} at ${pages} pages / ${out.length} msgs. SCAN IS TRUNCATED.\n`);
      break;
    }
  }
  console.log(`[scan] ${label}: ${out.length} messages over ${pages} page(s)`);
  return out;
}

// -- subject classification --

const PREFIX_RE = /^\s*(re|fw|fwd|rv|res)\s*:\s*/i;

function stripPrefixes(subject: string): { base: string; hadPrefix: boolean } {
  let s = subject;
  let hadPrefix = false;
  while (PREFIX_RE.test(s)) {
    s = s.replace(PREFIX_RE, "");
    hadPrefix = true;
  }
  return { base: s.trim(), hadPrefix };
}

const STRICT = /\+\s*chatgpt\s*[?.!]?\s*$/i;
// The subject was only hardcoded in no-website-pitch.ts on 2026-08-19. Before that it
// was hand-typed and drifted ("ChatGPT + Orlando Amusement", "Alfonso's is invisible in
// ChatGPT"). Those are real pitches, so the honest denominator is the LOOSE match and
// the strict count is reported alongside it as a convention-compliance number.
const LOOSE = /chatgpt/i;

function businessFromSubject(base: string): string {
  return (
    base
      .replace(/\+\s*chatgpt\s*[?.!]?\s*$/i, "")
      .replace(/^\s*chatgpt\s*\+\s*/i, "")
      .replace(/\s*\+?\s*chatgpt\s*/i, " ")
      .replace(/\s{2,}/g, " ")
      .trim() || base.trim()
  );
}

// -- recipients --

const EXCLUDED = [
  "srtagency.com",
  ...(process.env.OUTREACH_EXCLUDE_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean),
];

function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at < 0 ? "" : email.slice(at + 1);
}
function isExcluded(email: string): boolean {
  const d = domainOf(email);
  if (!d) return true;
  return EXCLUDED.some((x) => d === x || d.endsWith(`.${x}`));
}
// Not cold. Subject carries "ChatGPT" but the body opens "Nice speaking with you, we will
// get started on your report" -- a post-call follow-up to someone already spoken to.
// Counting it would flatter both the numerator and the denominator.
const NOT_COLD = new Set(["chronos9d@gmail.com"]);

function addrs(list: Addr[] | undefined): string[] {
  return (list ?? []).map((r) => (r.emailAddress?.address ?? "").trim().toLowerCase()).filter(Boolean);
}

// -- auto-reply / bounce detection --

const BOT_SENDER = /(mailer-daemon|postmaster|no-?reply|noreply|bounce|mailerdaemon|donotreply)/i;
const BOT_SUBJECT =
  /^\s*(automatic reply|auto[- ]?reply|out of office|undeliverable|delivery status notification|mail delivery|undelivered mail|read:|fuera de la oficina|respuesta autom)/i;

function isAutomated(m: Msg): boolean {
  const from = (m.from?.emailAddress?.address ?? "").toLowerCase();
  const subj = m.subject ?? "";
  return BOT_SENDER.test(from) || BOT_SUBJECT.test(subj);
}

// -- prospect grouping --

type Prospect = {
  key: string;
  business: string;
  emails: Set<string>;
  domains: Set<string>;
  convIds: Set<string>;
  firstSent: string;
  sends: number;
  followups: number;
  replies: Msg[];
  automated: Msg[];
};

function weekOf(iso: string): string {
  const d = new Date(iso);
  const day = d.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  const mon = new Date(d.getTime() - diff * 86400000);
  return mon.toISOString().slice(0, 10);
}

async function main() {
  console.log(`\nScanning matthew@srtagency.com since ${SINCE}\n`);

  // -- PASS A: sent --
  const sentUrl =
    `${GRAPH}/me/mailFolders/sentitems/messages` +
    `?$filter=${encodeURIComponent(`sentDateTime ge ${SINCE}`)}` +
    `&$orderby=${encodeURIComponent("sentDateTime desc")}` +
    `&$top=100` +
    `&$select=${encodeURIComponent("id,conversationId,subject,sentDateTime,toRecipients,ccRecipients")}`;
  const sent = await pageAll(sentUrl, "sent items");

  const prospects = new Map<string, Prospect>();
  const byConv = new Map<string, string>();
  const byEmail = new Map<string, string>();
  const nearMiss: Array<{ subject: string; to: string; when: string }> = [];
  let strictMatches = 0;

  const sentAsc = sent.slice().sort((a, b) => (a.sentDateTime ?? "").localeCompare(b.sentDateTime ?? ""));

  for (const m of sentAsc) {
    const subject = m.subject ?? "";
    const { base, hadPrefix } = stripPrefixes(subject);
    const to = [...addrs(m.toRecipients), ...addrs(m.ccRecipients)].filter(
      (a) => !isExcluded(a) && !NOT_COLD.has(a)
    );

    if (!LOOSE.test(base)) continue;
    if (STRICT.test(base)) strictMatches++;
    else if (to.length) nearMiss.push({ subject, to: to[0], when: (m.sentDateTime ?? "").slice(0, 10) });
    if (!to.length) continue;

    let key: string | undefined;
    if (m.conversationId) key = byConv.get(m.conversationId);
    if (!key) {
      for (const a of to) {
        const k = byEmail.get(a);
        if (k) {
          key = k;
          break;
        }
      }
    }
    if (!key) key = to[0];

    let p = prospects.get(key);
    if (!p) {
      p = {
        key,
        business: businessFromSubject(base) || key,
        emails: new Set(),
        domains: new Set(),
        convIds: new Set(),
        firstSent: m.sentDateTime ?? "",
        sends: 0,
        followups: 0,
        replies: [],
        automated: [],
      };
      prospects.set(key, p);
    }
    if (!p.business || p.business === key) p.business = businessFromSubject(base) || p.business;
    for (const a of to) {
      p.emails.add(a);
      p.domains.add(domainOf(a));
      byEmail.set(a, key);
    }
    if (m.conversationId) {
      p.convIds.add(m.conversationId);
      byConv.set(m.conversationId, key);
    }
    p.sends++;
    if (hadPrefix) p.followups++;
    if (!p.firstSent || (m.sentDateTime ?? "") < p.firstSent) p.firstSent = m.sentDateTime ?? p.firstSent;
  }

  // -- PASS B: everything inbound, all folders --
  const inUrl =
    `${GRAPH}/me/messages` +
    `?$filter=${encodeURIComponent(`receivedDateTime ge ${SINCE}`)}` +
    `&$orderby=${encodeURIComponent("receivedDateTime desc")}` +
    `&$top=100` +
    `&$select=${encodeURIComponent("id,conversationId,subject,receivedDateTime,from,bodyPreview")}`;
  const inboundAll = await pageAll(inUrl, "all folders (inbound scan)");

  // /me/messages is documented as all folders, but a reply that got filtered is the one
  // we least want to miss, so Junk is swept explicitly and deduped by message id.
  const junkUrl =
    `${GRAPH}/me/mailFolders/junkemail/messages` +
    `?$filter=${encodeURIComponent(`receivedDateTime ge ${SINCE}`)}` +
    `&$orderby=${encodeURIComponent("receivedDateTime desc")}` +
    `&$top=100` +
    `&$select=${encodeURIComponent("id,conversationId,subject,receivedDateTime,from,bodyPreview")}`;
  const junk = await pageAll(junkUrl, "junk email");
  const seenIds = new Set(inboundAll.map((m) => m.id));
  const junkExtra = junk.filter((m) => !seenIds.has(m.id));
  if (junkExtra.length) console.log(`[scan] junk messages NOT already in the all-folders scan: ${junkExtra.length}`);
  const inbound = [...inboundAll, ...junkExtra];

  const domainIndex = new Map<string, string>();
  for (const p of prospects.values()) for (const d of p.domains) if (d) domainIndex.set(d, p.key);

  let attached = 0;
  for (const m of inbound) {
    const from = (m.from?.emailAddress?.address ?? "").trim().toLowerCase();
    if (!from || isExcluded(from)) continue;

    let key: string | undefined;
    if (m.conversationId) key = byConv.get(m.conversationId);
    if (!key) key = byEmail.get(from);
    if (!key) key = domainIndex.get(domainOf(from));
    if (!key) continue;

    const p = prospects.get(key);
    if (!p) continue;
    if ((m.receivedDateTime ?? "") < p.firstSent) continue;
    attached++;
    if (isAutomated(m)) p.automated.push(m);
    else p.replies.push(m);
  }
  console.log(`[scan] inbound attached to a pitched prospect: ${attached}\n`);

  // -- report --
  const all = [...prospects.values()].sort((a, b) => a.firstSent.localeCompare(b.firstSent));
  const replied = all.filter((p) => p.replies.length > 0);
  const totalSends = all.reduce((n, p) => n + p.sends, 0);
  const totalFollowups = all.reduce((n, p) => n + p.followups, 0);
  const bounced = all.filter((p) => p.replies.length === 0 && p.automated.length > 0);

  const line = (s = "") => console.log(s);
  line("=".repeat(72));
  line('COLD PITCH ANSWER RATE  ·  "<Business> + ChatGPT"  ·  since 2026-07-24');
  line("=".repeat(72));
  line();
  line(`Businesses pitched (unique)       ${all.length}`);
  line(`  first-touch emails              ${totalSends - totalFollowups}`);
  line(`  follow-up nudges (re:)          ${totalFollowups}`);
  line(`  total emails sent               ${totalSends}`);
  line();
  line(`Businesses that replied (human)   ${replied.length}`);
  line(`Total human reply messages        ${replied.reduce((n, p) => n + p.replies.length, 0)}`);
  line();
  line(`ANSWER RATE per business          ${all.length ? ((replied.length / all.length) * 100).toFixed(1) : "0.0"}%`);
  line(`ANSWER RATE per email sent        ${totalSends ? ((replied.length / totalSends) * 100).toFixed(1) : "0.0"}%`);
  line();
  line(
    `Auto-replies / bounces (excluded)  ${all.reduce((n, p) => n + p.automated.length, 0)} msgs across ${bounced.length} businesses with no human reply`
  );
  line();

  // Every reply so far arrived inside 1 day, so a prospect pitched yesterday is not yet a
  // "no". Splitting the cohort keeps a fresh batch from dragging the headline down.
  const MATURE_DAYS = 3;
  const cutoff = new Date(Date.now() - MATURE_DAYS * 86400000).toISOString();
  const mature = all.filter((p) => p.firstSent < cutoff);
  const fresh = all.filter((p) => p.firstSent >= cutoff);
  const matureReplied = mature.filter((p) => p.replies.length > 0);
  line("-".repeat(72));
  line(`COHORT SPLIT (a reply has always arrived within 1 day, so <${MATURE_DAYS}d is undecided)`);
  line("-".repeat(72));
  line(
    `Had ${MATURE_DAYS}+ days to answer    ${String(mature.length).padStart(3)} pitched   ${String(matureReplied.length).padStart(2)} replied   ${mature.length ? ((matureReplied.length / mature.length) * 100).toFixed(1) : "0.0"}%   <- the real rate`
  );
  line(
    `Still too fresh to count   ${String(fresh.length).padStart(3)} pitched   ${String(fresh.filter((p) => p.replies.length).length).padStart(2)} replied`
  );
  line();

  line("-".repeat(72));
  line("BY WEEK (week starting Monday, by first touch)");
  line("-".repeat(72));
  const weeks = new Map<string, { pitched: number; replied: number; sends: number }>();
  for (const p of all) {
    const w = weekOf(p.firstSent);
    const row = weeks.get(w) ?? { pitched: 0, replied: 0, sends: 0 };
    row.pitched++;
    row.sends += p.sends;
    if (p.replies.length) row.replied++;
    weeks.set(w, row);
  }
  line("week of      pitched   emails   replied   rate");
  for (const w of [...weeks.keys()].sort()) {
    const r = weeks.get(w)!;
    line(
      `${w}  ${String(r.pitched).padStart(7)}  ${String(r.sends).padStart(7)}  ${String(r.replied).padStart(7)}   ${((r.replied / r.pitched) * 100).toFixed(1)}%`
    );
  }
  line();

  line("-".repeat(72));
  line("EMAILS ON THREAD vs REPLY (is the follow-up ladder earning anything)");
  line("-".repeat(72));
  const ladder = new Map<number, number>();
  for (const p of replied) ladder.set(p.sends, (ladder.get(p.sends) ?? 0) + 1);
  const pitchedByTouches = new Map<number, number>();
  for (const p of all) pitchedByTouches.set(p.sends, (pitchedByTouches.get(p.sends) ?? 0) + 1);
  line("emails on thread   businesses   replied   rate");
  for (const t of [...pitchedByTouches.keys()].sort((a, b) => a - b)) {
    const tot = pitchedByTouches.get(t)!;
    const rep = ladder.get(t) ?? 0;
    line(`${String(t).padStart(16)}   ${String(tot).padStart(10)}   ${String(rep).padStart(7)}   ${((rep / tot) * 100).toFixed(1)}%`);
  }
  line();

  line("-".repeat(72));
  line("WHO REPLIED");
  line("-".repeat(72));
  for (const p of replied) {
    const first = p.replies
      .slice()
      .sort((a, b) => (a.receivedDateTime ?? "").localeCompare(b.receivedDateTime ?? ""))[0];
    const days = (new Date(first.receivedDateTime ?? p.firstSent).getTime() - new Date(p.firstSent).getTime()) / 86400000;
    line(`· ${p.business}  <${[...p.emails][0]}>`);
    line(
      `    sent ${p.firstSent.slice(0, 10)} (${p.sends} email${p.sends === 1 ? "" : "s"})  ·  replied ${(first.receivedDateTime ?? "").slice(0, 10)}  ·  ${days.toFixed(1)}d`
    );
    line(`    from ${first.from?.emailAddress?.address ?? "?"}: ${(first.bodyPreview ?? "").replace(/\s+/g, " ").slice(0, 160)}`);
  }
  line();

  line("-".repeat(72));
  line(`NO REPLY (${all.length - replied.length})`);
  line("-".repeat(72));
  for (const p of all.filter((x) => !x.replies.length)) {
    const bounce = p.automated.length ? `  [${p.automated.length} auto/bounce]` : "";
    line(`· ${p.business.padEnd(38).slice(0, 38)} ${String(p.sends).padStart(2)} email(s)  first ${p.firstSent.slice(0, 10)}${bounce}`);
  }
  line();

  line("-".repeat(72));
  line("DATA QUALITY");
  line("-".repeat(72));
  line(`sent messages scanned             ${sent.length}`);
  line(`counted as pitch mail (loose)     ${totalSends}`);
  line(`  of which matched the strict "<Business> + ChatGPT" convention: ${strictMatches}`);
  line(`  drifted subjects, counted anyway: ${nearMiss.length}`);
  for (const n of nearMiss.slice(0, 40)) line(`    ${n.when}  ${n.to}  |  ${n.subject}`);
  if (nearMiss.length > 40) line(`    ... and ${nearMiss.length - 40} more`);
  line();
  line("bounce / auto-reply messages excluded from the numerator:");
  const autos = all.flatMap((p) => p.automated.map((m) => ({ p, m })));
  for (const a of autos.slice(0, 30)) {
    line(`    ${(a.m.receivedDateTime ?? "").slice(0, 10)}  ${a.m.from?.emailAddress?.address ?? "?"}  |  ${a.m.subject ?? ""}`);
  }
  if (autos.length > 30) line(`    ... and ${autos.length - 30} more`);
  line();
}

main().catch((e) => {
  console.error("\nFAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
