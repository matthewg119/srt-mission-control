// The tools the Today chat gets, and the four it deliberately does not.
//
// ‼️ FOUR TOOLS REMOVED, AND THAT IS THE WHOLE REASON THIS IS A SEPARATE ENDPOINT.
//
// send_email, send_sms and send_template DISPATCH IMMEDIATELY: ai-tools.ts calls
// microsoft.sendMail and returns "Email sent", with no approval card anywhere on that path.
// Meanwhile every CLIENT tool is a read, and ai.ts tells the model so in words: "You cannot tick a
// delivery step, approve a keyword set, publish a page or send anything to a client."
//
// This page is where somebody will type "email the three clinics we have not contacted" and mean
// DRAFT them. Leaving the sending tools in this set is the single largest risk on the surface, and
// the fix is REMOVAL, not a sentence in the prompt: a prompt is an instruction and an absent tool is
// a fact. reachinbox/thread-agent.ts makes the identical move for the identical reason.
//
// ‼️ THIS DOES NOT CLOSE THE GAP ON /api/chat, WHICH STILL HAS ALL FOUR. That is worth fixing on its
// own and is not this file's job. Worse, it is now slightly more dangerous than it was: somebody who
// learns here that "the chat drafts" will carry that belief to the other one.
//
// ‼️ schedule_followup STAYS, unlike in the reachinbox lane. That lane excluded it because its input
// contains a stranger's pasted words; this lane's input is Matthew alone, and it queues a Slack
// draft rather than sending anything.

import { AI_TOOLS } from "@/lib/ai-tools";

const SENDS_TO_A_HUMAN = new Set(["send_email", "send_sms", "send_template", "enroll_in_sequence"]);

/** The four doorways this surface adds. Three touch only today's view; one starts a draft run. */
export const PLAN_TOOLS = [
  {
    name: "get_today_plan",
    description:
      "Read today's plan: everything waiting on a person across every live client, grouped by role (onboarding, writing, delivery, outreach) with a score, a reason and an estimate. Use this whenever asked what to do today, what is waiting, or what to start with.",
    input_schema: {
      type: "object",
      properties: {
        role: {
          type: "string",
          enum: ["onboarder", "writer", "delivery", "outreach"],
          description: "Only this lane. Omit for all of them.",
        },
      },
      required: [],
    },
  },
  {
    name: "reorder_today_item",
    description:
      "Move one item to the top of its lane in today's plan. Changes only the order this one person sees today, and is undone by one drag. Use it when told to do something first.",
    input_schema: {
      type: "object",
      properties: {
        item_key: { type: "string", description: "The item's key, exactly as get_today_plan returned it." },
      },
      required: ["item_key"],
    },
  },
  {
    name: "defer_today_item",
    description:
      "Move one item out of today's lanes and into Not today, until tomorrow. It is not deleted and it comes back. Use it when told something is not happening today.",
    input_schema: {
      type: "object",
      properties: {
        item_key: { type: "string", description: "The item's key, exactly as get_today_plan returned it." },
      },
      required: ["item_key"],
    },
  },
  {
    name: "run_ops_workflow",
    description:
      "Start a workflow that is about the business rather than one client, such as reviewing the day or listing who has not been contacted. It produces DRAFTS and posts them to #alerts-infra. It returns as soon as it has started, so say it has started and never describe output you have not seen.",
    input_schema: {
      type: "object",
      properties: {
        workflow_key: { type: "string", description: "day_review or uncontacted_sweep." },
        note: { type: "string", description: "What was asked for, in his words. Optional." },
      },
      required: ["workflow_key"],
    },
  },
];

export const TODAY_TOOLS = [
  ...AI_TOOLS.filter((t) => !SENDS_TO_A_HUMAN.has((t as { name: string }).name)),
  ...PLAN_TOOLS,
];

export const PLAN_TOOL_NAMES = new Set(PLAN_TOOLS.map((t) => t.name));

/**
 * What this surface may and may not do, said to the model in the words it will repeat back.
 *
 * ‼️ THE PROMPT SAYS IT AND THE TOOL SET ENFORCES IT. Either alone is not enough: a prompt without
 * the removal is a suggestion, and a removal without the prompt makes the model apologise for a
 * capability it never had rather than offering the thing it can do.
 */
export const TODAY_PREAMBLE = [
  "You are looking at Matthew's plan for today inside Mission Control. He is the only person who talks to you here.",
  "",
  "WHAT YOU CAN DO WITHOUT ASKING:",
  "- Read anything: the plan, any client's profile, keywords, page plan, pages, audits, documents and Slack history, and the whole CRM.",
  "- Reorder or defer items on TODAY'S plan. It changes only his own view of his own day and one drag undoes it.",
  "- Start a client workflow or an ops workflow. Both produce drafts and post them to Slack. Say STARTED, and never describe output you have not seen.",
  "- Write CRM bookkeeping: log a call, add a note, set a status, snooze, open or close a follow-up task.",
  "",
  "WHAT YOU CANNOT DO, AT ALL, ON THIS SURFACE:",
  "- Send an email, a text or a template to anybody. Those tools are not available to you here. When he asks you to send something, draft it through a workflow and tell him where the approval card is.",
  "- Tick, skip or complete a delivery step. Name the step and hand back its board link instead.",
  "- Publish a page, approve a keyword set, or change a page plan.",
  "",
  "When you list work, use the reasons the plan gives you, verbatim. They are why one thing is above another and he will ask.",
  "Say the estimate as an estimate. It is a stated number, not a measurement.",
].join("\n");
