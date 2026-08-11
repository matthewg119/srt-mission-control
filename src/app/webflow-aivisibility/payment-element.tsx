"use client";

// The embedded Payment Element, shared by the $39 audit and the $499 Standard plan.
//
// Embedded rather than a redirect to Stripe Checkout, because the whole tripwire
// depends on the buyer never leaving the page they were just persuaded on.
//
// Only @stripe/stripe-js and @stripe/react-stripe-js appear here. The server SDK
// (`stripe`) must never be reachable from a client component.

import { useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";

// loadStripe outside the component: called on every render it would re-fetch
// Stripe.js and thrash the iframe.
let stripePromise: Promise<Stripe | null> | null = null;
function getStripeJs(): Promise<Stripe | null> {
  if (!stripePromise) {
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    stripePromise = key ? loadStripe(key) : Promise.resolve(null);
  }
  return stripePromise;
}

export interface PaymentFormProps {
  clientSecret: string;
  submitLabel: string;
  busyLabel: string;
  /** Called after Stripe confirms with no error. */
  onPaid: () => void | Promise<void>;
}

function InnerForm({ submitLabel, busyLabel, onPaid }: Omit<PaymentFormProps, "clientSecret">) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements || busy) return;
    setBusy(true);
    setError(null);

    // redirect: "if_required" keeps card payments in-page while still supporting the
    // methods that genuinely need a hop.
    const { error: err } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    });

    if (err) {
      setError(err.message ?? "That payment did not go through.");
      setBusy(false);
      return;
    }

    await onPaid();
  }

  return (
    <form onSubmit={submit}>
      <PaymentElement />
      <button className="medspa-btn" type="submit" disabled={!stripe || busy} style={{ marginTop: "1rem" }}>
        {busy ? busyLabel : submitLabel}
      </button>
      {error && (
        <p className="medspa-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export function PaymentForm({ clientSecret, ...rest }: PaymentFormProps) {
  return (
    <Elements
      stripe={getStripeJs()}
      options={{
        clientSecret,
        appearance: {
          theme: "night",
          variables: {
            colorPrimary: "#00c9a7",
            colorBackground: "#171717",
            colorText: "#d6d6d6",
            borderRadius: "8px",
          },
        },
      }}
    >
      <InnerForm {...rest} />
    </Elements>
  );
}

/**
 * Raise a 3DS challenge for an already-created subscription.
 *
 * The off-session founding charge can come back `requires_action`. Without this the
 * subscription would sit `incomplete` forever and the buyer would believe they had
 * subscribed.
 */
export async function handleNextAction(clientSecret: string): Promise<{ ok: boolean; message?: string }> {
  const stripe = await getStripeJs();
  if (!stripe) return { ok: false, message: "Payments are unavailable right now." };

  const { error } = await stripe.handleNextAction({ clientSecret });
  if (error) return { ok: false, message: error.message ?? "Authentication failed." };
  return { ok: true };
}
