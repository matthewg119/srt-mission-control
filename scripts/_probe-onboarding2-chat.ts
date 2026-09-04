// The assistant's gates, the page model, and the no-duplicate-fields rule, checked without
// spending a token.
//
//   npx tsx scripts/_probe-onboarding2-chat.ts
//
// Pure: no database, no Anthropic call. It exercises the executor, the prompt builders, the
// coverage functions and the scheduler directly, because the things most likely to be wrong here
// are silent. A booking offered at 5 of 6 does not throw. A grounded prompt that quietly omits a
// hard line answers questions perfectly well right up until it answers the wrong one. And a
// coverage check that stopped covering something would look exactly like one that still does.

import fs from "fs";
import path from "path";
import {
  makeExecutor,
  groundedPrompt,
  qualifyingPrompt,
  GROUNDED_TOOLS,
  QUALIFYING_TOOLS,
  type ExecutorContext,
} from "../src/lib/onboarding2/chat";
import { buildSnapshot, pagesOf } from "../src/lib/onboarding2/snapshot";
import { canonicalPage, canonicalSection, sha256Hex } from "../src/lib/onboarding2/canonical";
import { coverageOf, freezeInitials, missingSections, type InitialRow } from "../src/lib/onboarding2/initials";
import {
  CALL_HOUR,
  CALL_TIMEZONES,
  clockLabel,
  dayOptions,
  readDayChoice,
  readDaypart,
  readTimezone,
} from "../src/lib/onboarding2/scheduling";
import { localToInstant } from "../src/lib/onboarding2/calendar";
import { splitIntoMessages } from "../src/lib/onboarding2/texting";
import {
  CHAT_FAQS,
  CHAT_HARD_LINES,
  CLOSING_MESSAGES,
  SCHEDULING_INTRO,
  QUALIFYING_QUESTIONS,
  SCHEDULING_UI,
  TIMEZONE_OPTIONS,
} from "../src/config/onboarding2";
// ‼️ THE COUNTS ARE IMPORTED, NEVER RESTATED. This probe asserted "nine sections" and "four
// pages" as literals, so the v5 cut broke six checks that were all describing the same two
// facts the template already exports. A probe that hardcodes a count tests the count; a probe
// that reads it tests the INVARIANT, which is what the page model actually needs proving.
import {
  AGREEMENT_PAGE_COUNT,
  AGREEMENT_SECTION_COUNT,
  TEMPLATE_VERSION,
} from "../src/config/onboarding2-agreement";
import { intakePatchFrom, answeredCount } from "../src/lib/onboarding2/delivery";
import { modeFor } from "../src/lib/onboarding2/chat-store";
import type { Onboarding2LeadRow, Onboarding2SigningRow } from "../src/lib/onboarding2/types";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail}` : ""}`);
  if (!ok) failures++;
}

function fakeLead(answered: number): Onboarding2LeadRow {
  return {
    id: "lead", created_at: "", updated_at: "", email: "probe@example.com",
    phone: null, business_name: null, contact_name: null, signer_title: null,
    website: null, city: null, state: null, signing_id: null, signed_at: null, is_demo: true,
    qualifying: QUALIFYING_QUESTIONS.slice(0, answered).map((q) => ({
      key: q.key, question: q.question, answer: "something", askedAt: "", sourceTurnOrdinals: [0],
    })),
    qualifying_answered: answered, qualifying_completed_at: null,
    booking_offered_at: null, booked_slot_at: null, calendly_event_uri: null,
    call_daypart: null, call_day: null, call_choice_label: null, call_chosen_at: null,
    call_timezone: null, call_starts_at: null, call_event_id: null,
    call_invite_sent_at: null, call_invite_error: null,
    contact_id: null, client_id: null, ip_hash: null, source_url: null, referrer: null,
    utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null,
    fbc: null, fbp: null, fbclid: null,
  };
}

/** One recorded initial, as the row the route writes. */
function fakeInitial(pageNo: number, sections: number[], at: string): InitialRow {
  return {
    id: `i${pageNo}`, signing_id: "s", created_at: at,
    section_no: sections[0], section_key: `k${sections[0]}`, initials: "JR",
    section_sha256: "a".repeat(64), dwell_ms: 4200, client_nonce: `n${pageNo}`,
    page_no: pageNo, page_sections: sections, page_sha256: "b".repeat(64),
  };
}

async function main(): Promise<void> {
  const snapshot = await buildSnapshot();

  // !! `unsigned` AND `signed` NOW MEAN "BEFORE AND AFTER SCREEN ONE", NOT BEFORE AND AFTER A
  // SIGNATURE. modeFor() keys on `email` since 2026-09-04, because nothing sets signed_at any
  // more and keying on it would pin every new session to grounded mode forever. The variable
  // names are kept so the rest of this 500-line probe still reads, and signed_at is left on the
  // fixture to prove it is no longer what decides.
  const unsigned = { signed_at: null, email: null, agreement_snapshot: snapshot } as Onboarding2SigningRow;
  const signed = {
    signed_at: null,
    email: "owner@example.com",
    agreement_snapshot: snapshot,
  } as Onboarding2SigningRow;

  // ── The mode gate ──
  check("a session with no identity is grounded", modeFor(unsigned) === "grounded");
  check("a session that has been through screen one is qualifying", modeFor(signed) === "qualifying");
  check(
    "signed_at no longer decides the mode",
    modeFor({ signed_at: "2026-09-01T00:00:00Z", email: null, agreement_snapshot: snapshot } as Onboarding2SigningRow) ===
      "grounded",
    "a signature with no identity behind it is not a qualifying session"
  );

  // ── Grounded mode has exactly one tool, and it cannot write anything ──
  check("grounded mode has exactly one tool", GROUNDED_TOOLS.length === 1, `got ${GROUNDED_TOOLS.length}`);
  check(
    "that tool is flag_for_human",
    GROUNDED_TOOLS[0]?.name === "flag_for_human",
    GROUNDED_TOOLS[0]?.name
  );

  const gp = groundedPrompt(snapshot);
  const missingLines = CHAT_HARD_LINES.filter((l) => !gp.includes(l));
  check(
    "every hard line reaches the grounded prompt",
    missingLines.length === 0,
    missingLines.join("\n      ")
  );
  check(
    `the grounded prompt carries all ${AGREEMENT_SECTION_COUNT} sections`,
    snapshot.sections.every((s) => gp.includes(s.heading)),
    "a missing section is a question it will answer from nowhere"
  );
  check(
    "the grounded prompt is built from the SNAPSHOT, so it quotes what this signer is reading",
    gp.includes(snapshot.sections[0].body[0]),
    ""
  );

  // ─────────────────────────────────────────────────────────────────────────
  // THE PAGE MODEL. One initial per page covering every clause, and the proof that this attests
  // to the same text one-initial-per-clause did. v5: five pages over eleven clauses.
  // ─────────────────────────────────────────────────────────────────────────

  const pages = pagesOf(snapshot);
  check("the snapshot carries pages", (snapshot.pages?.length ?? 0) > 0, "buildSnapshot did not write any");
  check(
    `${AGREEMENT_SECTION_COUNT} clauses lay out as ${AGREEMENT_PAGE_COUNT} pages`,
    pages.length === AGREEMENT_PAGE_COUNT && snapshot.sections.length === AGREEMENT_SECTION_COUNT,
    `got ${pages.length} pages over ${snapshot.sections.length} sections`
  );
  check(
    "every section is on exactly one page, with none missing and none twice",
    (() => {
      const seen = pages.flatMap((p) => p.sections);
      return (
        seen.length === snapshot.sections.length &&
        new Set(seen).size === seen.length &&
        snapshot.sections.every((s) => seen.includes(s.n))
      );
    })(),
    JSON.stringify(pages.map((p) => p.sections))
  );
  check(
    "the pages run in section order, so a page hash covers a contiguous run",
    pages.flatMap((p) => p.sections).every((n, i, all) => i === 0 || n === all[i - 1] + 1),
    JSON.stringify(pages.map((p) => p.sections))
  );

  // ‼️ THE ONE THAT MATTERS. A page hash is computed over the SAME canonical section strings, in
  // the same order, joined on the same separator, as the document hash uses. If canonicalPage
  // ever stopped covering a clause, an initial would attest to less than the signer read and
  // nothing else in the build would notice.
  const pageInputs = await Promise.all(
    pages.map(async (pg) =>
      sha256Hex(
        canonicalPage(pg.sections.map((n) => snapshot.sections.find((s) => s.n === n)!))
      )
    )
  );
  check(
    "each page hash is a hash of exactly the clauses on that page",
    pageInputs.every((h, i) => h === pages[i].sha256),
    "the stored page hash disagrees with a fresh one over the same sections"
  );
  const everySectionCanon = snapshot.sections.map(canonicalSection).join("");
  const everyPageCanon = pages
    .map((pg) => canonicalPage(pg.sections.map((n) => snapshot.sections.find((s) => s.n === n)!)))
    .join("")
    .split("")
    .join("");
  check(
    "the page strings contain exactly the text the section strings do",
    everyPageCanon === everySectionCanon,
    "a page initial would be attesting to different text than a section initial did"
  );

  // ── Coverage. The check that makes an initial mean something. ──
  const pageRows = pages.map((pg, i) => fakeInitial(pg.p, pg.sections, `2026-09-03T00:0${i}:00Z`));
  const allNumbers = snapshot.sections.map((s) => s.n);

  check(
    "one initial per page covers every section",
    missingSections(pageRows, allNumbers).length === 0,
    JSON.stringify(Array.from(coverageOf(pageRows)))
  );
  check(
    "dropping ONE page leaves its sections missing, so /sign still refuses",
    (() => {
      const last = pages[pages.length - 1];
      const short = pageRows.slice(0, -1);
      const gone = missingSections(short, allNumbers);
      return gone.length === last.sections.length && gone.every((n) => last.sections.includes(n));
    })(),
    JSON.stringify(missingSections(pageRows.slice(0, -1), allNumbers))
  );
  check(
    "a row from BEFORE pages existed still covers its one section",
    (() => {
      const old: InitialRow = { ...fakeInitial(1, [1], "2026-09-01T00:00:00Z"), page_no: null, page_sections: null, page_sha256: null };
      return coverageOf([old]).has(1) && coverageOf([old]).size === 1;
    })(),
    "the pre-migration fallback is that row's real meaning, not a shim"
  );

  // ‼️ THE FAN-OUT. Without it the PDF prints an initial under section 1 and blanks under every
  // clause after it, silently, because initialLine() returns quietly on undefined.
  const frozen = freezeInitials(pageRows, snapshot.sections);
  check(
    `${AGREEMENT_PAGE_COUNT} page rows freeze into ${AGREEMENT_SECTION_COUNT} initial records, one per clause`,
    frozen.length === AGREEMENT_SECTION_COUNT && frozen.every((r, i) => r.n === i + 1),
    `got ${frozen.length}: ${frozen.map((r) => r.n).join(",")}`
  );
  check(
    "each frozen record carries the page it was initialled on",
    frozen.every((r) => r.page === pages.find((pg) => pg.sections.includes(r.n))?.p),
    JSON.stringify(frozen.map((r) => [r.n, r.page]))
  );
  check(
    "each frozen record carries the PAGE hash, which is what was actually checked",
    frozen.every((r) => r.sectionSha256 === "b".repeat(64)),
    ""
  );
  check(
    "the frozen key comes from the snapshot, not from the row's first section",
    frozen.find((r) => r.n === 6)?.key === snapshot.sections.find((s) => s.n === 6)?.key,
    JSON.stringify(frozen.map((r) => [r.n, r.key]))
  );

  // ─────────────────────────────────────────────────────────────────────────
  // NOTHING IS COLLECTED TWICE. Checked against the ROUTES, not against a list in this file.
  // ─────────────────────────────────────────────────────────────────────────
  //
  // ‼️ THIS IS THE ASSERTION THE WHOLE 2026-09-03 PASS EXISTS TO MAKE. Reading the request fields
  // each route accepts, out of its own source, means a field quietly re-added to the signature
  // payload fails here rather than being noticed by somebody walking the funnel. Restating the
  // two lists as constants in this probe would only ever be testing this file against itself.
  const fieldsOf = (file: string): Set<string> => {
    const src = fs.readFileSync(path.join(process.cwd(), file), "utf8");
    return new Set(Array.from(src.matchAll(/\bbody\.(\w+)/g)).map((m) => m[1]));
  };
  // Session plumbing and the guards, which every public route in this lane takes by design.
  const PLUMBING = new Set(["sessionToken", "renderedAt", "company_url_hp", "attribution", "resume", "documentSha256"]);
  const screenOne = fieldsOf("src/app/api/onboarding2/email/route.ts");
  const signature = fieldsOf("src/app/api/onboarding2/sign/route.ts");
  const both = [...screenOne].filter((f) => signature.has(f) && !PLUMBING.has(f));
  check(
    "NO FIELD IS ACCEPTED BY BOTH SCREEN ONE AND THE SIGNATURE ROUTE",
    both.length === 0,
    both.length ? `collected twice: ${both.join(", ")}` : ""
  );
  for (const f of ["contactName", "businessLegalName", "signerTitle", "website", "email", "contactPhone"]) {
    check(`screen one collects ${f}`, screenOne.has(f), "");
    check(`the signature route does NOT re-ask ${f}`, !signature.has(f), "");
  }
  check(
    "the signature route takes only a signature, a date and an address",
    ["signatureTyped", "signedDate", "addressLine1", "addressCity", "addressState", "addressPostal"].every((f) =>
      signature.has(f)
    ) && [...signature].filter((f) => !PLUMBING.has(f)).length === 6,
    JSON.stringify([...signature].filter((f) => !PLUMBING.has(f)))
  );

  // ─────────────────────────────────────────────────────────────────────────
  // THE SIX QUESTIONS
  // ─────────────────────────────────────────────────────────────────────────

  const recordTool = QUALIFYING_TOOLS.find((t) => t.name === "record_answer");
  const enumKeys =
    ((recordTool?.input_schema.properties as Record<string, { enum?: string[] }>)?.question_key
      ?.enum ?? []);
  check(
    "record_answer's enum matches the question keys exactly",
    enumKeys.join(",") === QUALIFYING_QUESTIONS.map((q) => q.key).join(","),
    `tool: ${enumKeys.join(",")}`
  );
  // ‼️ THE COUNT COMES FROM THE ARRAY, NOT FROM A LITERAL. This said `=== 6` and broke the day
  // primary_treatment was added as the seventh, along with two checks below that also counted by
  // hand. The walk probe's header already carries this lesson for the agreement template; it
  // applies just as much here. What is worth asserting is that the tool enum and the array agree,
  // which the check above does, and that nothing DELETED came back, which the check below does.
  check(
    "there is at least one question and the tool enum matches it",
    QUALIFYING_QUESTIONS.length > 0,
    `${QUALIFYING_QUESTIONS.length} questions: ${QUALIFYING_QUESTIONS.map((q) => q.key).join(",")}`
  );
  check(
    "the three deleted questions are gone",
    !QUALIFYING_QUESTIONS.some((q) => ["website", "top_objection", "top_competitor"].includes(q.key)),
    QUALIFYING_QUESTIONS.map((q) => q.key).join(",")
  );
  check(
    "question one is open text",
    QUALIFYING_QUESTIONS[0].key === "highest_margin_service" &&
      QUALIFYING_QUESTIONS[0].freeText === true &&
      QUALIFYING_QUESTIONS[0].options.length === 0,
    JSON.stringify(QUALIFYING_QUESTIONS[0])
  );
  // ‼️ TWO OPEN-TEXT QUESTIONS NOW, NOT ONE. highest_margin_service and primary_treatment are both
  // free text on purpose: each one ends up interpolated into generated copy, so a menu would put
  // "Something else" inside a page. Everything that is NOT free text still has to offer real
  // buttons, because a question with one option is a question with no answer.
  check(
    "every question either offers buttons or is explicitly free text",
    QUALIFYING_QUESTIONS.every((q) => q.freeText === true || q.options.length >= 2),
    JSON.stringify(
      QUALIFYING_QUESTIONS.map((q) => `${q.key}:${q.freeText ? "free" : q.options.length}`)
    )
  );
  check(
    "the booking-software question has an Other option, which the client turns into a popup",
    QUALIFYING_QUESTIONS.find((q) => q.key === "booking_software")?.otherOption !== undefined,
    "without it, Other is recorded as somebody's booking system"
  );

  // ── No question re-asks anything collected before the signature ──
  const banned = ["legal name", "business name", "address", "email", "phone", "title", "date", "website"];
  const asked = QUALIFYING_QUESTIONS.map((q) => q.question.toLowerCase()).join(" ");
  const reAsked = banned.filter((b) => asked.includes(b));
  check(
    "none of the six re-asks something screen one or the signature block already has",
    reAsked.length === 0,
    reAsked.length ? `re-asks: ${reAsked.join(", ")}` : ""
  );

  const qp = qualifyingPrompt(signed, fakeLead(3));
  check(
    "the qualifying prompt lists only the outstanding questions",
    !qp.includes(`[${QUALIFYING_QUESTIONS[0].key}]`) && qp.includes(`[${QUALIFYING_QUESTIONS[3].key}]`),
    ""
  );
  check(
    "the prompt forbids clarifying follow-ups",
    /NEVER ask a clarifying or confirming follow-up/i.test(qp),
    ""
  );
  check(
    "the prompt forbids mentioning a calendar",
    /calendar/i.test(qp) && /Never mention a calendar/i.test(qp),
    ""
  );

  // ── THE GATE THAT MATTERS, INVERTED 2026-09-04 ──
  //
  // There is no longer an offer_booking tool to refuse. The call is booked BEFORE the questions
  // are asked, by the deterministic state machine in app/api/onboarding2/chat/route.ts, so the
  // thing worth asserting is that the model has NO tool that could reach scheduling at all.
  // Absent beats refused, which is the same lesson GROUNDED_TOOLS records at the top of chat.ts.
  const toolNames = QUALIFYING_TOOLS.map((t) => t.name);
  check(
    "the qualifying toolset cannot reach scheduling",
    !toolNames.includes("offer_booking"),
    `tools: ${toolNames.join(", ")}`
  );

  // One short of complete, derived rather than typed, so adding a question moves this with it.
  const oneShort = QUALIFYING_QUESTIONS.length - 1;
  const ctx5: ExecutorContext = {
    row: signed, lead: fakeLead(oneShort), ordinal: 0, justCompleted: false, priceFlagged: false,
  };
  const progress = JSON.parse(
    (await makeExecutor(ctx5)("get_progress", {})).content
  ) as { outstanding?: string[]; total?: number };

  check(
    "get_progress reports exactly one question outstanding, one short of complete",
    Array.isArray(progress.outstanding) && progress.outstanding.length === 1,
    JSON.stringify(progress.outstanding)
  );
  check(
    "get_progress counts against QUALIFYING_QUESTIONS, so adding a question moves it",
    progress.total === QUALIFYING_QUESTIONS.length,
    `total ${progress.total}, questions ${QUALIFYING_QUESTIONS.length}`
  );

  // ── THE NO-CLARIFYING GATE, in the executor ──
  //
  // The executor cannot write to a database in a probe, so this exercises the branch that runs
  // before the write by handing it an unknown key, and then the real one by inspecting the tool
  // description. The instruction itself is asserted against the source, which is where it lives.
  const executorSrc = fs.readFileSync(
    path.join(process.cwd(), "src/lib/onboarding2/chat.ts"),
    "utf8"
  );
  check(
    "record_answer hands back the next question and an instruction not to ask anything else",
    /Ask NOTHING else\. Do not clarify, confirm, or repeat back/.test(executorSrc),
    "the no-follow-ups rule has to be a tool RESULT, not only a prompt line"
  );
  // !! THE TOOL IS GONE, SO THE ASSERTION IS ABOUT ITS ABSENCE (2026-09-04). It used to be
  // handed back "Say nothing at all. Return an empty reply", so the close could not come from the
  // model. The call is now booked BEFORE the questions, by a state machine the model never sees,
  // so there is no tool to instruct. Absent beats instructed.
  //
  // ‼️ IT STRIPS COMMENTS FIRST, AND THAT IS NOT A LOOPHOLE. chat.ts names offer_booking three
  // times on purpose, recording what it was and why it must not come back, and a check that
  // punished the file for documenting its own history would push somebody to delete the note
  // rather than the tool. What must not exist is a BRANCH.
  const executorCode = executorSrc
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  check(
    "the executor has no offer_booking branch, so nothing can reach scheduling from a turn",
    !/offer_booking/.test(executorCode),
    "an offer_booking branch is back in makeExecutor"
  );
  check(
    "no tool result tells the model to call a tool that does not exist",
    !/Call offer_booking/.test(executorCode),
    "record_answer is handing back an instruction naming a removed tool"
  );
  check(
    "record_answer's description tells it to record the first answer, vague or not",
    /Never ask them to clarify or confirm before recording/.test(recordTool?.description ?? ""),
    ""
  );

  // ── v4: nine sections, and no FAQ may cite one that is not there ──
  check(
    `the agreement is ${AGREEMENT_SECTION_COUNT} sections (${TEMPLATE_VERSION})`,
    snapshot.sections.length === AGREEMENT_SECTION_COUNT,
    `got ${snapshot.sections.length}`
  );

  const badSectionField = CHAT_FAQS.filter(
    (f) => f.section !== null && (f.section < 1 || f.section > snapshot.sections.length)
  );
  check(
    `no FAQ carries a section number outside 1 to ${AGREEMENT_SECTION_COUNT}`,
    badSectionField.length === 0,
    badSectionField.map((f) => `${f.q} -> ${f.section}`).join("\n      ")
  );

  const badCitation: string[] = [];
  for (const f of CHAT_FAQS) {
    for (const m of f.a.matchAll(/Section (\d+)/g)) {
      const n = Number(m[1]);
      if (n < 1 || n > snapshot.sections.length) badCitation.push(`${f.q} -> Section ${n}`);
    }
  }
  check(
    `no FAQ answer cites a section outside 1 to ${AGREEMENT_SECTION_COUNT}`,
    badCitation.length === 0,
    badCitation.join("\n      ")
  );

  // !! THE `section` FIELD AND THE PROSE HAVE TO AGREE, AND UNTIL v5 NOTHING CHECKED IT.
  // config/onboarding2.ts's own header claimed this probe asserted it; it asserted only the
  // RANGE, so the v5 renumber (which moves every one of them) could have re-pointed a field and
  // left the sentence citing the old number, with both halves still in range. That is exactly
  // the failure that header warns about: a real clause cited under the wrong number.
  //
  // The rule is MEMBERSHIP, not equality, because one answer legitimately cites two clauses
  // (faq34 explains the booking path by pointing at the guarantee that makes it countable).
  // What is banned is an answer whose `section` appears nowhere in the words it says.
  const citedIn = (a: string) => Array.from(a.matchAll(/Section (\d+)/g)).map((m) => Number(m[1]));
  const fieldProseMismatch = CHAT_FAQS.filter((f) => {
    if (f.section === null) return false;
    const cited = citedIn(f.a);
    return cited.length > 0 && !cited.includes(f.section);
  });
  check(
    "every FAQ's section field is one of the sections its answer actually cites",
    fieldProseMismatch.length === 0,
    fieldProseMismatch
      .map((f) => `${f.q} -> field ${f.section}, prose cites ${citedIn(f.a).join("/")}`)
      .join("\n      ")
  );

  // !! THE TWO v5 CLAUSES HAVE TO BE ANSWERABLE. They are the only two things in this document
  // that ask the CLIENT to do something, so they are the two a signer argues with, and an
  // unanswerable one falls through to flag_for_human on the most predictable question there is.
  for (const [n, label] of [
    [2, "the reviews obligation"],
    [3, "the booking path"],
  ] as const) {
    check(
      `at least two FAQs answer ${label} (section ${n})`,
      CHAT_FAQS.filter((f) => f.section === n).length >= 2,
      `${CHAT_FAQS.filter((f) => f.section === n).length} found`
    );
  }

  // !! NO FAQ MAY PROMISE A GUARANTEE CLOCK. There is no clock in this agreement to pause, and
  // an assistant that invents one describes a mechanism the signer cannot find in the text.
  const clockClaims = CHAT_FAQS.filter((f) => /guarantee clock|clock pauses|pause the clock/i.test(f.a));
  check(
    "no FAQ describes a guarantee clock, because the document has none",
    clockClaims.length === 0,
    clockClaims.map((f) => f.q).join("\n      ")
  );

  const headings = snapshot.sections.map((sec) => sec.heading).join(" | ");
  check(
    "the liability cap survived the cut",
    snapshot.sections.some((sec) =>
      sec.body.some((b) => b.includes("maximum liability under this agreement is capped"))
    ),
    `deleting old section 11 outright would have left no cap at all. Headings: ${headings}`
  );
  check(
    "the Concierge disclosure survived the cut",
    snapshot.sections.some((sec) =>
      (sec.bullets ?? []).some(
        (b) => b.includes("not a medical device") && b.includes("deleted within 24 hours")
      )
    ),
    "section 1 still promises to install the widget, so the disclosure has to be somewhere"
  );
  check(
    "no section points at a clause that is not in the document",
    !snapshot.sections.some((sec) =>
      [...sec.body, ...(sec.bullets ?? []), ...(sec.after ?? [])].some((t) =>
        /Section (1[0-9]|[1-9][0-9])/.test(t)
      )
    ),
    "old section 12 ended with a reference to Section 11, which no longer exists"
  );

  // ── The price gate, in the executor rather than the prompt ──
  const ctxPrice: ExecutorContext = {
    row: unsigned, lead: null, ordinal: 0, justCompleted: false,
    priceFlagged: false,
  };
  const flagged = JSON.parse(
    (
      await makeExecutor(ctxPrice)("flag_for_human", {
        question: "Can you do it for $299 a month instead?",
        reason: "price_negotiation",
      })
    ).content
  ) as { flagged: boolean; say: string };

  check("a price negotiation is flagged for a human", flagged.flagged === true);
  check(
    "the executor tells the model NOT to restate the fee",
    /do not state|do NOT state/i.test(flagged.say) && !/499/.test(flagged.say),
    flagged.say
  );
  check("ctx.priceFlagged is set, so a blank turn falls back to the handoff line", ctxPrice.priceFlagged === true);

  const priceLine = CHAT_HARD_LINES.some((l) => l.includes("price_negotiation"));
  check("the price-negotiation hard line is in the prompt too", priceLine);

  // ─────────────────────────────────────────────────────────────────────────
  // THE CLOSE. No calendar, and days the model never chose.
  // ─────────────────────────────────────────────────────────────────────────

  check(
    "the close is three fixed messages, not one paragraph",
    CLOSING_MESSAGES.length === 3,
    `got ${CLOSING_MESSAGES.length}`
  );
  // !! THE DAYPART QUESTION MOVED OUT OF THE CLOSE AND INTO THE OPENER (2026-09-04).
  // CLOSING_MESSAGES used to end the questions by asking "mornings or afternoons?", because
  // scheduling came last. Scheduling comes first now, so that line lives in SCHEDULING_INTRO and
  // the close is the wrap-up after the last answer.
  check(
    "the opener asks mornings or afternoons",
    SCHEDULING_INTRO.some((m) => /mornings or afternoons/i.test(m)),
    SCHEDULING_INTRO.join(" | ")
  );
  // !! STILL NO LINK IN ANY MODEL-ADJACENT COPY, AND THIS IS THE ASSERTION WORTH KEEPING.
  // There IS a calendar in the funnel now, but its URL is a field on a route response that the
  // model never sees. Nothing in the fixed copy may carry one.
  check(
    "neither the opener nor the close carries a calendar link",
    ![...CLOSING_MESSAGES, ...SCHEDULING_INTRO].some((m) =>
      /http|calendly|calendar|link/i.test(m)
    ),
    [...CLOSING_MESSAGES, ...SCHEDULING_INTRO].join(" | ")
  );

  // 2026-09-03 is a Thursday. 08:00 local is before both cutoffs; 20:00 is after both.
  const earlyThu = new Date("2026-09-03T12:00:00Z"); // 08:00 in New York
  const lateThu = new Date("2026-09-04T00:00:00Z"); // 20:00 Thursday in New York

  const amEarly = dayOptions("morning", earlyThu);
  check("three days are offered", amEarly.length === 3, JSON.stringify(amEarly));
  check(
    "early in the day, today is still on offer",
    amEarly[0].label.startsWith("Today"),
    JSON.stringify(amEarly.map((d) => d.label))
  );
  check(
    "no option is a link, a URL or a clock time",
    !amEarly.some((d) => /http|:\d\d|am\b|pm\b/i.test(d.label)),
    JSON.stringify(amEarly.map((d) => d.label))
  );
  const amLate = dayOptions("morning", lateThu);
  check(
    "late in the day, today is dropped and it starts at tomorrow",
    amLate[0].label.startsWith("Tomorrow"),
    JSON.stringify(amLate.map((d) => d.label))
  );
  check(
    "weekends are skipped, so a Thursday evening offers Friday then Monday",
    amLate.every((d) => !["Saturday", "Sunday"].some((w) => d.label.startsWith(w))),
    JSON.stringify(amLate.map((d) => d.label))
  );
  check(
    "every offered day is in the daypart that was asked for",
    dayOptions("afternoon", earlyThu).every((d) => d.label.endsWith("afternoon")),
    ""
  );

  check("a typed daypart is read", readDaypart("afternoons work better") === "afternoon");
  check("an ambiguous one is refused rather than guessed", readDaypart("either is fine") === null);
  check(
    "a tapped label matches the day it names",
    readDayChoice(amEarly[1].label, amEarly)?.id === amEarly[1].id
  );
  check("nonsense matches nothing", readDayChoice("whenever", amEarly) === null);

  // == THE TIMEZONE STEP, AND THE HOUR IT MAKES REAL (v5, 2026-09-03) ==
  //
  // !! THE WHOLE REASON THIS QUESTION EXISTS IS THE INVITE. While a person settled the hour on
  // the phone, "afternoon" meaning OUR afternoon cost nothing. A calendar invite makes the hour
  // a fact, and a fixed 2:00 pm Eastern is 11:00 am in Los Angeles: a clinic that tapped
  // AFTERNOON would receive a MORNING invite. These checks are that sentence, executable.
  check("a tapped zone label reads back", readTimezone("Pacific") === "America/Los_Angeles");
  check("so does the IANA name itself", readTimezone("America/Chicago") === "America/Chicago");
  check("and a common abbreviation", readTimezone("EST") === "America/New_York");
  check(
    "an ambiguous answer is refused rather than guessed, exactly like readDaypart",
    readTimezone("eastern or central, whatever") === null
  );
  check("nonsense is refused", readTimezone("wherever you are") === null);
  check(
    "an unusable free-text zone is null rather than a string Intl would throw on",
    readTimezone("GMT+0530") === null
  );

  check(
    "afternoon is an afternoon hour and morning is a morning one, in THEIR zone",
    CALL_HOUR.morning < 12 && CALL_HOUR.afternoon >= 12
  );

  // !! THE CHECK THAT MOTIVATED THE QUESTION. Same wall clock, four zones, four DIFFERENT
  // instants. If these ever collapse to one value the zone is being ignored and every non
  // Eastern clinic is getting an invite at the wrong hour.
  const instants = CALL_TIMEZONES.map((z) =>
    localToInstant("2026-09-14", CALL_HOUR.afternoon, z).toISOString()
  );
  check(
    "2pm local is a different instant in each of the four zones",
    new Set(instants).size === CALL_TIMEZONES.length,
    instants.join(" | ")
  );
  check(
    "and they run later as you go west, one hour apart",
    instants.every((iso, i) =>
      i === 0
        ? true
        : new Date(iso).getTime() - new Date(instants[i - 1]).getTime() === 3_600_000
    ),
    instants.join(" | ")
  );

  // !! THE DST CHECK, AND IT IS WHY localToInstant RESOLVES THE OFFSET TWICE. US DST ended on
  // 2026-11-01. A single-pass conversion computed in October is an hour wrong for a November
  // date, which is a confidently wrong invite twice a year and nothing on screen would say so.
  const beforeDst = localToInstant("2026-10-15", 14, "America/New_York");
  const afterDst = localToInstant("2026-11-15", 14, "America/New_York");
  check(
    "2pm New York is 18:00Z in October and 19:00Z in November, so DST is honoured",
    beforeDst.toISOString().includes("T18:00") && afterDst.toISOString().includes("T19:00"),
    `${beforeDst.toISOString()} | ${afterDst.toISOString()}`
  );
  check(
    "the same wall clock either side of the change is NOT the same instant",
    beforeDst.getUTCHours() !== afterDst.getUTCHours()
  );

  check(
    "the clock label reads the way a person says it",
    clockLabel(10) === "10:00 am" && clockLabel(14) === "2:00 pm" && clockLabel(12) === "12:00 pm"
  );

  // !! THE CONFIRMATION MAY ONLY PROMISE AN INVITE WHEN ONE WENT OUT. Two separate constants
  // rather than one with an optional clause, because "the invite is on its way" said on a row
  // that never sent one is the sentence this close cannot afford to get wrong: the client stops
  // watching for it and nobody finds out until the hour arrives.
  check(
    "the no-invite confirmation exists and promises nothing",
    typeof SCHEDULING_UI.confirmedNoInvite === "string" &&
      !/invite/i.test(SCHEDULING_UI.confirmedNoInvite),
    SCHEDULING_UI.confirmedNoInvite
  );
  check(
    "the invite confirmation names the time, which the other one cannot",
    SCHEDULING_UI.confirmed.includes("{time}") && !SCHEDULING_UI.confirmedNoInvite.includes("{time}")
  );
  check(
    "there are four zone chips and every one is a real IANA zone Intl accepts",
    TIMEZONE_OPTIONS.length === 4 &&
      TIMEZONE_OPTIONS.every((t) => {
        try {
          new Intl.DateTimeFormat("en-US", { timeZone: t.zone });
          return true;
        } catch {
          return false;
        }
      }),
    TIMEZONE_OPTIONS.map((t) => t.zone).join(", ")
  );
  check(
    "the chips and the zones the column accepts are the same four",
    TIMEZONE_OPTIONS.every((t) => (CALL_TIMEZONES as readonly string[]).includes(t.zone)) &&
      CALL_TIMEZONES.length === TIMEZONE_OPTIONS.length
  );

  // !! NOTHING IN THIS CLOSE MAY SHOW A LINK. The invite is an .ics in an inbox, deliberately,
  // and a Teams join url or a booking page would put back the calendar the funnel deleted.
  const closeCopy = [
    SCHEDULING_UI.askZone,
    SCHEDULING_UI.askDay,
    SCHEDULING_UI.confirmed,
    SCHEDULING_UI.confirmedNoInvite,
    SCHEDULING_UI.closing,
    SCHEDULING_UI.reask,
    ...TIMEZONE_OPTIONS.map((t) => t.label),
  ];
  check(
    "no scheduling copy contains a URL, a domain or the word calendar",
    !closeCopy.some((c) => /https?:\/\/|www\.|\.com|calendly|calendar/i.test(c)),
    closeCopy.join(" | ")
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Multi-message send shape
  // ─────────────────────────────────────────────────────────────────────────

  const split = splitIntoMessages(
    "Got it. That helps a lot with what we build first. How many new patients do you see in a month?"
  );
  check("a reply ending in a question splits into two or three bubbles", split.length >= 2 && split.length <= 3, JSON.stringify(split));
  check("the question is the last bubble and it is alone", split[split.length - 1].endsWith("?") && split.filter((s) => s.includes("?")).length === 1, JSON.stringify(split));
  check("the first bubble is short", split[0].split(/\s+/).length <= 8, split[0]);
  check("a one-liner is left as one bubble", splitIntoMessages("Got it.").length === 1);
  check(
    "nothing is lost in the split",
    split.join(" ").replace(/\s+/g, " ") ===
      "Got it. That helps a lot with what we build first. How many new patients do you see in a month?",
    JSON.stringify(split)
  );

  // ─────────────────────────────────────────────────────────────────────────
  // The intake mapping. Pure, so it runs with no database.
  // ─────────────────────────────────────────────────────────────────────────

  const lead6 = fakeLead(6);
  lead6.qualifying = lead6.qualifying.map((a) =>
    a.key === "highest_margin_service"
      ? { ...a, answer: "Injectables, Botox and filler" }
      : a.key === "booking_software"
        ? { ...a, answer: "Boulevard" }
        : a
  );

  const { patch, domain } = intakePatchFrom(
    {
      ...signed,
      business_legal_name: "Glow Clinic LLC",
      contact_name: "Jordan Reyes",
      website: "glowclinic.com",
    } as Onboarding2SigningRow,
    lead6
  );
  const services = patch.services as Record<string, unknown> | undefined;
  const ideal = patch.ideal_patient as Record<string, unknown>;

  check(
    "the highest-margin service lands in ideal_patient.highest_margin, the [treatment] substitution",
    ideal?.highest_margin === "Injectables, Botox and filler",
    JSON.stringify(ideal)
  );
  // ‼️ THE READERS THAT LOST THEIR WRITER. Asserted as ABSENT rather than left unmentioned, so
  // that reintroducing a half-populated key is a failure rather than a surprise downstream.
  check(
    "services.competitors is NOT written any more, because top_competitor was deleted",
    services?.competitors === undefined,
    JSON.stringify(services)
  );
  check(
    "ideal_patient.objections and objection_1 are NOT written any more",
    ideal?.objections === undefined && ideal?.objection_1 === undefined,
    JSON.stringify(ideal)
  );
  // ‼️ THE ONE THAT WOULD HAVE STALLED EIGHT STEPS SILENTLY. The website moved to screen one, so
  // this now has to come off the SIGNING row. Reading an answer would compile, run, and leave
  // clients.domain null on every client this funnel produces.
  check(
    "the website comes off the SIGNING row and still derives clients.domain",
    domain === "glowclinic.com" &&
      patch.domain === "glowclinic.com" &&
      String(patch.website).includes("glowclinic.com"),
    `domain=${String(domain)} website=${String(patch.website)}`
  );
  check(
    "no website on the row means no domain, rather than a domain built from an answer",
    (() => {
      const { domain: d } = intakePatchFrom(
        { ...signed, business_legal_name: "X", website: null } as Onboarding2SigningRow,
        lead6
      );
      return d === null;
    })(),
    ""
  );
  check(
    "intake_completed_at is set, which is the only thing intake_received verifies",
    typeof patch.intake_completed_at === "string",
    ""
  );
  check(
    "the signature block becomes the canonical legal name",
    patch.legal_name === "Glow Clinic LLC" && patch.dba_name === "Jordan Reyes",
    ""
  );
  check(
    "answeredCount counts only the answers that were actually given",
    answeredCount(fakeLead(5)) === 5 && answeredCount(lead6) === 6,
    ""
  );

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
