// The "start me myself" screen: what it asks, and where the answers land.
//
// A system_logs ROW AND NO MIGRATION, the same call /onboardingfree and /LHR both make. The
// real destination is a Slack thread reply; this row is the durable copy so a Slack outage
// cannot lose it, and the replay guard.
//
// ‼️ THIS DOES NOT PROVISION A CLIENT. startPilot() takes one of six pilot seats, sets
// billing_status, can be refused outright by the seat cap, and opens the whole delivery
// board. Somebody who tapped a button on an ad page has not bought anything, so none of that
// may happen here. When they convert, Matthew runs /start and these answers are sitting in
// the thread waiting to be typed in once.
//
// ‼️ THE FIELDS ARE THE ONES startPilot() WANTS AND NOTHING ELSE. Every question here is a
// field on the clients row that a kickoff call would otherwise be spent collecting: the NAP
// address is the spine of the product, and the competitor is what the first audit compares
// against. Nothing is asked that we would not use in week one.
//
// This constant cannot live in the route file. Next's App Router validates route module
// exports against a fixed list, so a route.ts exporting anything but its HTTP methods and
// the known config fields fails `next build` with a type error.

import { guard } from "@/lib/copy-guard";

export const CHATGPT_ADS_SETUP_EVENT = "chatgpt_ads_setup";

export interface SetupField {
  key: string;
  label: string;
  kind: "text" | "tel";
  required?: boolean;
  help?: string;
  placeholder?: string;
}

export const SETUP_FIELDS: SetupField[] = [
  {
    key: "contact_name",
    label: guard("s name", "Your full name"),
    kind: "text",
    required: true,
    placeholder: "Jordan Reyes",
  },
  {
    key: "address_line1",
    label: guard("s addr", "Clinic street address"),
    kind: "text",
    required: true,
    help: guard(
      "s addr help",
      "Exactly as it appears on your Google listing. When your address disagrees with itself across the web, the engines stop repeating any version of it."
    ),
    placeholder: "1420 Battleground Ave, Suite 200",
  },
  {
    key: "city",
    label: guard("s city", "City"),
    kind: "text",
    required: true,
    placeholder: "Greensboro",
  },
  {
    key: "state",
    label: guard("s state", "State"),
    kind: "text",
    required: true,
    placeholder: "NC",
  },
  {
    key: "postal_code",
    label: guard("s zip", "ZIP"),
    kind: "text",
    required: true,
    placeholder: "27408",
  },
  {
    key: "clinic_phone",
    label: guard("s phone", "The number on your listing"),
    kind: "tel",
    required: false,
    help: guard("s phone help", "Leave it blank if it is the mobile you already gave us."),
  },
  {
    key: "top_competitor",
    label: guard("s comp", "Who do you lose patients to?"),
    kind: "text",
    required: false,
    help: guard("s comp help", "One name is enough. It is the first thing we measure against."),
  },
];

export const SETUP_COPY = {
  heading: guard("s h", "Five things and you are set up."),
  body: guard(
    "s body",
    "This is everything we would have asked on the call. Once it is in, we can start on your listing the same week."
  ),
  cta: guard("s cta", "Send it"),
  doneHeading: guard("s done h", "That is everything."),
  doneBody: guard(
    "s done body",
    "We have what we need. You will hear from us with the first draft of your page, and there is nothing else for you to do."
  ),
  expired: guard(
    "s expired",
    "This link has expired. Links last 30 days. Call (336) 833-2303 and we will send a new one."
  ),
  broken: guard(
    "s broken",
    "This link is not valid. Call (336) 833-2303 and we will send a new one."
  ),
} as const;
