"use client";

// The AI Referral Engine, v2: the same mirror, wearing the Virtual Agent's clothes.
//
// ‼️ READ referral-engine-client.tsx FIRST. This file is the second rendering of a regulated
// surface, not a redesign of it. Everything that file refuses, this file refuses, and
// scripts/_probe-review-gating.ts now reads BOTH. What changed is the shell and the script: a
// panel that opens over the page instead of a column on it, six questions instead of four, and
// three yes/no gates that decide which of them get asked.
//
// ‼️ THE STARS BLOCK BELOW IS COPIED FROM referral-engine-client.tsx CHARACTER FOR CHARACTER.
// The probe subtracts five exact expressions from this file and fails on any surviving mention,
// and it now also fails if any of the five is MISSING, because subtraction alone passes on a file
// with no stars in it at all. Do not tidy that block, do not rename `n`, do not move the advance
// off the row and onto the buttons. It learns THAT she tapped and never WHICH.
//
// ‼️ THERE IS NO MODEL IN HERE EITHER, AND THE PANEL IS WHERE THAT GETS TESTED. It looks like the
// concierge widget on purpose, because Matthew wants one agent across a client's whole site. It
// shares the concierge's CLASS NAMES AND TOKEN NAMES and none of its code: the concierge is a
// model conversation on another origin, and this is a scripted walk of REVIEW_SCRIPT by index
// with no network round trip per turn. Wiring this to /api/concierge/turn would put a model in
// the path that assembles a customer's review, which is the one thing the build spec forbids
// outright. FTC 16 CFR Part 465, the Rytr fact pattern.
//
// ‼️ THERE IS NO MICROPHONE IN THIS FILE, AND ITS ABSENCE IS LOAD BEARING TWICE OVER.
//
// Removed 2026-09-24 on Matthew's call: the chatbot on its own is enough. What went with it was
// not just a button. SpeechRecognition, the recogniser refs, the composer mirror that existed
// only because onend fires outside React, and the getUserMedia call that primed the permission
// during the handover screen are all gone, because a page that asks to use a microphone it
// never touches is asking for access to nothing.
//
// So the rule the v1 file spends forty lines defending, that a customer's VOICE must never reach
// our servers because review_tool_submissions has nowhere to put an identity, is satisfied here
// by there being no audio path at all. Do not add one back without reading that header first:
// src/lib/clients/voice-notes.ts still has a working transcriber and it must stay unwired.
// ‼️ A GATE IS A BRANCH. Tapping Yes shows "Yes" in the transcript, because that is what a chat
// looks like, and puts the word nowhere else: not in `answers`, not in the stored row, not in the
// clipboard. See answerGate(), which is the only function that handles a chip and which the probe
// reads for exactly that.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CARRY_STRIDE,
  REVIEW_SHAPES,
  QUESTION_SET_VERSION_V6,
  assembleJoined,
  assemblePlain,
  isEmpty,
  type ReviewAnswers,
} from "@/lib/hub/review-assemble";
import {
  AGENT_NAME,
  CONNECTING_LINE,
  CONNECTING_MS,
  INVITE_REWARD_LINE,
  REVIEW_COUNT_WORD,
  VISIT_COUNT_WORD,
  REVIEW_SCRIPT,
  fillBusiness,
  fillOffer,
  fillReward,
  stepAfter,
} from "@/lib/hub/review-script";
import {
  DEFAULT_INVITE_MODE,
  INVITE_CHANNELS,
  INVITE_TEMPLATES,
  claimUrl,
  composeInvite,
  fillInvite,
  inviteCode,
  templateByKey,
  type InviteChannel,
  type InviteMode,
} from "@/lib/hub/referral-invite";

export interface ReviewDestination {
  key: string;
  label: string;
  url: string;
}


/**
 * What the clinic has agreed to give a referred friend.
 *
 * ‼️ NULL MEANS THE RECOMMEND QUESTION AND THE INVITE ARE NOT ASKED AT ALL. A clinic with no deal
 * on file must not be made to promise one: the invite step's copy says "we will send them X", so
 * with no X the honest walk is the one without it. The driver skips both steps rather than
 * rendering an empty promise, and a patient never sees a referral question the clinic cannot
 * honour at the desk.
 */
export interface ReferralConfig {
  /** One deal per service, as set on the onboarding call. Two sided since 2026-10-05. */
  offers: ReadonlyArray<{
    serviceLabel: string;
    /** What the referred friend gets. */
    offerText: string;
    /** What she gets, when the clinic rewards her at all. */
    referrerOfferText?: string | null;
  }>;
  /** Used when she names a service that is not on the list, or names nothing recognisable. */
  defaultOffer: string | null;
  /** Her reward, when the service she named carries none of its own. */
  defaultReferrerOffer?: string | null;
  /**
   * The two-for-one she is offered for a SECOND friend, and null means she is not asked for one.
   *
   * ‼️ CLINIC-WIDE AND IN THE BAG, NOT A COLUMN ON client_service_offers. Matthew,
   * 2026-10-07: "after they referred one friend we tell them if they add a 2nd friend we give them
   * an extre offer. 2x1 so you can come with that friend and get X together, this way you get both
   * in at the same time a 2nd time and you can upsell other stuff." That is a deal about a VISIT,
   * two people through the door at once, not a deal about the service she happened to name, so it
   * is one value per clinic and belongs beside default_offer in clients.review_workflow. It also
   * means no migration: a column would have made the whole offers select fail until the SQL ran,
   * which would silently drop every per-service deal in the meantime.
   *
   * ‼️ AND NULL REALLY MEANS NOT ASKED. Exactly like defaultOffer: a clinic that has not
   * agreed a two-for-one must not have one invented for it, because the argument lands at the
   * front desk with two people standing there.
   */
  defaultPairOffer?: string | null;
  /** The clinic's number, so the text she sends has them on the thread. */
  clinicPhone: string | null;
  /** The host the claim link is built on. Null falls back to this app's origin. */
  reviewsHost?: string | null;
  /**
   * Which of the two shapes this clinic runs.
   *
   * ‼️ IT CHANGES ONLY WHO PUTS THE LINK IN FRONT OF THE FRIEND, never what the patient is asked.
   * Both record the same row and mint the same link, which is what makes the two comparable on
   * the same clinic without re-teaching the front desk.
   */
  mode?: InviteMode;
}

interface Props {
  businessName: string;
  /** "Miami, FL". Rendered under the clinic's name on the opening card; omitted when unknown. */
  location?: string | null;
  clientId: string;
  destinations: ReviewDestination[];
  needsSpanish: boolean;
  referral?: ReferralConfig | null;
}

const BUBBLE_GAP_MS = { min: 400, max: 900 } as const;

/**
 * The two panels, in the order they appear on screen.
 *
 * ‼️ THE RETOUCHED ONE IS FIRST IN v8 AND HERS WAS FIRST IN v7. THE REVERSAL WAS DELIBERATE.
 * v7's comment here read: "HERS IS FIRST AND THAT IS NOT A LAYOUT PREFERENCE. First and selected
 * is the version she typed; the joined one sits beside it as the option. Reversing this array
 * would put our joined draft in the reading position and make hers the alternative, which is the
 * same product as a tidy-up button with extra steps."
 *
 * Matthew, 2026-10-13: "I want them to see original, and retouched version so they can copy the
 * retouched only. and modify if they want in that same box where the retouched is".
 *
 * ‼️ WHAT SURVIVES OF THE OLD RULE IS THE MITIGATION AND IT IS LOAD BEARING. v7's fear was a tool
 * that replaces her words and hopes she does not mind. Three things stop that being what this is,
 * and all three are on this screen rather than in a comment: the original is beside it, always,
 * unedited and visible, so the difference is shown rather than remembered; the retouched box is
 * fully editable, so her exact words are one deletion away; and she ticks an attestation before
 * the clipboard will take anything. What she cannot do any more is COPY the unjoined one, which
 * is the single thing he asked to change.
 *
 * ‼️ THE LABELS CLAIM EXACTLY WHAT THE CODE DOES AND NOT A WORD MORE. "Joined into sentences" is
 * true of assembleJoined: every word it inserts is in CARRIES, and every content word of those is
 * in the question she answered. "Tidied", "improved", "better" or "polished" would be us
 * advertising a rewrite we do not perform and must never perform.
 */
const VERSIONS = [
  { key: "joined", name: "Your review", note: "Your answers, joined into sentences" },
  { key: "hers", name: "What you typed", note: "Your answers exactly as you wrote them" },
] as const;

type Stage = "intro" | "connecting" | "chat";
/**
 * What the composer is waiting for.
 *
 * ‼️ `gate` AND `refer` ARE SEPARATE ARMS FOR A REASON THAT IS NOT COSMETIC. They render the same
 * pair of chips, but a gate is answered by answerGate() and the recommend question by
 * answerRefer(), and the gating probe reads answerGate() as a whole function and fails on
 * `setAnswers`, `store(`, `destinations`, `rating`, `privateNote`, `rev-private` or
 * `setRevealed` appearing anywhere inside it. Routing the referral through that one function
 * would have meant widening it to touch referral state, which is exactly the widening the probe
 * exists to catch.
 */
type Awaiting = "none" | "text" | "gate" | "stars" | "refer" | "invite";

/**
 * A control set she has already answered, kept in the transcript.
 *
 * ‼️ IT IS A RECORD OF A CHOICE, NOT A CONTROL. Matthew, 2026-10-13: "you remove the whole texting
 * buttons after we finish it, make them part as the conversation but gray out the options that
 * they didnt pick leaving the button dead but visible in the history". Before this the live
 * controls simply vanished when the step completed, so the transcript lost the fact that she had
 * been asked anything at all, and a chat that shows her answers but not the questions reads as
 * half a conversation.
 *
 * ‼️ AND NOTHING HERE IS AN ANSWER IN THE SENSE THAT MATTERS. These strings are chip LABELS, ours,
 * and the rule they sit under has not moved: a chip's text may never become review text. This is
 * display. `_probe-review-gating.ts` separately asserts that no "Yes" is assignable to
 * ReviewAnswers, and nothing below changes what reaches the clipboard.
 */
interface AnsweredChips {
  /** What she was asked, in her own transcript's voice. */
  label: string;
  /** Every option she was shown, in the order she saw them. */
  options: readonly string[];
  /** The one she picked. Rendered solid; the rest are greyed and dead. */
  chosen: string;
}

interface Bubble {
  id: number;
  from: "them" | "her";
  text: string;
  /** Present instead of `text` when this entry records a control set she answered. */
  chips?: AnsweredChips;
  /**
   * Present instead of `text` when this entry records a block she was SHOWN and acted on.
   *
   * ‼️ THE MESSAGE SHE COPIED IS THE ONE THAT MATTERS AND IT USED TO VANISH. Matthew, 2026-10-13:
   * "after we click copy the message it gets rid of the original message i need all of it to stay
   * and just gray out and continue the conversation no dissappearing." The preview lived inside
   * the `send` phase, so advancing to the hand-off took it off the screen, and the one thing she
   * might want to re-read while pasting into another app was the thing we had just removed.
   */
  quote?: { label: string; body: string };
}

export function VirtualAgentClient({
  businessName,
  location = null,
  clientId,
  destinations,
  needsSpanish,
  referral = null,
}: Props) {
  const [answers, setAnswers] = useState<ReviewAnswers>({});

  /**
   * Which wording the carries use. Regenerate advances it.
   *
   * ‼️ IT IS A WORDING INDEX AND IT IS NOT THE RATING, AND THE DISTANCE BETWEEN THOSE TWO IS THE
   * WHOLE OF WHY THIS IS ALLOWED TO EXIST. It starts at 0 for everybody, it moves only when she
   * presses the button, and nothing about the clinic, the stars or the answers can move it.
   * Offering a better-reading review to five stars and not to two is review shaping with a nicer
   * name; `rating` must never appear in this, in the panel below, or in assembleJoined, and
   * _probe-review-v7.ts asserts all three.
   */
  /**
   * ‼️ RANDOM PER WALK, NOT 0, AND THIS IS THE HALF THAT ACTUALLY BREAKS THE PATTERN. A table of
   * 54 shapes is worth nothing if every patient starts on the same one, and before this they did:
   * everybody who never pressed Regenerate got the identical skeleton, so a clinic's profile would
   * have filled with reviews whose full stops and commas landed in the same places. See
   * CARRY_COMBINATIONS in review-assemble.ts for his words on it.
   *
   * ‼️ A LAZY useState INITIALISER, NOT Math.random() IN THE RENDER BODY, and not a ref either.
   * This component is server rendered before it hydrates; a random value computed during render
   * would be computed twice and disagree, which is the hydration mismatch the invite code's own
   * docstring was written about. It is safe here for the additional reason that the seed is only
   * ever READ inside the review step, which renders when `revealed` is true and is therefore never
   * part of the server's output.
   *
   * ‼️ AND THE RANDOMNESS IS IN THE COMPONENT, NEVER IN review-assemble.ts. That module stays pure
   * and deterministic: the same answers and the same variant always produce the same string, which
   * is what lets the probe sweep all 54 shapes over fixtures. A module that rolled its own dice
   * could not be tested at all.
   */
  const [variant, setVariant] = useState(() => Math.floor(Math.random() * REVIEW_SHAPES));

  /**
   * How many times she pressed Regenerate. Counted, never routed.
   *
   * Separate from `variant` because that one cycles: with three wordings, four presses leaves it
   * at 1. This is the press count, which is the thing worth knowing. A high number across many
   * patients means our connectives read badly, which is a fact about us.
   */
  const [regenerateCount, setRegenerateCount] = useState(0);

  /**
   * Her wording from before the last press of "Try another wording", or null.
   *
   * ‼️ THIS EXISTS SO THE BUTTON CAN BE PERMANENT. The previous design withdrew the button once
   * she had edited the box, on the grounds that regenerating would discard what she wrote. The
   * reasoning was right and the remedy was wrong: it protected her text by removing the feature,
   * and Matthew hit exactly that on 2026-10-16, wanting to shuffle a review he had already
   * touched and finding the control gone. Keeping what it would have overwritten is the answer
   * that costs her nothing.
   */
  const [undoable, setUndoable] = useState<string | null>(null);

  /**
   * Her edits to the retouched box. `null` means she has not touched it.
   *
   * ‼️ null IS LOAD BEARING AND NOT MERELY AN EMPTY VALUE. It is what Regenerate checks: once she
   * has edited the box, pressing it again would silently throw away what she wrote, so the button
   * is replaced by a line telling her the wording is hers now. See the panel below.
   *
   * ‼️ AND THERE IS NO SECOND BUFFER ANY MORE. v7 kept `edited` beside this one because both
   * panels were editable and switching between them had to be non-destructive. The original panel
   * is read-only in v8, so it has nothing to keep and a buffer for it would be a buffer nothing
   * can ever fill.
   */
  const [editedJoined, setEditedJoined] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [submissionId, setSubmissionId] = useState<string | null>(null);

  // ───────────────────────────────────────────────────────────────────────────
  // ‼️ THE FIVE EXPRESSIONS. Identical to referral-engine-client.tsx, and for the same reason:
  // scripts/_probe-review-gating.ts removes these five strings from this file byte for byte and
  // then fails if the word survives anywhere else. Every value 1 to 5 walks the identical path
  // to the identical button.
  //
  //     const [rating, setRating] = useState<number | null>(null)
  //     aria-checked={rating === n}
  //     className={rating !== null && n <= rating ? "is-on" : undefined}
  //     onClick={() => setRating(n)}
  //     rating,
  // ───────────────────────────────────────────────────────────────────────────
  const [rating, setRating] = useState<number | null>(null);
  const [starsAnswered, setStarsAnswered] = useState(false);
  const [privateNote, setPrivateNote] = useState("");
  const [attested, setAttested] = useState(false);

  // ── The referral ───────────────────────────────────────────────────────────
  //
  // ‼️ A SEPARATE BAG FROM `answers`, AND THE SEPARATION IS THE DEFENCE. Nothing here is a
  // ReviewQuestion key, so none of it is assignable to ReviewAnswers, iterable by
  // assembleLabelled or assemblePlain, storable by the submit route's answers loop, or reachable
  // from the clipboard. The friend's name and number in particular are a third party's details
  // and they go to referral_invites, never to review_tool_submissions.
  const [friendName, setFriendName] = useState("");
  const [friendContact, setFriendContact] = useState("");
  const [templateKey, setTemplateKey] = useState(INVITE_TEMPLATES[0].key);
  const [inviteSent, setInviteSent] = useState(false);
  /**
   * The invite in three beats, which is Matthew's sequence of 2026-10-05.
   *
   * ‼️ IT IS THREE SCREENS BECAUSE ONE SCREEN ASKED TOO MUCH AT ONCE. The step used to open with
   * two text fields, a contacts button, three wording chips, a message preview and three send
   * buttons, all at a counter with somebody waiting. His fix: tell her to go and get the number,
   * let her leave, and ask for it only once she is back.
   *
   * `instruct` go and find it, press Done when you have it
   * `confirm`  did you actually copy it? A No goes back rather than forward
   * `enter`    paste it, and nothing else on screen
   * `send`     now pick the wording, read it, and send it
   *
   * ‼️ `send` SPLIT OFF `enter` ON 2026-10-07 AND THE SPLIT IS THE WHOLE FIX. `enter` had
   * grown back into the wall this three-beat sequence was built to undo: two inputs, a contacts
   * link, an optional email, three wording chips, a message preview, three send buttons and a
   * skip, all at once. Matthew: "after they click in yes when they actually copied the number just
   * leave a space for them to paste the number in the conversation and then we just keep the chat
   * as regular." So `enter` is now one box and a Next, like every other question in the walk, and
   * everything about the message happens after she has answered it.
   *
   * ‼️ THE CONFIRM STEP IS NOT A NAG. She has just come back from another app, which on a phone
   * means this page may have been unloaded and restored; asking is how she finds out whether the
   * thing she copied survived, before she is looking at an empty box wondering what she did wrong.
   */
  /**
   * ‼️ "handoff" IS NEW IN v8 AND IT IS WHERE SHE ACTUALLY SENDS THE MESSAGE. Before it, "Copy the
   * message" copied and the step ended, which left her holding a clipboard on a screen that had
   * moved on. He asked for her to be held in frame: copy, then "open your texting app and paste...
   * come back when you are finished", then a Done button she presses herself.
   *
   * ‼️ AND "Done" IS NOT A DELIVERY CONFIRMATION. We are not the sender and cannot be: see the
   * module header in referral-invite.ts. It advances the walk and it is recorded as "she got as
   * far as her own keyboard", which is exactly what referral_invites.sent_at's comment already
   * says it means. Nothing here may claim her friend received anything.
   */
  const [invitePhase, setInvitePhase] = useState<
    "instruct" | "confirm" | "enter" | "send" | "handoff"
  >("instruct");
  const [inviteError, setInviteError] = useState<string | null>(null);
  /**
   * The invite code for this visit. One friend, one code.
   *
   * ‼️ THE SECOND FRIEND WAS DROPPED ENTIRELY ON 2026-10-13, HIS CALL, AND THE REASON IT IS A
   * CLEAN DELETION RATHER THAN A LOSS IS WORTH WRITING DOWN. Round two existed to spend a
   * two-for-one deal, and its only exit was a "That is enough" button. He asked for that button to
   * go. Removing the button without removing the round would have trapped her in a loop she had
   * opted into, with the rest of the walk behind it; removing the round removes the need for the
   * exit. One friend per visit.
   *
   * What v7's comment here argued still holds and is now enforced by there being no mechanism:
   * "A loop that kept offering would be this tool pressing somebody who has already said yes
   * twice, at a counter, which is the one thing the whole handover was shaped to avoid."
   *
   * ‼️ clients.review_workflow.referral_offer.default_pair_offer IS LEFT ALONE IN THE CONFIG AND
   * IN referral-config.ts. It is simply no longer read here. Ripping a key out of a bag a clinic
   * may already have filled in is a separate decision from not asking a second time.
   *
   * A lazy useState initialiser rather than a ref assigned during render: this component is
   * server rendered before it hydrates, and a ref written in the render body would be computed
   * on both sides from Math.random and disagree. useState's initialiser runs once per mount on
   * the client, which is the only place the code is ever read.
   */
  const [code] = useState(() => inviteCode());

  // ── The walk ───────────────────────────────────────────────────────────────
  const [stage, setStage] = useState<Stage>("intro");
  const [index, setIndex] = useState(0);
  const [awaiting, setAwaiting] = useState<Awaiting>("none");
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [typing, setTyping] = useState(false);
  const [composed, setComposed] = useState("");
  const aliveRef = useRef(false);

  const bubbleId = useRef(0);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const played = useRef<Set<number>>(new Set());
  const endRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    aliveRef.current = true;
    const pending = timers.current;
    return () => {
      aliveRef.current = false;
      for (const t of pending) clearTimeout(t);
    };
  }, []);

  // ‼️ `lead: true` IS WHAT MAKES THIS THE v5 ASSEMBLY, and it is passed here rather than inferred
  // inside assemblePlain so that "which flow is this" stays a decision somebody wrote down. v1
  // calls the same function with no options and is untouched. See the lead-line banner in
  // review-assemble.ts for the two words of ours that this puts in her review and why.
  const assembled = useMemo(() => assemblePlain(answers, { lead: true }), [answers]);

  /**
   * ‼️ COMPUTED ALONGSIDE HERS AND NEVER INSTEAD OF IT. Both exist on every render, both are on
   * the screen, and the difference between them is a thing she can see rather than a thing she is
   * told about. assembleJoined takes answers and a wording index and nothing else: no rating, no
   * client, no business name, no destination. See the banner in review-assemble.ts.
   */
  const joined = useMemo(() => assembleJoined(answers, variant), [answers, variant]);

  /** The original, read-only. No edit buffer, because nothing can edit it. */
  const hersText = assembled;

  /**
   * What the copy button copies and the attestation covers.
   *
   * ‼️ ONE VARIABLE FOR BOTH, SO WHAT SHE APPROVED IS WHAT REACHES HER CLIPBOARD BY CONSTRUCTION.
   * The alternative shape, where the box on screen is separate from the string the button reads,
   * is how a tool ends up copying something she never saw.
   */
  const text = editedJoined ?? joined;
  const nothingTyped = isEmpty(answers);

  /**
   * Where "Copy and go" takes her.
   *
   * ‼️ destinationsFor() ALREADY PUTS THE CLINIC'S CHOSEN PLATFORM FIRST, so this is their
   * decision and not ours: `review_destination_primary`, then the rest in declaration order. Null
   * when the clinic has configured no link at all, which the launch lane is supposed to prevent.
   */
  const primaryDestination = destinations[0] ?? null;

  /**
   * Another wording for our connecting words. Hers never move.
   *
   * ‼️ IT RE-RUNS A PURE FUNCTION OVER A TABLE OF LITERALS. No network, no model, no request. All
   * it changes is which entry of CARRIES each key uses, and every entry is fenced by
   * _probe-review-v7.ts section 1b to the words of the question that key asked. Pressing it
   * cannot reach a word she did not type and the question did not contain.
   *
   * ‼️ AND IT CANNOT SOFTEN A COMPLAINT, WHICH IS THE ONE THING A "TRY AGAIN" BUTTON MUST NOT DO.
   * An answer holding a conjunction is never carried at all, so "a bit sore and the wait was long"
   * is byte identical at every index. Fixture 4 asserts exactly that, at every index.
   */
  const regenerate = () => {
    // ‼️ HER EDIT IS PUT SOMEWHERE RECOVERABLE BEFORE IT IS REPLACED, AND THAT IS WHAT LETS THE
    // BUTTON STAY. See the panel below for the whole argument: the rule this replaces hid the
    // button after her first edit, which protected her text by taking the feature away.
    // `editedJoined` is null when she has not touched the box, and then there is nothing to
    // recover and no Undo is offered.
    setUndoable(editedJoined);
    if (editedJoined !== null) setEditedJoined(null);

    setVariant((at) => (at + CARRY_STRIDE) % REVIEW_SHAPES);
    // ‼️ A SEPARATE COUNTER, BECAUSE `variant` WRAPS AND WOULD BE A WRONG NUMBER. With three
    // wordings, four presses leaves `variant` at 1. Storing that as "how many wordings she tried"
    // would under-report every patient who went round more than once, and a metric that is wrong
    // in one direction only is worse than no metric.
    setRegenerateCount((n) => n + 1);
    setCopied(false);
  };

  /**
   * Put her own wording back after a press she did not mean.
   *
   * ‼️ ONE PRESS, NO DIALOG, AND NOTHING IS EVER LOST SILENTLY. A confirm box on a patient-facing
   * walk at a counter is friction she did not ask for, and "are you sure" is a worse answer than
   * "here it is back". Offered only when there is an edit of hers to restore.
   */
  const undoRegenerate = () => {
    if (undoable === null) return;
    setEditedJoined(undoable);
    setUndoable(null);
    setCopied(false);
  };

  /**
   * The deal for the service she named.
   *
   * ‼️ MATCHED ON WHAT SHE TYPED, FALLING BACK TO THE CLINIC-WIDE DEAL, AND NEVER INVENTED. The
   * match is deliberately loose in one direction only: her words have to CONTAIN the service
   * label or the label has to contain her words, so "botox" finds "Botox" and "lip filler" finds
   * "Lip filler". Anything it cannot place gets `defaultOffer`, and with no default there is no
   * referral step at all. A wrong deal shown to a patient is a discount the front desk then has
   * to argue about with her friend at the counter, so absent beats wrong here exactly as it does
   * for destination links.
   */
  const resolvedOffer = useMemo(() => {
    if (!referral) return { friend: null as string | null, referrer: null as string | null };
    const said = (answers.service ?? "").trim().toLowerCase();
    if (said) {
      const hit = referral.offers.find((o) => {
        const label = o.serviceLabel.trim().toLowerCase();
        return label.length > 0 && (said.includes(label) || label.includes(said));
      });
      if (hit) {
        return {
          friend: hit.offerText,
          // Her reward falls back to the clinic-wide one independently of the friend's, because a
          // clinic commonly sets a per-service deal for the friend and one flat thank-you for her.
          referrer: hit.referrerOfferText ?? referral.defaultReferrerOffer ?? null,
        };
      }
    }
    return { friend: referral.defaultOffer, referrer: referral.defaultReferrerOffer ?? null };
  }, [referral, answers.service]);

  const offerText = resolvedOffer.friend;
  const referrerOffer = resolvedOffer.referrer;
  // ‼️ THE TWO-FOR-ONE AND THE SECOND-FRIEND ASK WERE DELETED HERE, 2026-10-13. What stood here
  // was `pairOffer` (read from review_workflow.referral_offer.default_pair_offer) and
  // `canOfferSecond`, with this argument attached to it: "ASKED ONLY AFTER A FIRST INVITE ACTUALLY
  // WENT, AND ONLY WHERE THERE IS A DEAL. Not after a skip: she declined to send one, and
  // following that with a better deal for sending two is haggling."
  //
  // That reasoning was sound and the ask is gone anyway, because he asked for the "That is enough"
  // exit to go and the round cannot survive without it. See the `code` docstring above.
  //
  // The config key and the column are untouched. referral-config.ts still reads
  // default_pair_offer into the config object; nothing on this screen consumes it.

  /**
   * Whether the referral half of the walk happens at all.
   *
   * ‼️ IT TURNS ON THE FRIEND'S DEAL AND NOT ON HERS. A clinic that rewards only the friend runs
   * the full referral; a clinic that somehow set only her reward has nothing to put in the
   * message, so there is nothing to ask. The friend's offer is the one the invite copy promises.
   */
  const referralOn = Boolean(referral && offerText);

  const inviteMode: InviteMode = referral?.mode ?? DEFAULT_INVITE_MODE;

  /** Where the friend claims it. Minted from the code so the preview and the row agree. */
  const link = useMemo(
    () =>
      claimUrl(
        referral?.reviewsHost ?? null,
        code,
        typeof window === "undefined" ? "" : window.location.origin
      ),
    [referral?.reviewsHost, code]
  );

  const later = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms);
    timers.current.push(t);
    return t;
  }, []);

  const push = useCallback((from: Bubble["from"], body: string) => {
    bubbleId.current += 1;
    const id = bubbleId.current;
    setBubbles((prev) => [...prev, { id, from, text: body }]);
  }, []);

  /**
   * Keep an answered control set in the transcript, greyed and dead.
   *
   * ‼️ ITS OWN FUNCTION, DELIBERATELY, AND THE REASON IS A PROBE AND NOT TASTE.
   * `scripts/_probe-review-gating.ts` cuts `answerGate()` and `answerRefer()` out of this file by
   * name and fails the build if `rev-private`, `privateNote`, `setRevealed`, `destinations`,
   * `rating`, `store(` or `setAnswers` appears inside either of them. Those two handlers must stay
   * small enough to read in one go, because what they are NOT allowed to do is the whole point of
   * them. Transcript bookkeeping lives here instead of being inlined there.
   *
   * ‼️ AND IT CARRIES NO VALUE THE WALK CAN READ BACK. It writes to `bubbles`, which nothing
   * stores, nothing assembles and nothing posts: store() sends `answers`. A greyed chip is a thing
   * she can see and nothing else can use.
   */
  const pushChips = useCallback((label: string, options: readonly string[], chosen: string) => {
    bubbleId.current += 1;
    const id = bubbleId.current;
    setBubbles((prev) => [...prev, { id, from: "her", text: chosen, chips: { label, options, chosen } }]);
  }, []);

  /**
   * Keep a block she was shown in the transcript, greyed and dead.
   *
   * Same rule as pushChips and the same reason it is its own function: `bubbles` is display, and
   * nothing stores, assembles or posts it. What it holds here is the message SHE is about to send
   * from her own phone, which is the one thing she may want to re-read while pasting it somewhere
   * else, and which used to be removed from the screen at exactly that moment.
   */
  const pushQuote = useCallback((label: string, body: string) => {
    bubbleId.current += 1;
    const id = bubbleId.current;
    setBubbles((prev) => [...prev, { id, from: "her", text: body, quote: { label, body } }]);
  }, []);

  /**
   * Play the step at `index`, then either advance or wait for her.
   *
   * ‼️ THE PAUSE IS NOT A LOADING STATE. Nothing is fetched and nothing is generated; the whole
   * script is in the bundle. Three dots, never a sentence claiming something is thinking, because
   * nothing is thinking.
   */
  useEffect(() => {
    if (stage !== "chat") return;
    if (played.current.has(index)) return;
    const current = REVIEW_SCRIPT[index];
    if (!current) return;
    played.current.add(index);

    // ‼️ THE REFERRAL STEPS SKIP SILENTLY WHEN THERE IS NO DEAL ON FILE, with no bubble and no
    // pause, so a clinic that has not set its offers up walks the review questions it has always
    // walked. played.current already guards against this running twice. See ReferralConfig.
    if ((current.kind === "refer" || current.kind === "invite") && !referralOn) {
      setIndex((i) => i + 1);
      return;
    }

    setTyping(true);
    const gap = index === 0 ? BUBBLE_GAP_MS.min : BUBBLE_GAP_MS.max;
    later(() => {
      setTyping(false);
      if (current.kind === "say") {
        push("them", fillBusiness(current.text, businessName));
        setIndex((i) => i + 1);
        return;
      }
      // The invite's prompt is the one line that carries the deal. fillOffer runs after
      // fillBusiness so neither substitution can reach into the other's output, and her own
      // reward is APPENDED rather than templated into the prompt, because a clinic that rewards
      // only the friend must render no sentence about hers at all.
      const prompt =
        current.kind === "invite"
          ? [
              fillOffer(fillBusiness(current.prompt, businessName), offerText ?? ""),
              referrerOffer ? fillReward(INVITE_REWARD_LINE, referrerOffer) : "",
            ]
              .filter(Boolean)
              .join(" ")
          : fillBusiness(current.prompt, businessName);
      push("them", prompt);
      setAwaiting(
        current.kind === "gate"
          ? "gate"
          : current.kind === "refer"
            ? "refer"
            : current.kind === "stars"
              ? "stars"
              : current.kind === "invite"
                ? "invite"
                : "text"
      );
    }, gap);
  }, [stage, index, businessName, push, later, referralOn, offerText, referrerOffer]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [bubbles, typing]);

  // Focus moves into the panel when it opens, so a screen reader and a keyboard both land on the
  // conversation rather than back at the top of the page.
  //
  // ‼️ THE BODY SCROLL LOCK WENT WITH THE OVERLAY ON 2026-10-06. It existed because the panel was
  // fixed over the page and a phone keyboard would otherwise scroll the page UNDER it. The panel
  // is in the frame now, in normal flow, so locking the body stops somebody scrolling the very
  // page the panel is part of.
  useEffect(() => {
    if (stage === "intro" || revealed) return;
    panelRef.current?.focus({ preventScroll: true });
  }, [stage, revealed]);

  /**
   * Leave the stars and hand over to the agent.
   *
   * ‼️ NO PERMISSION IS ASKED FOR HERE ANY MORE, AND THE ABSENCE IS THE POINT. Until
   * 2026-09-24 this called getUserMedia inside the click so the browser would show its box while
   * the handover screen was up, because the next screen had a microphone on it. Matthew removed
   * the microphone: the keyboard is enough. A page that asks to use a device it then never
   * touches is asking for access to nothing, which is the same objection the v1 file already
   * makes about showing a priming screen where SpeechRecognition does not exist.
   *
   * There is no getUserMedia, no SpeechRecognition and no MediaRecorder in this file, so there is
   * nothing to prime, nothing to stop and nothing to delete afterwards.
   */
  function leaveIntro() {
    setStage("connecting");
    later(() => {
      if (aliveRef.current) setStage((s) => (s === "connecting" ? "chat" : s));
    }, CONNECTING_MS);
  }

  /** Her answer to the question that is open. */
  function commit(value: string) {
    const current = REVIEW_SCRIPT[index];
    if (!current || current.kind !== "ask") return;
    const body = value.trim();
    if (body) {
      push("her", body);
      setAnswers((prev) => ({ ...prev, [current.key]: body }));
      // ‼️ HER EDITS TO THE REVIEW BOX ARE NOT RESET HERE, AND THAT IS THE SAME RULE v7 HAD.
      // v7 cleared `edited` at this point, because answering another question re-assembled HER
      // version and an edit buffer over it would have gone stale. There is no such buffer now:
      // the original panel is read-only and recomputes from `answers` on its own. `editedJoined`
      // is deliberately left alone, because it holds words she typed into the review box and
      // answering a later question is not a reason to throw them away.
      setCopied(false);
      // ‼️ THE PROGRESS WRITE, AND THIS IS THE ONLY REASON AN ABANDONED WALK EXISTS AT ALL.
      // Before 2026-10-13 the row appeared only at reveal(), so somebody who answered two
      // questions and put the phone down was in no table and "where do we lose people" could not
      // be answered. The answer she just gave is passed explicitly: setAnswers has not flushed
      // yet when this runs, so reading `answers` here would store the state one question behind.
      void store({ alsoAnswer: { key: current.key, value: body } });
    }
    setComposed("");
    setAwaiting("none");
    setIndex((i) => i + 1);
  }

  /**
   * A yes/no chip, and everything it is not allowed to do.
   *
   * ‼️ IT ADVANCES THE WALK. That is the entire function. It does not store, does not reveal,
   * does not touch the private note, does not read the stars and does not write a word into
   * `answers`. The chip's label goes into the TRANSCRIPT, because a chat that does not show what
   * she tapped is not a chat, and the transcript is not what gets copied.
   *
   * ‼️ A No SKIPS THE ONE QUESTION THE GATE GUARDS AND NOTHING ELSE. stepAfter() counts forward
   * and has no destination table, so there is nowhere for "and if she says no, show her the
   * private box instead" to be added without rewriting it. That sentence is the review gating
   * funnel, prohibited by Google's Business Profile policy and reachable by the FTC as
   * suppression under 16 CFR Part 465.
   */
  function answerGate(saidYes: boolean) {
    const current = REVIEW_SCRIPT[index];
    if (!current || current.kind !== "gate") return;
    pushChips(current.prompt, [current.yes, current.no], saidYes ? current.yes : current.no);
    setAwaiting("none");
    setIndex(stepAfter(index, saidYes));
  }

  /**
   * The stars, answered inside the walk.
   *
   * ‼️ IT ADVANCES AND NOTHING ELSE, which is the same promise answerGate() makes. The value is
   * already in state by the time this runs (the row's own onClick put it there, unchanged from
   * the five pinned expressions); this function does not read it, and must not. A branch here on
   * what she tapped would be review gating with the branch moved one function along.
   *
   * ‼️ AND THE STARS ARE DELIBERATELY LEFT OUT OF THE GREYED-TRANSCRIPT WORK, 2026-10-13. This is
   * an exclusion with a reason, not a row somebody forgot.
   *
   * The gates, the message-style chips and the send buttons all keep an answered copy of
   * themselves in the transcript now (see pushChips). The star row cannot join them without
   * reading `rating` to know which star to render solid, and `_probe-review-gating.ts` section 1
   * subtracts five exact `rating` expressions from this file and fails on any residue, section 1b
   * requires all five present byte for byte, and one of the five is the literal
   * `onClick={() => setRating(n)}`. So a greyed star row means either a sixth read of `rating` or
   * an edit to a pinned expression, and both fail the build.
   *
   * That probe is the FTC rail on this surface: it is what proves no path behaves differently for
   * a 1 than for a 5. His ask named the texting buttons. Trading the rail for a cosmetic row would
   * be the wrong way round, so the stars simply advance as they always did. If he wants them in
   * the history, the honest route is a sixth allowed expression added to that probe WITH the
   * argument written beside it, in its own commit.
   */
  function leaveStars() {
    if (!starsAnswered) return;
    setAwaiting("none");
    setIndex((i) => i + 1);
    // ‼️ IT STILL DOES NOT READ WHAT SHE TAPPED. store() sends `rating` because the column exists
    // and has since 2026-09-04; this function neither reads it nor branches on it, and the five
    // pinned `rating` expressions in this file are unchanged. What it records is that she got
    // PAST the stars, which is a step and not a score.
    void store();
  }

  /**
   * "Would you recommend this service to a friend?"
   *
   * ‼️ A No TAKES NOTHING AWAY. It skips the invite and lands on the review questions, which is
   * where a Yes lands too once she is done inviting. She reaches the same editable box, the same
   * attestation, the same copy button and the same destination links either way, and that is the
   * whole reason this question is allowed to exist at all: review-assemble.ts banned it precisely
   * because an NPS question in front of a review is normally the pre-screen that decides who is
   * shown the public link. Here it decides who is offered a referral deal.
   *
   * ‼️ AND IT IS NOT answerGate(). Read the Awaiting docstring for why that matters to the probe.
   */
  function answerRefer(saidYes: boolean) {
    const current = REVIEW_SCRIPT[index];
    if (!current || current.kind !== "refer") return;
    pushChips(current.prompt, [current.yes, current.no], saidYes ? current.yes : current.no);
    setAwaiting("none");
    setIndex(stepAfter(index, saidYes));
  }

  /** The message she is about to send, previewed exactly as it will open. */
  const inviteMessage = useMemo(
    () =>
      fillInvite(templateByKey(templateKey).body, {
        friendName: friendName.trim() || "there",
        businessName,
        serviceLabel: (answers.service ?? "").trim(),
        // ‼️ THE FRIEND'S DEAL ONLY. Hers is never in this message: a friend reading "and she gets
        // 20% off for sending you this" is being told they are the mechanism of somebody else's
        // discount. fillInvite has no token for it.
        offerText: offerText ?? "",
        link,
      }),
    [templateKey, friendName, businessName, answers.service, offerText, link]
  );

  /**
   * Open the composed message on her phone, then move on.
   *
   * ‼️ NOTHING IS SENT FROM HERE. composeInvite returns an href or a clipboard payload; her own
   * messages app does the sending and she has to press the button in it. There is no fetch in
   * this function beyond recording that the invite happened, which is a write about the clinic's
   * referral and not a message to anybody.
   */
  function openInvite(channel: InviteChannel) {
    setInviteError(null);
    const result = composeInvite({
      channel,
      friendContact,
      clinicContact: referral?.clinicPhone ?? null,
      message: inviteMessage,
    });

    if (result.kind === "unavailable") {
      setInviteError(result.reason);
      return;
    }
    // ‼️ THE TWO ANSWERED CHIP ROWS GO INTO THE TRANSCRIPT HERE, AND THIS IS THE LAST MOMENT BOTH
    // ARE STILL TRUE. The style row and the channel row both disappear with the `send` phase, and
    // his ask was that they stay in the history with the unpicked options greyed. Recorded in the
    // order she answered them: she chose the wording first, then how to send it.
    pushChips(
      "Select message style",
      INVITE_TEMPLATES.map((t) => t.label),
      templateByKey(templateKey).label
    );
    // ‼️ IN THE ORDER SHE MET THEM: the wording she chose, the message that wording produced, then
    // how she sent it. The message is the block that used to disappear at this exact moment.
    if (inviteMode === "text") pushQuote("The message you copied", inviteMessage);
    pushChips(
      "How to send it",
      INVITE_CHANNELS.map((c) => c.label),
      INVITE_CHANNELS.find((c) => c.key === channel)?.label ?? channel
    );

    if (result.kind === "clipboard") {
      void navigator.clipboard.writeText(result.text).catch(() => {});
      setInviteSent(true);
      void storeInvite("text", channel);
      // ‼️ THE COPY PATH NOW HOLDS HER IN FRAME, AND THE WHATSAPP PATH CANNOT. His ask: after
      // "Copy the message", "open your texting app and paste the copied message into your friend's
      // chat. Come back when you are finished" and a Done button. That only works for the channel
      // that LEAVES HER HERE. The branch below calls window.open(_, "_self"), which navigates this
      // page away, so a hand-off screen behind it would be a screen nobody is ever on.
      setInvitePhase("handoff");
      return;
    }

    window.open(result.href, "_self");
    setInviteSent(true);
    void storeInvite("text", channel);
  }

  /**
   * She has pasted the number. Move to the message, in the rhythm of the rest of the chat.
   *
   * ‼️ THE NUMBER NEVER GOES INTO A BUBBLE. The transcript is on screen at a counter with
   * the front desk beside her and it is the easiest thing in this tool to photograph. Her friend's
   * name is already visible in the preview she is about to read, so the bubble carries that and
   * stops there. Nothing in the transcript is stored either way; store() sends `answers`.
   */
  function toSend() {
    setInviteError(null);
    // ‼️ VALIDATED HERE RATHER THAN AT THE SEND BUTTON, because the send button is now on
    // the next screen and an error about a field she can no longer see is an error she cannot fix.
    // composeInvite() still refuses an empty number on its own; this is the half that can explain.
    if (inviteMode === "text" && !friendContact.trim()) {
      setInviteError("We need their number to open the message.");
      return;
    }
    if (inviteMode === "internal" && !friendName.trim() && !friendContact.trim()) {
      setInviteError("We need their name or their number to pass on.");
      return;
    }
    const who = friendName.trim();
    push("her", who ? `It is ${who}.` : "Got it.");
    setInvitePhase("send");
  }

  // ‼️ addSecondFriend() WAS DELETED HERE, 2026-10-13, WITH THE ROUND IT STARTED. See the `code`
  // docstring: his call was to drop the "That is enough" button, and that button was round two's
  // only exit.

  /**
   * The `internal` shape: record the referral and send nothing.
   *
   * ‼️ THE SECOND OF THE TWO OPTIONS, AND IT IS NOT A DEGRADED FIRST. Nothing leaves the building,
   * so there is no message to a number nobody consented to give us and no sender to wire. What
   * the clinic gets is a lead with her name on it and the same claim link to send however they
   * already talk to people. The patient is told plainly that somebody will reach out, because a
   * screen that says "sent" when nothing was sent is the one thing this path must not do.
   */
  function recordInvite() {
    setInviteError(null);
    if (!friendName.trim() && !friendContact.trim()) {
      setInviteError("We need their name or their number to pass on.");
      return;
    }
    setInviteSent(true);
    void storeInvite("internal", null);
  }

  /**
   * Read one contact out of her phone's address book, where the browser offers to.
   *
   * ‼️ IT IS CHROME ON ANDROID AND NOWHERE ELSE, SO THE TYPED FIELDS ARE THE REAL PATH AND NOT
   * THE FALLBACK. The Contact Picker API does not exist in Safari on iOS at all, which is most
   * patients standing at a med spa counter. The picker is an accelerator when it happens to be
   * there; the two inputs below are always rendered, because the front desk is beside her and
   * reading a number out is faster than hunting for a permission prompt.
   *
   * ‼️ ONE CONTACT, NAME AND NUMBER, AND NOTHING IS UPLOADED BY THIS FUNCTION. It fills two text
   * inputs she can see and correct. Her address book is not read anywhere else and no part of it
   * is sent: only the one name and number she picked travel, and only when she opens the message.
   */
  async function pickContact() {
    setInviteError(null);
    const nav = navigator as Navigator & {
      contacts?: {
        select: (
          props: string[],
          opts?: { multiple?: boolean }
        ) => Promise<Array<{ name?: string[]; tel?: string[] }>>;
      };
    };
    if (!nav.contacts?.select) {
      setInviteError("This phone will not let a website open contacts. Type their number instead.");
      return;
    }
    try {
      const picked = await nav.contacts.select(["name", "tel"], { multiple: false });
      const one = picked[0];
      if (!one) return;
      if (one.name?.[0]) setFriendName(one.name[0]);
      if (one.tel?.[0]) setFriendContact(one.tel[0]);
    } catch {
      // She cancelled, or the browser refused. Either way the inputs are already on screen.
    }
  }

  // ‼️ skipInvite() WAS DELETED HERE, 2026-10-13, BECAUSE NOTHING CALLED IT ANY MORE. It moved
  // past the invite without sending one, and its last caller was round two's "That is enough"
  // button. Round one has not been skippable since 2026-10-12, so with round two gone there is no
  // surface that skips this step at all.
  //
  // Left as a comment rather than as an uncalled function on purpose: an unreferenced handler on a
  // regulated surface reads as a way out that exists and is merely unwired, which is the thing
  // somebody re-wires in six months without finding the argument. The way out is the recommend
  // gate one step earlier. If this is ever needed again, it is four lines.

  /** She sent it, so carry on to the review questions. */
  function finishInvite() {
    // ‼️ IT MUST NOT SAY "SENT" IN internal MODE, because nothing was. The transcript is the only
    // record she sees of what happened, and a chat that reports a message nobody sent is the
    // same class of lie as the handover screen claiming somebody is looking up a file.
    const who = friendName.trim();
    push(
      "her",
      inviteMode === "internal"
        ? who
          ? `Please look after ${who}.`
          : "Passed on."
        : who
          ? `I sent it to ${who}.`
          : "Sent."
    );
    setAwaiting("none");
    setIndex((i) => i + 1);
  }

  /**
   * Write what we have so far.
   *
   * ‼️ CALLED AS SHE GOES SINCE 2026-10-13, NOT ONCE AT THE END, AND THAT IS WHAT MAKES A FUNNEL
   * POSSIBLE. Before this the row appeared only when she reached her finished review, so a walk
   * abandoned at the stars existed nowhere and "where do we lose people" was unanswerable. The
   * first call inserts, every later one patches.
   *
   * ‼️ AND IT IS WHY ANYTHING COUNTING ROWS IN THAT TABLE IS NOW COUNTING ATTEMPTS. `completed_at`
   * is the column that means "she got a review out of it". weekly-report.ts moved to it in the
   * same release; a future reader that counts rows instead will quietly report abandoned walks to
   * a client as reviews collected.
   *
   * ‼️ NO session id, NO ip, NO user agent, EVER. docs/2026-08-18-client-hub.sql: "THE ABSENCE OF
   * THE COLUMN IS THE ENFORCEMENT... Adding one of these columns later is a spec violation, not a
   * feature." The funnel is built from how far THIS ROW got, which is weaker than joining page
   * views to submissions and is the measurement we are allowed to take.
   */
  async function store(opts?: {
    postedDestination?: string;
    completed?: boolean;
    /**
     * The answer she gave in the same tick as this call.
     *
     * ‼️ REQUIRED WHEN CALLING FROM commit(), AND LEAVING IT OUT IS A SILENT OFF-BY-ONE. React
     * has not flushed setAnswers by the time the handler calls this, so `answers` is still the
     * state from before her latest answer. The first call would insert a row missing the only
     * answer she had given, which is also the call that decides whether a row exists at all: the
     * route refuses an insert with nothing in it.
     */
    alsoAnswer?: { key: keyof ReviewAnswers; value: string };
  }) {
    const sending: ReviewAnswers = opts?.alsoAnswer
      ? { ...answers, [opts.alsoAnswer.key]: opts.alsoAnswer.value }
      : answers;
    try {
      const res = await fetch("/api/hub/reviews/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientId,
          answers: sending,
          submissionId,
          postedDestination: opts?.postedDestination,
          rating,
          privateNote: privateNote.trim() || undefined,
          attested,
          questionSetVersion: QUESTION_SET_VERSION_V6,
          // ── The funnel, counted and never routed ──
          lastStep: REVIEW_SCRIPT[index]?.id ?? null,
          completed: opts?.completed === true,
          // ‼️ "SHE CHANGED IT", NOT "WHAT SHE CHANGED IT TO". editedJoined holds her text and it
          // is already stored, in `answers`, as the answers she typed. A second copy of her prose
          // under a different column would be the same words stored twice with no reader for the
          // duplicate.
          copiedEdited: editedJoined !== null,
          regenerateCount,
        }),
      });
      const json = (await res.json()) as { id?: string };
      if (json.id) setSubmissionId(json.id);
    } catch {
      // Storing is for SRT's benefit, not hers. A failed write must never block her from copying
      // her own words and posting them.
    }
  }

  /**
   * Record that an invite was opened.
   *
   * ‼️ A SEPARATE CALL TO A SEPARATE TABLE, NEVER FOLDED INTO store(). The friend's name and
   * number must not travel in the same body as her review answers, because that body is what
   * writes review_tool_submissions and the whole no-PII position on that table rests on there
   * being nothing in the request for it to store.
   *
   * ‼️ AND IT FAILS SILENTLY, for the same reason store() does. She has already opened her
   * messages app by the time this runs. A failed write here means SRT cannot attribute the
   * referral, which is our problem, not a reason to show her an error about a message she has
   * already sent.
   */
  async function storeInvite(mode: InviteMode, channel: InviteChannel | null) {
    try {
      await fetch("/api/hub/reviews/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientId,
          submissionId,
          serviceLabel: (answers.service ?? "").trim() || null,
          offerText,
          // Snapshotted beside the friend's, so a later edit to the clinic's deals cannot change
          // what either of them was promised.
          //
          // ‼️ ONE REWARD NOW, BECAUSE THERE IS ONE FRIEND. This read
          // `inviteRound === 1 ? referrerOffer : pairOffer` while a second round existed, because
          // the two were earned by different things: the first when that friend books, the
          // two-for-one when she and a second friend came in together. With the round gone there
          // is only the first, which is the one the copy on screen promises her.
          referrerOfferText: referrerOffer,
          templateKey,
          // ‼️ CONSTANT 1 SINCE 2026-10-13, AND IT IS SENT ANYWAY. The route writes it into
          // offer_snapshot and the column shape stays as it was, so no migration and no reader
          // changes. A row that says round 1 is true; dropping the field would make every stored
          // invite indistinguishable from the two-round ones already in the table.
          round: 1,
          code,
          friendName: friendName.trim() || null,
          friendContact: friendContact.trim() || null,
          // ‼️ ALWAYS NULL SINCE 2026-10-09. The box that collected it is gone; the field is
          // still sent so the route's shape is unchanged and a future surface can fill it.
          referrerEmail: null,
          mode,
          channel,
        }),
      });
    } catch {
      // See above.
    }
  }

  function reveal() {
    setRevealed(true);
    // Stored whether or not she goes on to post. The language is the asset either way.
    //
    // ‼️ THIS IS WHERE completed_at IS SET, AND "COMPLETED" MEANS SHE GOT A REVIEW OUT OF THE
    // WALK. It does not mean she posted one: no code path can observe a review appearing on
    // Google, which is what posted_destination's own comment says. Reaching her finished review
    // is the furthest thing this tool can honestly claim to have achieved.
    void store({ completed: true });
  }

  /**
   * Copy her review, record where she is going, and take her there.
   *
   * ‼️ THE OPEN HAPPENS IN THE SAME USER GESTURE AS THE COPY, AND IT HAS TO. A popup blocker
   * allows window.open only while a click is still being handled, so awaiting the store() round
   * trip first would get the tab blocked for some patients and not others. The store is fired and
   * not awaited for the same reason it is everywhere else in this file: recording is for SRT's
   * benefit and must never stand between her and posting her own words.
   *
   * ‼️ AND IT IS STILL THE SAME PATH FOR EVERY RATING. One button, one destination, no branch on
   * the stars anywhere in it. The destination is whichever platform the clinic named as primary,
   * which is a fact about the clinic and not about her.
   */
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
    if (primaryDestination) {
      void store({ postedDestination: primaryDestination.key });
      // noopener for the usual reason: the page we are opening gets no handle on this one.
      window.open(primaryDestination.url, "_blank", "noopener,noreferrer");
    }
  }

  // ‼️ THE READABILITY RAIL WAS DELETED HERE, 2026-10-13. Matthew: "Get rid of the grammaryl tab".
  //
  // What stood here was `highlighted` (a mirror div under a transparent textarea, so a highlight
  // could land under the sentence it was about), a `rail` memo counting long sentences, adverbs,
  // passives, hedges and long words, and a `clean` flag. It pointed at her writing and never
  // rewrote it, which was its whole defence, and that defence still holds. It went because he did
  // not want it, not because it was wrong.
  //
  // ‼️ AND ITS REMOVAL IS WHAT MAKES THE TWO PANELS SYMMETRIC, which is the thing he actually
  // asked for. With no mirror to line up, both panels are plain textareas with the same
  // typography, so the side-by-side finally looks like a comparison instead of one real box and
  // one shadow of it.
  //
  // ‼️ src/lib/hub/readability.ts IS DELIBERATELY STILL THERE. It now has no caller in the app,
  // but scripts/test-onboarding-artifacts.ts (the FIRST script in CI) imports it and asserts it
  // imports nothing and exports no rewriter. Deleting the module belongs in its own commit, if at
  // all: one commit doing two things is how this deletion gets blamed for that probe going red.
  //
  // ‼️ THE PROMISE COPY THAT LIVED IN THE RAIL'S FOOT MOVED, IT DID NOT GO. See .rev2-promise
  // below. Shipping a joiner with no on-screen statement of what it does is a deception problem
  // of its own, separate from the review rule and not cured by any of it.

  const step = REVIEW_SCRIPT[index];
  const canSend = composed.trim().length > 0;
  const done = !step;
  const chatting = !revealed && (stage === "connecting" || stage === "chat");

  return (
    <>
      {/*
        The masthead stays rendered behind the panel. It is the one thing that makes
        reviews.{domain} look like the same business as learn.{domain}, and in `full` the panel
        simply covers it rather than the page having to render two ways.
        The COPY is untouched and is not themable (Runner v3 5g).
      */}
      {/*
        The clinic's identity, and it STAYS RENDERED BEHIND THE PANEL. It is the one thing that
        makes reviews.{domain} look like the same business as learn.{domain}; the panel simply
        covers it rather than the page having to render two ways.

        ‼️ REDESIGNED 2026-10-05 TO MATTHEW'S MOCKUP, and the COPY is still not themable
        (Runner v3 5g). What changed is the furniture: a monogram, the clinic's town, a serif
        headline and two lines saying what this costs her and what it does not do. The old version
        was an eyebrow, a heading and a bare Start button, which he called horrible and which was
        giving a patient no reason at all to tap.
      */}
      <header className="rev-open-id">
        <span className="rev-open-mark" aria-hidden="true">
          {businessName.trim().charAt(0).toUpperCase()}
        </span>
        <span className="rev-open-who">
          <span className="rev-open-name">{businessName}</span>
          {location ? <span className="rev-open-where">{location}</span> : null}
        </span>
      </header>

      {!revealed && stage === "intro" && (
        <div className="rev-open">
          {/*
            ‼️ THE STARS USED TO BE ON THIS SCREEN AND THEY MOVED INTO THE WALK (2026-10-05).
            Matthew's order asks what she had and who did it before it asks her to score anything,
            and the front desk hands the card over on the provider question, so the first thing on
            screen can no longer be a rating.

            What is left is the handover. It needs a tap of its own because the panel's five
            second connect has to start from a deliberate action rather than from the page
            loading, or she spends it looking at a spinner she did not ask for.
          */}
          <p className="rev-open-eyebrow">Thank you for visiting</p>
          <h1 className="rev-open-title">Tell us how it went</h1>
          <p className="rev-open-lede">
            Two parts, and the second one is up to you. Answer whichever questions you like and
            skip the rest.
          </p>

          {/*
            ‼️ TWO PARTS, NAMED SEPARATELY, AND THIS IS NOT A LAYOUT PREFERENCE. Matthew,
            2026-10-06: "the seven short questions are still tied together we need separation from
            those 2 sections". Until now the headline said "Leave us a review" over a single count
            of seven, which told her that all seven WERE the review. They are not: the first two
            and the stars are about her visit, and the question about a friend sits in that half
            too. Presenting the referral inside a review ask is the one conflation this whole lane
            is built to avoid, and clients.review_incentive_flag exists because of it.

            ‼️ BOTH COUNTS ARE DERIVED FROM THE SCRIPT, split at the first `refer` step, for the
            reason QUESTION_COUNT_WORD already carries: onboarding2 said "Six questions" over an
            array of seven, which is a small lie told at the moment somebody has just agreed to
            something. Reordering the walk moves the boundary and both numbers with it.
          */}
          <ol className="rev-open-parts">
            <li>
              <span className="rev-open-part-no">1</span>
              <span>
                <strong>Your visit.</strong> {VISIT_COUNT_WORD} questions and the stars. None of
                this is posted anywhere.
              </span>
            </li>
            <li>
              <span className="rev-open-part-no">2</span>
              <span>
                <strong>A review, if you would like one.</strong> {REVIEW_COUNT_WORD} more
                questions, then your own words handed back to you to post or not.
              </span>
            </li>
          </ol>

          <ul className="rev-open-facts">
            <li>
              <svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20" fill="none"
                stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
              <span>About ninety seconds</span>
            </li>
            <li>
              <svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20" fill="none"
                stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="10" width="16" height="10" rx="2" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" />
              </svg>
              <span>You decide what gets shared</span>
            </li>
          </ul>

          {needsSpanish && (
            // Rendered rather than hidden, because a Spanish-speaking customer being handed
            // English questions is a real thing to notice, and the spec forbids inventing the
            // Spanish here.
            <p className="rev-note">Estas preguntas aún no están disponibles en español.</p>
          )}

          <button type="button" className="rev-primary" onClick={leaveIntro}>
            Start
          </button>
          {/*
            The footnote the reference screens carry under their button. It says the one thing the
            two facts above do not, which is that there is nothing to install and no account to
            make. A patient standing at a counter with somebody waiting behind her is deciding
            whether this is a trap, not whether it is a good deal.
          */}
          <p className="rev-open-foot">No account, no app, nothing to download.</p>

          {/*
            ‼️ THE SINGLE COUNT LINE LIVED HERE AND IS GONE ON PURPOSE. It read
            "{QUESTION_COUNT_WORD} short questions", one number covering both halves, which is
            precisely the tying-together the two parts above exist to undo. The number is not lost:
            it is now said twice, once per part, and still derived from the same script. The
            printed card is untouched, because review-card.ts still reads CARD_QUESTIONS and that
            array is byte for byte what it was.
          */}
        </div>
      )}

      {chatting && (
        /*
          The panel opens OVER the page and closes when the walk ends, so the masthead, her stars
          and the client's mark stay where they were, and her review lands on a normal page with
          room for the original beside it.

          ‼️ A FULL-SCREEN VARIANT WAS BUILT, WALKED AND REJECTED (2026-09-24). It deleted the
          masthead and the client's mark, which are the only things making reviews.{domain} look
          like the same business as learn.{domain}, and it put the review step, the attestation,
          the destination links and the private note inside one fixed scrolling column. If
          somebody proposes it again, that is what it costs.

          (The rail this comment used to name was deleted on 2026-10-13. The two-column room it
          describes is now the review and the original, which needs it for the same reason.)
        */
        <div className="va-shell">
          <div className="va-scrim" aria-hidden="true" />
          {/*
            ‼️ A REGION AND NOT A DIALOG SINCE 2026-10-06. `role="dialog" aria-modal="true"` was
            correct while this floated over a scrim: it told a screen reader the rest of the page
            was inert, which it was. Inline in the frame nothing is inert, and a modal that does
            not trap is a lie to exactly the people who depend on the answer.
          */}
          <section
            className="va-panel"
            aria-label={AGENT_NAME}
            tabIndex={-1}
            ref={panelRef}
          >
            <div className="va-head">
              <span className="va-avatar" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 4h16v12H8l-4 4z" />
                </svg>
              </span>
              <span className="va-title">{AGENT_NAME}</span>
            </div>

            {stage === "connecting" ? (
              // ‼️ IT SAYS WHAT IT IS DOING AND NOTHING MORE. Nobody is looking up a file. See
              // CONNECTING_LINE in review-script.ts for why this wording and not the other one.
              <div className="va-connecting" aria-live="polite">
                <span className="va-spinner" aria-hidden="true" />
                <p className="va-connecting-line">{CONNECTING_LINE}</p>
              </div>
            ) : (
              <>
                <div className="va-msgs">
                  {bubbles.map((bubble) =>
                    bubble.quote ? (
                      /*
                        A block she was shown and acted on. Dimmed to the muted token, selectable,
                        never a control: there is nothing to press and nothing to undo. It is here
                        so the message she is pasting into another app is still on screen while she
                        pastes it.
                      */
                      <div key={bubble.id} className="va-answered">
                        <p className="va-answered-q">{bubble.quote.label}</p>
                        <p className="va-answered-quote">{bubble.quote.body}</p>
                      </div>
                    ) : bubble.chips ? (
                      /*
                        ‼️ THE ANSWERED CONTROL SET, DEAD AND VISIBLE. His ask: "gray out the
                        options that they didnt pick leaving the button dead but visible in the
                        history". Rendered as real <button> elements so the row looks like the one
                        she tapped rather than like a sentence about it, and every one of them is
                        `disabled`, so there is nothing to tap and nothing to tab to.

                        ‼️ `disabled` IS CORRECT HERE AND IS FORBIDDEN IN THE REVIEW PANEL, which
                        is not a contradiction. There, a disabled control would be a live choice
                        withheld from her. Here the choice is already made and the only honest
                        state for the row is inert.

                        ‼️ aria-disabled AS WELL AS disabled, and the label says so. A screen
                        reader walking back through the transcript should hear "Warm, selected" and
                        "Short, dimmed", not two buttons it might try to press.
                      */
                      <div key={bubble.id} className="va-answered">
                        <p className="va-answered-q">{bubble.chips.label}</p>
                        <div className="va-chips is-pair va-answered-row">
                          {bubble.chips.options.map((option) => {
                            const picked = option === bubble.chips?.chosen;
                            return (
                              <button
                                key={option}
                                type="button"
                                disabled
                                aria-disabled="true"
                                className={picked ? "va-chip is-on" : "va-chip is-dim"}
                              >
                                {option}
                                <span className="va-sr">{picked ? " selected" : " not selected"}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <div
                        key={bubble.id}
                        className={bubble.from === "her" ? "va-msg is-her" : "va-msg is-them"}
                      >
                        {bubble.text}
                      </div>
                    )
                  )}

                  {typing && (
                    // Three dots, never a sentence about what is happening. Nothing is happening.
                    <div className="va-msg is-them va-typing" aria-label="typing">
                      <span />
                      <span />
                      <span />
                    </div>
                  )}

                  <div ref={endRef} />
                </div>

                {done ? (
                  <div className="va-composer">
                    <button
                      type="button"
                      className="va-send is-wide"
                      onClick={reveal}
                      disabled={nothingTyped}
                    >
                      Show my review
                    </button>
                  </div>
                ) : awaiting === "gate" && step.kind === "gate" ? (
                  // Two chips, side by side. Neither label reaches her review; see answerGate().
                  <div className="va-chips is-pair">
                    <button type="button" className="va-chip" onClick={() => answerGate(true)}>
                      {step.yes}
                    </button>
                    <button type="button" className="va-chip" onClick={() => answerGate(false)}>
                      {step.no}
                    </button>
                  </div>
                ) : awaiting === "refer" && step.kind === "refer" ? (
                  /*
                    ‼️ THE SAME TWO CHIPS AS A GATE, AND A No COSTS HER NOTHING. It skips the
                    invite and lands on the review questions, which is where a Yes lands too.
                    There is no third path and no private box behind this one. See answerRefer().
                  */
                  <div className="va-chips is-pair">
                    <button type="button" className="va-chip" onClick={() => answerRefer(true)}>
                      {step.yes}
                    </button>
                    <button type="button" className="va-chip" onClick={() => answerRefer(false)}>
                      {step.no}
                    </button>
                  </div>
                ) : awaiting === "stars" ? (
                  <div className="va-composer">
                    {/*
                      ‼️ THE STARS DECIDE NOTHING. Read the state declaration above before adding
                      any branch that reads the value. Every one of the five leads to the same
                      questions, the same box, the same links and the same private note. The row
                      below carries the advance so that moving on learns THAT she tapped and never
                      WHICH.

                      ‼️ COPIED FROM referral-engine-client.tsx CHARACTER FOR CHARACTER. The probe
                      asserts all five expressions are present here, unchanged. Do not tidy it.
                      It moved into the composer on 2026-10-05 and not one character of it changed.
                    */}
                    <fieldset className="rev-stars">
                      <legend>How would you rate your experience?</legend>
                      <div
                        className="rev-stars-row"
                        role="radiogroup"
                        aria-label="Rating out of five"
                        onClick={() => setStarsAnswered(true)}
                      >
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button
                            key={n}
                            type="button"
                            role="radio"
                            aria-checked={rating === n}
                            aria-label={`${n} star${n === 1 ? "" : "s"}`}
                            className={rating !== null && n <= rating ? "is-on" : undefined}
                            onClick={() => setRating(n)}
                          >
                            <span aria-hidden="true">★</span>
                          </button>
                        ))}
                      </div>
                    </fieldset>

                    <button
                      type="button"
                      className="va-send is-wide"
                      onClick={leaveStars}
                      disabled={!starsAnswered}
                    >
                      Next
                    </button>
                  </div>
                ) : awaiting === "invite" ? (
                  /*
                    The invite, and the only screen in this tool that collects somebody else's
                    details.

                    ‼️ NOTHING HERE IS SENT BY US. The buttons open her own messages app with the
                    message already written. See composeInvite(): it returns an href and there is
                    no sender in this lane.

                    ‼️ THE MESSAGE IS SHOWN TO HER BEFORE IT OPENS, in full, in her own words'
                    place. She is about to send it from her number to a friend, so she reads it
                    first. A referral message that goes out of her phone without her having read
                    it is us writing to her friends in her name.
                  */
                  <div className="va-composer va-invite">
                    {/* ── Beat one: go and get it ── */}
                    {invitePhase === "instruct" && (
                      <>
                        <p className="va-invite-note">
                          Open your contacts and find their number. Come back and press Done when
                          you have it copied.
                        </p>
                        <button
                          type="button"
                          className="va-send is-wide"
                          onClick={() => setInvitePhase("confirm")}
                        >
                          Done
                        </button>
                      </>
                    )}

                    {/* ── Beat two: did it actually work ── */}
                    {invitePhase === "confirm" && (
                      <>
                        <p className="va-invite-note">
                          Did you copy their number?
                          {referrerOffer ? ` You get ${referrerOffer} once they book.` : ""}
                        </p>
                        <div className="va-chips is-pair">
                          <button
                            type="button"
                            className="va-chip"
                            onClick={() => setInvitePhase("enter")}
                          >
                            Yes
                          </button>
                          {/*
                            ‼️ A No GOES BACK, NOT FORWARD. She has not got the number yet, so the
                            next screen would be an empty box she cannot fill. This is the only
                            backwards move in the whole walk and it exists because this is the only
                            step that sends her out of the page.
                          */}
                          <button
                            type="button"
                            className="va-chip"
                            onClick={() => setInvitePhase("instruct")}
                          >
                            Not yet
                          </button>
                        </div>
                      </>
                    )}

                    {/*
                      ── Beat three: the space to paste it, and nothing else ──

                      ‼️ THIS SCREEN IS TWO BOXES AND A BUTTON ON PURPOSE. It used to be these two
                      boxes PLUS the contacts link, her own email, three wording chips, a message
                      preview, three send buttons and a skip, all at once, which is the wall the
                      three-beat sequence was supposed to have removed and which grew back.
                      Matthew, 2026-10-07: "just leave a space for them to paste the number in the
                      conversation and then we just keep the chat as regular". Everything about the
                      message moved to the beat after this one.
                    */}
                    {invitePhase === "enter" && (
                      <>
                        <div className="va-bar is-stack">
                          <input
                            type="text"
                            value={friendName}
                            onChange={(e) => setFriendName(e.target.value)}
                            placeholder="Their first name"
                            aria-label="Your friend's first name"
                          />
                          <input
                            type="tel"
                            value={friendContact}
                            onChange={(e) => setFriendContact(e.target.value)}
                            placeholder="Paste their mobile number"
                            aria-label="Your friend's mobile number"
                          />
                          <button
                            type="button"
                            className="va-skip"
                            onClick={() => void pickContact()}
                          >
                            Or pick from contacts
                          </button>
                          {/*
                            ‼️ HER OWN EMAIL BOX WAS HERE AND MATTHEW REMOVED IT ON 2026-10-09.
                            It was optional, below her friend's details, and bought her one
                            message when that friend came in. It was also a fourth box on a step
                            whose whole job is two, put to somebody standing at a counter.

                            ‼️ WHAT THAT COSTS, SO NOBODY HUNTS FOR THE BUG LATER: nothing fills
                            referral_invites.referrer_email from this surface any more, so the
                            "your friend booked" email in referral-emails.ts can never fire. It
                            degrades rather than breaks, because sendReferrerEmail already returns
                            early on a missing address. The column and the sender stay for a
                            surface that collects it honestly.
                          */}
                        </div>

                        {inviteError && (
                          <p className="va-invite-error" role="alert">
                            {inviteError}
                          </p>
                        )}

                        <button type="button" className="va-send is-wide" onClick={toSend}>
                          Next
                        </button>
                      </>
                    )}

                    {/*
                      ── Beat four: the message ──

                      ‼️ NOTHING HERE IS SENT BY US. The buttons open her own messages app with the
                      message already written. See composeInvite(): it returns an href and there is
                      no sender in this lane.

                      ‼️ SHE READS IT BEFORE IT OPENS, in full, in her own words' place. She is
                      about to send it from her number to a friend. A referral message that goes out
                      of her phone without her having read it is us writing to her friends in her
                      name.

                      ‼️ AND THE WORDING PICKER AND THE PREVIEW ARE `text` MODE ONLY. In `internal`
                      mode there is no message, so showing her one to choose and read would be the
                      screen describing something that will not happen.
                    */}
                    {invitePhase === "send" && !inviteSent && (
                      <>
                        {inviteMode === "text" ? (
                          <>
                            {/*
                              ‼️ THE HEADING IS THE FIX, AND THE CHIPS WERE NEVER THE PROBLEM.
                              He walked the preview and could not tell what four unlabelled chips
                              were offering. A row of bare words above a message preview could
                              plausibly be the recipient, the service, or a filter. One line of
                              copy saying what the row IS costs nothing and was the whole defect.
                            */}
                            <p className="va-invite-note">Select message style</p>
                            <div className="va-chips" role="group" aria-label="Message style">
                              {INVITE_TEMPLATES.map((t) => (
                                <button
                                  key={t.key}
                                  type="button"
                                  className={t.key === templateKey ? "va-chip is-on" : "va-chip"}
                                  aria-pressed={t.key === templateKey}
                                  onClick={() => setTemplateKey(t.key)}
                                >
                                  {t.label}
                                </button>
                              ))}
                            </div>

                            <p className="va-invite-preview">{inviteMessage}</p>
                          </>
                        ) : (
                          <p className="va-invite-note">
                            {businessName} will reach out to them directly.
                          </p>
                        )}

                        {inviteError && (
                          <p className="va-invite-error" role="alert">
                            {inviteError}
                          </p>
                        )}

                        {inviteMode === "internal" ? (
                          <button
                            type="button"
                            className="va-send is-wide"
                            onClick={recordInvite}
                          >
                            Pass their details on
                          </button>
                        ) : (
                          <div className="va-chips" role="group" aria-label="How to send it">
                            {INVITE_CHANNELS.map((c) => (
                              <button
                                key={c.key}
                                type="button"
                                className="va-chip"
                                onClick={() => openInvite(c.key)}
                              >
                                {c.label}
                              </button>
                            ))}
                          </div>
                        )}

                        {/* ‼️ "Change their details" WAS HERE AND WENT ON 2026-10-12, his call.
                            It was the way back to the two boxes. What it mostly did on a phone at
                            a counter was offer a second decision at the moment she had already
                            made one. Her details are still hers to fix: nothing has been sent
                            until she taps a channel, and the message preview above shows exactly
                            what will go. */}
                      </>
                    )}

                    {/*
                      ── Beat five: she has the message. Now she sends it. ──

                      ‼️ THIS SCREEN IS WHERE THE REFERRAL ACTUALLY HAPPENS AND IT DID NOT EXIST
                      BEFORE v8. "Copy the message" copied and the step ended, which left her
                      holding a clipboard on a screen that had already moved on; whether she ever
                      pasted it was a thing nobody on either side could know. His ask, in his
                      words: stay in the same frame, "open your texting app and paste the copied
                      message into your friend's chat. Come back when you are finished", and a Done
                      button.

                      ‼️ "Done" IS NOT A DELIVERY CONFIRMATION AND MUST NEVER BE WORDED AS ONE. We
                      are not the sender and cannot observe anything: see the module header in
                      referral-invite.ts. She is telling us she is finished, which is what
                      referral_invites.sent_at already means ("she got as far as her own
                      keyboard"). "Sent" or "Delivered" here would be a claim we cannot make.

                      ‼️ AND IT IS NOT A SECOND ASK. The two-for-one and the whole second-friend
                      round were deleted on 2026-10-13: see the `code` docstring. What stood here
                      offered "Add a second friend and you both get {pairOffer}". One friend per
                      visit now, and the only button is the way on.
                    */}
                    {invitePhase === "handoff" && (
                      <>
                        <p className="va-invite-note">
                          Open your texting app and paste the copied message into your friend&apos;s
                          chat. Come back when you are finished.
                        </p>
                        <button type="button" className="va-send is-wide" onClick={finishInvite}>
                          Done
                        </button>
                      </>
                    )}

                    {/* The WhatsApp path navigates away and returns here, so it still needs a
                        plain way on. Suppressed during the hand-off, which has its own. */}
                    {inviteSent && invitePhase !== "handoff" && (
                      <button type="button" className="va-send is-wide" onClick={finishInvite}>
                        Done, next question
                      </button>
                    )}

                    {/*
                      ‼️ "That is enough" WAS HERE AND WENT ON 2026-10-13 WITH THE ROUND IT EXITED.
                      His call. It rendered only in round two, and v7's comment said in capitals
                      that round two "KEEPS 'That is enough' AND MUST. She opted into a second
                      friend by tapping 'Yes, add one more'; removing her way out would leave her
                      inside a loop she chose, with the rest of the walk behind it."

                      That was correct, and it is exactly why dropping the second friend entirely
                      was the right way to honour the ask. Deleting the button alone would have
                      built the trap the comment described. Deleting the round removes the need for
                      an exit from it.

                      ‼️ THE OPT OUT STILL EXISTS AND IT IS ONE STEP EARLIER. "Would you recommend
                      this service to a friend?" sits immediately before the invite and a No counts
                      past the whole referral. That gate is the only way out, which is what makes
                      it safe for this step to have none: somebody who does not want to refer
                      anybody answers the question that asks them, rather than being asked to send
                      something and then given a way to back out of it.
                    */}
                  </div>
                ) : awaiting === "text" ? (
                  <div className="va-composer">
                    <div className="va-bar">
                      {/*
                        ‼️ THE PLACEHOLDER IS GREY TEXT AND NEVER A VALUE. `placeholder` cannot be
                        submitted, does not survive a tap, and leaves an empty answer empty. The
                        moment it became `value` or a defaultValue she could simply press Send on,
                        this tool would be handing her review content she did not write.
                      */}
                      <textarea
                        rows={2}
                        value={composed}
                        onChange={(e) => setComposed(e.target.value)}
                        placeholder={
                          step.kind === "ask" && step.placeholder
                            ? step.placeholder
                            : "Type your answer"
                        }
                        aria-label={step.kind === "ask" ? step.prompt : "Your answer"}
                      />
                      <button
                        type="button"
                        className="va-send"
                        onClick={() => commit(composed)}
                        disabled={!canSend}
                      >
                        Send
                      </button>
                    </div>

                    {/*
                      A COMMAND, not an answer. Nothing it does puts a word into what gets copied.
                      "Answer whichever you like and skip the rest" was free when four boxes sat
                      on one screen and has to be built once the questions arrive one at a time.

                      ‼️ THE LABEL IS PER QUESTION SINCE 2026-10-05 AND STILL STORES NOTHING. "I was
                      not concerned about anything" is Matthew's wording and it is a real answer to
                      the question, so it reads as one; what it DOES is identical to the generic
                      skip, which is commit("") and therefore no bullet at all. A skip whose label
                      is a sentence must never start storing that sentence, or the button becomes
                      us writing her review with a nicer tap target.
                    */}
                    <button type="button" className="va-skip" onClick={() => commit("")}>
                      {step.kind === "ask" && step.skipLabel ? step.skipLabel : "Skip this one"}
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </section>
        </div>
      )}

      {revealed && (
        <>
          {/*
            ‼️ NO LABELLED BULLET LIST. v1 showed her notes broken out by question above the box;
            Matthew asked for the message alone. The labels were ours and never travelled into the
            clipboard anyway, so removing them takes nothing away from her and removes a screen
            that read like a form receipt.
          */}
          <h2>Your review</h2>
          <p className="rev-hint">
            Edit it however you like before you copy it. Every word in it is a word you typed or a
            word from the question you were answering.
          </p>

          <div className="rev2-read">
            {/*
              ‼️ TWO PANELS, SIDE BY SIDE, AND ONLY ONE OF THEM IS COPYABLE. NOT ONE BOX WITH A
              TIDY-UP BUTTON. A single box that rewrites itself in place takes her words away and
              puts ours where they were; she then has to remember what she wrote in order to judge
              the swap. Side by side she can see both, which is the difference between a tool that
              shows its work and one that hides it.

              ‼️ THE ORIGINAL IS READ-ONLY, AND THAT IS THE ONE THING v8 CHANGED HERE. Matthew:
              "so they can copy the retouched only". It is still rendered, still complete, still
              beside the box she posts, so what we added is always visible by comparison. What she
              cannot do is post the unjoined version, and that was his decision.

              ‼️ BOTH PANELS ARE SHOWN AT EVERY RATING AND NEITHER IS GATED. Not collapsed behind
              a disclosure, not withheld from a low rating, not reordered by it. `rating` must not
              appear anywhere between this comment and .rev2-promise below, and
              scripts/_probe-review-v7.ts slices exactly that range and fails if it does.

              ‼️ BOTH ARE PLAIN TEXTAREAS SINCE THE RAIL WENT, which is what makes them symmetric.
              There is no mirror div to keep aligned any more, so there is no reason for one panel
              to be built differently from the other.
            */}
            <div className="rev2-versions">
              {VERSIONS.map((panel) => {
                const isJoined = panel.key === "joined";
                return (
                  <div
                    key={panel.key}
                    className={`rev2-version${isJoined ? " rev2-version-on" : " rev2-version-off"}`}
                  >
                    <div className="rev2-version-head">
                      <span className="rev2-version-name">{panel.name}</span>
                      <span className="rev2-version-note">{panel.note}</span>
                    </div>

                    {isJoined ? (
                      <>
                        <textarea
                          className="rev-out"
                          rows={10}
                          value={text}
                          aria-label="Your review, which you can edit"
                          onChange={(e) => {
                            setEditedJoined(e.target.value);
                            setCopied(false);
                          }}
                        />
                        {/*
                          ‼️ THE BUTTON IS PERMANENT SINCE 2026-10-16, AND IT USED TO DISAPPEAR.
                          What stood here hid it once `editedJoined !== null` and replaced it with
                          "This is your wording now, so we have stopped suggesting others", because
                          regenerating over her edit would discard what she wrote.

                          The reasoning was right and the remedy was wrong. It protected her text
                          by taking the feature away, and Matthew hit it immediately: he typed in
                          the box, then wanted to shuffle the review, and the control was gone. A
                          tool with 324 arrangements and no way to reach them has 1.

                          The honest fix is to keep what the press would have overwritten. Undo
                          appears beside it only when there is an edit of hers to restore, puts it
                          back in one press, and asks her nothing.

                          ‼️ STILL NO `disabled` ANYWHERE IN THIS BLOCK. The panel slice in
                          scripts/_probe-review-v7.ts fails on that attribute, which is how the
                          no-gating rule stays enforceable, and a greyed control is a puzzle where
                          a present one is an offer.
                        */}
                        <div className="rev2-regen-row">
                          <button type="button" className="rev2-regen" onClick={regenerate}>
                            Try another wording
                          </button>
                          {undoable !== null && (
                            <button
                              type="button"
                              className="rev2-regen"
                              onClick={undoRegenerate}
                            >
                              Undo, put my wording back
                            </button>
                          )}
                        </div>
                      </>
                    ) : (
                      /*
                        ‼️ SHORTER THAN THE REVIEW BOX, AND ONLY BECAUSE THEY ARE STACKED NOW.
                        Side by side they were equals; one above the other, two ten-row boxes put
                        the attestation and the Copy button a long way down a 26rem frame. This one
                        is reference material and scrolls internally, so six rows costs her nothing
                        and keeps the thing she has to press on the screen.
                      */
                      <textarea
                        className="rev-out"
                        rows={6}
                        value={hersText}
                        readOnly
                        aria-label="What you typed, for comparison"
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {/*
              ‼️ THE PROMISE. IT MOVED HERE FROM THE RAIL'S FOOT AND MOVING IT WAS A SHIPPING
              CONDITION, NOT A TIDY-UP.

              Deleting the rail deleted the home of the only on-screen sentence saying what this
              tool does to her words. Shipping a joiner with no such sentence is a deception
              problem of its own: separate from FTC 16 CFR Part 465, not cured by any of the
              fences, and not something a comment in a source file can answer for.

              Its wording has now changed twice, each time because the feature changed under it:

                v6: "We point at what is shaded. We never write a replacement. Your call, and
                     your words either way." False the moment a joined panel existed.
                v7: "We point at what is shaded. We tidy the grammar and join your answers up.
                     We never add words you did not say." Its first sentence died with the rail.
                v8: below. "with words from our own questions" is the new clause and it is the
                     honest description of CARRIES: there are more of our words in her review
                     than in v7, and every one of them comes from a question she read.

              ‼️ THE THIRD SENTENCE EXISTS BECAUSE THE BUTTON EXISTS. A control labelled "Try
              another wording" invites exactly one wrong assumption, which is that it is rewriting
              what she said. Saying what it actually varies is cheaper than letting her guess.

              ‼️ DO NOT RESTORE EITHER OLD WORDING. scripts/_probe-review-v7.ts fails on the v6
              sentence by exact match, and this class name is the end marker for the panel slice
              above, so renaming it silently empties that check instead of failing it.
            */}
            <p className="rev2-promise">
              We tidy the grammar and join your answers up with words from our own questions. We
              never add words you did not say about your visit. Try another wording only rephrases
              our joining words, never yours.
            </p>
          </div>

          {/*
            ‼️ THE ATTESTATION GATES THE COPY BUTTON AND NOTHING ELSE. It is evidence, not a
            filter: it does not gate the questions, the assembly or the destination links, because
            it is not a score and must never behave like one.
          */}
          <label className="rev-attest">
            <input
              type="checkbox"
              checked={attested}
              onChange={(e) => {
                setAttested(e.target.checked);
                setCopied(false);
              }}
            />
            {/*
              ‼️ "I APPROVE THESE WORDS AS MY OWN" REPLACED "THESE ARE MY OWN WORDS", AND THE
              CHANGE IS FOR ACCURACY RATHER THAN STYLE. With four carries in play the box holds a
              few words of our questions as well as hers, so the old sentence asked her to certify
              something that is not quite true, on the one control whose entire job is to be a
              truthful record of her approval. His own compliance note calls this step "the
              customer approves it"; approval is exactly what this now says. "A real customer of
              this business" is untouched, because that half is the half that matters most and it
              was always hers to assert.
            */}
            <span>I am a real customer of this business and I approve these words as my own.</span>
          </label>

          {/*
            ‼️ ONE BUTTON. THE ROW OF DESTINATION LINKS IS GONE, 2026-10-13, HIS CALL: "remove the
            post on google button lets leave it only as copy and go".

            It used to be Copy, then a row of links she had to tap second. Two taps for one
            intention, and the second one is the one people forget: she copies, the step looks
            finished, and the review never reaches a profile. Copy and go does both.

            ‼️ THE DESTINATION ROW IS STILL NAMED .rev-dests AND STILL SITS ABOVE THE PRIVATE BOX,
            WHICH IS NOT COSMETIC. scripts/_probe-review-gating.ts section 5 compares where
            "rev-dests" and "rev-private" appear IN THIS FILE and fails if the private box comes
            first. The rule it enforces is the one this whole tool is built around: the public
            route is offered to everybody, above the private one, and never instead of it. A single
            button is still the public route, so the element stays and keeps the name.

            ‼️ AND SHE IS TOLD WHERE IT GOES BEFORE SHE PRESSES IT. A button that silently opens a
            new tab is a dark pattern, and this one opens somebody else's website.
          */}
          <button type="button" className="rev-primary" onClick={copy} disabled={!attested}>
            {copied
              ? "Copied"
              : primaryDestination
                ? `Copy and go to ${primaryDestination.label}`
                : "Copy my review"}
          </button>

          <p className="rev-dests rev-hint">
            {primaryDestination
              ? `Opens ${primaryDestination.label} in a new tab. Paste your review there.`
              : // ‼️ ABSENT BEATS WRONG, SAME AS THE REFERRAL STEP. With no link configured there
                // is nowhere to send her, so the button copies and says so rather than inventing a
                // destination. A clinic in this state should not be live: the reviews_live step in
                // src/lib/launch/verify.ts refuses until at least one link exists.
                "Copy your words, then paste them wherever you leave reviews."}
          </p>

          {/*
            ‼️ AFTER THE DESTINATION LINKS, NEVER INSTEAD OF THEM, AND OFFERED TO EVERYONE.
            The gating pattern this tool refuses is: low score, private form, no public link. So
            this box sits BELOW the links in the DOM, is not conditional on anything she scored or
            tapped, and takes nothing away.

            ‼️ AND IT IS BELOW THEM IN THE SOURCE, NOT ONLY ON SCREEN. The probe compares where
            "rev-private" and "rev-dests" appear in this FILE.
          */}
          <details className="rev-private">
            <summary>Something you would rather tell {businessName} privately?</summary>
            <p className="rev-hint">This goes to the business and is not posted anywhere.</p>
            <textarea
              rows={3}
              value={privateNote}
              onChange={(e) => setPrivateNote(e.target.value)}
              placeholder="Optional"
            />
            <button type="button" className="rev-secondary" onClick={() => void store()}>
              Send privately
            </button>
          </details>
        </>
      )}
    </>
  );
}
