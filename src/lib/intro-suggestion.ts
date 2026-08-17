// New-lead intro text suggestion. When a fresh lead with a phone arrives, draft a
// first-touch text (Stage 1 in sms-ai-engine.ts: say hi, find out what the
// business does, offer the free AI visibility check) and post it to the lead's
// SMS Slack channel with a ✅ Send button.
//
// This is suggestion-ONLY: armAutoSend:false so nothing fires without Matthew's
// explicit click. Deduped via sms_conversations.intro_suggested_at so re-running
// capture never double-suggests.
//
// IMPORTANT: do NOT call this for a lead that already has a scheduled real first
// SMS (sms_conversations.first_sms_template is set). An AI intro would double-text.

import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import { ensureSmsChannel } from "@/lib/sms-channel";
import { postImessageSuggestion } from "@/lib/imessage-suggestion";
import { generateDraft } from "@/lib/sms-ai-engine";
import { resolveTenantId } from "@/lib/persona";

interface SuggestIntroArgs {
  contactId: string;
  phone: string;
  displayName: string;
  businessName?: string | null;
  monthlyRevenue?: number | null;
  zohoLeadId?: string | null;
}

// First-touch marker fed to generateDraft as the "inbound message" so the Stage 1
// prompt produces an opener (not a reply to a real message).
const FIRST_TOUCH_MARKER =
  "[new lead, no message yet. Write a warm first-touch opener: say hi by first name, ask what the business does if it is not already obvious, and offer to run the free AI visibility check. This is cold outreach, keep it short and human. Do not invent anything about what the AI currently says about them, nothing has been checked yet.]";

export async function suggestIntroText(args: SuggestIntroArgs): Promise<{ ok: boolean; reason?: string }> {
  const { contactId, displayName, businessName, monthlyRevenue, zohoLeadId } = args;

  const normalizedPhone = normalizePhone(args.phone);
  if (!normalizedPhone) return { ok: false, reason: "invalid_phone" };

  try {
    // 1. Ensure a conversation exists for this phone.
    const { data: conv } = await supabaseAdmin
      .from("sms_conversations")
      .upsert(
        {
          contact_id: contactId,
          phone: normalizedPhone,
          portal_token: randomUUID(),
          outcome: "open",
        },
        { onConflict: "phone" }
      )
      .select("id, intro_suggested_at, first_sms_template")
      .single();

    if (!conv?.id) return { ok: false, reason: "no_conversation" };

    // 2. Dedup — already suggested an intro for this convo.
    if (conv.intro_suggested_at) return { ok: false, reason: "already_suggested" };

    // 3. Safety: never intro a lead that already has a scheduled real first SMS.
    if (conv.first_sms_template) return { ok: false, reason: "scheduled_first_sms" };

    // 4. Ensure the Slack channel.
    const channel = await ensureSmsChannel({
      conversationId: conv.id as string,
      phone: normalizedPhone,
      displayName,
      contactId,
      zohoLeadId: zohoLeadId ?? null,
      businessName: businessName ?? null,
    });
    if (!channel.channelId) return { ok: false, reason: "no_channel" };

    // 5. Draft the intro (Stage 1 Soft Pitch).
    const tenantId = (await resolveTenantId()) ?? "";
    const { draft } = await generateDraft({
      tenantId,
      stage: 1,
      inboundMessage: FIRST_TOUCH_MARKER,
      history: [],
      contact: {
        firstName: displayName.split(" ")[0] || displayName,
        businessName: businessName ?? null,
        monthlyRevenue: monthlyRevenue ?? null,
      },
    });
    if (!draft) return { ok: false, reason: "no_draft" };

    // 6. Post as suggestion-only (no auto-send).
    await postImessageSuggestion({
      channelId: channel.channelId,
      conversationId: conv.id as string,
      draft,
      armAutoSend: false,
    });

    // 7. Mark so we never double-suggest.
    await supabaseAdmin
      .from("sms_conversations")
      .update({ intro_suggested_at: new Date().toISOString() })
      .eq("id", conv.id);

    return { ok: true };
  } catch (err) {
    console.error("[intro-suggestion] error:", (err as Error).message);
    return { ok: false, reason: "error" };
  }
}
