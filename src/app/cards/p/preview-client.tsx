"use client";

// /cards/p — the card, the proof, and then the ask. In that order.
//
// ‼️ READ src/config/card-preview.ts FIRST for what this walks and why the order is the argument.
//
// ‼️ THREE STATES IN ONE SECTION, NOT THREE PAGES. The lockup at the top does not move and the
// content under it changes, which is the doctrine /cards and the review walk both settled on after
// Matthew rejected the double stacking by name on 2026-10-07. The walk only goes forwards: the
// "Back to the card" link between the first two screens was removed on 2026-10-09 at his request,
// and nothing can rewind out of the chat, because a chat that can be rewound is a chat whose
// answers nobody trusts.
//
// ‼️ THERE IS NO MODEL IN THIS PATH AND NO FETCH PER TURN. The whole script is in the bundle and
// the walk is an index into an array, the same doctrine the Virtual Agent and /cards follow.
//
// ‼️ IT POSTS ONCE, WHEN THE FIFTH ANSWER LANDS. Nothing is sent while they are typing, so a
// clinic that abandons halfway leaves no half-lead. The booking beats that follow are after the
// write on purpose: the lead is the thing worth protecting, and a clinic that answers five
// questions and never picks a time is still somebody to chase.

import { useMemo, useState } from "react";

import {
  PREVIEW_INSIDE,
  PREVIEW_SCAN,
  PREVIEW_SCRIPT,
  copyFor,
} from "@/config/card-preview";
import { designByKey } from "@/config/card-designs";
import { CardFront, ScanHand } from "./card-art";
import { PreviewChat } from "./preview-chat";

type Screen = "card" | "inside" | "chat";

export interface PreviewClientProps {
  /** The clinic's name, or the placeholder. Never empty. Resolved on the server. */
  clinicName: string;
  /** Their own future reviews host, printed on the card, or null. See CardFrontProps. */
  reviewsHost: string | null;
  /** The code, rendered server side by `qrcode`. One target, so one image for all three designs. */
  qrDataUrl: string;
  /** What the phone frame embeds. The walkthrough with its demo ribbon dropped. */
  insideSrc: string;
  /** Which design the page opened on, from ?d= or the first offered one. */
  initialDesign: string;
  /** The link's own token, handed back on submit so the answers find the right thread. */
  token: string | null;
}

export function PreviewClient(props: PreviewClientProps) {
  const [screen, setScreen] = useState<Screen>("card");
  // ‼️ READ ONCE AND NEVER SET. The picker that used to change it is gone; ?d= still seeds it on
  // the server, so a second design is a setter and a control away rather than a rewrite.
  const [designKey] = useState(props.initialDesign);
  // ‼️ THE FRAME DOES NOT START INTERACTIVE, WHICH IS A REQUIREMENT AND NOT A DETAIL. "they need
  // to click it to go inside". A clinic owner who scrolls past an embedded page has not understood
  // that it is live; one deliberate tap is what turns a picture into a product.
  const [insideLive, setInsideLive] = useState(false);
  // ‼️ WHICH DOOR THEY TOOK INTO THE CHAT, and it changes two things only: an opening bubble, and
  // a loud line on the Slack card. The five questions are identical, because a clinic that wants a
  // custom design still has to tell us who they are and what they sell.
  const [wantsCustom, setWantsCustom] = useState(false);

  const design = useMemo(() => designByKey(designKey), [designKey]);
  const copy = useMemo(() => copyFor(design.copy), [design]);

  // ── Screen one: the object ────────────────────────────────────────────────
  if (screen === "card") {
    return (
      <div className="cp-screen">
        <p className="cd-open-eyebrow">{PREVIEW_SCAN.eyebrow}</p>
        <h1 className="cp-title">{PREVIEW_SCAN.title}</h1>
        <p className="cd-open-lede">{PREVIEW_SCAN.lede}</p>

        <div className="cp-stage">
          {/* ‼️ A BUTTON AND NOT A DIV WITH AN onClick. The whole card is the tap target, it is
              the only thing on the screen that moves the walk on, and a keyboard has to reach it. */}
          <button
            type="button"
            className="cp-cardtap"
            onClick={() => setScreen("inside")}
            aria-label={PREVIEW_SCAN.tap}
          >
            <CardFront
              design={design}
              copy={copy}
              clinicName={props.clinicName}
              qrDataUrl={props.qrDataUrl}
              reviewsHost={props.reviewsHost}
            />
            <span className="cp-tap" style={{ background: design.accent, color: design.onAccent }}>
              {PREVIEW_SCAN.tap}
            </span>
          </button>
          <ScanHand design={design} />
        </div>

        {/* ‼️ THE SHORTCUT SITS WITH THE LINE ABOUT THEIR OWN PAGE, which is where he put it, and
            the two belong together: that sentence is the first thing on the screen that is about
            THEIR setup rather than about the card, so it is the moment somebody who has already
            understood the product stops reading and wants to start. It sits UNDER the sentence
            and smaller than it, because it is an escape and not an instruction.

            ‼️ AND THE TWO SWATCHES THAT WERE HERE ARE GONE. "remove the option to look at 2
            previews 2 squares". There is one card now, so a picker under it was a question with
            one answer, and it turned a demonstration into a form. */}
        <p className="cp-note">{PREVIEW_SCAN.qrNote}</p>
        {/* ‼️ TWO DOORS, AND THE ORDER IS THE POINT. The custom-design one is above the skip
            because disliking the card is the more common reason to leave this screen early, and
            because the two mean different things: this one sets wantsCustom and promises options
            in two hours, the skip below claims nothing at all. */}
        <div className="cp-minis">
          <button
            type="button"
            className="cp-mini"
            onClick={() => {
              setWantsCustom(true);
              setScreen("chat");
            }}
          >
            {PREVIEW_SCAN.customFree}
          </button>
          <button type="button" className="cp-mini cp-skip" onClick={() => setScreen("chat")}>
            {PREVIEW_SCAN.skipToChat}
          </button>
        </div>

        <button type="button" className="cd-primary cp-cta" onClick={() => setScreen("inside")}>
          {PREVIEW_SCAN.cta}
        </button>
      </div>
    );
  }

  // ── Screen two: the proof ─────────────────────────────────────────────────
  if (screen === "inside") {
    return (
      <div className="cp-screen">
        <p className="cd-open-eyebrow">{PREVIEW_INSIDE.eyebrow}</p>
        <h1 className="cp-title">{PREVIEW_INSIDE.title}</h1>
        <p className="cd-open-lede">{PREVIEW_INSIDE.lede}</p>

        <div className="cp-phone">
          <div className="cp-phone-screen">
            {/* ‼️ THE REAL PAGE, NOT A PICTURE OF IT, AND NOT A SECOND RENDERER OF IT EITHER.
                /preview/[token]'s header warns that three renderers of one page is three places for
                a theme to drift; a hand-drawn mock of the walk here would be a fourth. The frame
                loads /demo/agent, which is the same <ReferralEngine> every other surface draws,
                reaches no database and stores nothing. */}
            <iframe
              title={PREVIEW_INSIDE.title}
              src={props.insideSrc}
              loading="lazy"
              className="cp-frame"
              // Inert until tapped. `inert` is not in React's types on this version, so the
              // overlay below is what actually blocks the pointer; this is the belt.
              tabIndex={insideLive ? undefined : -1}
            />
            {!insideLive && (
              <button type="button" className="cp-veil" onClick={() => setInsideLive(true)}>
                <span
                  className="cp-tap"
                  style={{ background: design.accent, color: design.onAccent }}
                >
                  {PREVIEW_INSIDE.tap}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* ‼️ THE ROW UNDER THE PHONE IS A WAY FORWARD NOW, NOT A WAY OUT. It used to carry
            "Open it full screen", which was a link into another tab at the exact moment somebody
            had just understood what they were looking at. In its place, in grey so it cannot
            compete with the green: the door for a clinic that likes the idea and not the card.
            Matthew, 2026-10-09, on both halves of that swap. */}
        <p className="cp-note">
          {insideLive ? `${PREVIEW_INSIDE.live} ` : ""}
          <button
            type="button"
            className="cp-mini"
            onClick={() => {
              setWantsCustom(true);
              setScreen("chat");
            }}
          >
            {PREVIEW_INSIDE.custom}
          </button>
        </p>

        <button type="button" className="cd-primary cp-cta" onClick={() => setScreen("chat")}>
          {PREVIEW_INSIDE.cta}
        </button>
        <p className="cd-open-foot">{PREVIEW_INSIDE.foot}</p>
      </div>
    );
  }

  // ── Screen three: the chat ────────────────────────────────────────────────
  // The chat lives in preview-chat.tsx, shared with /cards/v2.
  return (
    <PreviewChat
      script={PREVIEW_SCRIPT}
      token={props.token}
      designKey={designKey}
      wantsCustom={wantsCustom}
    />
  );
}
