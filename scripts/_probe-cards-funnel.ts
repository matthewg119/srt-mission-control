// THE CARD-LED ONBOARDING'S RULES, EXECUTABLE.
//
//   bun --no-env-file run scripts/_probe-cards-funnel.ts
//
// ‼️ NO MODEL CALL, NO DATABASE, NO NETWORK. Pure reads of the config plus greps over the three
// files that carry the funnel.
//
// WHAT IT PROVES:
//  1. The fork is EXCLUSIVE. Booking the call never also asks for the review platform.
//  2. Nothing calls the compliance step HIPAA, and it gates nothing.
//  3. It sells nothing: no price, no offer picker, no plan name.
//  4. The route validates what the client validates, because a browser check is not a boundary.
//  5. It asks for a PLATFORM and never a review URL.
//  6. Every lead goes through ingestLead(), so Matthew is notified.

import fs from "node:fs";
import path from "node:path";

import {
  CARDS_CLOSE,
  CARDS_FORK,
  CARDS_FREE_SITE,
  CARDS_IDS,
  CARDS_PLATFORM_STEP,
  CARDS_SCRIPT,
  CARDS_SOURCE,
  NO_WEBSITE,
  REVENUE_BANDS,
} from "../src/config/onboarding-cards";
import { HUB_API } from "../src/lib/hub/hub-paths";

const CONFIG = "src/config/onboarding-cards.ts";
const CLIENT = "src/app/cards/cards-client.tsx";
const ROUTE = "src/app/api/cards/route.ts";
const PAGE = "src/app/cards/page.tsx";

let failures = 0;

function check(ok: boolean, label: string, detail?: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (detail) console.log(`      ${detail}`);
  if (!ok) failures += 1;
}

function read(file: string): string {
  const CR = String.fromCharCode(13);
  return fs.readFileSync(path.join(process.cwd(), file), "utf8").split(CR).join("");
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const configSrc = stripComments(read(CONFIG));
const clientSrc = stripComments(read(CLIENT));
const routeSrc = stripComments(read(ROUTE));
const pageSrc = stripComments(read(PAGE));

// ── 1. THE FORK IS EXCLUSIVE. ───────────────────────────────────────────────
//
// ‼️ MATTHEW'S CALL, AND THE ONE RULE THIS FUNNEL EXISTS TO GET RIGHT: "if this happen then its
// better if we dont give them the option to finish the offer and setup which provider he wants
// the reviews sent to." A clinic that books the call must not half-configure itself first, or the
// call starts by undoing their guesses.
check(
  CARDS_SCRIPT.every((s) => s.id !== CARDS_PLATFORM_STEP.id),
  "the platform question is NOT in the main script",
  "it is appended only on the self-serve branch"
);
check(
  /finish === "self"/.test(clientSrc) && /CARDS_PLATFORM_STEP/.test(clientSrc),
  "the client appends it only when the finish is self-serve"
);
check(
  !/finish === "call"[\s\S]{0,200}CARDS_PLATFORM_STEP/.test(clientSrc),
  "and never on the call branch"
);
// The last step of the main script is the fork, so nothing scripted follows a booking.
check(
  CARDS_SCRIPT[CARDS_SCRIPT.length - 1].kind === "fork",
  "the fork is the last step of the script",
  `last is "${CARDS_SCRIPT[CARDS_SCRIPT.length - 1].kind}"`
);
check(Object.keys(CARDS_FORK).length === 2, "there are exactly two ways to finish");
check(
  Object.keys(CARDS_CLOSE).length === 2,
  "and each branch has its own closing line, so neither claims the other's outcome"
);

// ── 2. THE COMPLIANCE STEP IS NOT CALLED HIPAA AND GATES NOTHING. ───────────
//
// ‼️ MATTHEW'S OWN READ AND IT IS THE RIGHT ONE. The real artifact is a Business Associate
// Agreement and it belongs on the call. Labelling an offer-setup step "for HIPAA compliance" is a
// pressure tactic an owner works out later, and the card itself needs no agreement from anybody.
for (const [label, src] of [
  ["the config", configSrc],
  ["the client", clientSrc],
  ["the route", routeSrc],
  ["the page", pageSrc],
] as const) {
  check(!/hipaa/i.test(src), `${label} never says HIPAA`);
}
const consent = CARDS_SCRIPT.find((s) => s.kind === "consent");
check(Boolean(consent), "there is a compliance step");
check(
  consent?.kind === "consent" && /Business Associate Agreement/.test(consent.prompt),
  "and it names the Business Associate Agreement, which is the real artifact"
);
check(
  consent?.kind === "consent" && /need no paperwork|cards need no/i.test(consent.prompt),
  "and says plainly that the cards themselves need none of it"
);
// It is read and acknowledged. A tick box implies it gates something, and it does not.
check(
  consent?.kind === "consent" && typeof consent.cta === "string" && consent.cta.length > 0,
  "it is acknowledged rather than agreed to"
);

// ── 3. IT SELLS NOTHING. ────────────────────────────────────────────────────
//
// ‼️ THIS IS WHY IT IS A SIBLING OF /onboarding2 AND NOT A MODE OF IT. The clinic already said
// yes to a free batch of cards. A price, a plan name or an offer card appearing here would make
// the email that got them here a bait.
// ‼️ THE ALLOWANCE IS PER FILE AND NOT SHARED, because the bands are DECLARED in the config and
// only IMPORTED by the client. A single budget for both would have let a price slip into the
// client as long as the config happened to be short one band.
const BAND_FIGURES = (REVENUE_BANDS.join(" ").match(/\$\d/g) ?? []).length;
for (const [label, src, allowed] of [
  ["the config", configSrc, BAND_FIGURES],
  ["the client", clientSrc, 0],
] as const) {
  const money = (src.match(/\$\d/g) ?? []).length;
  check(
    money === allowed,
    `${label} quotes no price of ours`,
    money === allowed
      ? allowed === 0
        ? "no figures at all"
        : "the only figures are the revenue bands"
      : `${money} figures found, ${allowed} allowed`
  );
  check(
    !/review_free|year_3300|month_349|OFFER_KEYS|offer-cards/.test(src),
    `${label} does not reach for the offer picker`
  );
}

// ── 4. THE ROUTE VALIDATES WHAT THE CLIENT VALIDATES. ───────────────────────
//
// ‼️ A BROWSER CHECK IS A COURTESY AND NEVER A BOUNDARY. This route is public by design, like
// every funnel door in this app, so anything the client refuses the route must refuse too.
for (const rule of ["validEmail", "validName"]) {
  check(clientSrc.includes(rule), `the client checks ${rule}`);
  check(routeSrc.includes(rule), `and so does the route`);
}
check(
  /\^\[a-z0-9\]\[a-z0-9\.-\]\*\\\.\[a-z\]\{2,\}\$/.test(clientSrc) &&
    /\^\[a-z0-9\]\[a-z0-9\.-\]\*\\\.\[a-z\]\{2,\}\$/.test(routeSrc),
  "the website shape rule is the same expression in both"
);
// ‼️ NEITHER FETCHES THE WEBSITE. A clinic whose host is down for an hour must still be able to
// finish onboarding; whether the site resolves is the crawler's question.
check(
  !/fetch\(\s*[`"']https?:/.test(routeSrc),
  "and neither of them fetches the site to check it"
);
check(
  routeSrc.includes(NO_WEBSITE) || /NO_WEBSITE/.test(routeSrc),
  "the no-website sentinel survives to the server",
  "so 'they told us they have none' and 'we never asked' stay different"
);

// ── 5. A PLATFORM, NEVER A URL. ─────────────────────────────────────────────
//
// Same rule onboarding2's q7 carries: a review URL typed into a chat box, or constructed by us
// from a business name, is a link that can send a real patient to somebody else's profile.
check(
  CARDS_PLATFORM_STEP.kind === "chips",
  "the platform question is a fixed choice and not a text box"
);
check(
  !/review\s*url|reviewUrl|google\.com\/maps|place_id/i.test(configSrc),
  "and nothing in the funnel asks for a review link"
);
check(
  /REVIEW_PLATFORMS/.test(configSrc),
  "its options come from the shared platform table, not a copy of it"
);

// ── 6. EVERY LEAD IS NOTIFIED. ──────────────────────────────────────────────
//
// "make sure i get notified when we get the hot lead." ingestLead() is the one door that upserts
// the contact AND posts the #hot-leads card; writing `contacts` directly here would mean a lead
// that exists in the database and nowhere Matthew looks.
check(/ingestLead\(/.test(routeSrc), "the route goes through ingestLead()");
check(
  !/from\("contacts"\)/.test(routeSrc),
  "and never writes the contacts table itself"
);
// ‼️ includes() AND NOT A REGEX, because the first two attempts at this line shipped a literal
// backspace byte where `\b` was meant and the check silently passed nothing. A substring test
// needs no escapes and cannot be corrupted the same way. If the route ever writes `headline:`
// instead of the shorthand, add it here rather than reaching for a word boundary.
check(
  routeSrc.includes("headline,") && routeSrc.includes("detailLines:"),
  "and it fills in the card"
);
// The branch has to be legible at a glance, because it decides whether Matthew owes them anything.
check(
  /CARDS, booking a call|CARDS, self-serve/.test(routeSrc),
  "the headline says which branch they took"
);
check(
  /WANTS THE FREE WEBSITE/.test(routeSrc),
  "and shouts when a free website is owed, because that one has a clock on it"
);

// ── 7. HOUSEKEEPING. ────────────────────────────────────────────────────────
check(CARDS_SOURCE === "cards", "the lead source tag is 'cards'", CARDS_SOURCE);
check(
  new Set(CARDS_IDS).size === CARDS_IDS.length,
  "no two steps share an id",
  CARDS_IDS.join(", ")
);
check(
  !HUB_API.has("/api/cards"),
  "the route is NOT reachable on a client hostname",
  "it is SRT's own funnel; a client's domain has no business serving it"
);
check(
  /robots: \{ index: false/.test(pageSrc),
  "the page is noindex, because it is the back half of an outbound sequence"
);
check(
  CARDS_FREE_SITE.yes.length > 0 && CARDS_FREE_SITE.no.length > 0,
  "the free website offer can be declined"
);

console.log("");
if (failures > 0) {
  console.error(`${failures} check(s) failed. The fork is exclusive and the funnel sells nothing.`);
  process.exit(1);
}
console.log("All checks passed. One fork, two ways out, and nothing called HIPAA.");
