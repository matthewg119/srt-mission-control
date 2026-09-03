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

import {
  AGREEMENT_CLOSING,
  AGREEMENT_FOOTER,
  AGREEMENT_PAGES,
  AGREEMENT_PREAMBLE,
  AGREEMENT_PROMISE,
  AGREEMENT_SECTIONS,
  AGREEMENT_TITLE,
  TEMPLATE_VERSION,
} from "@/config/onboarding2-agreement";
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
 * ‼️ THIS IS WHAT AN INITIAL ATTESTS TO. Frozen at POST /start from AGREEMENT_PAGES, so the
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

/** Read the live template and freeze it. Called once per signing and nowhere else. */
export async function buildSnapshot(): Promise<AgreementSnapshot> {
  const sections: SnapshotSection[] = [];
  for (const s of AGREEMENT_SECTIONS) {
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

  // The page hashes. Built from AGREEMENT_PAGES, which is derived from the same `page` fields,
  // so the grouping cannot be declared in two places and disagree with itself.
  const pages: SnapshotPage[] = [];
  for (const pg of AGREEMENT_PAGES) {
    pages.push({
      p: pg.p,
      sections: pg.sections.map((s) => s.n),
      sha256: await sha256Hex(canonicalPage(pg.sections)),
    });
  }

  const documentSha256 = await sha256Hex(
    canonicalDocument({
      title: AGREEMENT_TITLE,
      preamble: AGREEMENT_PREAMBLE,
      promise: AGREEMENT_PROMISE,
      sections: AGREEMENT_SECTIONS,
      closing: AGREEMENT_CLOSING,
      footer: AGREEMENT_FOOTER,
    })
  );

  return {
    version: TEMPLATE_VERSION,
    canon: CANON,
    title: AGREEMENT_TITLE,
    preamble: AGREEMENT_PREAMBLE,
    promise: AGREEMENT_PROMISE,
    sections,
    pages,
    closing: AGREEMENT_CLOSING,
    footer: AGREEMENT_FOOTER,
    capturedAt: new Date().toISOString(),
    documentSha256,
  };
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
