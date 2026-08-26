// The general onboarding link. Public, no token.
//
// This is the URL that goes on Stripe's thank-you page: "Start your onboarding". One
// field, because everything else is asked properly on the next screen and a long form in
// front of a customer who has just paid is how momentum dies.

import type { Metadata } from "next";
import { StartForm } from "./start-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Start onboarding",
  // Nothing here should be indexed. It is a post-purchase destination, not a landing page.
  robots: { index: false, follow: false },
};

export default function StartPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0a0a0a] px-4 py-10 text-white">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center text-lg font-bold tracking-wide">SRT Agency</div>
        <StartForm />
      </div>
    </main>
  );
}
