"use client";

// The four boxes a referred friend fills in, and the one request they make.
//
// ‼️ THE FRIEND IS GIVING US THEIR OWN DETAILS, WHICH IS THE WHOLE POINT AND THE WHOLE DIFFERENCE.
// Everywhere else in this lane a contact detail arrives second hand: the patient typed her
// friend's number at a counter and the friend had agreed to nothing. Here they are typing it
// themselves, into a form on the clinic's own domain, having been told what it is for. That is
// consent, and it is why this is the shape Matthew chose over a three-way text.
//
// ‼️ NO TRACKING, NO PIXEL, NO ANALYTICS ON THIS PAGE. It is reached by one person holding one
// link. There is nothing here to optimise and anything measuring it would be measuring a named
// individual's behaviour on their friend's recommendation.

import { useState } from "react";

/** The browser's half of the check. The route's copy is the boundary; this one is a courtesy. */
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;.]{2,}$/;

export function ClaimForm({
  code,
  businessName,
  askEmail,
}: {
  code: string;
  businessName: string;
  /**
   * ‼️ ONLY TRUE WHEN THE CLINIC ACTUALLY SENDS THE CONFIRMATION. A form that asks for an address
   * nothing uses is a form asking for something it does not need, and this page is read by
   * somebody doing the clinic a favour. When it is false there is no field and no column written.
   */
  askEmail: boolean;
}) {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [service, setService] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailOk = !askEmail || EMAIL.test(email.trim());
  const canSend = name.trim().length > 0 && contact.trim().length > 0 && emailOk;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/hub/reviews/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code,
          name: name.trim(),
          contact: contact.trim(),
          service: service.trim() || undefined,
          // Absent rather than empty when the field was never shown, so the route stores null.
          email: askEmail ? email.trim() : undefined,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!json.ok) {
        setError(json.error ?? "That did not go through. Please give us a call instead.");
        return;
      }
      setDone(true);
    } catch {
      // ‼️ THE FALLBACK IS A PHONE CALL, NOT A RETRY LOOP. This person is doing the clinic a
      // favour; a spinner that keeps failing is where they give up.
      setError("That did not go through. Please give us a call instead.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rev-claim-done">
        <h2>You are on the list</h2>
        <p className="hub-lede">
          {businessName} has your details and will be in touch to book you in.
        </p>
      </div>
    );
  }

  return (
    <div className="rev-claim">
      <label className="rev-claim-field">
        <span>Your name</span>
        <input
          type="text"
          value={name}
          autoComplete="name"
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <label className="rev-claim-field">
        <span>Phone or email</span>
        <input
          type="text"
          value={contact}
          autoComplete="tel"
          onChange={(e) => setContact(e.target.value)}
        />
      </label>

      {askEmail && (
        <label className="rev-claim-field">
          {/* Required, and the label says what it buys. An address asked for with no reason given
              is the field people put nonsense into. */}
          <span>Email, so we can send this to you</span>
          <input
            type="email"
            value={email}
            autoComplete="email"
            inputMode="email"
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
      )}

      <label className="rev-claim-field">
        {/* Optional, and labelled optional. The clinic can ask on the phone; a required field
            here is one more reason to close the tab. */}
        <span>What are you interested in? (optional)</span>
        <input type="text" value={service} onChange={(e) => setService(e.target.value)} />
      </label>

      {error && (
        <p className="va-invite-error" role="alert">
          {error}
        </p>
      )}

      <button type="button" className="rev-primary" onClick={submit} disabled={!canSend || busy}>
        {busy ? "Sending" : "Claim my offer"}
      </button>

      <p className="rev-hint">
        {businessName} will use this to contact you about this offer. Nothing else.
        {askEmail ? " Your confirmation is sent on their behalf by SRT, their agency." : ""}
      </p>
    </div>
  );
}
