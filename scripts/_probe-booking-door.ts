/**
 * The booking door (2026-09-15): audit report, Get Started, book, board opens in its own channel.
 *
 * Pure checks and source assertions. Spends nothing, writes nothing, posts nothing.
 *
 *   bunx tsx --env-file=.env.local scripts/_probe-booking-door.ts
 */
import fs from "fs";
import path from "path";
import { isClientRun } from "../src/lib/audit-engine/run-labels";
import { hasBannedDash } from "../src/lib/copy-guard";
import {
  buildInviteIcs,
  confirmationBodyHtml,
  confirmationSubject,
  formatCallTime,
} from "../src/lib/clients/booking-confirmation-email";
import { bookingUrlForReport } from "../src/lib/onboarding2-link";
import { channelLine, DEFAULT_ONBOARDING_OWNER, onboardingOwnerId, opsChannelNameFor } from "../src/lib/clients/provision";

export {};

let failed = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail !== undefined ? `\n      ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failed++;
}

const root = path.join(__dirname, "..");
const src = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
/** Source with comments stripped, so a comment that NAMES a function does not count as calling it. */
const code = (rel: string) => src(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

console.log("\n=== #hot-leads only for prospects ===");
check("a run fired for a client is a client run", isClientRun({ client_link_source: "fired_for_client", lead_source: null }));
check("a baseline scan's lead_source is a client run", isClientRun({ client_link_source: null, lead_source: "aeo_client_onboarding" }));
check("a public-intake prospect is not", !isClientRun({ client_link_source: null, lead_source: "pdf_guide" }));
check("an unlinked cold /audit is not", !isClientRun({}));
check(
  "finishReport's pitch block is guarded by isClientRun",
  /if \(report\.requester_email && !isClientRun\(/.test(code("src/lib/audit-engine/finish-report.ts"))
);
check(
  "the baseline scan no longer passes requesterEmail",
  !/requesterEmail:/.test(code("src/lib/clients/baseline-scan.ts"))
);

console.log("\n=== No scan at onboarding ===");
for (const rel of [
  "src/app/api/onboarding2/booked/route.ts",
  "src/app/api/onboarding2/chat/route.ts",
  "src/app/api/onboarding/save/route.ts",
  "src/lib/clients/open-board.ts",
  "src/lib/onboarding2/delivery.ts",
  "src/app/api/clients/start-pilot/route.ts",
]) {
  check(`${rel} never starts a baseline scan`, !/startBaselineScan/.test(code(rel)));
}
check("the booking opens the board", /openClientBoard\(/.test(code("src/app/api/onboarding2/booked/route.ts")));
check("the dashboard opens the same board", /openClientBoard\(/.test(code("src/app/api/clients/start-pilot/route.ts")));
check("the chat's last answer no longer opens a board by default", /applyQualifyingAnswers\(/.test(code("src/app/api/onboarding2/chat/route.ts")));
check(
  "openClientBoard attaches the audit by the report slug",
  /adoptPriorAudit\(clientId, \{ reportSlug: opts\.reportSlug \}\)/.test(code("src/lib/clients/open-board.ts"))
);
check(
  "adoptPriorAudit tries the slug before contact, email and domain",
  code("src/lib/clients/adopt-audit.ts").indexOf('q.eq("slug", reportSlug)') <
    code("src/lib/clients/adopt-audit.ts").indexOf('q.eq("contact_id", contactId)')
);
check(
  "step 2's verifier accepts an adopted audit after a fired one",
  /newestLinked\(FIRED_FOR_CLIENT\)[\s\S]*newestLinked\(ADOPTED_PROSPECT_AUDIT\)/.test(code("src/lib/clients/step-verify.ts"))
);

console.log("\n=== A channel Matthew can see, announced with its link ===");
const prov = code("src/lib/clients/provision.ts");
check("startPilot invites MATTHEW_SLACK_USER_ID into the channel", /createOpsChannel\(clientId, slug, \{ name: opsChannelNameFor\(slug\), invite: owner \}\)/.test(prov));
check("the booking and dashboard doors send no intake-link welcome email", /if \(door !== "self_serve"\)/.test(prov));
check("srt-agency-llc is not doubled to srt-srt-agency-llc", opsChannelNameFor("srt-agency-llc") === "srt-agency-llc");
check("an ordinary slug gets the srt- prefix", opsChannelNameFor("glow-med-spa") === "srt-glow-med-spa");
check(
  "the card says get started onboarding here, for the client, with the channel link",
  channelLine("C0C1WTPH0AZ", "Glow Med Spa") === ":point_right: *Get started onboarding here for Glow Med Spa:* <#C0C1WTPH0AZ>",
  channelLine("C0C1WTPH0AZ", "Glow Med Spa")
);
check("a missing channel is said out loud", channelLine(null, "Glow Med Spa").includes("No channel was created for Glow Med Spa"));
const savedOwner = process.env.MATTHEW_SLACK_USER_ID;
delete process.env.MATTHEW_SLACK_USER_ID;
check("an unset MATTHEW_SLACK_USER_ID still invites Matthew", onboardingOwnerId() === DEFAULT_ONBOARDING_OWNER && DEFAULT_ONBOARDING_OWNER === "U074ZQ1K0UE");
if (savedOwner !== undefined) process.env.MATTHEW_SLACK_USER_ID = savedOwner;
for (const [rel, re] of [
  ["src/lib/onboarding2/card.ts", /channelLine\(provision\.opsChannelId, business\)/],
  ["src/lib/clients/open-board.ts", /channelLine\(args\.opsChannelId, args\.name\)/],
  ["src/lib/clients/provision.ts", /channelLine\(args\.opsChannelId, args\.legalName\)/],
] as const) {
  check(`${rel} names the client on the channel line`, re.test(code(rel)));
}
check(
  "openOpsThread posts the header in channelFor, not the shared channel",
  /channelFor\(args\.clientId\)\) \?\? onboardingChannel\(\)/.test(code("src/lib/onboarding2/delivery.ts"))
);

console.log("\n=== One booking link ===");
check("the report no longer renders the bare BOOKING_LINK button", !/BOOKING_LINK/.test(code("src/components/audit-report/PricingCta.tsx")));
for (const rel of ["src/lib/audit-engine/delivery-email.ts", "src/lib/audit-engine/loom-script.ts", "src/lib/audit-engine/loom-beatsheet.ts"]) {
  check(`${rel} no longer reads BOOKING_LINK`, !/BOOKING_LINK/.test(code(rel)));
}
const url = bookingUrlForReport({ slug: "glow-med-spa-abc123", score: 13, city: "Greensboro, NC", client_name: "Glow Med Spa" });
check("the booking link is /onboarding2 with the report slug", url.includes("/onboarding2?") && url.includes("r=glow-med-spa-abc123"), url);

console.log("\n=== The confirmation email ===");
const startsAt = "2026-09-16T19:00:00Z";
const when = formatCallTime(startsAt, "America/New_York");
check("the time is in the client's zone", when === "Wednesday, September 16 at 3:00 PM EDT", when);
check("a bad zone falls back rather than throwing", formatCallTime(startsAt, "Not/AZone").includes("September 16"));
const subject = confirmationSubject(startsAt, "America/Chicago");
check("the subject names the time", subject === "Confirmed: our onboarding call on Wednesday, September 16 at 2:00 PM CDT", subject);
const body = confirmationBodyHtml({
  to: "owner@example.com",
  firstName: "Dana",
  businessName: "Glow Med Spa",
  startsAt,
  timeZone: "America/New_York",
  joinUrl: "https://zoom.us/j/123",
});
check("the body carries the join link", body.includes("https://zoom.us/j/123"));
check("the body has no em or en dash", !hasBannedDash(body.replace(/<[^>]+>/g, "")));
check("a body with no join link says where the link is", confirmationBodyHtml({ to: "a@b.c", startsAt }).includes("Calendly confirmation"));

const longJoin = `https://us06web.zoom.us/j/81234567890?pwd=${"x".repeat(120)}`;
const ics = buildInviteIcs({
  startsAt,
  organizerEmail: "matthew@srtagency.com",
  attendeeEmail: "owner@example.com",
  attendeeName: "Dana",
  joinUrl: longJoin,
  eventUuid: "ABCDEF123",
  businessName: "Glow Med Spa, LLC",
});
check("the invite is a REQUEST", ics.includes("METHOD:REQUEST") && ics.includes("BEGIN:VEVENT"));
check("the UID comes off the Calendly event", ics.includes("UID:ABCDEF123@srtagency.com"));
check("the start is UTC", ics.includes("DTSTART:20260916T190000Z"));
check("no end given means an hour", ics.includes("DTEND:20260916T200000Z"));
check("lines end CRLF", ics.split("\r\n").length > 10 && !/[^\r]\n/.test(ics));
check("every line is folded to 75 octets", ics.split("\r\n").every((l) => Buffer.byteLength(l, "utf8") <= 75));
check("commas in text are escaped", ics.includes("Glow Med Spa\\, LLC"));
check("the long join URL survives unfolding", ics.replace(/\r\n /g, "").includes(longJoin));

console.log(failed ? `\n${failed} FAILED` : "\nall green");
process.exit(failed ? 1 : 0);
