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
  QUESTION_SET_VERSION_V5,
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
import { analyse, mergeMarks } from "@/lib/hub/readability";

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
  /**
   * Whether to offer her a box for her own email at the invite step.
   *
   * ‼️ ONLY TRUE WHEN THE CLINIC ACTUALLY SENDS HER THE MESSAGE, and the field is additionally
   * hidden when she has no reward of her own, because the only thing that message says is which
   * reward she has earned. Asking for an address that buys her nothing is the shape of a form
   * collecting an address because it can.
   */
  askReferrerEmail?: boolean;
}

const BUBBLE_GAP_MS = { min: 400, max: 900 } as const;

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

interface Bubble {
  id: number;
  from: "them" | "her";
  text: string;
}

export function VirtualAgentClient({
  businessName,
  location = null,
  clientId,
  destinations,
  needsSpanish,
  referral = null,
  askReferrerEmail = false,
}: Props) {
  const [answers, setAnswers] = useState<ReviewAnswers>({});
  const [edited, setEdited] = useState<string | null>(null);
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
  /**
   * HER OWN address, and it is the only reason she is ever written to.
   *
   * ‼️ IT IS IN THIS BAG AND NOT IN `answers`, LIKE HER FRIEND'S DETAILS AND FOR THE SAME REASON.
   * Nothing here is a ReviewQuestion key, so it is not assignable to ReviewAnswers, not iterable
   * by assembleLabelled or assemblePlain, not storable by the submit route's answers loop and not
   * reachable from the clipboard. It goes to referral_invites.referrer_email and the submit route
   * never sees it, which is what keeps review_tool_submissions free of anything identifying.
   */
  const [referrerEmail, setReferrerEmail] = useState("");
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
   * `enter`    now type it, or skip
   *
   * ‼️ THE CONFIRM STEP IS NOT A NAG. She has just come back from another app, which on a phone
   * means this page may have been unloaded and restored; asking is how she finds out whether the
   * thing she copied survived, before she is looking at an empty box wondering what she did wrong.
   */
  const [invitePhase, setInvitePhase] = useState<"instruct" | "confirm" | "enter">("instruct");
  const [inviteError, setInviteError] = useState<string | null>(null);
  /**
   * Minted once per visit, so the message she previews carries the code that gets stored.
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
  const text = edited ?? assembled;
  const nothingTyped = isEmpty(answers);
  const reading = useMemo(() => analyse(text), [text]);

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
      // Her edits are hers. Re-assembling over them would discard what she typed in the box.
      setEdited(null);
      setCopied(false);
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
    push("her", saidYes ? current.yes : current.no);
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
   */
  function leaveStars() {
    if (!starsAnswered) return;
    setAwaiting("none");
    setIndex((i) => i + 1);
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
    push("her", saidYes ? current.yes : current.no);
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
    if (result.kind === "clipboard") {
      void navigator.clipboard.writeText(result.text).catch(() => {});
    } else {
      window.open(result.href, "_self");
    }

    setInviteSent(true);
    void storeInvite("text", channel);
  }

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

  /** Move past the invite without sending one. A command, not an answer. */
  function skipInvite() {
    setAwaiting("none");
    setIndex((i) => i + 1);
  }

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

  async function store(postedDestination?: string) {
    try {
      const res = await fetch("/api/hub/reviews/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientId,
          answers,
          submissionId,
          postedDestination,
          rating,
          privateNote: privateNote.trim() || undefined,
          attested,
          questionSetVersion: QUESTION_SET_VERSION_V5,
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
          referrerOfferText: referrerOffer,
          templateKey,
          code,
          friendName: friendName.trim() || null,
          friendContact: friendContact.trim() || null,
          // Hers, when she gave one. The route validates it and stores null for anything else.
          referrerEmail: referrerEmail.trim() || null,
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
    void store();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const highlighted = useMemo(() => mergeMarks(text, reading), [text, reading]);

  /**
   * The rail beside her words. Counts and consequences, never replacements.
   *
   * ‼️ EVERY ROW IS A COUNT OF SOMETHING IN HER SENTENCE. "2 sentences run long" is an
   * observation. "Try this instead" is us writing her review, and there is no button that does
   * it. Read the header of src/lib/hub/readability.ts before adding a row.
   */
  const rail = useMemo(() => {
    const kinds = new Map<string, number>();
    for (const flag of reading.flags) kinds.set(flag.kind, (kinds.get(flag.kind) ?? 0) + 1);
    const long = reading.hard.filter((h) => h.reason === "long").length;
    const dense = reading.hard.length - long;
    return [
      { key: "long", mark: "long", label: "Sentences that run long", n: long },
      { key: "dense", mark: "dense", label: "Sentences packed tight", n: dense },
      { key: "adverb", mark: "adverb", label: "Adverbs", n: kinds.get("adverb") ?? 0 },
      { key: "passive", mark: "passive", label: "Passive phrases", n: kinds.get("passive") ?? 0 },
      { key: "qualifier", mark: "qualifier", label: "Hedges", n: kinds.get("qualifier") ?? 0 },
      { key: "complex", mark: "complex", label: "Long words", n: kinds.get("complex") ?? 0 },
    ];
  }, [reading]);

  const clean = rail.every((row) => row.n === 0);

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
          and the client's mark stay where they were, and her notes land on a normal page with room
          for the reading rail beside them.

          ‼️ A FULL-SCREEN VARIANT WAS BUILT, WALKED AND REJECTED (2026-09-24). It deleted the
          masthead and the client's mark, which are the only things making reviews.{domain} look
          like the same business as learn.{domain}, and it put the notes step, the rail, the
          attestation, the destination links and the private note inside one fixed scrolling
          column. If somebody proposes it again, that is what it costs.
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
                  {bubbles.map((bubble) => (
                    <div
                      key={bubble.id}
                      className={bubble.from === "her" ? "va-msg is-her" : "va-msg is-them"}
                    >
                      {bubble.text}
                    </div>
                  ))}

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
                    {(invitePhase === "enter" || inviteSent) && (
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
                        placeholder="Their mobile number"
                        aria-label="Your friend's mobile number"
                      />
                      <button type="button" className="va-skip" onClick={() => void pickContact()}>
                        Or pick from contacts
                      </button>
                      {/*
                        ‼️ HERS, OPTIONAL, AND LAST. It is below her friend's details because her
                        friend's details are what the step is for; hers buys one message when that
                        friend comes in. The placeholder says so, and leaving it blank costs her
                        nothing: no address means no message and nothing ever asks again.
                      */}
                      {askReferrerEmail && referrerOffer && (
                        <input
                          type="email"
                          value={referrerEmail}
                          onChange={(e) => setReferrerEmail(e.target.value)}
                          placeholder="Your email, to hear when they book (optional)"
                          aria-label="Your own email, optional"
                          autoComplete="email"
                          inputMode="email"
                        />
                      )}
                    </div>
                    )}

                    {/* ── Beat one: go and get it ── */}
                    {invitePhase === "instruct" && !inviteSent && (
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
                    {invitePhase === "confirm" && !inviteSent && (
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
                      ‼️ THE WORDING PICKER AND THE PREVIEW ARE `text` MODE ONLY. In `internal`
                      mode there is no message, so showing her one to choose and read would be
                      the screen describing something that will not happen.
                    */}
                    {inviteMode === "text" && (invitePhase === "enter" || inviteSent) && (
                      <>
                        <div className="va-chips" role="group" aria-label="Message wording">
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
                    )}

                    {inviteMode === "internal" && invitePhase === "enter" && !inviteSent && (
                      <p className="va-invite-note">
                        {businessName} will reach out to them directly.
                      </p>
                    )}

                    {inviteError && (
                      <p className="va-invite-error" role="alert">
                        {inviteError}
                      </p>
                    )}

                    {inviteSent ? (
                      <button type="button" className="va-send is-wide" onClick={finishInvite}>
                        Done, next question
                      </button>
                    ) : invitePhase !== "enter" ? null : inviteMode === "internal" ? (
                      <button type="button" className="va-send is-wide" onClick={recordInvite}>
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

                    <button type="button" className="va-skip" onClick={skipInvite}>
                      Skip this one
                    </button>
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
            Edit anything below before you copy it. These are your words, and only your words get
            copied.
          </p>

          <div className="rev2-read">
            {/*
              The textarea is transparent and sits on a mirror div holding the same characters, so
              a highlight lands under the sentence it is about. The two MUST keep identical text
              and identical typography or the words separate. Only background and text-decoration
              may be added to a mark.
            */}
            <div className="rev-editor">
              <div className="rev-mirror" aria-hidden="true">
                {highlighted.map((part, i) => {
                  const flagClass = part.flag ? ` rev-flag rev-flag-${part.flag}` : "";
                  if (part.hard) {
                    return (
                      <mark key={i} className={`rev-hard rev-hard-${part.hard}${flagClass}`}>
                        {part.text}
                      </mark>
                    );
                  }
                  return (
                    <span key={i} className={flagClass.trim() || undefined}>
                      {part.text}
                    </span>
                  );
                })}
                {"\n"}
              </div>
              <textarea
                className="rev-out"
                rows={10}
                value={text}
                onChange={(e) => {
                  setEdited(e.target.value);
                  setCopied(false);
                }}
              />
            </div>

            {/*
              ‼️ THE RAIL POINTS. IT DOES NOT REWRITE, AND THERE IS NO BUTTON THAT DOES.
              "This sentence runs long" is a fact about her sentence. "Try this instead" is us
              writing her review, which is the thing this tool exists not to do. That holds for
              every row below exactly as it holds for the marks they count.
            */}
            <aside className="rev2-rail" aria-label="Readability">
              <p className="rev2-rail-head">
                {reading.words} word{reading.words === 1 ? "" : "s"}
                {reading.words > 0 ? ` · grade ${Math.round(reading.grade)}` : ""}
              </p>

              {clean ? (
                <p className="rev2-rail-clear">
                  {reading.words > 0
                    ? "Nothing here is hard to read. It is ready."
                    : "Your words will be checked here as you write."}
                </p>
              ) : (
                <ul className="rev2-rail-rows">
                  {rail
                    .filter((row) => row.n > 0)
                    .map((row) => (
                      <li key={row.key}>
                        <span className={`rev2-key rev2-key-${row.mark}`} aria-hidden="true" />
                        <span className="rev2-rail-label">{row.label}</span>
                        <span className="rev2-rail-n">{row.n}</span>
                      </li>
                    ))}
                </ul>
              )}

              <p className="rev2-rail-foot">
                We point at what is shaded. We never write a replacement. Your call, and your words
                either way.
              </p>
            </aside>
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
            <span>I am a real customer of this business and these are my own words.</span>
          </label>

          <button type="button" className="rev-primary" onClick={copy} disabled={!attested}>
            {copied ? "Copied" : "Copy and go leave review"}
          </button>

          {destinations.length > 0 ? (
            <>
              <p className="rev-hint">Then paste it wherever you would like to post it.</p>
              <div className="rev-dests">
                {destinations.map((destination) => (
                  <a
                    key={destination.key}
                    href={destination.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => void store(destination.key)}
                  >
                    {destination.label}
                  </a>
                ))}
              </div>
            </>
          ) : (
            <p className="rev-hint">
              Copy your words, then paste them into your review on Google.
            </p>
          )}

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
