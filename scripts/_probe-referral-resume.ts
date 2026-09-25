// The resume link is not a session bearer, expires, and cannot open another tenant's conversation.
//
//   bun --no-env-file run scripts/_probe-referral-resume.ts
//
// ‼️ THIS IS THE SECURITY-SHAPED HALF OF THE WELCOME EMAIL, so the checks are about what a link CANNOT
// do. A link in an email is the least controlled thing we produce: it sits in a mailbox for years, gets
// forwarded to accountants and spouses, and is read by every scanner between us and them.
//
// ‼️ IT SETS ITS OWN SECRET so it can sign and verify in one process with no environment. The real secret
// is CLIENT_LINK_SECRET and it is never read here.

process.env.CLIENT_LINK_SECRET = process.env.CLIENT_LINK_SECRET || "probe-only-secret-not-the-real-one";

import fs from "node:fs";
import path from "node:path";

import { signOnboardingToken } from "../src/lib/clients/token";
import { RESUME_TTL_DAYS, mintResumeToken, resumeUrl, sessionIdFromResumeToken } from "../src/lib/concierge/resume";

let failures = 0;

function check(ok: boolean, label: string, detail?: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (detail) console.log(`      ${detail}`);
  if (!ok) failures += 1;
}

function read(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8");
}

/**
 * The same file with its comments removed.
 *
 * ‼️ EVERY CHECK ABOUT WHAT THE CODE DOES MUST READ CODE, and the comments in this repo are long
 * enough to break one. Three checks in the first draft of this probe failed on the comments EXPLAINING the
 * rule they were checking: resume.ts says in prose that it never touches photo_delete_after, and
 * referral-email.ts says in prose that the source recording named a competitor and a score. A probe an
 * explanation can fool is worse than one that is missing. The lead card probe learned this first.
 */
function code(file: string): string {
  // ‼️ SPLIT ON /\r?\n/, NOT ON "\n", AND THAT IS THE WINDOWS CRLF TRAP THIS REPO ALREADY
  // KNOWS ABOUT. Splitting on the newline alone leaves a \r at the end of every line, and `.` never matches a
  // carriage return, so `.*$` cannot reach the end of the line and the comment is left exactly where it
  // was. The probe then passes on a checkout with LF endings and fails on the same commit with CRLF,
  // which is what happened the moment these branches were merged in a Windows worktree.
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((l) => l.replace(/(^|\s)\/\/.*$/, ""))
    .join("\n");
}

const SESSION = "11111111-2222-3333-4444-555555555555";

// ── 1. It round trips, and only for its own scope ───────────────────────────
console.log("\n1. the token names one session and one purpose");

const { token } = mintResumeToken(SESSION);
check(sessionIdFromResumeToken(token) === SESSION, "a resume token gives back its session id");
check(sessionIdFromResumeToken(null) === null, "a missing token gives back nothing");
check(sessionIdFromResumeToken("garbage") === null, "so does garbage");
check(sessionIdFromResumeToken(token.slice(0, -2) + "xy") === null, "so does a tampered signature");

// ‼️ THE SCOPE CHECK IS THE POINT OF REUSING token.ts. An onboarding link is emailed to every client and
// lives fourteen days; if it opened a conversation as well, one link would do two jobs.
const onboarding = signOnboardingToken(SESSION, 14, "onboarding").token;
const preview = signOnboardingToken(SESSION, 14, "preview").token;
check(sessionIdFromResumeToken(onboarding) === null, "an onboarding-scoped token opens no conversation");
check(sessionIdFromResumeToken(preview) === null, "and neither does a preview one");

// ── 2. It expires, and sooner than everything else ──────────────────────────
console.log("\n2. it expires");

check(RESUME_TTL_DAYS === 3, "three days", `${RESUME_TTL_DAYS}`);
check(
  RESUME_TTL_DAYS < 14,
  "shorter than the preview and onboarding links",
  "those are walked on a call that might slip a week; this one is sent to somebody who stopped mid form"
);
const expired = signOnboardingToken(SESSION, -1, "resume").token;
check(sessionIdFromResumeToken(expired) === null, "an expired token opens nothing");

// ── 3. It is NOT the session's write bearer ─────────────────────────────────
//
// concierge_sessions.session_token is what /turn, /action and /booked accept to append to a conversation.
// It is unique, has no expiry column anywhere in the schema, and loadConciergeSession compares it with a
// plain .eq(). Putting that in an email would be putting a permanent write credential in a mailbox.
console.log("\n3. it is not the session token");

const resumeSrc = code("src/lib/concierge/resume.ts");
check(!resumeSrc.includes("session_token"), "resume.ts never reads the session token column");
check(!resumeSrc.includes("sessionToken"), "and never the field either");
const email = read("src/lib/concierge/referral-email.ts");
const emailCode = code("src/lib/concierge/referral-email.ts");
check(!email.includes("sessionToken") && !email.includes("session_token"), "and neither does the email");

const start = code("src/app/api/concierge/start/route.ts");
const branch = start.slice(start.indexOf("const resumeToken"), start.indexOf("const ipHash"));
check(branch.length > 400, "the resume branch was found to read", `${branch.length} chars`);
check(
  branch.includes("existing.clientId === config.clientId"),
  "the session must belong to the tenant being opened",
  "preview-grant.ts makes the same point: verifying a signature and forgetting the identity comparison is the one way to get this wrong"
);
check(
  branch.includes("existing.sessionToken"),
  "the real bearer is handed back by the server, not carried in the link",
  "which is the whole exchange: a short signed grant in, a session token out, over TLS, not through a mailbox"
);
check(!branch.includes("startConciergeSession"), "a resume mints no second session");

// ── 4. It restores a position and a name, not a transcript ──────────────────
console.log("\n4. what a forwarded link exposes");

check(
  branch.includes("hasContact: Boolean(existing.email)") && !branch.includes("loadMessages"),
  "the resume response carries no transcript",
  "a forwarded link should expose a step and a first name, not what somebody said about their business"
);
check(!branch.includes("email: existing.email"), "and it does not echo the email address back either");

// ── 5. It never touches the photo purge ─────────────────────────────────────
//
// purge.ts is the only thing in this repo that makes the consent copy ("deleted within 24 hours") true,
// and it is watched. A resume that extended the deadline so a returning visitor could see their photo
// again would quietly turn that promise into a lie.
console.log("\n5. the 24 hour photo purge is untouched");

for (const [file, src] of [
  ["resume.ts", resumeSrc],
  ["referral-email.ts", emailCode],
  ["start/route.ts resume branch", branch],
] as const) {
  check(!/photo_delete_after|storage_ref|photo_deleted_at/.test(src), `${file} touches no photo column`);
}

// ── 6. The link points at the page they were on, or at nothing ──────────────
console.log("\n6. the link");

const good = resumeUrl({ id: SESSION, entryHost: "clinic.com", entryPath: "/botox-vs-dysport" });
check(!!good && good.startsWith("https://clinic.com/botox-vs-dysport?"), "it reopens the page that earned the conversation", good ?? "(null)");
check(!!good && good.includes("srtc="), "with the token on it");
check(resumeUrl({ id: SESSION, entryHost: null, entryPath: "/x" }) === null, "no host means no link, rather than a guessed one");
check(resumeUrl({ id: SESSION, entryHost: "localhost", entryPath: "/x" }) === null, "and a hostname with no dot is not a host");
check(
  resumeUrl({ id: SESSION, entryHost: "https://clinic.com/", entryPath: "x" })?.startsWith("https://clinic.com/x") === true,
  "a stored scheme and a missing slash are both tolerated",
  resumeUrl({ id: SESSION, entryHost: "https://clinic.com/", entryPath: "x" }) ?? "(null)"
);

// ── 7. Every link in the email is conditional ───────────────────────────────
//
// The Loom is not recorded, the download does not exist as a file at all, and a resume link needs a
// session that recorded its page. A dead link in a first email is worse than a shorter first email.
console.log("\n7. no dead links");

check(email.includes("REFERRAL_ENGINE_LOOM_URL"), "the Loom is read from config, not hardcoded");
check(email.includes("REFERRAL_ENGINE_ASSET_URL"), "and so is the download");
check(/if \(loom\)/.test(email), "the Loom line is omitted when there is no recording");
check(/if \(params\.resumeUrl\)/.test(email), "and the resume line when there is no page");
check(
  email.includes("runs on your own site rather than as a file to download"),
  "with no asset it describes the install instead of linking to nothing",
  "pitch.ts sells the engine as set up on your site, and the walk ends with a technician installing it"
);
check(
  email.includes("REFERRAL_LOOM_SCRIPT"),
  "the Loom script lives in the repo rather than in a chat log",
  "so the recording and the email cannot drift without somebody editing the file"
);
check(
  !/21 out of 100|web plastic surgery|Phoenix/i.test(emailCode),
  "and it carries nothing from the one prospect the source recording was made for",
  "that video names a competitor, a city and somebody else's score"
);

const action = read("src/app/api/concierge/action/route.ts");
const actionCode = code("src/app/api/concierge/action/route.ts");
check(actionCode.includes('picked === "referral"'), "only the referral walk sends this email");
check(
  actionCode.includes("await sendReferralWelcome"),
  "it is awaited, not fired and forgotten",
  "a floating promise after the response may never run in a serverless function, and the walk promised this email"
);
check(
  action.slice(action.indexOf("sendReferralWelcome") - 400, action.indexOf("sendReferralWelcome")).includes("try {"),
  "and a mail failure never fails the form"
);

console.log("");
if (failures) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log("All checks passed. The link is a grant, not a bearer, and it expires.");

export {};
