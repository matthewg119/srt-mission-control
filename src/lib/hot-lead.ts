// A lead replied to a text. That is the highest-intent signal this system gets,
// so it flips the conversation, posts the 🔥 card, and tells the caller whether
// this was the MOMENT it went hot.
//
// This is the surviving half of markZohoHotLead(), which did four things:
//   1. wrote Lead_Status = "Hot Lead" to Zoho     — deleted with the cutover
//   2. wrote a Zoho note                          — now a CRM note (lead_activities)
//   3. flipped sms_conversations.outcome          — kept
//   4. posted 🔥 to the lead's Slack channel      — kept, minus the Zoho deep link
//
// ‼️ THE RETURN VALUE IS TRANSITION-ONLY AND IT ARMS SOMETHING.
// `true` means "this reply is what made them hot", not "they are hot". It is
// what decides whether api/imessage/inbound auto-arms the AI suggestion card,
// so returning true on every inbound reply would re-arm that card on every
// message of an already-hot thread. `alreadyHot` is read from the conversation
// row before anything is written, which is the only reason the distinction
// survives a retry.

import { supabaseAdmin } from "@/lib/db";
import { addNote } from "@/lib/crm";

export interface MarkHotLeadInput {
  /** Null for an unrecognized number. The thread still goes hot, it just has
   *  no record to hang the note on. Same no-drop rule as inbound messaging:
   *  not knowing who someone is never means ignoring what they said. */
  contactId: string | null;
  replyText: string;
  slackChannelId: string | null;
}

export async function markHotLead(input: MarkHotLeadInput): Promise<boolean> {
  const { contactId, replyText, slackChannelId } = input;
  let becameHot = false;

  try {
    const { slack } = await import("@/lib/slack-bot");

    // Read the current state BEFORE writing, so a redelivered webhook does not
    // report itself as the transition.
    let alreadyHot = false;
    if (slackChannelId) {
      const { data: conv } = await supabaseAdmin
        .from("sms_conversations")
        .select("outcome")
        .eq("slack_channel_id", slackChannelId)
        .maybeSingle();
      alreadyHot = (conv?.outcome as string | null) === "hot_lead";
    }

    if (!alreadyHot) {
      if (contactId) {
        try {
          await addNote({
            contactId,
            title: "Hot Lead",
            content: `Replied to SMS: "${replyText.slice(0, 200)}"`,
            origin: "mission_control",
            actor: "inbound_sms",
          });
        } catch (noteErr) {
          // A note that did not land must not cost us the flip or the 🔥 post.
          console.error("[markHotLead] note failed:", noteErr);
        }
      }

      if (slackChannelId) {
        await supabaseAdmin
          .from("sms_conversations")
          .update({ outcome: "hot_lead" })
          .eq("slack_channel_id", slackChannelId);
      }

      becameHot = true;
    }

    if (slackChannelId) {
      await slack.postMessage(
        slackChannelId,
        `🔥 *HOT LEAD* — replied to text.${alreadyHot ? " (already marked)" : ""} Call immediately.`
      );
    }
  } catch (err) {
    console.error("[markHotLead] unexpected error:", err);
    return false;
  }

  return becameHot;
}
