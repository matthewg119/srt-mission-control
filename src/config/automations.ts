// Stage automation rules — what happens when a lead enters a stage, and what
// happens when it sits there too long.
//
// This file used to carry 18 rules across two MCA pipelines (Underwriting,
// Shopping, Pre-Approved, VC / DL, Contracts Out/In, Pending Stips, Funding
// Call, In Funding). Those stages no longer exist; the rules below are keyed
// to the stages in stage-display.ts and nothing else.
//
// The `pipeline` field is kept because automation-engine.ts and the dashboard
// both read it, but there is only one pipeline now.

import {
  STAGE_NO_CONTACT,
  STAGE_WORKING,
    STAGE_FOLLOW_UP,
  STAGE_CLOSED,
  STAGE_NOT_INTERESTED,
  STAGE_HOT,
} from "./stage-display";

export interface AutomationAction {
  type: "send_sms" | "send_email" | "add_tag" | "remove_tag" | "notify_team";
  templateSlug?: string;
  tag?: string;
  message?: string;
  delayMinutes?: number; // 0 = immediate
}

export interface AutomationRule {
  id: string;
  pipeline: "Pipeline";
  stage: string;
  trigger: "on_enter" | "stale";
  staleDays?: number; // Only for stale trigger
  actions: AutomationAction[];
  enabled: boolean;
  description: string;
}

export const DEFAULT_AUTOMATIONS: AutomationRule[] = [
  {
    id: "no-contact-welcome",
    pipeline: "Pipeline",
    stage: STAGE_NO_CONTACT,
    trigger: "on_enter",
    actions: [
      { type: "send_sms", templateSlug: "new-lead-welcome-sms" },
      { type: "send_email", templateSlug: "new-lead-welcome-email" },
      { type: "add_tag", tag: "new-lead" },
    ],
    enabled: true,
    description: "Welcome SMS + Email when a new lead comes in",
  },
  {
    id: "no-contact-stale",
    pipeline: "Pipeline",
    stage: STAGE_NO_CONTACT,
    trigger: "stale",
    staleDays: 3,
    actions: [
      { type: "notify_team", message: "Lead has been sitting for 3+ days without contact" },
    ],
    enabled: true,
    description: "Alert the team when new leads go cold",
  },
  {
    id: "working-followup",
    pipeline: "Pipeline",
    stage: STAGE_WORKING,
    trigger: "on_enter",
    actions: [
      { type: "send_sms", templateSlug: "contacted-followup-sms" },
      { type: "send_email", templateSlug: "contacted-followup-email", delayMinutes: 30 },
      { type: "remove_tag", tag: "new-lead" },
      { type: "add_tag", tag: "contacted" },
    ],
    enabled: true,
    description: "Follow-up SMS + delayed email after first contact",
  },
  {
    id: "working-stale",
    pipeline: "Pipeline",
    stage: STAGE_WORKING,
    trigger: "stale",
    staleDays: 3,
    actions: [
      { type: "notify_team", message: "Contacted 3+ days ago with no reply, worth a call" },
    ],
    enabled: true,
    description: "Surface contacted leads that went quiet",
  },
  {
    id: "follow-up-entered",
    pipeline: "Pipeline",
    stage: STAGE_FOLLOW_UP,
    trigger: "on_enter",
    actions: [
      { type: "add_tag", tag: "follow-up" },
      { type: "notify_team", message: "Lead moved to Follow Up" },
    ],
    enabled: true,
    description: "Flag a live conversation to the team",
  },
  {
    id: "follow-up-stale",
    pipeline: "Pipeline",
    stage: STAGE_FOLLOW_UP,
    trigger: "stale",
    staleDays: 2,
    actions: [
      { type: "notify_team", message: "Live conversation with no touch in 2 days" },
    ],
    enabled: true,
    description: "A missed day here is what costs the yes",
  },
  {
    id: "closed",
    pipeline: "Pipeline",
    stage: STAGE_CLOSED,
    trigger: "on_enter",
    actions: [
      { type: "remove_tag", tag: "follow-up" },
      { type: "add_tag", tag: "closed" },
    ],
    enabled: true,
    description: "Clean up tags when a lead closes out",
  },
  {
    id: "not-interested",
    pipeline: "Pipeline",
    stage: STAGE_NOT_INTERESTED,
    trigger: "on_enter",
    actions: [
      { type: "remove_tag", tag: "follow-up" },
      { type: "remove_tag", tag: "new-lead" },
      { type: "add_tag", tag: "not-interested" },
    ],
    enabled: true,
    // Tags only. setLeadStatus has already flipped do_not_contact by the time
    // this runs, so there is deliberately nothing here that sends.
    description: "Strip the working tags when a lead comes off the list for good",
  },
];
