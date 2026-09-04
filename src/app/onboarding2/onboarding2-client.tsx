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
  CHAT_UI,
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

// !! NINE STAGES BECAME FOUR ON 2026-09-04. `agreement`, `signature`, `signing` and `signed` are
// gone with the screens they named: the agreement is no longer read or signed in this funnel, it
// is signed by hand on the call at delivery step `agreement_signed`.
//
// `stale` went with them and it is worth saying why, because it was not dead weight. It caught a
// template edit landing mid-read, detected by the page-hash echo, and it existed because this
// flow was fourteen screens long. Nobody reads the template here any more, so there is no read
// left to invalidate.
//
// The signing ROW, the snapshot, /api/onboarding2/initial, /api/onboarding2/sign and the
// onboarding2_initials table all still exist. The SCREENS were removed from the funnel, not the
// record from the database.
type Stage = "loading" | "chat" | "limited";

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
        setError("Could not start your session. Refresh and try again.");
        setStage("chat");
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
      // !! A RESUMED SESSION LANDS IN THE CHAT, NOT BACK ON THE FORM. The chat rebuilds its own
      // history from stored turns and the lead row decides whether it is still booking or already
      // asking questions, so returning here is genuinely resuming rather than starting again.
      //
      // The initials seed and the pages-done arithmetic went with the agreement screens. `res`
      // still carries `agreement`, because POST /start still freezes a snapshot; nothing on the
      // client reads it now.
      // !! EVERY SESSION LANDS IN THE CHAT, RESUMED OR NOT. There is no form to go back to. A
      // resumed session still gets its stored identity into state, because the chat's own
      // progress is computed server-side from the same row and this keeps the two agreeing.
      const resumed = res.identity as Identity | null;
      if (resumed) setIdentity(resumed);
      setStage("chat");
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
    // !! ViewContent NOW FIRES ON THE CHAT, NOT ON THE AGREEMENT. It marked "started reading the
    // contract", which was the funnel's real second step. That step is gone; the equivalent
    // moment is the conversation opening, which is the last thing before a booking.
    if (stage === "chat") track("ViewContent");
  }, [stage]);





  // !! submitIdentity() WAS DELETED HERE ON 2026-09-04 WITH THE SCREEN THAT CALLED IT.
  // It validated six fields client-side and POSTed them to /api/onboarding2/email. The chat
  // asks for four of them now and validates them SERVER-SIDE with the same functions, in
  // lib/onboarding2/intake-steps.ts, which is where that logic always belonged: the client
  // copy only ever existed to save a round trip. The route is intact and unreferenced.

  // !! submitInitial() AND submitSignature() WERE DELETED HERE ON 2026-09-04, WITH THE SCREENS
  // THAT CALLED THEM. Between them they carried the page-hash echo, the client-side
  // canonicalPage/canonicalDocument recomputation, the nonce that made a retry collide instead
  // of writing a second initial, and the coverage arithmetic.
  //
  // NONE OF THAT LOGIC WAS LOST. It lives server-side, where it always mattered:
  // /api/onboarding2/initial still checks the claimed sections against the snapshot and
  // constant-time compares the page hash, and /api/onboarding2/sign still refuses a signature
  // that does not cover every clause. Both routes are intact and unreferenced. If e-signature
  // comes back, the server half is already there and only these two handlers need rewriting.

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


  // !! FULL SCREEN FROM THE MOMENT IDENTITY IS IN. Not a corner bubble with a form behind it.
  // The conversation IS the page: it books the call first and asks the questions second, and it
  // reads like a texting thread because that is what it is.
  if (stage === "chat" && sessionToken) {
    return <ChatPanel sessionToken={sessionToken} fullscreen demo={demo} />;
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

  // !! THE LAST SCREEN IN THIS COMPONENT IS GONE (2026-09-04, second pass).
  //
  // `identity` was six labelled fields: full name, business legal name, title, website, email,
  // phone. The chat asks for four of them now, in conversation, between the timezone and the day
  // (see lib/onboarding2/intake-steps.ts). Business legal name moved to the first post-booking
  // question and the signer title is not asked at all: the agreement it existed for is signed by
  // hand on the call.
  //
  // !! TWO GUARDS DIED WITH THIS SCREEN AND NEITHER WAS REPLACED IN KIND.
  // The honeypot (`company_url_hp`) and the MIN_FILL_SECONDS time trap both lived on the form.
  // POST /start still accepts and enforces both, and the mount effect above still sends them, so
  // the SESSION is still trapped; what is no longer trapped is the identity submission, because
  // there is no longer a submission. What bounds the chat instead is the per-IP start cap, the
  // per-IP hourly turn cap, the per-signing turn caps and MIN_TURN_GAP_MS. Stricter in
  // aggregate, different in kind, and worth knowing before somebody reports "the honeypot is
  // gone" as a regression.
  //
  // Attribution is unaffected: it was always sent to /start as well, which is where the utm_*,
  // fbc and fbp columns are written.
  if (!sessionToken) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-24 text-center text-white/50">
        {error ?? "Loading"}
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
      <ChatPanel sessionToken={sessionToken} fullscreen demo={demo} />
    </>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-12">{children}</div>;
}
