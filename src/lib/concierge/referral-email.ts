// The email that goes out when somebody finishes the AI Referral Engine walk.
//
// ‼️ IT EXISTS BECAUSE THE WALK PROMISES IT. Step four says "we will send your download link promptly"
// and the closing line says "plus the email we already sent you". Those are Matthew's words and both were
// false until this file shipped. A door on a live page that promises a prospect an email we never send is
// the one failure in this lane that costs a real person something.
//
// ‼️ MICROSOFT GRAPH, NOT RESEND. Every email in this repo goes out through microsoft.sendMail, and the
// Resend key in Vercel has never been wired to anything. clients/welcome-email.ts records the same thing.
//
// ‼️ AND EVERY LINK IS CONDITIONAL, BECAUSE A DEAD LINK IS WORSE THAN A MISSING ONE. The Loom does not
// exist as a recording yet, the download does not exist as a file at all, and a resume link needs a
// session that recorded which page it started on. Each one is left out when it is not there, and the
// email reads correctly with any combination of them missing. That is the test a conditional link has to
// pass, and it is why the copy never says "the three links below".
//
// ‼️ "DOWNLOAD" IS NOT WHAT THE PRODUCT IS, AND THAT IS A COPY QUESTION FOR MATTHEW, NOT A BUG TO HIDE.
// The AI Referral Engine is a hosted tool: config/pitch.ts sells it as "set up on your site", step 17 of
// the board is `referral_engine_preview`, and the walk itself ends with a technician installing it. There
// is no file in this repo to download and no env var naming one. So when REFERRAL_ENGINE_ASSET_URL is
// unset this email describes the install instead of linking to nothing, which is honest but is not what
// the walk's step four led them to expect. Two words in that step would close the gap.

import { guard } from "@/lib/copy-guard";

/** Where the free tool is downloaded from, when there is a file. Unset today; see the header. */
function assetUrl(): string | null {
  return (process.env.REFERRAL_ENGINE_ASSET_URL ?? "").trim() || null;
}

/**
 * The Loom, when one has been recorded.
 *
 * ‼️ THE SLOT SHIPS BEFORE THE RECORDING, so nothing waits on it and no deploy is needed when it exists.
 * The script Matthew should record against is in this file, below.
 */
function loomUrl(): string | null {
  return (process.env.REFERRAL_ENGINE_LOOM_URL ?? "").trim() || null;
}

/**
 * THE LOOM SCRIPT, written generically from the recording Matthew sent on 2026-09-25.
 *
 * ‼️ WHAT HE SENT WAS A WALKTHROUGH FOR ONE PROSPECT, NOT AN EXPLAINER, and it could not be used as it
 * stood. It names a competitor ("web plastic surgery"), a city, and "right now you scored 21 out of 100".
 * Sent to everybody, every recipient watches a walkthrough of somebody else's score. It also carries a
 * guarantee carve-out written for plastic surgeons specifically, and quotes $350 a month where the offer
 * on record is $349. So this keeps his structure and his argument and drops everything that belonged to
 * that one call.
 *
 * ‼️ THE 6% TO 45% FIGURES STAY UNCITED, WHICH IS MATTHEW'S CALL. I raised that this email goes to
 * strangers about their own business and that the doctrine is no number no process measured; he chose to
 * keep them as written. Recorded here so that when somebody asks where the figure came from, the answer
 * is "the Loom", not a measurement.
 *
 * It is exported so it is in the repo rather than in a chat log, and so the recording and the email
 * cannot drift apart without somebody editing this file.
 */
export const REFERRAL_LOOM_SCRIPT = [
  "1. What this is. The AI Referral Engine is free, and it is the tool that turns the patients you",
  "   already have into the reviews an assistant can quote. Not more reviews. Better ones.",
  "",
  "2. Why reviews. Assistants weigh what other people say about you more heavily than anything you",
  "   write about yourself. That is the lever that moves fastest, and it is the one you already own.",
  "",
  "3. The three pillars, and why missing one keeps you invisible.",
  "   Findable: you can be first on Google and still not be one of the three names an assistant says.",
  "   Familiar: reviews, directories and mentions are what it reads to decide you are a safe answer.",
  "   Fresh: a page written last year answers last year's question.",
  "",
  "4. The shift. Last year about 6 in 100 people asked an assistant to find a local business. This",
  "   year it is 45. That is the wave, and the three pillars are how you catch up with it.",
  "",
  "5. Who I am. Matthew, founder of Search Retrieval Tactics. Three years as marketing director for a",
  "   business financing firm and three at a marketing agency before this. What we do now is help",
  "   clinic owners book more appointments using AI.",
  "",
  "6. The two doors. The free tool is yours either way and you keep it. If you want us to do the",
  "   content and the pages around it as well, that is $349 a month. Both are on the link below.",
  "",
  "NOT IN THE VIDEO, and this is deliberate: no score, no named competitor, no city, and no guarantee.",
  "The report has their score in it. A number said out loud in a video that goes to everybody is a",
  "number about somebody else.",
] as const;

const SUBJECT = guard("referral email subject", "Your AI Referral Engine, and the install call");

const SIGNATURE = [
  "<p style=\"margin:24px 0 0;color:#5b6672;font-size:14px\">",
  "Matthew<br>Search Retrieval Tactics",
  "</p>",
].join("");

export interface ReferralEmailParams {
  to: string;
  firstName?: string | null;
  /** The page they were on, with a signed resume token. Null when the session recorded no host. */
  resumeUrl: string | null;
  /** The free vs five appointments picker. */
  onboardingUrl: string;
}

/**
 * Send it. Throws nothing the caller has to handle: a failure is logged and swallowed by the caller,
 * because a person who has just filled in a form must not see a 500 because our mailbox is down.
 */
export async function sendReferralWelcome(params: ReferralEmailParams): Promise<void> {
  const { microsoft } = await import("@/lib/microsoft");

  const hello = params.firstName?.trim() ? `Hi ${params.firstName.trim()},` : "Hi,";
  const asset = assetUrl();
  const loom = loomUrl();

  const parts: string[] = [
    `<p style="margin:0 0 16px">${hello}</p>`,
    // ‼️ THE FIRST LINE CHANGES WITH WHAT ACTUALLY EXISTS, rather than promising a link that is not there.
    asset
      ? `<p style="margin:0 0 16px">Here is your AI Referral Engine: <a href="${asset}">download it here</a>. It is yours to keep.</p>`
      : `<p style="margin:0 0 16px">Your AI Referral Engine is ready to be set up. It runs on your own site rather than as a file to download, which is what the install call is for.</p>`,
  ];

  if (loom) {
    parts.push(
      `<p style="margin:0 0 16px">Before the call, this is worth four minutes: ` +
        `<a href="${loom}">what the AI Referral Engine does and why reviews are the lever</a>.</p>`
    );
  }

  if (params.resumeUrl) {
    parts.push(
      `<p style="margin:0 0 16px">If you closed the chat before we finished, ` +
        `<a href="${params.resumeUrl}">pick it back up here</a>. It opens on the same page and carries on ` +
        `where you left off. That link works for three days.</p>`
    );
  }

  parts.push(
    `<p style="margin:0 0 16px">And if you would rather just book the call, ` +
      `<a href="${params.onboardingUrl}">pick a time here</a>.</p>`
  );

  parts.push(SIGNATURE);

  await microsoft.sendMail({
    to: params.to,
    subject: SUBJECT,
    body: `<div style="font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#14181f">${parts.join("")}</div>`,
    isHtml: true,
    fromMailbox: process.env.OUTREACH_MAILBOX || "matthew@srtagency.com",
  });
}
