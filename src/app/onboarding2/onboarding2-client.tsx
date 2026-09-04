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
type Stage = "loading" | "identity" | "chat" | "limited";

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
      // !! A RESUMED SESSION LANDS IN THE CHAT, NOT BACK ON THE FORM. The chat rebuilds its own
      // history from stored turns and the lead row decides whether it is still booking or already
      // asking questions, so returning here is genuinely resuming rather than starting again.
      //
      // The initials seed and the pages-done arithmetic went with the agreement screens. `res`
      // still carries `agreement`, because POST /start still freezes a snapshot; nothing on the
      // client reads it now.
      const resumed = res.identity as Identity | null;
      if (resumed) {
        setIdentity(resumed);
        setStage("chat");
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
    // !! ViewContent NOW FIRES ON THE CHAT, NOT ON THE AGREEMENT. It marked "started reading the
    // contract", which was the funnel's real second step. That step is gone; the equivalent
    // moment is the conversation opening, which is the last thing before a booking.
    if (stage === "chat") track("ViewContent");
  }, [stage]);





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
    // !! STRAIGHT TO THE CHAT, WHICH OPENS ON BOOKING. There is no agreement screen between the
    // two any more, so this is the whole of the funnel's front half: six fields, then a
    // conversation that books the call.
    setStage("chat");
    window.scrollTo({ top: 0 });
  }

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

      </Shell>

      {/*
        !! NO CORNER BUBBLE HERE ANY MORE. It existed to answer questions about the agreement while
        somebody read it, and there is no agreement on screen to ask about. The only stage that
        reaches this return is `identity`, six labelled fields; an assistant floating over it would
        have nothing to be grounded in. The chat takes the whole page one stage later.
      */}
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
