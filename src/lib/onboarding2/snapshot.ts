// Freezing the agreement, and reading a frozen one back.
//
// ‼️ buildSnapshot() IS THE ONLY FUNCTION IN THE CODEBASE THAT READS THE LIVE TEMPLATE, and it
// is called from exactly one place: POST /api/onboarding2/start. Everything downstream, every
// agreement screen, the PDF, and the grounded chatbot, reads the SNAPSHOT off the row. That is
// the whole mechanism by which editing config/onboarding2-agreement.ts leaves a signature taken
// last month rendering its original wording.
//
// ‼️ THE SNAPSHOT IS TAKEN AT SESSION START, NOT AT SIGNATURE, AND THE DIFFERENCE MATTERS.
// This flow is fourteen screens long. The client bundle is pinned to a build; an API route is
// not. Snapshot at signature and somebody who read sections 1 to 8 under v3.0 and 9 to 14 after
// a deploy gets a record claiming v3.1 throughout, with no trace that anything moved. Snapshot at
// start and the session is pinned to the bytes it opened with, so a mid-session edit is DETECTED
// by the hash echo rather than silently absorbed.

import { agreementFor } from "@/config/onboarding2-agreement";
import type { OfferKey } from "@/config/pitch";
import { CANON, canonicalDocument, canonicalPage, canonicalSection, sha256Hex } from "./canonical";

export interface SnapshotSection {
  n: number;
  key: string;
  heading: string;
  body: string[];
  bullets?: string[];
  after?: string[];
  /**
   * The hash of THIS section alone.
   *
   * No longer echoed by anything: an initial covers a page, so POST /initial checks the PAGE
   * hash. Kept because it is stored on every onboarding2_initials row written before 2026-09-03
   * and on every initials_snapshot frozen before then, and dropping it from the type would make
   * those rows unreadable.
   */
  sha256: string;
}

/**
 * One rendered page: the sections on it, and the hash of all of them together.
 *
 * ‼️ THIS IS WHAT AN INITIAL ATTESTS TO. Frozen at POST /start from the resolved variant's own layout, so the
 * grouping a signer initialled cannot move under them mid-session any more than the wording can.
 */
export interface SnapshotPage {
  /** 1 to 4. */
  p: number;
  /** The section numbers on this page, in order. */
  sections: number[];
  /** sha256(canonicalPage(those sections)). Echoed on every POST /initial. */
  sha256: string;
}

export interface AgreementSnapshot {
  version: string;
  /**
   * Which offer this document is for.
   *
   * ‼️ OPTIONAL FOR EXACTLY THE REASON `pages` IS OPTIONAL: every row frozen before the v6
   * offer split has no such field, and a required one would make every stored snapshot fail to
   * assign. offerOf() below is the single reader and it answers "legacy_v5" for those rows, so
   * nothing else in the codebase has to know this was ever absent.
   *
   * ‼️ IT IS NOT WHAT BINDS THE OFFER TO THE SIGNATURE. canonicalDocument() does not hash this
   * field, so on its own it is an editable label. What binds the offer is the PREAMBLE, which
   * names the plan in text and is hashed. Do not add this to canonicalDocument(): that changes
   * the joining rule, which canonical.ts forbids doing in place.
   */
  offer?: OfferKey;
  canon: string;
  title: string;
  preamble: string[];
  promise: string;
  sections: SnapshotSection[];
  /**
   * ‼️ OPTIONAL IN THE TYPE, AND ONLY BECAUSE ROWS FROZEN BEFORE 2026-09-03 DO NOT HAVE IT.
   * Every snapshot buildSnapshot() writes from now on carries it. pagesOf() below is the one
   * reader, and it synthesises one-section pages for an old row rather than leaving a caller to
   * handle the absence, so nothing else in the codebase has to know this was ever missing.
   */
  pages?: SnapshotPage[];
  closing: string[];
  footer: string[];
  capturedAt: string;
  documentSha256: string;
}

/**
 * Read the live template for ONE OFFER and freeze it. Called once per signing and nowhere else.
 *
 * ‼️ THE OFFER IS REQUIRED AND HAS NO DEFAULT, DELIBERATELY. A default would hand whichever
 * variant it named to every caller that forgot to pass one, silently, and "forgot" would surface
 * as a client signed onto terms nobody quoted them. Required means the compiler enumerates the
 * call sites instead.
 */
export async function buildSnapshot(offer: OfferKey): Promise<AgreementSnapshot> {
  const doc = agreementFor(offer);
  const sections: SnapshotSection[] = [];
  for (const s of doc.sections) {
    sections.push({
      n: s.n,
      key: s.key,
      heading: s.heading,
      body: s.body,
      bullets: s.bullets,
      after: s.after,
      sha256: await sha256Hex(canonicalSection(s)),
    });
  }

  // The page hashes. Built from the same resolved document as the sections above, so the
  // grouping cannot be declared in two places and disagree with itself.
  const pages: SnapshotPage[] = [];
  for (const pg of doc.pages) {
    pages.push({
      p: pg.p,
      sections: pg.sections.map((s) => s.n),
      sha256: await sha256Hex(canonicalPage(pg.sections)),
    });
  }

  const documentSha256 = await sha256Hex(
    canonicalDocument({
      title: doc.title,
      preamble: doc.preamble,
      promise: doc.promise,
      sections: doc.sections,
      closing: doc.closing,
      footer: doc.footer,
    })
  );

  return {
    version: doc.templateVersion,
    offer: doc.offer,
    canon: CANON,
    title: doc.title,
    preamble: doc.preamble,
    promise: doc.promise,
    sections,
    pages,
    closing: doc.closing,
    footer: doc.footer,
    capturedAt: new Date().toISOString(),
    documentSha256,
  };
}

/**
 * Which offer a stored snapshot was frozen under.
 *
 * ‼️ "legacy_v5" IS A REAL ANSWER AND NOT A FALLBACK. Rows written before the v6 offer split
 * were frozen when there was exactly one document and one set of terms, so the honest answer for
 * them is the name of that document, not a guess at which of today's three it most resembles.
 * Never map it onto one of the live OfferKeys: a v5 row is not a yearly client.
 */
export function offerOf(snapshot: AgreementSnapshot): OfferKey | "legacy_v5" {
  return snapshot.offer ?? "legacy_v5";
}

/**
 * Re-derive the document hash from a stored snapshot.
 *
 * ‼️ THIS IS THE VERIFICATION PATH AND IT MUST NOT TOUCH THE LIVE TEMPLATE. It proves that a
 * stored row's text and its stored hash still agree, which is the question anybody auditing a
 * signature will actually ask. It takes the snapshot's own `canon`, so a future change to the
 * joining rule can branch here rather than invalidating every row written before it.
 */
export async function verifySnapshot(
  snapshot: AgreementSnapshot
): Promise<{ ok: boolean; expected: string; stored: string }> {
  if (snapshot.canon !== CANON) {
    // Not a failure, a fork. There is one canon today, so this is the branch point rather than
    // the branch itself, and it says so out loud instead of returning a confident false.
    return { ok: false, expected: `unknown canon ${snapshot.canon}`, stored: snapshot.documentSha256 };
  }
  const expected = await sha256Hex(
    canonicalDocument({
      title: snapshot.title,
      preamble: snapshot.preamble,
      promise: snapshot.promise,
      sections: snapshot.sections,
      closing: snapshot.closing,
      footer: snapshot.footer,
    })
  );
  return { ok: expected === snapshot.documentSha256, expected, stored: snapshot.documentSha256 };
}

/** The section the browser is asking about, or null. Never trusts the index it was handed. */
export function sectionOf(snapshot: AgreementSnapshot, n: number): SnapshotSection | null {
  return snapshot.sections.find((s) => s.n === n) ?? null;
}

/**
 * The pages of a stored snapshot.
 *
 * ‼️ A SNAPSHOT FROZEN BEFORE 2026-09-03 HAS NO `pages`, AND IT IS NOT BROKEN. Back then one
 * initial covered one section, so its pages ARE its sections, one apiece, each carrying the
 * section hash that was already stored. Synthesising them here means the initial route, the
 * client and the probes have one shape to handle instead of two, and an old session that is still
 * open in somebody's tab keeps working through a deploy rather than 409ing at the next page.
 */
export function pagesOf(snapshot: AgreementSnapshot): SnapshotPage[] {
  if (snapshot.pages?.length) return snapshot.pages;
  return snapshot.sections.map((s) => ({ p: s.n, sections: [s.n], sha256: s.sha256 }));
}

/** The page the browser is asking about, or null. */
export function pageOf(snapshot: AgreementSnapshot, p: number): SnapshotPage | null {
  return pagesOf(snapshot).find((pg) => pg.p === p) ?? null;
}

/**
 * The agreement as flat text, for the grounded chatbot's system prompt and for the probe.
 *
 * Reads the snapshot, so the assistant answers questions about the document THIS PERSON is
 * reading rather than whatever the template says today.
 */
export function snapshotToPlainText(snapshot: AgreementSnapshot): string {
  const parts: string[] = [snapshot.title, "", ...snapshot.preamble, "", snapshot.promise, ""];
  for (const s of snapshot.sections) {
    parts.push(`SECTION ${s.n}: ${s.heading}`);
    parts.push(...s.body);
    for (const b of s.bullets ?? []) parts.push(`- ${b}`);
    parts.push(...(s.after ?? []));
    parts.push("");
  }
  parts.push(...snapshot.closing, "", ...snapshot.footer);
  return parts.join("\n");
}
