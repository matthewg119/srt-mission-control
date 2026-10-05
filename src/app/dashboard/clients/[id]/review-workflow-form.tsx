"use client";

// Delivery steps 29 and 30: how they ask for reviews, who owns the tool, and where reviews go.
//
// ‼️ THIS PANEL IS THE MISSING WRITER FOR THREE THINGS THAT ONLY EVER HAD READERS.
// Step 29's refusal said "Set it on the client board" and there was no control anywhere that
// wrote `review_request_mode`, so that step could never be confirmed for any client. The two
// URL fields are why the AI Referral Engine's "Post on Google" button has never once appeared: it
// reads `review_workflow.google_url` and nothing has ever written it. See the route header.
//
// The intake destinations are printed above the URL boxes, not as decoration: step 4 asks WHERE
// they collect reviews and gets back labels ("Google", "RealSelf"), which is what tells you
// which links to go and ask for.
//
// ‼️ 2026-09-08: IT HAD TWO BOXES FOR SIX PLATFORMS, AND THAT WAS THE SECOND HALF OF THE SAME
// BUG THIS PANEL WAS BUILT TO FIX.
//
// The funnel offers six destinations. This panel offered Google and RealSelf. So a client who
// answered Trustpilot, Yelp, BBB or Facebook had their choice recorded on
// review_destination_primary and there was nowhere on any screen to put the matching link.
// SRT Agency's own row says 'trustpilot'. The AI Referral Engine then rendered no button, correctly
// and silently, because absent beats wrong, and every customer got the fallback hint.
//
// All six are drawn from REVIEW_PLATFORMS now, and the panel SAYS WHICH ONE THE CLIENT PICKED,
// because the failure was never a missing box. It was that nothing on screen connected the
// answer they gave to the box that was empty.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { stepNumber } from "@/config/delivery-steps";
import {
  REVIEW_PLATFORMS,
  destinationLine,
  destinationState,
} from "@/lib/hub/review-destinations";

export interface ReviewWorkflowView {
  mode: "booking_system" | "card_only" | null;
  ownerName: string | null;
  /**
   * The `review_workflow` bag as stored, so this panel can read all six URL keys without the
   * page having to name each one. Only the URL fields are read here; the intake keys beside
   * them are left alone, and the route MERGES rather than replaces on save.
   */
  workflow: Record<string, unknown>;
  /** `clients.review_destination_primary`. A platform NAME, never a link. */
  primaryKey: string | null;
  /** The labels from intake step 4, verbatim. */
  intakeDestinations: string[];
  bookingSoftware: string | null;
  /** The live reviews host, so the panel can offer the thing it configures. */
  reviewsHost: string | null;
  /** Internal preview, login required. Null when CLIENT_LINK_SECRET is unset. */
  previewUrl: string | null;

  // ── The in-clinic referral (v5, 2026-10-05) ───────────────────────────────
  //
  // ‼️ READ OFF THE SAME BAG AS THE URLs ABOVE, except serviceOffers, which is its own table.
  // See src/lib/hub/referral-config.ts for why those two live in different places.
  /** `review_workflow.charge_timing`. Decides when the front desk hands the card over. */
  chargeTiming: string | null;
  /** `review_workflow.front_desk_count`. How many cards to print and how many people to train. */
  frontDeskCount: number | null;
  /** `review_workflow.private_feedback_to`. Who hears what a patient will not post. */
  privateFeedbackTo: string | null;
  /** `review_workflow.referral_offer.default_offer`. What the FRIEND gets. */
  defaultOffer: string | null;
  /** `review_workflow.referral_offer.default_referrer_offer`. What SHE gets. */
  defaultReferrerOffer: string | null;
  /** `review_workflow.referral_offer.mode`: "text" or "internal". */
  inviteMode: string | null;
  // ── The referral emails (2026-10-05) ───────────────────────────────────
  //
  // ‼️ ALL FOUR BOOLEANS ARE OFF UNTIL SOMEBODY HERE TURNS THEM ON. `review_workflow
  // .referral_email`, same bag, same merge. Editable here and from the step thread, which is
  // what makes "set it up on the call, anytime" true rather than a deploy away.
  /** The master switch. Nothing in this lane sends for this client while it is false. */
  emailEnabled: boolean;
  /** The clinic hears when a referral is made, and again when it is claimed. */
  notifyClinic: boolean;
  /** The friend gets a confirmation. Also what makes the claim form ask for their address. */
  emailFriend: boolean;
  /** The patient hears that her friend came in and her reward is due. */
  emailReferrer: boolean;
  /** Where the clinic's own notices go. Blank falls back to the clients row's email. */
  notifyTo: string | null;
  /** Which SRT mailbox sends. One of `mailboxOptions`. */
  fromMailbox: string | null;
  /** The clinic's address, so a reply reaches them rather than us. */
  replyTo: string | null;
  /** The mailboxes we can actually send from, straight off the outreach rotation. */
  mailboxOptions: string[];
  /** The clients row's own email, shown as the fallback so nobody has to guess what it is. */
  clientEmail: string | null;
  /** `client_service_offers` rows, in sort order. */
  serviceOffers: Array<{
    serviceLabel: string;
    priceLabel: string | null;
    offerText: string | null;
    referrerOfferText: string | null;
    excluded: boolean;
  }>;
}

/** A grid row in the form. Blank rows are rendered to type into and dropped on save. */
interface OfferRow {
  serviceLabel: string;
  priceLabel: string;
  /** What the friend gets. */
  offerText: string;
  /** What the patient who refers gets. */
  referrerOfferText: string;
  excluded: boolean;
}

/** Enough empty rows that a clinic can add services without hunting for an add button. */
const SPARE_ROWS = 3;

const INPUT =
  "w-full rounded border border-white/10 bg-transparent px-2 py-1.5 text-[12px] text-white/85 placeholder:text-[rgba(255,255,255,0.25)] focus:border-white/30 focus:outline-none";
const LABEL = "mb-1 block text-[10px] uppercase tracking-widest text-[rgba(255,255,255,0.4)]";

export function ReviewWorkflowForm({
  clientId,
  view,
}: {
  clientId: string;
  view: ReviewWorkflowView;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [mode, setMode] = useState<string>(view.mode ?? "");
  const [ownerName, setOwnerName] = useState(view.ownerName ?? "");

  // ── The referral ───────────────────────────────────────────────────────────
  const [chargeTiming, setChargeTiming] = useState(view.chargeTiming ?? "");
  const [frontDeskCount, setFrontDeskCount] = useState(
    view.frontDeskCount == null ? "" : String(view.frontDeskCount)
  );
  const [privateFeedbackTo, setPrivateFeedbackTo] = useState(view.privateFeedbackTo ?? "");
  const [defaultOffer, setDefaultOffer] = useState(view.defaultOffer ?? "");
  const [defaultReferrerOffer, setDefaultReferrerOffer] = useState(
    view.defaultReferrerOffer ?? ""
  );
  const [inviteMode, setInviteMode] = useState(view.inviteMode ?? "text");
  const [emailEnabled, setEmailEnabled] = useState(view.emailEnabled);
  const [notifyClinic, setNotifyClinic] = useState(view.notifyClinic);
  const [emailFriend, setEmailFriend] = useState(view.emailFriend);
  const [emailReferrer, setEmailReferrer] = useState(view.emailReferrer);
  const [notifyTo, setNotifyTo] = useState(view.notifyTo ?? "");
  const [fromMailbox, setFromMailbox] = useState(view.fromMailbox ?? "");
  const [replyTo, setReplyTo] = useState(view.replyTo ?? "");
  const [fillAll, setFillAll] = useState("");
  const [fillAllReferrer, setFillAllReferrer] = useState("");
  const [offers, setOffers] = useState<OfferRow[]>(() => [
    ...view.serviceOffers.map((o) => ({
      serviceLabel: o.serviceLabel,
      priceLabel: o.priceLabel ?? "",
      offerText: o.offerText ?? "",
      referrerOfferText: o.referrerOfferText ?? "",
      excluded: o.excluded,
    })),
    ...Array.from({ length: SPARE_ROWS }, () => ({
      serviceLabel: "",
      priceLabel: "",
      offerText: "",
      referrerOfferText: "",
      excluded: false,
    })),
  ]);

  function editRow(i: number, patch: Partial<OfferRow>) {
    setOffers((prev) => prev.map((row, n) => (n === i ? { ...row, ...patch } : row)));
  }

  /**
   * Put one deal on every named service.
   *
   * ‼️ IT SKIPS THE EXCLUDED ONES, which is the whole reason the column exists. A clinic that has
   * said "never discount this" must not have that undone by the convenience button, or the button
   * becomes something nobody dares press on a half-finished grid.
   */
  function applyToAll() {
    const friend = fillAll.trim();
    const referrer = fillAllReferrer.trim();
    if (!friend && !referrer) return;
    setOffers((prev) =>
      prev.map((row) =>
        row.serviceLabel.trim() && !row.excluded
          ? {
              ...row,
              offerText: friend || row.offerText,
              referrerOfferText: referrer || row.referrerOfferText,
            }
          : row
      )
    );
  }

  // One entry per platform, keyed by the review_workflow field it writes.
  const [urls, setUrls] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const platform of REVIEW_PLATFORMS) {
      const raw = view.workflow[platform.field];
      seed[platform.field] = typeof raw === "string" ? raw : "";
    }
    return seed;
  });

  // Described from what is SAVED, not from what is typed. A box with an unsaved link in it has
  // not fixed anything yet, and a panel that said otherwise would be the same class of lie as a
  // green tick over unchecked work.
  const state = destinationState(view.workflow, view.primaryKey);

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/review-workflow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          ownerName,
          ...urls,
          chargeTiming,
          frontDeskCount,
          privateFeedbackTo,
          defaultOffer,
          defaultReferrerOffer,
          inviteMode,
          referralEmailEnabled: emailEnabled,
          referralNotifyClinic: notifyClinic,
          referralEmailFriend: emailFriend,
          referralEmailReferrer: emailReferrer,
          referralNotifyTo: notifyTo,
          referralFromMailbox: fromMailbox,
          referralReplyTo: replyTo,
        }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) {
        setError(json.error ?? "Save failed.");
        return;
      }

      // ‼️ TWO ROUTES, ONE BUTTON, AND THE GRID GOES SECOND ON PURPOSE. The bag write above is a
      // merge and cannot lose anything; the grid write is a replace. Doing the safe one first
      // means a failure on the second leaves the settings saved and the grid as it was, which is
      // a state the panel can describe accurately instead of guessing at.
      const offerRes = await fetch(`/api/clients/${clientId}/service-offers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: offers }),
      });
      const offerJson = (await offerRes.json()) as { ok: boolean; error?: string };
      if (!offerJson.ok) {
        setError(`Settings saved. The services grid did not: ${offerJson.error ?? "unknown error"}`);
        return;
      }

      setNotice("Saved.");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // A role is not a person. Flagged rather than refused: an owner with one receptionist is
  // entitled to write what they want, and step 30's evidence is a reply in the thread anyway.
  const roleNotName = /^(the )?(front desk|reception|receptionist|staff|team|office)$/i.test(
    ownerName.trim()
  );

  return (
    <div className="space-y-4 text-[12px]">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={LABEL} htmlFor="rw-mode">
            How they ask (step {stepNumber("review_handover")})
          </label>
          <select
            id="rw-mode"
            className={INPUT}
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            <option value="">Not decided yet</option>
            <option value="booking_system">
              booking_system — automated request in their software
            </option>
            <option value="card_only">card_only — the printed cards are the mechanism</option>
          </select>
          <p className="mt-1 text-[11px] text-[rgba(255,255,255,0.45)]">
            {mode === "booking_system" ? (
              <>
                Recorded. Step 29 still wants a screenshot of the configured request in its
                thread, because their booking software is not something this app can query.
                {view.bookingSoftware ? ` They use ${view.bookingSoftware}.` : ""}
              </>
            ) : mode === "card_only" ? (
              `Recorded, and that is a complete answer. Step ${stepNumber("review_handover")} confirms on this alone.`
            ) : (
              `Step ${stepNumber("review_handover")} refuses until this is one of the two. The label allows either.`
            )}
          </p>
        </div>

        <div>
          <label className={LABEL} htmlFor="rw-owner">
            Who owns the tool (step {stepNumber("review_handover")})
          </label>
          <input
            id="rw-owner"
            className={INPUT}
            value={ownerName}
            placeholder="A name, not a role"
            onChange={(e) => setOwnerName(e.target.value)}
          />
          <p className="mt-1 text-[11px] text-[rgba(255,255,255,0.45)]">
            {roleNotName
              ? `That is a role, not a person. Step ${stepNumber("review_handover")} says handed to the NAMED person, and a link sent to a desk is a link nobody owns.`
              : `Step ${stepNumber("review_handover")}'s card reads this back so you can check the handover went to the right person.`}
          </p>
        </div>
      </div>

      {/*
        id="review-destination" so a step card can link straight at the boxes rather than at the
        top of a long board. Same precedent as id="theme", which step 15's card names by anchor.
      */}
      <div id="review-destination" className="rounded border border-white/10 p-3">
        <p className={LABEL}>Where her review goes</p>

        {/*
          ‼️ THE STATE LINE, AND ITS ABSENCE WAS THE WHOLE FAILURE. Everything needed to say
          "they chose Trustpilot and no Trustpilot link is set, so no button will appear" was
          already in the database. Nothing said it. destinationLine() is the one place that
          sentence is written, so the board, a step card and the tool all describe the same
          state in the same words.
        */}
        <p
          className={`mb-3 text-[11px] ${
            state.configured.length === 0 || state.primaryMissingUrl
              ? "text-[#F5A623]"
              : "text-[#4ADE80]"
          }`}
        >
          {destinationLine(state)}
        </p>

        <p className="mb-3 text-[11px] text-[rgba(255,255,255,0.45)]">
          {view.intakeDestinations.length ? (
            <>
              At intake they said they collect on:{" "}
              <span className="text-white/70">{view.intakeDestinations.join(", ")}</span>. Get the
              real links for those.
            </>
          ) : (
            "Intake step 4 recorded no destinations, so ask on the call."
          )}
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          {REVIEW_PLATFORMS.map((platform) => {
            const isPrimary = state.primary?.key === platform.key;
            return (
              <div key={platform.key}>
                <label className={LABEL} htmlFor={`rw-${platform.key}`}>
                  {platform.name} review link
                  {isPrimary ? (
                    <span className="ml-2 normal-case tracking-normal text-[#F5A623]">
                      their choice
                    </span>
                  ) : null}
                </label>
                <input
                  id={`rw-${platform.key}`}
                  className={
                    isPrimary && !urls[platform.field]?.trim()
                      ? `${INPUT} border-[#F5A623]/50`
                      : INPUT
                  }
                  value={urls[platform.field] ?? ""}
                  placeholder={platform.placeholder}
                  onChange={(e) =>
                    setUrls((prev) => ({ ...prev, [platform.field]: e.target.value }))
                  }
                />
              </div>
            );
          })}
        </div>

        <p className="mt-2 text-[11px] text-[rgba(255,255,255,0.45)]">
          These are the buttons on the AI Referral Engine. With nothing set, every customer gets a hint
          telling her to go and find the page herself, which is where most of them stop.{" "}
          <span className="text-[#F5A623]">
            Leave a box empty rather than guessing: a wrong link sends her to somebody else&apos;s
            business.
          </span>
        </p>
      </div>

      {/*
        ── The in-clinic referral (v5, 2026-10-05) ────────────────────────────

        ‼️ id="referral-offer" SO A STEP CARD CAN LINK STRAIGHT AT IT, the same precedent as
        id="theme" and id="review-destination" above.

        ‼️ WITH NOTHING FILLED IN HERE THE PATIENT IS NEVER ASKED TO REFER ANYBODY, and the panel
        says so rather than leaving it to be discovered. referralConfigFor() returns null when
        there is no default and no row, and the walk skips the recommend question and the invite
        outright, because a clinic that has not agreed a deal must not be made to promise one.
      */}
      <div id="referral-offer" className="rounded border border-white/10 p-3">
        <p className={LABEL}>The referral at the counter</p>
        <p className="mb-3 text-[11px] text-[rgba(255,255,255,0.45)]">
          {offers.some((o) => o.serviceLabel.trim() && o.offerText.trim() && !o.excluded) ||
          defaultOffer.trim()
            ? "Patients are asked whether they would recommend this clinic, and a Yes offers to text a friend. A No costs them nothing: they reach the same review either way."
            : "Nothing is set, so patients are NOT asked to refer anybody. Fill in a deal below, or the default, and the question appears."}
        </p>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className={LABEL} htmlFor="rw-charge">
              When do they charge
            </label>
            <select
              id="rw-charge"
              className={INPUT}
              value={chargeTiming}
              onChange={(e) => setChargeTiming(e.target.value)}
            >
              <option value="">Not asked yet</option>
              <option value="after">After the appointment</option>
              <option value="before">Before the appointment</option>
              <option value="both">Both, it varies</option>
            </select>
            <p className="mt-1 text-[11px] text-[rgba(255,255,255,0.45)]">
              Decides when the front desk hands the card over.
            </p>
          </div>

          <div>
            <label className={LABEL} htmlFor="rw-desk">
              Front desk headcount
            </label>
            <input
              id="rw-desk"
              className={INPUT}
              value={frontDeskCount}
              inputMode="numeric"
              placeholder="A whole number"
              onChange={(e) => setFrontDeskCount(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-[rgba(255,255,255,0.45)]">
              How many cards to print and how many people to train.
            </p>
          </div>

          <div>
            <label className={LABEL} htmlFor="rw-send">
              How the friend is reached
            </label>
            <select
              id="rw-send"
              className={INPUT}
              value={inviteMode}
              onChange={(e) => setInviteMode(e.target.value)}
            >
              <option value="text">She texts them, clinic on the thread</option>
              <option value="internal">The clinic follows up, nothing is sent</option>
            </select>
            <p className="mt-1 text-[11px] text-[rgba(255,255,255,0.45)]">
              {inviteMode === "internal"
                ? "Nothing leaves the building. The referral is recorded, she is told you will reach out, and the lead shows up here. No consent question at all."
                : "The invite opens a group text already written on her phone with this clinic on it. Her thumb is the send button, so nobody is texted who never gave us their number."}
            </p>
          </div>
        </div>

        <div className="mt-4">
          <label className={LABEL} htmlFor="rw-feedback">
            Who hears private feedback
          </label>
          <input
            id="rw-feedback"
            className={INPUT}
            value={privateFeedbackTo}
            placeholder="A name or an email"
            onChange={(e) => setPrivateFeedbackTo(e.target.value)}
          />
        </div>

        {/*
          ── The emails (2026-10-05) ──────────────────────────────────────────

          ‼️ EVERYTHING HERE IS OFF UNTIL IT IS SWITCHED ON, PER CLIENT, and the master switch is
          first so it reads as the thing it is. A clinic that has not discussed email sends none
          of these, which is the state every client is in until somebody sits on this panel.

          ‼️ AND THE SENDER IS US, WHICH THE PANEL SAYS OUT LOUD RATHER THAN IMPLYING OTHERWISE.
          Graph can only send from a mailbox inside our own tenant, so "from the clinic's
          address" is not on offer here and must not look as though it is. The clinic's address
          is the REPLY-TO, and the note under the picker says so.
        */}
        <div id="referral-email" className="mt-5 rounded border border-white/10 p-3">
          <p className={LABEL}>The emails</p>

          <label className="mt-2 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={emailEnabled}
              onChange={(e) => setEmailEnabled(e.target.checked)}
            />
            <span>
              Send referral emails for this client
              <span className="block text-xs text-white/50">
                Off for every client until it is ticked here. Nothing below sends while it is off.
              </span>
            </span>
          </label>

          <div className={emailEnabled ? "mt-3 space-y-2" : "mt-3 space-y-2 opacity-40"}>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                disabled={!emailEnabled}
                checked={notifyClinic}
                onChange={(e) => setNotifyClinic(e.target.checked)}
              />
              <span>
                Tell the clinic about each referral, and again when it is claimed
                <span className="block text-xs text-white/50">
                  This is the lead when nobody texts anybody, so it is the one to leave on.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                disabled={!emailEnabled}
                checked={emailFriend}
                onChange={(e) => setEmailFriend(e.target.checked)}
              />
              <span>
                Confirm it to the friend
                <span className="block text-xs text-white/50">
                  Also what makes the claim form ask for their email. With this off it does not,
                  because a form should not collect an address nothing uses.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                disabled={!emailEnabled}
                checked={emailReferrer}
                onChange={(e) => setEmailReferrer(e.target.checked)}
              />
              <span>
                Tell the patient when her friend comes in
                <span className="block text-xs text-white/50">
                  Only when she has earned something and only when she gave us her own address at
                  the counter. Sent at the claim, never at the referral.
                </span>
              </span>
            </label>
          </div>

          <div className="mt-3">
            <label className={LABEL} htmlFor="rw-notify-to">
              Where the clinic&apos;s notices go
            </label>
            <input
              id="rw-notify-to"
              className={INPUT}
              type="email"
              value={notifyTo}
              placeholder={view.clientEmail ? `Blank uses ${view.clientEmail}` : "An email address"}
              onChange={(e) => setNotifyTo(e.target.value)}
            />
          </div>

          <div className="mt-3">
            <label className={LABEL} htmlFor="rw-reply-to">
              Reply-to: the clinic&apos;s own address
            </label>
            <input
              id="rw-reply-to"
              className={INPUT}
              type="email"
              value={replyTo}
              placeholder="Where a patient's reply should land"
              onChange={(e) => setReplyTo(e.target.value)}
            />
          </div>

          <div className="mt-3">
            <label className={LABEL} htmlFor="rw-from-mailbox">
              Sent from
            </label>
            <select
              id="rw-from-mailbox"
              className={INPUT}
              value={fromMailbox}
              onChange={(e) => setFromMailbox(e.target.value)}
            >
              <option value="">
                {view.mailboxOptions[0] ? `${view.mailboxOptions[0]} (default)` : "Default"}
              </option>
              {view.mailboxOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-white/50">
              One of our own mailboxes, because that is all Microsoft will send as. The clinic
              cannot be the sender without its own sending domain, so it is the reply-to instead,
              and every message to a patient or a friend says we sent it on their behalf.
            </p>
          </div>
        </div>

        {/*
          ‼️ ONE GRID FOR SERVICES, PRICES AND DEALS, which is the same decision the printed setup
          sheet makes: on a call these are one pass down one list, and asking twice is how a ten
          minute call becomes twenty.
        */}
        <div className="mt-4">
          <p className={LABEL}>What a referred friend gets, per service</p>

          <div className="mb-2 flex gap-2">
            <input
              className={INPUT}
              value={fillAll}
              placeholder="Every friend gets..."
              onChange={(e) => setFillAll(e.target.value)}
            />
            <input
              className={INPUT}
              value={fillAllReferrer}
              placeholder="...and she gets"
              onChange={(e) => setFillAllReferrer(e.target.value)}
            />
            <button
              type="button"
              className="shrink-0 rounded border border-white/15 px-2 py-1.5 text-[11px] text-white/70 hover:border-white/30"
              onClick={applyToAll}
              disabled={!fillAll.trim() && !fillAllReferrer.trim()}
            >
              Apply to all
            </button>
          </div>

          {/* A header row, because four free-text boxes side by side are unreadable without one. */}
          <div className="mb-1 flex gap-2 text-[10px] uppercase tracking-widest text-[rgba(255,255,255,0.3)]">
            <span className="flex-1">Service</span>
            <span className="w-[6rem] shrink-0">Price</span>
            <span className="flex-1">Their friend gets</span>
            <span className="flex-1">She gets</span>
            <span className="w-[4.5rem] shrink-0" />
          </div>

          <div className="space-y-1">
            {offers.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  className={INPUT}
                  value={row.serviceLabel}
                  placeholder="Service"
                  onChange={(e) => editRow(i, { serviceLabel: e.target.value })}
                />
                <input
                  className={`${INPUT} max-w-[6rem]`}
                  value={row.priceLabel}
                  placeholder="Price"
                  onChange={(e) => editRow(i, { priceLabel: e.target.value })}
                />
                <input
                  className={INPUT}
                  value={row.offerText}
                  placeholder="What their friend gets"
                  disabled={row.excluded}
                  onChange={(e) => editRow(i, { offerText: e.target.value })}
                />
                <input
                  className={INPUT}
                  value={row.referrerOfferText}
                  placeholder="Optional"
                  disabled={row.excluded}
                  onChange={(e) => editRow(i, { referrerOfferText: e.target.value })}
                />
                <label className="flex w-[4.5rem] shrink-0 items-center gap-1 text-[10px] text-[rgba(255,255,255,0.45)]">
                  <input
                    type="checkbox"
                    checked={row.excluded}
                    onChange={(e) => editRow(i, { excluded: e.target.checked })}
                  />
                  no offer
                </label>
              </div>
            ))}
          </div>

          <button
            type="button"
            className="mt-2 text-[11px] text-white/50 underline hover:text-white/80"
            onClick={() =>
              setOffers((prev) => [
                ...prev,
                {
                  serviceLabel: "",
                  priceLabel: "",
                  offerText: "",
                  referrerOfferText: "",
                  excluded: false,
                },
              ])
            }
          >
            Add a service
          </button>

          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL} htmlFor="rw-default-offer">
                Default: what their friend gets
              </label>
              <input
                id="rw-default-offer"
                className={INPUT}
                value={defaultOffer}
                placeholder="When the service is not listed above"
                onChange={(e) => setDefaultOffer(e.target.value)}
              />
              <p className="mt-1 text-[11px] text-[rgba(255,255,255,0.45)]">
                Her words are matched against the service names above. Anything unmatched falls
                back to this, and with neither there is no referral question at all.
              </p>
            </div>
            <div>
              <label className={LABEL} htmlFor="rw-default-reward">
                Default: what she gets
              </label>
              <input
                id="rw-default-reward"
                className={INPUT}
                value={defaultReferrerOffer}
                placeholder="Optional"
                onChange={(e) => setDefaultReferrerOffer(e.target.value)}
              />
              <p className="mt-1 text-[11px] text-[rgba(255,255,255,0.45)]">
                Shown to her as &ldquo;once they book&rdquo;, never as a reward for the review.
                Leave it blank to reward only the friend.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/*
        ‼️ EVERY PANEL THAT STARTS SOMETHING PRINTS WHAT CAN BE DONE NEXT. Matthew's acceptance
        criterion, and the shape is step 15's card: the options, the preview, the live thing.
        A control that saves and then offers nothing is the bug being fixed.
      */}
      <div className="rounded border border-white/10 p-3 text-[11px] text-[rgba(255,255,255,0.55)]">
        <p className="mb-1 text-[rgba(255,255,255,0.75)]">Next</p>
        <ul className="space-y-1">
          {state.primaryMissingUrl && state.primary ? (
            <li>
              Ask them for their {state.primary.name} review link. It is the one they chose and
              the one box still empty.
            </li>
          ) : null}
          {view.previewUrl ? (
            <li>
              <a className="text-[#F5A623] underline" href={view.previewUrl}>
                Open the AI Referral Engine
              </a>{" "}
              and check the buttons are the ones you expect. Nothing typed there is stored.
            </li>
          ) : null}
          {view.reviewsHost ? (
            <li>
              Live at{" "}
              <a
                className="text-[#F5A623] underline"
                href={`https://${view.reviewsHost}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {view.reviewsHost}
              </a>
              , which is what the QR on the printed cards resolves to.
            </li>
          ) : (
            <li>No reviews host is attached yet, so the QR on the cards has nothing to open.</li>
          )}
          <li>
            Step {stepNumber("review_handover")} confirms on the mode above. Step{" "}
            {stepNumber("review_handover")} confirms on a handover to the named person, with
            the evidence in its own Slack thread.
          </li>
        </ul>
      </div>

      {error ? <p className="text-[11px] text-[#F87171]">{error}</p> : null}
      {notice ? <p className="text-[11px] text-[#4ADE80]">{notice}</p> : null}

      <button
        type="button"
        onClick={() => void save()}
        disabled={busy}
        className="rounded border border-white/15 px-3 py-1.5 text-[11px] text-white/80 hover:border-white/30 disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
