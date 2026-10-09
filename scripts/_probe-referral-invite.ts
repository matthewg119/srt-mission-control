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
  DEFAULT_INVITE_MODE,
  INVITE_CHANNELS,
  INVITE_TEMPLATES,
  INVITE_TTL_DAYS,
  claimUrl,
  composeInvite,
  dialable,
  fillInvite,
  inviteCode,
  inviteExpiry,
  normaliseCode,
  readInviteMode,
  templateByKey,
} from "../src/lib/hub/referral-invite";
import { HUB_API, HUB_CLAIM, externalPathDecision } from "../src/lib/hub/hub-paths";

const MODULE = "src/lib/hub/referral-invite.ts";
const ROUTE = "src/app/api/hub/reviews/invite/route.ts";
const CLAIM_ROUTE = "src/app/api/hub/reviews/claim/route.ts";
const CLAIM_PAGE = "src/app/hub/[host]/r/[code]/page.tsx";
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

// ── 1b. THE TWO MODES, AND NEITHER OF THEM IS US SENDING. ──────────────────
//
// ‼️ THE WHOLE POINT OF OFFERING TWO IS THAT THE PATIENT'S WALK IS IDENTICAL UP TO THE INVITE.
// `text` is her thumb; `internal` is a human at the clinic. There is deliberately no third mode
// in which a server sends anything, and `readInviteMode` collapses every unrecognised value onto
// the safe one rather than inventing a state the UI has no arm for.
check(
  DEFAULT_INVITE_MODE === "text",
  "the default mode is her own phone",
  `DEFAULT_INVITE_MODE is "${DEFAULT_INVITE_MODE}"`
);
check(readInviteMode("internal") === "internal", "internal is readable off a stored value");
check(readInviteMode("clinic") === "text", "and an unknown mode falls back, never through");
check(readInviteMode(undefined) === "text", "as does a missing one");

// ‼️ NO MODE NAMES A SENDER OF OURS. The failure to guard against is somebody adding a third mode
// that posts to a provider, which would make every sentence in this file's header false.
check(
  !/"clinic"|'clinic'/.test(moduleSrc.replace(/clinicContact|clinicPhone/g, "")),
  "no mode sends from a number of the clinic's or ours"
);

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
    offerText: "20% off their first visit",
    link: "https://reviews.medspa123.com/r/ACDEFG",
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
      filled.includes(facts.link) && filled.includes(facts.offerText),
      `and carries the claim link and the offer`,
      undefined
    );
    // ‼️ HER OWN REWARD IS NEVER IN THE FRIEND'S MESSAGE. A friend reading "and she gets 20% off
    // for sending you this" is being told they are the mechanism of somebody else's discount.
    check(
      !/you(r)? (next|own)|she gets|they get .*for sending/i.test(filled),
      `and says nothing about what SHE gets`
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
//
// ‼️ THE ALLOWLIST IS PER COLUMN SINCE 2026-10-05, WHICH IS STRICTER THAN THE SINGLE FILE IT
// REPLACED AND NOT A RELAXATION OF IT. The claim route has to read friend_name back in order to
// tell the clinic that what the patient said and what the friend typed disagree, so "exactly one
// file in all of src/" stopped being true the moment the emails existed. Widening it to "these
// two files" would have been the weak fix, because it would have let any future column be touched
// anywhere on that list. Each column now names the files that may mention it, so a third reader
// of a second-hand contact detail is still a failure.
{
  const CONTACT_COLUMNS: ReadonlyArray<readonly [string, readonly string[]]> = [
    // HEARSAY. A patient recited these at a counter about somebody who had agreed to nothing.
    // Written by the invite route; read by the claim route only to quote back to the clinic.
    // Nothing anywhere may send to them, which section 6b below is the check for.
    ["friend_name", [ROUTE, CLAIM_ROUTE]],
    ["friend_contact", [ROUTE, CLAIM_ROUTE]],
    // GIVEN BY ITS OWNER. Written where it is typed, read where it is sent to.
    ["referrer_email", [ROUTE, CLAIM_ROUTE]],
    ["claimed_email", [CLAIM_ROUTE]],
  ];

  const found = new Map<string, string[]>();
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) {
        const src = stripComments(fs.readFileSync(full, "utf8"));
        const rel = full.split(path.sep).join("/");
        for (const [column] of CONTACT_COLUMNS) {
          if (src.includes(column)) {
            const list = found.get(column) ?? [];
            list.push(rel);
            found.set(column, list);
          }
        }
      }
    }
  };
  walk(path.join(process.cwd(), "src"));

  for (const [column, allowed] of CONTACT_COLUMNS) {
    const hits = found.get(column) ?? [];
    const unexpected = hits.filter((f) => !allowed.some((a) => f.endsWith(a)));
    check(
      unexpected.length === 0,
      `only ${allowed.length === 1 ? "one file mentions" : `${allowed.length} named files mention`} ${column}`,
      unexpected.length
        ? `also in: ${unexpected.join(", ")}`
        : allowed.map((a) => a.split("/").pop()).join(", ")
    );
  }

  check(
    /from\("referral_invites"\)/.test(routeSrc),
    "and it writes them to referral_invites"
  );
  check(
    !/from\("review_tool_submissions"\)[\s\S]{0,400}friend_/.test(routeSrc),
    "and never to review_tool_submissions"
  );
}

// ── 6b. THE SENDER CANNOT REACH A SECOND-HAND CONTACT DETAIL AT ALL. ────────
//
// ‼️ THE EMAILS ARRIVED ON 2026-10-05 AND THIS IS WHAT STOPS THEM BECOMING THE THING THIS LANE
// WAS BUILT TO AVOID. The patient's text comes off her own phone precisely because a message
// from us to a number the friend never gave anybody is the clinic's TCPA exposure. An email is a
// different channel with a different consent story, and the whole of that story is WHO TYPED THE
// ADDRESS: the friend typed theirs on the clinic's own claim form, the patient typed hers at the
// invite step. friend_contact is neither.
//
// So referral-emails.ts is handed facts and queries nothing. It cannot name the hearsay columns,
// it holds no Supabase client, and it decides nothing about whether to send: the config gate is
// in referral-config.ts and every flag in it defaults to false.
{
  const EMAILS = "src/lib/hub/referral-emails.ts";
  const emailSrc = stripComments(fs.readFileSync(path.join(process.cwd(), EMAILS), "utf8"));

  check(
    !/friend_contact|friend_name/.test(emailSrc),
    "the sender never names a contact detail the patient recited"
  );
  check(
    !/supabaseAdmin|\.from\(/.test(emailSrc),
    "and it reads no table of its own, so it cannot find one either"
  );
  // The master switch is a switch, not a suggestion. All four flags read `=== true`, so a bag
  // with no referral_email object at all sends nothing.
  const configSrc = stripComments(
    fs.readFileSync(path.join(process.cwd(), "src/lib/hub/referral-config.ts"), "utf8")
  );
  for (const flag of ["enabled", "notify_clinic", "email_friend", "email_referrer"]) {
    check(
      new RegExp(`${flag}\\s*===\\s*true`).test(configSrc),
      `${flag} is off unless it is exactly true`
    );
  }
  check(
    /if \(!config\.enabled/.test(emailSrc) || /if \(!facts\.config\.enabled/.test(emailSrc),
    "and both entry points check the master switch first"
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

// ── 9. THE CLAIM FORM IS A PUBLIC PAGE ON EVERY CLIENT HOSTNAME. ───────────
//
// ‼️ THIS IS THE RISKIEST THING THE FEATURE ADDS, so it gets the most checks. /r/{CODE} is
// reachable on every domain any client has ever pointed at us, with no session, by anybody. What
// keeps it safe is not the URL pattern but what the code can do once resolved: nothing but name
// one row belonging to the host's own client.
{
  const claimRouteSrc = stripComments(read(CLAIM_ROUTE));
  const claimPageSrc = stripComments(read(CLAIM_PAGE));

  // The shape. Narrower than a slug: upper case and digits only, so no dot, hyphen or traversal.
  check(HUB_CLAIM.test("/r/ACDEFG"), "a claim code path is allowed");
  for (const bad of ["/r/", "/r/ab", "/r/acdefg", "/r/AC.DEF", "/r/AC/DEF", "/r/../etc", "/r/ACDEFGHIJKLMN"]) {
    check(!HUB_CLAIM.test(bad), `and ${bad} is not`);
  }
  check(externalPathDecision("/r/ACDEFG") === "rewrite", "it is rewritten into the host's own subtree");

  // ‼️ BARE /r REWRITES AND THAT IS CORRECT, NOT A HOLE. It is one lowercase segment, so
  // HUB_SLUG matches it and it becomes a lookup for a published page with the slug "r", which
  // 404s. This is the same reasoning externalPathDecision's own header spells out for
  // `/dashboard`: what protects a one-segment path is the rewrite into the host's subtree, not a
  // denylist. Asserting "refuse" here would have been asserting a behaviour the design does not
  // have, which is how a probe ends up documenting a rule nobody implemented.
  check(externalPathDecision("/r") === "rewrite", "bare /r is a page-slug lookup, never the form");
  check(
    externalPathDecision("/r/ACDEFG/extra") === "refuse",
    "and a third segment under it is refused"
  );

  // ‼️ SCOPED TO THE RESOLVED CLIENT IN BOTH PLACES. A global lookup on `code` alone would turn
  // six readable characters into a cross-tenant handle, which is the one way this page could
  // leak between clinics.
  for (const [label, src] of [["the claim page", claimPageSrc], ["the claim route", claimRouteSrc]] as const) {
    check(
      /\.eq\("client_id", client(Id)?\.?i?d?"?\)?/.test(src) || /eq\("client_id"/.test(src),
      `${label} scopes the code to the resolved client`
    );
    check(/eq\("code"/.test(src), `${label} looks the code up by code`);
    check(!/x-forwarded-for/i.test(src), `${label} never reads x-forwarded-for`);
    check(!/claude|anthropic/i.test(src), `${label} has no model in it`);
  }

  check(
    /x-hub-host/.test(claimRouteSrc) && /resolved\.kind !== "reviews"/.test(claimRouteSrc),
    "the claim route takes its client from the host header and refuses a non-reviews host"
  );
  check(HUB_API.has("/api/hub/reviews/claim"), "and the route is on the hub allowlist by name");

  // ‼️ ONE ANSWER FOR EVERY REFUSAL. Unknown, expired, wrong clinic and already claimed must be
  // indistinguishable, or six characters become enumerable with feedback.
  check(
    /This link is not open any more\./.test(claimRouteSrc),
    "every refusal gives the same reason"
  );
  check(
    /\.is\("claimed_at", null\)/.test(claimRouteSrc),
    "and a second claim cannot overwrite the first person's details"
  );

  // The page must not show the patient's name to the friend: she was never asked whether it could
  // be put on a web page for them.
  check(
    !/friend_name|offer_snapshot[\s\S]{0,120}referrer/.test(claimPageSrc),
    "the claim page shows the friend neither the referrer's name nor her reward"
  );
}

console.log("");
if (failures > 0) {
  console.error(`${failures} check(s) failed. We are not the sender, and a code must expire.`);
  process.exit(1);
}
console.log("All checks passed. She sends it, it expires, and her friend's number lives in one table.");
