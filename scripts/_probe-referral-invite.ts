// THE REFERRAL INVITE'S RULES, EXECUTABLE.
//
//   bun --no-env-file run scripts/_probe-referral-invite.ts
//
// ‼️ NO MODEL CALL, NO DATABASE, NO NETWORK. Every check is either a pure call into
// referral-invite.ts or a grep over the three files that carry the feature. That is what lets it
// run in CI with no secrets, next to _probe-review-gating.ts.
//
// WHAT IT PROVES, and each one is a thing that would be invisible in review:
//
//  1. We are not the sender. The module returns an href and has no network call in it at all.
//  2. Only the text channel claims to be three-way, because only it can be.
//  3. A code expires, and the window is the one Matthew asked for.
//  4. The code cannot be misread aloud at a reception desk.
//  5. A filled message never ships an unreplaced {token} to a patient's friend.
//  6. referral_invites is the ONLY table that holds a friend's contact details.
//  7. The invite route cannot identify the patient, exactly as the submit route cannot.
//
// The FTC-shaped check (that the offer is never described as consideration for a review) lives in
// _probe-review-gating.ts instead, beside the rest of that argument.

import fs from "node:fs";
import path from "node:path";

import {
  DEFAULT_SEND_MODE,
  INVITE_CHANNELS,
  INVITE_TEMPLATES,
  INVITE_TTL_DAYS,
  composeInvite,
  dialable,
  fillInvite,
  inviteCode,
  inviteExpiry,
  normaliseCode,
  templateByKey,
} from "../src/lib/hub/referral-invite";

const MODULE = "src/lib/hub/referral-invite.ts";
const ROUTE = "src/app/api/hub/reviews/invite/route.ts";
const CLIENT = "src/app/hub/[host]/reviews/virtual-agent-client.tsx";

let failures = 0;

function check(ok: boolean, label: string, detail?: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (detail) console.log(`      ${detail}`);
  if (!ok) failures += 1;
}

/** Source with CRLF normalised. Same reason _probe-review-gating.ts carries this. */
function read(file: string): string {
  const CR = String.fromCharCode(13);
  return fs.readFileSync(path.join(process.cwd(), file), "utf8").split(CR).join("");
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const moduleSrc = stripComments(read(MODULE));
const routeSrc = stripComments(read(ROUTE));

// ── 1. WE DO NOT SEND. ──────────────────────────────────────────────────────
//
// ‼️ THE WHOLE CONSENT POSITION RESTS ON THIS ONE FACT. The friend never gave anybody their
// number, so a message sent from our servers on the clinic's behalf is an unconsented commercial
// text that our button created. A composed message opened on the patient's own phone is her
// sending it, which is both lawful and what the front desk can actually walk her through.
//
// The day somebody wires a provider in here, this check fails and the argument has to be had.
for (const forbidden of ["fetch(", "twilio", "loopmessage", "ringcentral", "sendSms", "nodemailer"]) {
  check(
    !moduleSrc.toLowerCase().includes(forbidden.toLowerCase()),
    `${MODULE} has no ${forbidden} in it`,
    `it returns an href; the patient's own messages app is the sender`
  );
}

check(
  DEFAULT_SEND_MODE === "device",
  "the default send mode is her device, not the clinic's number",
  `DEFAULT_SEND_MODE is "${DEFAULT_SEND_MODE}"`
);

// `clinic` is declared so the seam is typed, and refused so it cannot be half-built.
{
  const result = composeInvite({
    channel: "sms",
    mode: "clinic",
    friendContact: "+15555550111",
    clinicContact: "+15555550142",
    message: "hello",
  });
  check(
    result.kind === "unavailable",
    "asking to send from the clinic's own number is refused, not silently downgraded",
    `got "${result.kind}"`
  );
}

// ── 2. ONLY THE TEXT CHANNEL CLAIMS TO BE THREE-WAY. ────────────────────────
//
// ‼️ A wa.me LINK TAKES EXACTLY ONE RECIPIENT AND CANNOT OPEN A GROUP. So a WhatsApp invite is
// the patient messaging her friend one to one, with the clinic nowhere on the thread. Labelling
// that "text us both" would be a promise the link cannot keep, which the patient discovers only
// after she has sent it.
{
  const sms = INVITE_CHANNELS.find((c) => c.key === "sms");
  const whatsapp = INVITE_CHANNELS.find((c) => c.key === "whatsapp");
  const copy = INVITE_CHANNELS.find((c) => c.key === "copy");
  check(sms?.threeWay === true, "the text channel is marked three-way");
  check(whatsapp?.threeWay === false, "the WhatsApp channel is NOT marked three-way");
  check(copy?.threeWay === false, "copying the message is NOT marked three-way");

  // And the labels must not say it either.
  const liars = INVITE_CHANNELS.filter(
    (c) => !c.threeWay && /\bboth\b|3.?way|three.?way/i.test(c.label)
  );
  check(
    liars.length === 0,
    "no label claims a group thread the channel cannot open",
    liars.map((c) => `${c.key}: "${c.label}"`).join(", ") || undefined
  );
}

{
  const both = composeInvite({
    channel: "sms",
    friendContact: "(555) 555-0111",
    clinicContact: "+1 555 555 0142",
    message: "hello",
  });
  check(both.kind === "open" && both.threeWay, "a text with a clinic number is three-way");
  check(
    both.kind === "open" && both.href.includes("5555550111") && both.href.includes("5555550142"),
    "and the href addresses the friend AND the clinic",
    both.kind === "open" ? both.href.slice(0, 80) : undefined
  );

  // ‼️ NO CLINIC NUMBER DEGRADES HONESTLY. It becomes an ordinary text from her to her friend and
  // SAYS so, rather than pretending the clinic is listening on a thread they are not on.
  const alone = composeInvite({
    channel: "sms",
    friendContact: "+15555550111",
    clinicContact: null,
    message: "hello",
  });
  check(
    alone.kind === "open" && !alone.threeWay,
    "with no clinic number on file it is not claimed to be three-way"
  );

  const noNumber = composeInvite({ channel: "sms", friendContact: "   ", message: "hello" });
  check(noNumber.kind === "unavailable", "and with no friend number there is nothing to open");

  const empty = composeInvite({ channel: "sms", friendContact: "+15555550111", message: "  " });
  check(empty.kind === "unavailable", "an empty message is refused rather than sent blank");
}

// ── 3. A CODE EXPIRES, AND IN THE WINDOW HE ASKED FOR. ──────────────────────
check(INVITE_TTL_DAYS === 14, "a code is good for 14 days", `INVITE_TTL_DAYS is ${INVITE_TTL_DAYS}`);
{
  const from = new Date("2026-10-05T12:00:00.000Z");
  const until = inviteExpiry(from);
  const days = Math.round((until.getTime() - from.getTime()) / 86_400_000);
  check(days === INVITE_TTL_DAYS, `and the expiry is exactly ${INVITE_TTL_DAYS} days out`, `${days} days`);
  check(inviteExpiry().getTime() > Date.now(), "a code minted now expires in the future");
}

// ‼️ NO REMINDER, NO NUDGE, NO CRON. Chasing the friend would mean messaging somebody who still
// has not given anybody permission to message them, which is the reason we are not the sender in
// the first place. A scheduler reaching into this table is that decision reversed by accident.
check(
  !/cron|schedule|reminder|nudge/i.test(moduleSrc),
  "nothing in the module reminds, nudges or schedules anything"
);

// ── 4. THE CODE SURVIVES BEING READ ALOUD AT A DESK. ────────────────────────
//
// It is spoken over a phone and typed by a receptionist, so every character that is ambiguous out
// loud or in handwriting has to be absent: O/0, I/L/1, S/5, B/8.
{
  const AMBIGUOUS = ["O", "0", "I", "L", "1", "S", "5", "B", "8"];
  const seen = new Set<string>();
  for (let i = 0; i < 4000; i += 1) for (const ch of inviteCode()) seen.add(ch);
  const bad = AMBIGUOUS.filter((ch) => seen.has(ch));
  check(
    bad.length === 0,
    "no code character can be misheard or misread",
    bad.length ? `found: ${bad.join(", ")}` : `${seen.size} distinct characters, none ambiguous`
  );
  check(inviteCode().length === 6, "a code is six characters");
  check(
    normaliseCode(" ab-cd ef ") === "ABCDEF",
    "and a code typed with spaces or hyphens still matches",
    normaliseCode(" ab-cd ef ")
  );
}

check(dialable("+1 (555) 555-0111") === "+15555550111", "a number is reduced to href-safe digits");
check(dialable("555.555.0111") === "5555550111", "and a local number keeps no punctuation");

// ── 5. NO UNREPLACED TOKEN EVER REACHES A FRIEND. ───────────────────────────
//
// ‼️ A PATIENT SENDING "{offer}" TO HER FRIEND IS THE WORST VISIBLE FAILURE THIS FEATURE HAS.
// She reads the message before it opens, so she would see it, lose confidence and stop. Every
// template is filled with the same facts and checked for leftovers.
{
  const facts = {
    friendName: "Jamie",
    businessName: "Med Spa 123",
    serviceLabel: "lip filler",
    offerText: "80% off their first visit",
    code: "ACDEFG",
  };
  for (const template of INVITE_TEMPLATES) {
    const filled = fillInvite(template.body, facts);
    const leftover = filled.match(/\{[a-z]+\}/gi);
    check(
      leftover === null,
      `the "${template.key}" message leaves no unreplaced token`,
      leftover ? `found: ${leftover.join(", ")}` : filled.slice(0, 72)
    );
    check(
      filled.includes(facts.code) && filled.includes(facts.offerText),
      `and carries the code and the offer`,
      undefined
    );
  }
  check(INVITE_TEMPLATES.length >= 3, "there are at least three wordings to choose from");
  check(
    templateByKey("not-a-real-key").key === INVITE_TEMPLATES[0].key,
    "an unrecognised wording falls back to the first rather than throwing"
  );
}

// ── 6. ONE TABLE HOLDS A FRIEND'S CONTACT, AND IT IS NOT THE REVIEW TABLE. ──
//
// ‼️ review_tool_submissions WAS BUILT WITH NO COLUMN FOR A NAME, AN EMAIL OR A PHONE, and its
// migration says the absence of the column is the enforcement. A friend's number is worse than
// the patient's would be: it belongs to somebody who is not using the tool and has agreed to
// nothing. The direction of the foreign key is what keeps that true, so the grep is over the
// whole of src/.
{
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) {
        const src = stripComments(fs.readFileSync(full, "utf8"));
        if (/friend_contact|friend_name/.test(src)) hits.push(full.split(path.sep).join("/"));
      }
    }
  };
  walk(path.join(process.cwd(), "src"));
  const unexpected = hits.filter((f) => !f.endsWith(ROUTE));
  check(
    unexpected.length === 0,
    "only the invite route names a friend's stored contact columns",
    unexpected.length ? `also in: ${unexpected.join(", ")}` : `exactly one writer: ${ROUTE}`
  );
  check(
    /from\("referral_invites"\)/.test(routeSrc),
    "and it writes them to referral_invites"
  );
  check(
    !/from\("review_tool_submissions"\)[\s\S]{0,400}friend_/.test(routeSrc),
    "and never to review_tool_submissions"
  );
}

// ── 7. THE INVITE ROUTE CANNOT IDENTIFY THE PATIENT. ────────────────────────
//
// Same rule the submit route carries: the host header is the only statement of which client the
// write belongs to, and an IP is never read. It holds the FRIEND's number because the patient
// typed it to introduce them; it still must not be able to say who the patient was.
check(
  !/x-forwarded-for/i.test(routeSrc),
  "the invite route does not read x-forwarded-for",
  "not to store it, not to hash it, not to rate limit on it"
);
check(
  /x-hub-host/.test(routeSrc),
  "it takes the client from the forged-proof host header"
);
check(
  /resolved\.kind !== "reviews"/.test(routeSrc),
  "and refuses any host that is not a reviews host"
);
check(
  !/claude|anthropic/i.test(routeSrc) && !/claude|anthropic/i.test(moduleSrc),
  "no model is in this path either"
);

// ── 8. THE CLIENT ASKS THE ROUTE, NOT A PROVIDER. ───────────────────────────
{
  const clientSrc = stripComments(read(CLIENT));
  check(
    clientSrc.includes('"/api/hub/reviews/invite"'),
    "the walk posts the invite to its own route"
  );
  check(
    !/twilio|loopmessage|wa\.me|sms:/i.test(clientSrc),
    "and builds no message href of its own",
    "composeInvite owns every link, so there is one place the three-way rule lives"
  );
}

console.log("");
if (failures > 0) {
  console.error(`${failures} check(s) failed. We are not the sender, and a code must expire.`);
  process.exit(1);
}
console.log("All checks passed. She sends it, it expires, and her friend's number lives in one table.");
