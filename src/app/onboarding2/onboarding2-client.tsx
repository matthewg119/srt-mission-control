"use client";

// The /onboarding2 state machine. Commitment before qualification: sign first, qualify second.
//
// ‼️ THE BROWSER COMPUTES ITS OWN HASHES. IT DOES NOT ECHO THE ONES THE SERVER SENT.
// The snapshot payload carries a sha256 per page, but sending that value back would prove exactly
// nothing: it would be the server checking its own number against itself. So every echo is
// recomputed here with canonicalPage() over the text this component actually rendered. The server
// then compares that against what it stored, which is what makes "the text we recorded is the
// text they saw" a true statement rather than an intention.
//
// ‼️ ADVANCE ON THE RESPONSE, NEVER ON THE TAP. An optimistic advance means the final screen
// POSTs a signature over initials the server never received, and the coverage check then 409s
// with the person at the end of the flow and nothing they can do about it.
//
// ‼️ THERE IS NO PAGE COUNTER IN STATE. `initialledPages` comes back from the server on every
// successful initial and on resume, and everything else is derived from it: which page is next,
// how far the progress bar has moved, what the header button says. A second source of position is
// a second thing that can disagree with the record, and the record is the one that ends up in a
// signed PDF.
//
// ‼️ THE WHOLE DOCUMENT RENDERS AT ONCE. THIS REVERSES THE PROGRESSIVE REVEAL AND THE REVERSAL IS
// DELIBERATE (Matthew, 2026-09-03, overriding his own call from the day before). All four pages
// are mounted and scrollable end to end before anything is initialled, because a contract you
// cannot read to the end before you start agreeing to it is not one people read.
//
// Two things that cost us, stated rather than discovered later:
//   - Somebody CAN initial page 4 before page 1. The header button always acts on the first
//     outstanding page, so the ordinary path is still in order, but the boxes are all live and
//     that is the point of showing them.
//   - dwell_ms had to be redefined. It used to be "time since this page was revealed", which only
//     meant anything because a page could not be seen before it was live. It is now time from the
//     page first SCROLLING INTO VIEW to the initial, measured with an IntersectionObserver and
//     stamped once. Dwell is stored evidence on onboarding2_initials, so it has to keep meaning
//     what it says it means.
//
// ‼️ SCREEN ONE COLLECTS THE WHOLE IDENTITY AND NOTHING LATER RE-ASKS FOR ANY OF IT. The
// signature screen is a signature, a date and a business address. Everything else is shown back
// read-only, because a signer who cannot see the party they are binding is a real weakness, and
// showing is not asking.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AGREEMENT_UI,
  CHAT_UI,
  LANDING,
  SIGNATURE_UI,
  SIGNED_UI,
} from "@/config/onboarding2";
import { canonicalDocument, canonicalPage, sha256Hex } from "@/lib/onboarding2/canonical";
import { formatPhoneUS } from "@/lib/clients/normalize";
import { readAttribution, track } from "@/lib/medspa/pixel";
import { ChatPanel } from "./chat-bubble";

const REEF = "#00C9A7";
const CARD = "rounded-xl bg-white/5 p-6 sm:p-8";
const CTA =
  "w-full rounded-lg bg-[#00C9A7] px-6 py-4 text-base font-bold text-[#04252b] disabled:opacity-50";
const INPUT_BASE =
  "w-full rounded-lg border bg-white/5 px-4 py-3 text-white placeholder-white/30 outline-none focus:border-[#00C9A7] ";

function inputClass(hasError: boolean): string {
  return INPUT_BASE + (hasError ? "border-red-400/60" : "border-white/15");
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

interface Agreement {
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

type Stage =
  | "loading"
  | "identity"
  | "agreement"
  | "signature"
  | "signing"
  | "signed"
  | "qualifying"
  | "limited"
  | "stale";

interface Report {
  score: number | null;
  city: string | null;
  business: string | null;
  competitor: string | null;
  userShowed: number | null;
  compShowed: number | null;
  reportSlug: string | null;
}

/** Screen one, in the order it is asked. */
interface Identity {
  contactName: string;
  businessLegalName: string;
  signerTitle: string;
  website: string;
  email: string;
  phone: string;
}

const EMPTY_IDENTITY: Identity = {
  contactName: "",
  businessLegalName: "",
  signerTitle: "",
  website: "",
  email: "",
  phone: "",
};

/**
 * Their initials, from the name they already gave us.
 *
 * ‼️ NOBODY TYPES THEIR INITIALS FOUR TIMES. First letter of the first word and of the last, which
 * is what a person writing in a margin does. Falls back to the first two letters of a single-word
 * name. Always passes INITIALS_RE, which requires one to six characters starting with a letter.
 */
function initialsFrom(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Onboarding2Funnel({
  report,
  utm,
}: {
  report: Report;
  utm: { source: string; medium: string; campaign: string; content: string };
}) {
  const [stage, setStage] = useState<Stage>("loading");
  const [agreement, setAgreement] = useState<Agreement | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  /** Section numbers. What the coverage check speaks in, and what a 409 hands back. */
  const [initialledSections, setInitialledSections] = useState<number[]>([]);
  /** Page numbers. What the screen ticks off. Both come from the server, never derived here. */
  const [initialledPages, setInitialledPages] = useState<number[]>([]);
  /** One box per page. A single shared string would leak page to page. */
  const [initialsByPage, setInitialsByPage] = useState<Record<number, string>>({});
  const [identity, setIdentity] = useState<Identity>({
    ...EMPTY_IDENTITY,
    businessLegalName: report.business ?? "",
  });
  const [idErrors, setIdErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trap, setTrap] = useState("");
  // Told to us by /start, decided there from the request host. The banner is the only reason the
  // client knows at all: nothing here changes behaviour, because the suppression is server-side.
  const [demo, setDemo] = useState(false);

  const renderedAt = useRef(Date.now());
  /** When each page first scrolled into view, keyed by page number. Feeds dwellMs. */
  const seenAt = useRef<Record<number, number>>({});
  /** The initials input on each page, so one can be scrolled to and focused. */
  const boxRefs = useRef<Record<number, HTMLInputElement | null>>({});
  /** The <article> for each page, watched by the IntersectionObserver. */
  const pageRefs = useRef<Record<number, HTMLElement | null>>({});
  /** Set by an action, consumed by the scroll effect on the next render. */
  const scrollTo = useRef<number | null>(null);
  /** Which page is under the reader's eye, for the page counter. Display only. */
  const [visiblePage, setVisiblePage] = useState(1);

  const [sig, setSig] = useState({
    signatureTyped: "",
    addressLine1: "",
    addressCity: report.city ?? "",
    addressState: "",
    addressPostal: "",
    signedDate: new Date().toISOString().slice(0, 10),
  });
  const [sigErrors, setSigErrors] = useState<Record<string, string>>({});

  // ‼️ THERE IS NO CLIENT-SIDE REVIEW SUPPRESSION HERE, AND REMOVING IT WAS THE POINT.
  // /chatgpt-ads guards a `live` ref that skips the POST on a preview host, which means the one
  // thing you cannot test on a preview over there is the thing you most need to: the submit. On a
  // contract that would have left the signature, the PDF, the assistant handoff and the close all
  // unexercised. Demo mode is decided SERVER-SIDE from the request host instead
  // (src/lib/onboarding2/demo.ts), so a preview runs every line production runs and only the
  // escaping side effects are suppressed.

  const attribution = useCallback(() => {
    const a = readAttribution();
    return {
      sourceUrl: window.location.href,
      referrer: document.referrer,
      utmSource: utm.source || a.utmSource,
      utmMedium: utm.medium || a.utmMedium,
      utmCampaign: utm.campaign || a.utmCampaign,
      utmContent: utm.content,
      fbc: a.fbc,
      fbp: a.fbp,
      fbclid: a.fbclid,
      score: report.score,
      city: report.city,
      business: report.business,
      competitor: report.competitor,
      userShowed: report.userShowed,
      compShowed: report.compShowed,
      reportSlug: report.reportSlug,
    };
  }, [report, utm]);

  const post = useCallback(
    async (path: string, payload: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
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

  // ── Open the session and freeze the agreement ──
  //
  // sessionStorage, NOT localStorage. A half-signed contract persisted across a closed tab on a
  // shared or front-desk machine is somebody else's document waiting to be finished by whoever
  // sits down next. The cost is that closing the tab restarts the flow, which is correct.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const existing = sessionStorage.getItem("srt:onb2:token");
      const res = await post("start", {
        renderedAt: renderedAt.current,
        company_url_hp: "",
        attribution: attribution(),
        resume: existing,
      });
      if (cancelled) return;
      if (!res || res.ok !== true) {
        setError("Could not load the agreement. Refresh and try again.");
        setStage("identity");
        return;
      }
      if (res.limited) {
        setStage("limited");
        return;
      }
      sessionStorage.setItem("srt:onb2:token", res.sessionToken as string);
      setSessionToken(res.sessionToken as string);
      setAgreement(res.agreement as Agreement);
      setDemo(res.demo === true);

      const doneSections = (res.initialledSections as number[]) ?? [];
      const donePages = (res.initialledPages as number[]) ?? [];
      setInitialledSections(doneSections);
      setInitialledPages(donePages);

      // ‼️ THE WHOLE IDENTITY COMES BACK ON A RESUME, NOT JUST THE EMAIL. A refresh mid-agreement
      // must not put somebody back on screen one with five empty boxes, which would be the
      // duplicate-question fault arriving by a different door.
      const resumed = res.identity as Identity | null;
      const pageCount = ((res.agreement as Agreement).pages ?? []).length;
      if (resumed) {
        setIdentity(resumed);
        setInitialsByPage((prev) => {
          const seed = initialsFrom(resumed.contactName);
          if (!seed) return prev;
          const next = { ...prev };
          for (const p of donePages) next[p] = next[p] ?? seed;
          return next;
        });
        setStage(donePages.length >= pageCount ? "signature" : "agreement");
      } else {
        setStage("identity");
      }
    })();
    return () => {
      cancelled = true;
    };
    // Once, on mount. attribution and post are stable enough that re-running would only ever
    // mean a second session row for one visitor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sections = useMemo(() => agreement?.sections ?? [], [agreement]);
  const pages = useMemo(() => agreement?.pages ?? [], [agreement]);
  const totalPages = pages.length || 4;

  /** Section number to the section, so a page can render its own clauses. */
  const sectionByNumber = useMemo(
    () => new Map(sections.map((s) => [s.n, s])),
    [sections]
  );

  /**
   * The first page with no initial against it, or null when every page is done.
   *
   * ‼️ THE HEADER BUTTON ALWAYS ACTS ON THIS ONE, EVEN IF THEY HAVE SCROLLED PAST IT. Every box is
   * live now, so somebody can work out of order if they choose to, but the one-tap path stays in
   * document order and the button says which page it is about to initial, so it is never a
   * surprise.
   */
  const nextPage = useMemo(
    () => pages.find((pg) => !initialledPages.includes(pg.p)) ?? null,
    [pages, initialledPages]
  );

  const suggestedInitials = useMemo(
    () => initialsFrom(identity.contactName),
    [identity.contactName]
  );

  // ── Pixel ──
  //
  // ‼️ track() DEDUPES ON THE EVENT NAME ALONE (a module-level Set in medspa/pixel.ts), and this
  // is a single-page funnel, so a name fires once per page load. That is why there is no
  // per-page pixel event: four fires of one name would be three no-ops, and a custom event name
  // would break the standard-events-only rule the ad sets are built on. The per-page evidence
  // lives in onboarding2_initials.created_at and dwell_ms, which is better than a pixel could be.
  useEffect(() => {
    if (stage === "agreement") track("ViewContent");
  }, [stage]);

  // ── Dwell, and the page counter ──
  //
  // ‼️ DWELL IS STAMPED WHEN A PAGE FIRST ENTERS THE VIEWPORT, AND NEVER RESTAMPED. With the whole
  // document mounted at once, "time since render" would be identical for all four pages and would
  // mean nothing. Scrolling back up to re-read page 2 must not rewrite page 2's stamp either: the
  // number we want is how long from first seeing a page to initialling it.
  //
  // The same observer drives the "Page N of 4" readout, because a document viewer that does not
  // tell you where you are in the document is a scrolling div.
  useEffect(() => {
    if (stage !== "agreement" || !pages.length) return;
    if (typeof IntersectionObserver === "undefined") return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const p = Number((entry.target as HTMLElement).dataset.page);
          if (!Number.isFinite(p)) continue;
          if (seenAt.current[p] === undefined) seenAt.current[p] = Date.now();
          setVisiblePage(p);
        }
      },
      // Fires when a page crosses the middle of the screen, so the counter changes when the page
      // you are actually reading changes, not when the next one peeks in at the bottom.
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 }
    );

    for (const pg of pages) {
      const el = pageRefs.current[pg.p];
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [stage, pages]);

  // ‼️ THE SCROLL RUNS AS AN EFFECT, NOT INSIDE THE HANDLER. At the moment submitInitial returns,
  // the state that decides what is on screen has not rendered yet.
  useEffect(() => {
    const target = scrollTo.current;
    if (target === null) return;
    scrollTo.current = null;
    const box = boxRefs.current[target];
    if (!box) return;
    box.scrollIntoView({ behavior: "smooth", block: "center" });
    // Focus without a second scroll, since scrollIntoView is already doing one.
    box.focus({ preventScroll: true });
  }, [initialledPages, stage]);

  // ── Screen 1 ──
  async function submitIdentity() {
    setError(null);
    const errs: Record<string, string> = {};
    const name = identity.contactName.trim();
    const company = identity.businessLegalName.trim();
    const title = identity.signerTitle.trim();
    const website = identity.website.trim();
    const email = identity.email.trim().toLowerCase();
    const phone = identity.phone.trim();

    // The server checks every one of these again. This is only so the message arrives without a
    // round trip.
    if (name.length < 2 || !/\p{L}/u.test(name)) errs.contactName = "Your full name, please.";
    if (company.length < 2) errs.businessLegalName = "The name your business is registered under.";
    if (title.length < 2) errs.signerTitle = "Owner, Medical Director, and so on.";
    if (!/^[a-z0-9.-]+\.[a-z]{2,}/i.test(website.replace(/^https?:\/\//i, "")))
      errs.website = "That does not look like a website.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errs.email = "That email does not look right.";
    if (phone.replace(/\D/g, "").length < 10) errs.phone = "A ten digit number, please.";

    setIdErrors(errs);
    if (Object.keys(errs).length) return;

    setSaving(true);
    const res = await post("email", {
      sessionToken,
      contactName: name,
      businessLegalName: company,
      signerTitle: title,
      website,
      email,
      contactPhone: phone,
      renderedAt: renderedAt.current,
      company_url_hp: trap,
      attribution: attribution(),
    });
    setSaving(false);
    if (!res || res.ok !== true) {
      setError((res?.error as string) || "Could not save that. Try again.");
      return;
    }
    track("Lead");
    setStage("agreement");
    window.scrollTo({ top: 0 });
  }

  // ── One PAGE, initialled ──
  //
  // ‼️ ONE POST PER PAGE, CARRYING A HASH OVER EVERY CLAUSE ON IT. The page grouping comes from
  // the snapshot, so `pageSections` is echoed for the server to CHECK rather than to act on: the
  // row it writes is built from the snapshot's own list. The nonce is what makes a retry collide
  // instead of writing a second initial for the same page.
  async function submitInitial(page: SnapshotPage) {
    if (!agreement || saving) return;
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
    if (!agreement) return;
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

    // ‼️ NO IDENTITY IN THIS PAYLOAD. Name, company, title, email and phone are on the row from
    // screen one, and /sign reads them there. Sending them again would be re-collecting them by
    // another name and would let a crafted request sign under a company nobody typed.
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
    if (res && res.error === "identity_missing") {
      setError("We lost your details. Please fill them in again.");
      setStage("identity");
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

    track("CompleteRegistration");
    setStage("signed");
    window.scrollTo({ top: 0 });
  }

  // ── Render ──

  if (stage === "loading") {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-24 text-center text-white/50">
        Loading the agreement
      </div>
    );
  }

  if (stage === "limited") {
    return (
      <Shell>
        <div className={CARD}>
          <h1 className="mb-2 text-xl font-bold">That has already come through</h1>
          <p className="text-white/70">
            We have a few sign ups from this connection already today. Reply to our email and we
            will sort it out.
          </p>
        </div>
      </Shell>
    );
  }

  if (stage === "stale") {
    return (
      <Shell>
        <div className={CARD}>
          <h1 className="mb-2 text-xl font-bold">{AGREEMENT_UI.staleTitle}</h1>
          <p className="mb-6 text-white/70">{AGREEMENT_UI.staleBody}</p>
          <button className={CTA} onClick={() => window.location.reload()}>
            Start again
          </button>
        </div>
      </Shell>
    );
  }

  // ‼️ FULL SCREEN FROM THE MOMENT THE QUESTIONS START. Not a corner bubble with a form behind it.
  // The questions ARE the page now, and it reads like a texting thread because that is what it is.
  if (stage === "qualifying" && sessionToken) {
    return <ChatPanel sessionToken={sessionToken} signed fullscreen demo={demo} />;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // THE DOCUMENT VIEWER.
  //
  // ‼️ IT IS A SEPARATE FULL-BLEED LAYOUT, NOT A CARD INSIDE THE FUNNEL SHELL, AND THAT IS THE
  // WHOLE FIX (Matthew, 2026-09-03: "this looks like its fake"). A white card floating on a black
  // marketing page reads as a web form dressed up as a contract. What a person recognises as a
  // document being signed is the chrome AROUND the paper: a toolbar naming the file, a grey
  // workspace, letter-proportioned pages with real margins and a drop shadow, a page counter that
  // moves as you scroll, and a signature field that looks like a field rather than a text input.
  //
  // The greys are Chrome's own PDF viewer, #323639 for the toolbar and #525659 for the canvas.
  // That pairing is what almost everybody in the world has looked at a contract in.
  // ─────────────────────────────────────────────────────────────────────────
  if (stage === "agreement" && agreement) {
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
                          <p key={line} className="font-serif text-[13px] leading-6 text-neutral-500">
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
                              htmlFor={`onb2-initials-${pg.p}`}
                              className="flex cursor-pointer items-center bg-[#d99e00] px-2.5 text-[10px] font-bold uppercase tracking-wider text-white"
                            >
                              Initial
                            </label>
                            {/* ‼️ A TAP FILLS IT IN. Derived from the name they gave on screen one,
                                dropped in on focus, and still fully editable afterwards. Nobody
                                types their initials four times. */}
                            <input
                              id={`onb2-initials-${pg.p}`}
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

              <p className="pb-10 pt-2 text-center text-xs text-white/50">{AGREEMENT_UI.askHelp}</p>
            </div>
          </div>
        </div>

        {/* The floating page pill, the way a PDF viewer shows position on a phone. */}
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-full bg-black/75 px-3.5 py-1.5 text-xs font-medium text-white/90 sm:hidden">
          Page {visiblePage} of {totalPages}
        </div>

        {sessionToken && (
          <ChatPanel sessionToken={sessionToken} signed={false} fullscreen={false} demo={demo} />
        )}
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
        {stage === "identity" && (
          <div className={CARD}>
            <div className="mb-6 text-sm font-bold uppercase tracking-wide" style={{ color: REEF }}>
              {LANDING.eyebrow}
            </div>
            <h1 className="mb-3 text-3xl font-bold leading-tight sm:text-4xl">{LANDING.heading}</h1>
            <p className="mb-6 text-lg font-semibold" style={{ color: REEF }}>
              {LANDING.promise}
            </p>
            <p className="mb-6 text-white/70">{LANDING.body}</p>

            {/* ‼️ SIX FIELDS, AND THIS IS THE ONLY SCREEN THAT ASKS FOR ANY OF THEM. */}
            <Field
              label={LANDING.nameLabel}
              hint={LANDING.nameHelp}
              autoComplete="name"
              value={identity.contactName}
              error={idErrors.contactName}
              onChange={(v) => setIdentity((s) => ({ ...s, contactName: v }))}
              required
            />
            <Field
              label={LANDING.companyLabel}
              hint={LANDING.companyHelp}
              autoComplete="organization"
              value={identity.businessLegalName}
              error={idErrors.businessLegalName}
              onChange={(v) => setIdentity((s) => ({ ...s, businessLegalName: v }))}
              required
            />
            <Field
              label={LANDING.titleLabel}
              hint={LANDING.titleHelp}
              autoComplete="organization-title"
              value={identity.signerTitle}
              error={idErrors.signerTitle}
              onChange={(v) => setIdentity((s) => ({ ...s, signerTitle: v }))}
              required
            />
            <Field
              label={LANDING.websiteLabel}
              hint={LANDING.websiteHelp}
              type="url"
              autoComplete="url"
              placeholder="yourclinic.com"
              value={identity.website}
              error={idErrors.website}
              onChange={(v) => setIdentity((s) => ({ ...s, website: v }))}
              required
            />
            <Field
              label={LANDING.emailLabel}
              hint={LANDING.emailHelp}
              type="email"
              autoComplete="email"
              placeholder="you@yourclinic.com"
              value={identity.email}
              error={idErrors.email}
              onChange={(v) => setIdentity((s) => ({ ...s, email: v }))}
              required
            />
            {/* ‼️ LIVE FORMATTED, AND IT ABSORBS A TYPED +1 AS THEY GO. formatPhoneUS is the same
                function every other funnel in this repo uses; normalizeLeadPhone on the server
                decides what is STORED, and what is stored is E.164 plus the raw string. There is
                never a separate WhatsApp number anywhere. */}
            <Field
              label={LANDING.phoneLabel}
              hint={LANDING.phoneHelp}
              kind="tel"
              placeholder="(336) 833-2303"
              value={identity.phone}
              error={idErrors.phone}
              onChange={(v) => setIdentity((s) => ({ ...s, phone: formatPhoneUS(v) }))}
              required
            />

            {error && <p className="mt-3 text-sm text-red-300">{error}</p>}

            {/* Offscreen, not display:none. A bot fills it, a person never sees it. */}
            <input
              type="text"
              name="company_url_hp"
              value={trap}
              onChange={(e) => setTrap(e.target.value)}
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              className="absolute left-[-9999px] h-0 w-0 opacity-0"
            />

            <button
              className={`${CTA} mt-5`}
              onClick={submitIdentity}
              disabled={saving || !sessionToken}
            >
              {saving ? "One moment" : LANDING.cta}
            </button>
            {/* ‼️ THE LAST LINE ON THIS SCREEN. The value stack that used to sit under it was
                deleted on 2026-09-02. Do not add a second block below this one. */}
            <p className="mt-4 text-xs text-white/40">{LANDING.fine}</p>
          </div>
        )}

        {(stage === "signature" || stage === "signing") && (
          <div className={CARD}>
            <h1 className="mb-2 text-2xl font-bold">{SIGNATURE_UI.heading}</h1>
            <p className="mb-6 text-white/70">{SIGNATURE_UI.body}</p>

            {/* ‼️ READ-ONLY. NOT INPUTS. Six values collected on screen one, shown back so nobody
                signs a contract without seeing the party it binds. Showing is not asking. */}
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
              <button
                className="mt-3 text-xs text-white/45 underline hover:text-white/70"
                onClick={() => {
                  setStage("identity");
                  window.scrollTo({ top: 0 });
                }}
              >
                {SIGNATURE_UI.recapEdit}
              </button>
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
            {/* The only thing screen one does not have. checkMarket() geocodes a STRUCTURED
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

            <button className={`${CTA} mt-6`} onClick={submitSignature} disabled={stage === "signing"}>
              {stage === "signing" ? SIGNATURE_UI.working : SIGNATURE_UI.cta}
            </button>
            <p className="mt-4 text-xs text-white/40">{SIGNATURE_UI.fine}</p>
          </div>
        )}

        {stage === "signed" && (
          <div className={CARD}>
            <h1 className="mb-2 text-2xl font-bold">{SIGNED_UI.heading}</h1>
            {/* ‼️ ONE BUTTON. The download link was deleted on 2026-09-03: the executed contract
                is emailed, and a second way to get it here made this screen a fork at the exact
                moment we want one forward path. */}
            <p className="mb-6 text-white/70">{SIGNED_UI.body}</p>
            <button
              className={CTA}
              onClick={() => {
                setStage("qualifying");
                window.scrollTo({ top: 0 });
              }}
            >
              {SIGNED_UI.cta}
            </button>
          </div>
        )}
      </Shell>

      {/*
        The grounded assistant, present while they are reading and signing. Gated server-side on
        the signing row: the `signed` prop only picks placeholder text and is not an authorisation
        boundary. The "limited" and "stale" stages return earlier and never reach here, which is
        why there is no check for them: those two are dead ends with nothing to ask about.
      */}
      {sessionToken && stage !== "qualifying" && (
        <ChatPanel sessionToken={sessionToken} signed={false} fullscreen={false} demo={demo} />
      )}
    </>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-12">{children}</div>;
}

/** The document glyph in the viewer toolbar. Inline SVG, because one icon is not a dependency. */
function DocIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="h-7 w-7 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      style={{ color: REEF }}
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </svg>
  );
}

function Recap({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-white/40">{label}</dt>
      <dd className="min-w-0 break-words text-white/85">{value || "not given"}</dd>
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
  kind,
  required,
  className = "",
  autoComplete,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: string;
  type?: string;
  /** "tel" turns on the numeric keypad and the formatted width. */
  kind?: "tel";
  required?: boolean;
  className?: string;
  autoComplete?: string;
  placeholder?: string;
}) {
  const isTel = kind === "tel";
  return (
    <div className="mb-4">
      <label className="mb-1.5 block text-sm font-medium">
        {label}
        {required && (
          <span className="ml-1" style={{ color: REEF }}>
            *
          </span>
        )}
      </label>
      <input
        type={isTel ? "tel" : type}
        inputMode={isTel ? "tel" : type === "email" ? "email" : undefined}
        autoComplete={isTel ? "tel" : autoComplete}
        maxLength={isTel ? 14 : undefined}
        placeholder={placeholder}
        className={`${inputClass(Boolean(error))} ${className}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <p className="mt-1 text-xs text-white/40">{hint}</p>}
      {error && <p className="mt-1.5 text-xs text-red-300">{error}</p>}
    </div>
  );
}
