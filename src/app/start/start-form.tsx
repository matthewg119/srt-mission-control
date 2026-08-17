"use client";

import { useEffect, useRef, useState } from "react";
import { clean, validEmail } from "@/lib/medspa/validate";

export function StartForm() {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  // Off screen rather than display:none, and never autofilled.
  const [trap, setTrap] = useState("");
  // The server rejects anything submitted within two seconds of the page rendering.
  const renderedAt = useRef<number>(0);

  useEffect(() => {
    renderedAt.current = Date.now();
  }, []);

  async function submit() {
    const address = clean(email, 254);
    if (!validEmail(address)) {
      setError("That email address does not look right.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/clients/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: address,
          firstName: clean(firstName, 80),
          company_url_hp: trap,
          renderedAt: renderedAt.current,
        }),
      });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        setError(json.error || "That did not work. Try once more.");
        setBusy(false);
        return;
      }

      // Straight into the form. A null redirect means the link could not be signed, in
      // which case say so rather than sending them nowhere.
      if (json.redirect) {
        window.location.assign(json.redirect);
        return;
      }
      setSent(true);
    } catch {
      setError("That did not work. Check your connection and try once more.");
    }
    setBusy(false);
  }

  if (sent) {
    return (
      <div className="rounded-xl bg-white/5 p-8 text-center">
        <h1 className="mb-3 text-xl font-bold">Check your email</h1>
        <p className="text-sm text-white/70">
          We have sent your onboarding link to {email}.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-white/5 p-6 sm:p-8">
      <h1 className="mb-2 text-xl font-bold sm:text-2xl">Let&rsquo;s get started</h1>
      <p className="mb-6 text-sm text-white/60">
        Enter your email and we will take you straight to the questions. About ten minutes,
        and you can stop and come back to it.
      </p>

      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium">Your email</label>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="you@yourbusiness.com"
            className="w-full rounded-lg border border-white/15 bg-white/5 px-4 py-3 text-white placeholder-white/30 outline-none focus:border-[#00C9A7]"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium">
            Your first name <span className="text-white/40">(optional)</span>
          </label>
          <input
            type="text"
            autoComplete="given-name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            className="w-full rounded-lg border border-white/15 bg-white/5 px-4 py-3 text-white outline-none focus:border-[#00C9A7]"
          />
        </div>
      </div>

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

      {error && <p className="mt-4 text-sm text-red-300">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={busy}
        className="mt-6 w-full rounded-lg bg-[#00C9A7] px-6 py-3.5 font-bold text-[#04252b] disabled:opacity-60"
      >
        {busy ? "One moment" : "Start"}
      </button>

      <p className="mt-4 text-center text-xs text-white/35">
        We will also email you the link, so you can finish it later on any device.
      </p>
    </div>
  );
}
