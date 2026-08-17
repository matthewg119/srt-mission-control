export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import {
  STAGE_NO_CONTACT,
  STAGE_WORKING,
  STAGE_EMAIL_PITCH,
  STAGE_NEGOTIATING,
  STAGE_CLOSED,
} from "@/config/stage-display";

// Stage templates for the five-stage AEO pipeline.
//
// The eighteen that used to live here were MCA stage templates (Pending Stips,
// Funding Call, In Funding, Funded) written against stages no lead can be in
// any more. Categories come from stage-display so they cannot drift again.
//
// The slugs referenced by src/config/automations.ts are preserved:
// new-lead-welcome-sms/email and contacted-followup-sms/email.
//
// House rule, and it applies to everything below: no em dashes.

const SEED_TEMPLATES = [
  {
    name: "New Lead Welcome SMS",
    slug: "new-lead-welcome-sms",
    type: "SMS",
    category: STAGE_NO_CONTACT,
    subject: null,
    body: `Hi {{first_name}}, Matthew from SRT Agency. We build the part of your website that AI assistants can actually read, so they send you customers instead of naming someone else. First one is free. Worth a quick chat? Reply STOP to opt out.`,
    variables: ["first_name"],
  },
  {
    name: "New Lead Welcome Email",
    slug: "new-lead-welcome-email",
    type: "Email",
    category: STAGE_NO_CONTACT,
    subject: "Can AI find {{business_name}}?",
    body: `Hi {{first_name}},

More people are asking an AI assistant for a business like yours than are typing it into a search box. Most sites have nothing on them an assistant can read, so it names somebody else.

We fix that. We build one section of your own site, in your words, structured so an assistant can quote it: what you do, who you do it for, where, and what it costs.

The first one is free. No card, nothing to install, and you keep it either way.

Just reply "yes" and I'll get it started.

{{agent_name}}
SRT Agency
{{agent_phone}}`,
    variables: ["first_name", "business_name", "agent_name", "agent_phone"],
  },
  {
    name: "Contacted Follow-Up SMS",
    slug: "contacted-followup-sms",
    type: "SMS",
    category: STAGE_WORKING,
    subject: null,
    body: `Hi {{first_name}}, Matthew from SRT following up. Still happy to build that first section for {{business_name}} at no cost. Just say the word.`,
    variables: ["first_name", "business_name"],
  },
  {
    name: "Contacted Follow-Up Email",
    slug: "contacted-followup-email",
    type: "Email",
    category: STAGE_WORKING,
    subject: "Following up, {{first_name}}",
    body: `Hi {{first_name}},

Good speaking with you. To put it plainly: we build one section of {{business_name}}'s site that AI assistants can read and cite, so that when someone asks for a business like yours, you get named.

The first build is free and takes about a week. You do not have to write anything.

Just reply "yes" and I'll get it started.

{{agent_name}}
SRT Agency
{{agent_phone}}`,
    variables: ["first_name", "business_name", "agent_name", "agent_phone"],
  },
  {
    name: "Pitch Sent SMS",
    slug: "pitch-sent-sms",
    type: "SMS",
    category: STAGE_EMAIL_PITCH,
    subject: null,
    body: `Hi {{first_name}}, just sent over the details on the free build for {{business_name}}. Reply here if anything is unclear.`,
    variables: ["first_name", "business_name"],
  },
  {
    name: "Pitch Nudge Email",
    slug: "pitch-nudge-email",
    type: "Email",
    category: STAGE_EMAIL_PITCH,
    subject: "Did this reach you?",
    body: `Hi {{first_name}},

Checking that my last note landed. The offer is unchanged: one section of your site that AI can read and cite, built by us, at no cost.

If the timing is wrong, that is a fine answer. Just tell me and I will leave it.

Just reply "yes" and I'll get it started.

{{agent_name}}
SRT Agency`,
    variables: ["first_name", "agent_name"],
  },
  {
    name: "Negotiating Recap Email",
    slug: "negotiating-recap-email",
    type: "Email",
    category: STAGE_NEGOTIATING,
    subject: "Where we landed",
    body: `Hi {{first_name}},

Recapping so we are on the same page.

We build the first section for {{business_name}} at no cost. You review it before anything goes live. If it does what we say it does, we talk about covering the rest of the site.

Anything you want changed before I start?

{{agent_name}}
SRT Agency
{{agent_phone}}`,
    variables: ["first_name", "business_name", "agent_name", "agent_phone"],
  },
  {
    name: "Kickoff SMS",
    slug: "kickoff-sms",
    type: "SMS",
    category: STAGE_NEGOTIATING,
    subject: null,
    body: `{{first_name}}, starting on the first section for {{business_name}} today. I will send it over for your review before anything goes live.`,
    variables: ["first_name", "business_name"],
  },
  {
    name: "Closed Out Email",
    slug: "closed-out-email",
    type: "Email",
    category: STAGE_CLOSED,
    subject: "Leaving this here",
    body: `Hi {{first_name}},

Closing this out on my end so I stop filling your inbox.

If AI visibility becomes relevant for {{business_name}} later, reply to this and I will pick it straight back up. The free first build stands whenever you want it.

{{agent_name}}
SRT Agency`,
    variables: ["first_name", "business_name", "agent_name"],
  },
];

export async function POST() {
  try {
    // Check if templates already exist
    const { count } = await supabaseAdmin
      .from("message_templates")
      .select("*", { count: "exact", head: true });

    if (count && count > 0) {
      return NextResponse.json({
        message: `${count} templates already exist. Skipping seed.`,
        seeded: 0,
      });
    }

    const { data, error } = await supabaseAdmin
      .from("message_templates")
      .insert(SEED_TEMPLATES)
      .select();

    if (error) throw error;

    return NextResponse.json({
      message: `Seeded ${data?.length || 0} templates successfully.`,
      seeded: data?.length || 0,
    });
  } catch (error) {
    console.error("Template seed error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to seed templates" },
      { status: 500 }
    );
  }
}
