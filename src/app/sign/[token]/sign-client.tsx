"use client";

// The signing page, opened from a link Matthew sends DURING the onboarding call.
//
// ‼️ THIS IS THE 2026-09-04 DELETION COMING BACK, AND IT COMES BACK SOMEWHERE ELSE ON PURPOSE.
// /onboarding2 used to read and sign the agreement across nine stages. Those screens were removed
// when the funnel became booking-first, and onboarding2-client.tsx still records why: "the
// agreement is no longer read or signed in this funnel, it is signed by hand on the call at
// delivery step agreement_signed", and "if e-signature comes back, the server half is already
// there and only these two handlers need rewriting."
//
// The server half was never touched. /api/onboarding2/initial, /api/onboarding2/sign, the
// coverage check, the page-hash echo, the nonce idempotency and onboarding2_initials all still
// work exactly as they did. So this is those two handlers rewritten, and the document viewer they
// belong to, lifted from 10e7d30^ rather than reinvented.
//
// ‼️ WHAT IS DIFFERENT FROM THE FUNNEL VERSION, AND WHY:
//
//   - NO IDENTITY SCREEN. The client already exists, so the recap is read-only with no way to
//     edit. A wrong company name is fixed by Matthew in Mission Control and a fresh link sent,
//     not by the signer retyping the party they are being bound to while he watches.
//   - NO CHAT. The funnel mounts ChatPanel beside the document. It is not mounted here because
//     modeFor() in chat-store.ts returns "qualifying" unconditionally, so the grounded contract
//     assistant is currently unreachable and what would actually appear is the booking bot,
//     asking a signer for their monthly revenue halfway through a contract.
//   - THE SESSION IS RESOLVED FROM THE URL, not from sessionStorage, so the link survives being
//     forwarded to the client's own phone while Matthew is still on the call.
//   - AFTER SIGNING IT STOPS. The funnel went on to ask questions. Here the signature is the
//     whole job and the last screen says so.
//
// ‼️ THE BROWSER COMPUTES ITS OWN HASHES. IT DOES NOT ECHO THE ONES THE SERVER SENT. Sending the
// server's own number back would be the server checking itself. Every echo is recomputed with
// canonicalPage() over the text this component actually rendered, which is what makes "the text
// we recorded is the text they saw" a true statement rather than an intention.
//
// ‼️ ADVANCE ON THE RESPONSE, NEVER ON THE TAP. An optimistic advance means the final screen
// POSTs a signature over initials the server never received, and the coverage check then 409s
// with the person at the end of the flow and nothing they can do about it.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AGREEMENT_UI, SIGNATURE_UI } from "@/config/onboarding2";
import { canonicalDocument, canonicalPage, sha256Hex } from "@/lib/onboarding2/canonical";

const REEF = "#00C9A7";
const CARD = "rounded-xl bg-white/5 p-6 sm:p-8";
const CTA =
  "w-full rounded-lg bg-[#00C9A7] px-6 py-4 text-base font-bold text-[#04252b] disabled:opacity-50";
const INPUT_BASE =
  "w-full rounded-lg border bg-white/5 px-4 py-3 text-white placeholder-white/30 outline-none focus:border-[#00C9A7] ";

function inputClass(hasError: boolean): string {
  return INPUT_BASE + (hasError ? "border-red-400/60" : "border-white/10");
}

interface SnapshotSection {
  n: number;
  key: string;
  heading: string;
  body: string[];
  bullets?: string[];
  after?: string[];
  sha256: string;
}

interface SnapshotPage {
  p: number;
  sections: number[];
  sha256: string;
}

export interface Agreement {
  version: string;
  canon: string;
  title: string;
  preamble: string[];
  promise: string;
  sections: SnapshotSection[];
  pages: SnapshotPage[];
  closing: string[];
  footer: string[];
  documentSha256: string;
}

export interface SignerIdentity {
  contactName: string;
  businessLegalName: string;
  signerTitle: string;
  website: string;
  email: string;
  phone: string;
}

type Stage = "agreement" | "signature" | "signing" | "signed" | "stale";

/**
 * Their initials, from the name already on the row.
 *
 * ‼️ NOBODY TYPES THEIR INITIALS FIVE TIMES. First letter of the first word and of the last, which
 * is what a person writing in a margin does. Falls back to the first two letters of a single-word
 * name. Always passes INITIALS_RE, which wants one to six characters starting with a letter.
 */
function initialsFrom(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function SignClient({
  agreement,
  identity,
  sessionToken,
  demo,
  initialledSections: seedSections,
  initialledPages: seedPages,
}: {
  agreement: Agreement;
  identity: SignerIdentity;
  sessionToken: string;
  demo: boolean;
  initialledSections: number[];
  initialledPages: number[];
}) {
  const [stage, setStage] = useState<Stage>("agreement");
  const [, setInitialledSections] = useState<number[]>(seedSections);
  const [initialledPages, setInitialledPages] = useState<number[]>(seedPages);
  const [initialsByPage, setInitialsByPage] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trap, setTrap] = useState("");
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);

  const renderedAt = useRef(Date.now());
  /** When each page first scrolled into view, keyed by page number. Feeds dwellMs. */
  const seenAt = useRef<Record<number, number>>({});
  const boxRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const pageRefs = useRef<Record<number, HTMLElement | null>>({});
  /** Set by an action, consumed by the scroll effect on the next render. */
  const scrollTo = useRef<number | null>(null);
  const [visiblePage, setVisiblePage] = useState(1);

  const [sig, setSig] = useState({
    signatureTyped: "",
    addressLine1: "",
    addressCity: "",
    addressState: "",
    addressPostal: "",
    signedDate: new Date().toISOString().slice(0, 10),
  });
  const [sigErrors, setSigErrors] = useState<Record<string, string>>({});

  const sections = useMemo(() => agreement.sections, [agreement]);
  const pages = useMemo(() => agreement.pages, [agreement]);
  const totalPages = pages.length;
  const sectionByNumber = useMemo(() => new Map(sections.map((s) => [s.n, s])), [sections]);
  const suggestedInitials = useMemo(
    () => initialsFrom(identity.contactName),
    [identity.contactName]
  );
  const nextPage = useMemo(
    () => pages.find((pg) => !initialledPages.includes(pg.p)) ?? null,
    [pages, initialledPages]
  );

  const post = useCallback(
    async (
      path: string,
      payload: Record<string, unknown>
    ): Promise<Record<string, unknown> | null> => {
      try {
        const res = await fetch(`/api/onboarding2/${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        return (await res.json()) as Record<string, unknown>;
      } catch {
        return null;
      }
    },
    []
  );

  // ‼️ dwell_ms IS TIME FROM THE PAGE SCROLLING INTO VIEW TO THE INITIAL, and not time since the
  // page was revealed. The whole document is mounted at once, so "revealed" means nothing here.
  // Dwell is stored evidence on onboarding2_initials, so it has to keep meaning what it says.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const p = Number((e.target as HTMLElement).dataset.page);
          if (!p) continue;
          if (e.isIntersecting) {
            if (!seenAt.current[p]) seenAt.current[p] = Date.now();
            setVisiblePage(p);
          }
        }
      },
      { threshold: 0.25 }
    );
    for (const el of Object.values(pageRefs.current)) if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [pages]);

  // ‼️ THE SCROLL RUNS AS AN EFFECT, NOT INSIDE THE HANDLER. At the moment submitInitial returns,
  // the page it wants to scroll to has not re-rendered as done yet.
  useEffect(() => {
    const p = scrollTo.current;
    if (p == null) return;
    scrollTo.current = null;
    pageRefs.current[p]?.scrollIntoView({ behavior: "smooth", block: "start" });
    boxRefs.current[p]?.focus({ preventScroll: true });
  });

  // ── One PAGE, initialled ──
  //
  // ‼️ ONE POST PER PAGE, CARRYING A HASH OVER EVERY CLAUSE ON IT. The page grouping comes from
  // the snapshot, so `pageSections` is echoed for the server to CHECK rather than to act on: the
  // row it writes is built from the snapshot's own list. The nonce is what makes a retry collide
  // instead of writing a second initial for the same page.
  async function submitInitial(page: SnapshotPage) {
    if (saving) return;
    setError(null);

    const value = (initialsByPage[page.p] ?? suggestedInitials).trim();
    if (!/^[\p{L}][\p{L} .'-]{0,5}$/u.test(value)) {
      setError("Type one to six letters.");
      boxRefs.current[page.p]?.focus();
      return;
    }
    setSaving(true);

    // Computed here, over the text this component rendered. Never the value the server sent.
    const onThisPage = page.sections
      .map((n) => sectionByNumber.get(n))
      .filter((s): s is SnapshotSection => Boolean(s));
    const pageSha256 = await sha256Hex(canonicalPage(onThisPage));
    const seen = seenAt.current[page.p] ?? renderedAt.current;

    const res = await post("initial", {
      sessionToken,
      pageNo: page.p,
      pageSections: page.sections,
      pageSha256,
      initials: value,
      dwellMs: Date.now() - seen,
      clientNonce: crypto.randomUUID(),
    });
    setSaving(false);

    if (res && res.error === "text_changed") {
      setStage("stale");
      return;
    }
    if (!res || res.ok !== true) {
      setError((res?.error as string) || "Could not save that. Try again.");
      return;
    }

    setInitialsByPage((prev) => ({ ...prev, [page.p]: value }));
    const donePages = (res.initialledPages as number[]) ?? [];
    setInitialledSections((res.initialledSections as number[]) ?? []);
    setInitialledPages(donePages);

    const remaining = pages.find((pg) => !donePages.includes(pg.p));
    if (!remaining) {
      setStage("signature");
      window.scrollTo({ top: 0 });
      return;
    }
    scrollTo.current = remaining.p;
  }

  // ── The signature ──
  async function submitSignature() {
    setError(null);

    const errs: Record<string, string> = {};
    if (!sig.signatureTyped.trim()) errs.signatureTyped = "Required.";
    if (!sig.addressLine1.trim()) errs.addressLine1 = "Required.";
    setSigErrors(errs);
    if (Object.keys(errs).length) return;

    setStage("signing");

    const documentSha256 = await sha256Hex(
      canonicalDocument({
        title: agreement.title,
        preamble: agreement.preamble,
        promise: agreement.promise,
        sections: agreement.sections,
        closing: agreement.closing,
        footer: agreement.footer,
      })
    );

    // ‼️ NO IDENTITY IN THIS PAYLOAD. Name, company, title, email and phone are on the row, put
    // there when the link was minted, and /sign reads them there. Sending them again would let a
    // crafted request sign under a company nobody typed.
    const res = await post("sign", {
      sessionToken,
      documentSha256,
      renderedAt: renderedAt.current,
      company_url_hp: trap,
      ...sig,
    });

    if (res && res.error === "text_changed") {
      setStage("stale");
      return;
    }
    if (res && res.error === "initials_incomplete") {
      // The server's coverage check disagrees with what this component thought was recorded, so
      // the SERVER wins. It answers in SECTION numbers; the boxes are per PAGE, so the missing
      // sections are mapped back to the pages that carry them before anything is dropped.
      const missing = (res.missing as number[]) ?? [];
      const missingPages = pages
        .filter((pg) => pg.sections.some((n) => missing.includes(n)))
        .map((pg) => pg.p);
      setError(
        missingPages.length === 1
          ? `Page ${missingPages[0]} still needs your initials.`
          : `Pages ${missingPages.join(", ")} still need your initials.`
      );
      setInitialledSections((prev) => prev.filter((n) => !missing.includes(n)));
      setInitialledPages((prev) => prev.filter((p) => !missingPages.includes(p)));
      if (missingPages.length) scrollTo.current = missingPages[0];
      setStage("agreement");
      return;
    }
    if (!res || res.ok !== true) {
      setError((res?.error as string) || "Could not record your signature. Try again.");
      setStage("signature");
      return;
    }

    if (typeof res.documentUrl === "string") setDocumentUrl(res.documentUrl);
    setStage("signed");
    window.scrollTo({ top: 0 });
  }

  if (stage === "stale") {
    return (
      <Shell>
        <div className={CARD}>
          <h1 className="mb-2 text-2xl font-bold">{AGREEMENT_UI.staleTitle}</h1>
          <p className="text-white/70">{AGREEMENT_UI.staleBody}</p>
        </div>
      </Shell>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // THE DOCUMENT VIEWER.
  //
  // ‼️ IT IS A SEPARATE FULL-BLEED LAYOUT, NOT A CARD INSIDE A MARKETING SHELL, AND THAT IS THE
  // WHOLE POINT (Matthew, 2026-09-03: "this looks like its fake"). A white card floating on a
  // black marketing page reads as a web form dressed up as a contract. What a person recognises
  // as a document being signed is the chrome AROUND the paper: a toolbar naming the file, a grey
  // workspace, letter-proportioned pages with real margins and a drop shadow, a page counter that
  // moves as you scroll, and a signature field that looks like a field rather than a text input.
  //
  // The greys are Chrome's own PDF viewer, #323639 for the toolbar and #525659 for the canvas.
  // That pairing is what almost everybody in the world has looked at a contract in.
  // ─────────────────────────────────────────────────────────────────────────
  if (stage === "agreement") {
    return (
      <div className="flex min-h-screen flex-col bg-[#525659]">
        {demo && (
          <div className="bg-amber-400 px-4 py-2 text-center text-xs font-bold text-[#0a0a0a]">
            TEST MODE. Nothing here reaches Slack, the CRM, your inbox or the client list.
          </div>
        )}

        {/* ‼️ THE TOOLBAR IS STICKY AND THE BUTTON IN IT NEVER MOVES. On a phone the initials box
            for the page they are on can be a screen and a half away; a Next button that scrolls
            out of reach is a flow that stalls wherever somebody happens to be looking. It
            initials the first outstanding page and scrolls to the next one, and it names the page
            it is about to act on so working out of order is never a surprise. */}
        <div className="sticky top-0 z-30 border-b border-black/40 bg-[#323639] shadow-lg">
          <div className="flex items-center gap-3 px-3 py-2.5 sm:px-5">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <DocIcon />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-white/90">{agreement.title}</div>
                <div className="text-[11px] text-white/45">
                  {agreement.version.toUpperCase()}
                  {"  |  "}
                  {initialledPages.length} of {totalPages} pages initialled
                </div>
              </div>
            </div>

            <div className="hidden shrink-0 items-center gap-2 rounded border border-white/15 px-2.5 py-1 text-xs text-white/70 sm:flex">
              Page {visiblePage} of {totalPages}
            </div>

            <button
              className="shrink-0 rounded bg-[#00C9A7] px-4 py-2 text-sm font-bold text-[#04252b] disabled:opacity-50 sm:px-5"
              onClick={() => {
                if (nextPage) void submitInitial(nextPage);
                else setStage("signature");
              }}
              disabled={saving}
            >
              {saving
                ? "Saving"
                : nextPage
                  ? `${AGREEMENT_UI.next}, page ${nextPage.p}`
                  : AGREEMENT_UI.finalCta}
            </button>
          </div>
          <div className="h-0.5 w-full bg-black/30">
            <div
              className="h-full transition-all duration-500"
              style={{
                width: `${(initialledPages.length / totalPages) * 100}%`,
                backgroundColor: REEF,
              }}
            />
          </div>
        </div>

        <div className="flex flex-1">
          {/* The page rail. A real viewer lets you see the whole document at a glance and jump.
              Hidden below lg, where the screen is the size of one page anyway. */}
          <aside className="hidden w-24 shrink-0 flex-col items-center gap-3 border-r border-black/30 bg-[#3c4043] py-6 lg:flex">
            {pages.map((pg) => {
              const done = initialledPages.includes(pg.p);
              return (
                <button
                  key={pg.p}
                  onClick={() => {
                    pageRefs.current[pg.p]?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  className={`flex h-16 w-12 flex-col items-center justify-center rounded-sm border text-[11px] font-medium transition ${
                    visiblePage === pg.p
                      ? "border-[#00C9A7] bg-white text-neutral-900"
                      : "border-white/20 bg-white/85 text-neutral-500 hover:bg-white"
                  }`}
                  title={`Page ${pg.p}`}
                >
                  <span>{pg.p}</span>
                  {done && (
                    <span className="mt-0.5 text-[10px] font-bold" style={{ color: "#0a7a68" }}>
                      OK
                    </span>
                  )}
                </button>
              );
            })}
          </aside>

          {/* The canvas. Letter-proportioned paper, real margins, square corners, hard shadow. */}
          <div className="flex-1 px-2 py-4 sm:px-6 sm:py-8">
            <div className="mx-auto flex w-full max-w-[816px] flex-col gap-6 sm:gap-8">
              {pages.map((pg) => {
                const done = initialledPages.includes(pg.p);
                const onPage = pg.sections
                  .map((n) => sectionByNumber.get(n))
                  .filter((s): s is SnapshotSection => Boolean(s));
                return (
                  <article
                    key={pg.p}
                    data-page={pg.p}
                    ref={(el) => {
                      pageRefs.current[pg.p] = el;
                    }}
                    className="flex min-h-[70vh] scroll-mt-24 flex-col bg-white px-6 py-10 text-neutral-900 shadow-[0_2px_8px_rgba(0,0,0,0.5)] sm:min-h-[1056px] sm:px-[76px] sm:py-[72px]"
                  >
                    {pg.p === 1 && (
                      <div className="mb-10 border-b border-neutral-300 pb-7">
                        <h1 className="mb-4 font-serif text-[22px] font-bold leading-snug sm:text-[26px]">
                          {agreement.title}
                        </h1>
                        {agreement.preamble.map((line) => (
                          <p
                            key={line}
                            className="font-serif text-[13px] leading-6 text-neutral-500"
                          >
                            {line}
                          </p>
                        ))}
                        <p className="mt-5 font-serif text-[15px] font-bold text-neutral-900">
                          {agreement.promise}
                        </p>
                      </div>
                    )}

                    <div className="flex-1">
                      {onPage.map((sec) => (
                        <div key={sec.key}>
                          <h2 className="mb-5 mt-9 font-serif text-[17px] font-bold leading-snug first:mt-0 sm:text-[19px]">
                            {sec.n}. {sec.heading}
                          </h2>

                          {sec.body.map((para, i) => (
                            <p
                              key={i}
                              className="mb-4 font-serif text-[15px] leading-7 text-neutral-800"
                            >
                              {para}
                            </p>
                          ))}

                          {sec.bullets?.length ? (
                            <ul className="my-5 space-y-3 pl-1">
                              {sec.bullets.map((b, i) => (
                                <li
                                  key={i}
                                  className="flex gap-3 font-serif text-[15px] leading-7 text-neutral-800"
                                >
                                  <span className="shrink-0 font-bold text-neutral-400">-</span>
                                  <span>{b}</span>
                                </li>
                              ))}
                            </ul>
                          ) : null}

                          {sec.after?.map((para, i) => (
                            <p
                              key={i}
                              className="mb-4 font-serif text-[15px] leading-7 text-neutral-800"
                            >
                              {para}
                            </p>
                          ))}
                        </div>
                      ))}
                    </div>

                    {/* ── The signature field ──
                        ‼️ IT LOOKS LIKE A FIELD ON A DOCUMENT, NOT LIKE AN INPUT ON A FORM. The
                        amber tab and the dashed box are the convention every e-signing tool uses,
                        and they are what tells somebody "this is the bit you fill in" without a
                        sentence of instruction. */}
                    <div className="mt-10 border-t border-neutral-300 pt-7">
                      {done ? (
                        <div className="inline-flex items-stretch">
                          <div
                            className="flex items-center px-2.5 text-[10px] font-bold uppercase tracking-wider text-white"
                            style={{ backgroundColor: "#0a7a68" }}
                          >
                            Signed
                          </div>
                          <div
                            className="border-2 border-l-0 bg-[#eefaf7] px-5 py-3"
                            style={{ borderColor: "#0a7a68" }}
                          >
                            <div className="text-xl font-bold uppercase tracking-widest text-neutral-900">
                              {initialsByPage[pg.p] || suggestedInitials || "OK"}
                            </div>
                            <div className="mt-0.5 text-[10px] uppercase tracking-wider text-neutral-500">
                              Initialled, page {pg.p}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div className="inline-flex items-stretch">
                            <label
                              htmlFor={`srt-initials-${pg.p}`}
                              className="flex cursor-pointer items-center bg-[#d99e00] px-2.5 text-[10px] font-bold uppercase tracking-wider text-white"
                            >
                              Initial
                            </label>
                            {/* ‼️ A TAP FILLS IT IN. Derived from the name already on the row,
                                dropped in on focus, and still fully editable afterwards. */}
                            <input
                              id={`srt-initials-${pg.p}`}
                              ref={(el) => {
                                boxRefs.current[pg.p] = el;
                              }}
                              className="w-[150px] border-2 border-l-0 border-dashed border-[#d99e00] bg-[#fff9e6] px-4 py-3 text-center text-xl font-bold uppercase tracking-widest text-neutral-900 outline-none focus:border-solid focus:bg-[#fffdf5]"
                              value={initialsByPage[pg.p] ?? ""}
                              maxLength={6}
                              autoComplete="off"
                              placeholder={suggestedInitials || "MG"}
                              onFocus={() => {
                                if (!suggestedInitials) return;
                                setInitialsByPage((prev) =>
                                  prev[pg.p] ? prev : { ...prev, [pg.p]: suggestedInitials }
                                );
                              }}
                              onChange={(e) =>
                                setInitialsByPage((prev) => ({ ...prev, [pg.p]: e.target.value }))
                              }
                              onKeyDown={(e) => e.key === "Enter" && submitInitial(pg)}
                            />
                          </div>
                          <p className="mt-2 max-w-md text-[13px] leading-5 text-neutral-500">
                            {AGREEMENT_UI.initialsHelp}
                          </p>
                          {error && nextPage?.p === pg.p && (
                            <p className="mt-2 text-sm font-medium text-red-600">{error}</p>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="mt-8 flex items-center justify-between border-t border-neutral-200 pt-4 text-[10px] uppercase tracking-widest text-neutral-400">
                      <span className="truncate pr-4">SRT Agency LLC</span>
                      <span className="shrink-0">
                        Page {pg.p} of {totalPages}
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </div>

        {/* The floating page pill, the way a PDF viewer shows position on a phone. */}
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-full bg-black/75 px-3.5 py-1.5 text-xs font-medium text-white/90 sm:hidden">
          Page {visiblePage} of {totalPages}
        </div>

        {/* The honeypot. POST /sign still reads company_url_hp and answers a filled one with a
            cheerful 200, so the field has to exist somewhere on the page for that trap to work. */}
        <input
          type="text"
          name="company_url"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          value={trap}
          onChange={(e) => setTrap(e.target.value)}
          className="absolute left-[-9999px] h-0 w-0 opacity-0"
        />
      </div>
    );
  }

  return (
    <>
      {demo && (
        <div className="sticky top-0 z-40 bg-amber-400 px-4 py-2 text-center text-xs font-bold text-[#0a0a0a]">
          TEST MODE. Nothing here reaches Slack, the CRM, your inbox or the client list.
        </div>
      )}

      <Shell>
        {(stage === "signature" || stage === "signing") && (
          <div className={CARD}>
            <h1 className="mb-2 text-2xl font-bold">{SIGNATURE_UI.heading}</h1>
            <p className="mb-6 text-white/70">{SIGNATURE_UI.body}</p>

            {/* ‼️ READ-ONLY, AND WITH NO WAY BACK. The funnel version had a "Not right? Go back and
                fix it" link, because the signer had typed these themselves a few screens earlier.
                Here they came off the client record. Letting somebody retype the party they are
                being bound to, on a call, minutes before signing, is how a contract ends up
                naming a business that does not exist. A wrong value is fixed in Mission Control
                and a fresh link sent. */}
            <div className="mb-6 rounded-lg border border-white/10 bg-white/5 p-4">
              <div className="mb-3 text-xs font-bold uppercase tracking-wide text-white/40">
                {SIGNATURE_UI.recapHeading}
              </div>
              <dl className="space-y-1.5 text-sm">
                <Recap label="Name" value={identity.contactName} />
                <Recap label="Title" value={identity.signerTitle} />
                <Recap label="Business" value={identity.businessLegalName} />
                <Recap label="Website" value={identity.website} />
                <Recap label="Email" value={identity.email} />
                <Recap label="Phone" value={identity.phone} />
              </dl>
              <p className="mt-3 text-xs text-white/40">
                Something wrong here? Tell Matthew and he will send a corrected link.
              </p>
            </div>

            <Field
              label="Your signature"
              hint="Type your full name. This is your signature."
              value={sig.signatureTyped}
              error={sigErrors.signatureTyped}
              onChange={(v) => setSig((s) => ({ ...s, signatureTyped: v }))}
              className="text-lg"
              required
            />
            {/* The only thing the client record does not have. checkMarket() geocodes a STRUCTURED
                address and its own comment says a centre-less client must not be allowed to mean
                no exclusivity, which is why this is four boxes rather than one. */}
            <Field
              label="Business address"
              value={sig.addressLine1}
              error={sigErrors.addressLine1}
              autoComplete="address-line1"
              onChange={(v) => setSig((s) => ({ ...s, addressLine1: v }))}
              required
            />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field
                label="City"
                autoComplete="address-level2"
                value={sig.addressCity}
                onChange={(v) => setSig((s) => ({ ...s, addressCity: v }))}
              />
              <Field
                label="State"
                autoComplete="address-level1"
                value={sig.addressState}
                onChange={(v) => setSig((s) => ({ ...s, addressState: v }))}
              />
              <Field
                label="ZIP"
                autoComplete="postal-code"
                value={sig.addressPostal}
                onChange={(v) => setSig((s) => ({ ...s, addressPostal: v }))}
              />
            </div>
            <Field
              label="Date"
              type="date"
              value={sig.signedDate}
              onChange={(v) => setSig((s) => ({ ...s, signedDate: v }))}
            />

            {error && <p className="mt-4 text-sm text-red-300">{error}</p>}

            <button
              className={`${CTA} mt-6`}
              onClick={submitSignature}
              disabled={stage === "signing"}
            >
              {stage === "signing" ? SIGNATURE_UI.working : SIGNATURE_UI.cta}
            </button>
            <p className="mt-4 text-xs text-white/40">{SIGNATURE_UI.fine}</p>
          </div>
        )}

        {stage === "signed" && (
          <div className={CARD}>
            <h1 className="mb-2 text-2xl font-bold">Signed. Welcome to SRT.</h1>
            {/* ‼️ THE DOWNLOAD LINK IS BACK ON THIS SCREEN, AND THE FUNNEL'S REASON FOR DROPPING
                IT DOES NOT APPLY HERE. There, it was deleted because a second way to get the
                contract made the screen a fork at the exact moment we wanted one forward path to
                the questions. Here there IS no next step: the signature is the whole job, this is
                the last screen, and somebody who has just signed on a call wants to see the thing
                they signed. */}
            <p className="mb-6 text-white/70">
              We are emailing your copy now. Nothing else is needed from you today.
            </p>
            {documentUrl ? (
              <a
                href={documentUrl}
                className="inline-block rounded-lg border border-white/15 px-5 py-3 text-sm font-semibold text-white hover:bg-white/5"
              >
                Download your signed copy
              </a>
            ) : null}
          </div>
        )}
      </Shell>
    </>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-12">{children}</div>;
}

function DocIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-7 w-7 shrink-0 text-white/55"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

function Recap({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-white/40">{label}</dt>
      <dd className="min-w-0 break-words text-white/90">{value || "Not given"}</dd>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  error,
  hint,
  type = "text",
  autoComplete,
  className = "",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: string;
  type?: string;
  autoComplete?: string;
  className?: string;
  required?: boolean;
}) {
  return (
    <div className="mb-4">
      <label className="mb-1.5 block text-sm font-medium text-white/80">
        {label}
        {required && <span className="ml-1 text-white/30">*</span>}
      </label>
      <input
        type={type}
        autoComplete={autoComplete}
        className={`${inputClass(Boolean(error))} ${className}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <p className="mt-1 text-xs text-white/40">{hint}</p>}
      {error && <p className="mt-1.5 text-xs text-red-300">{error}</p>}
    </div>
  );
}
