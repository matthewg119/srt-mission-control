import { supabaseAdmin } from "@/lib/db";
import { microsoft } from "@/lib/microsoft";
import { DEFAULT_AUTOMATIONS, type AutomationAction, type AutomationRule } from "@/config/automations";
import { renderTemplate, type TemplateContext } from "@/lib/template-renderer";

interface OpportunityContext {
  opportunityId?: string;
  contactId?: string;
  contactName?: string;
  firstName?: string;
  businessName?: string;
  fundingAmount?: string;
  approvedAmount?: string;
  approvedLender?: string;
  stageName?: string;
  pipelineName?: string;
}

/**
 * Build template context from opportunity data
 */
function buildTemplateContext(opp: OpportunityContext): TemplateContext {
  return {
    contact_name: opp.contactName || "",
    first_name: opp.firstName || opp.contactName?.split(" ")[0] || "",
    business_name: opp.businessName || "",
    funding_amount: opp.fundingAmount || "",
    approved_amount: opp.approvedAmount || "",
    approved_lender: opp.approvedLender || "",
    agent_name: "Benjamin",
    agent_phone: "(555) 123-4567",
    agent_email: "benjamin@srtagency.com",
    company_name: "SRT Agency",
    stage_name: opp.stageName || "",
    pipeline_name: opp.pipelineName || "",
  };
}

/**
 * Execute a single automation action
 */
async function executeAction(
  action: AutomationAction,
  context: TemplateContext,
  dealId: string,
  contactId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    switch (action.type) {
      case "send_sms":
      case "send_email": {
        if (!action.templateSlug) {
          return { success: false, error: "No template slug specified" };
        }

        const { data: template } = await supabaseAdmin
          .from("message_templates")
          .select("*")
          .eq("slug", action.templateSlug)
          .eq("is_active", true)
          .single();

        if (!template) {
          return { success: false, error: `Template "${action.templateSlug}" not found or inactive` };
        }

        const renderedBody = renderTemplate(template.body, context);
        const renderedSubject = template.subject
          ? renderTemplate(template.subject, context)
          : undefined;

        console.log(
          `[Automation] ${action.type.toUpperCase()}: ${renderedSubject || ""} → ${renderedBody.slice(0, 100)}...`
        );

        let sendStatus = "queued";
        let sendError: string | undefined;

        if (action.type === "send_email" && contactId) {
          try {
            // Look up contact email
            const { data: contact } = await supabaseAdmin
              .from("contacts")
              .select("email")
              .eq("id", contactId)
              .single();

            if (contact?.email) {
              await microsoft.sendMail({
                to: contact.email,
                subject: renderedSubject || "SRT Agency",
                body: renderedBody,
                isHtml: true,
              });
              sendStatus = "sent";
            } else {
              sendStatus = "send_failed";
              sendError = "Contact has no email address";
            }
          } catch (err) {
            sendError = err instanceof Error ? err.message : String(err);
            sendStatus = "send_failed";
            console.error(`[Automation] Email send failed:`, sendError);
          }
        }

        if (action.type === "send_sms") {
          sendStatus = "skipped";
          sendError = "SMS not available — Twilio integration coming soon";
        }

        await supabaseAdmin.from("automation_logs").insert({
          opportunity_id: dealId,
          contact_id: contactId,
          action_type: action.type,
          template_slug: action.templateSlug,
          status: sendError ? "error" : "success",
          metadata: {
            rendered_body: renderedBody,
            rendered_subject: renderedSubject,
            send_status: sendStatus,
            send_error: sendError,
          },
        });

        return { success: !sendError, error: sendError };
      }

      case "add_tag":
      case "remove_tag": {
        console.log(`[Automation] ${action.type}: ${action.tag} for contact ${contactId}`);

        let tagError: string | undefined;
        if (action.tag && contactId) {
          try {
            if (action.type === "add_tag") {
              // Update contacts table directly
              const { data: contact } = await supabaseAdmin
                .from("contacts")
                .select("tags")
                .eq("id", contactId)
                .single();

              const currentTags = (contact?.tags as string[]) || [];
              if (!currentTags.includes(action.tag)) {
                await supabaseAdmin
                  .from("contacts")
                  .update({ tags: [...currentTags, action.tag] })
                  .eq("id", contactId);
              }
            } else {
              // remove_tag
              const { data: contact } = await supabaseAdmin
                .from("contacts")
                .select("tags")
                .eq("id", contactId)
                .single();

              const currentTags = (contact?.tags as string[]) || [];
              const newTags = currentTags.filter((t) => t !== action.tag);
              await supabaseAdmin
                .from("contacts")
                .update({ tags: newTags })
                .eq("id", contactId);
            }
          } catch (err) {
            tagError = err instanceof Error ? err.message : String(err);
            console.error(`[Automation] Tag operation failed:`, tagError);
          }
        }

        await supabaseAdmin.from("automation_logs").insert({
          opportunity_id: dealId,
          contact_id: contactId,
          action_type: action.type,
          status: tagError ? "error" : "success",
          metadata: { tag: action.tag, error: tagError },
        });

        return { success: !tagError, error: tagError };
      }

      case "notify_team": {
        console.log(`[Automation] NOTIFY: ${action.message}`);

        await supabaseAdmin.from("system_logs").insert({
          event_type: "automation_notify",
          description: `[Auto] ${action.message} — ${context.business_name || "Unknown"} (${context.contact_name || "Unknown"})`,
          metadata: { dealId, contactId, message: action.message },
        });

        await supabaseAdmin.from("automation_logs").insert({
          opportunity_id: dealId,
          contact_id: contactId,
          action_type: "notify_team",
          status: "success",
          metadata: { message: action.message },
        });

        return { success: true };
      }

      default:
        return { success: false, error: `Unknown action type: ${action.type}` };
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: msg };
  }
}

/**
 * Process a stage change — find matching automations and execute them
 */
export async function processStageChange(
  pipelineName: string,
  fromStage: string | null,
  toStage: string,
  opportunityData: OpportunityContext
): Promise<{ executed: number; errors: number }> {
  const matchingRules = DEFAULT_AUTOMATIONS.filter(
    (rule) =>
      rule.enabled &&
      rule.pipeline === pipelineName &&
      rule.stage === toStage &&
      rule.trigger === "on_enter"
  );

  let executed = 0;
  let errors = 0;

  for (const rule of matchingRules) {
    const context = buildTemplateContext({
      ...opportunityData,
      stageName: toStage,
      pipelineName,
    });

    await supabaseAdmin.from("automation_logs").insert({
      opportunity_id: opportunityData.opportunityId || "",
      contact_id: opportunityData.contactId || "",
      from_stage: fromStage,
      to_stage: toStage,
      action_type: "stage_change",
      status: "success",
      metadata: { rule_id: rule.id, pipeline: pipelineName },
    });

    for (const action of rule.actions) {
      if (action.delayMinutes && action.delayMinutes > 0) {
        console.log(`[Automation] Delayed action: ${action.type} in ${action.delayMinutes}min`);
      }

      const result = await executeAction(
        action,
        context,
        opportunityData.opportunityId || "",
        opportunityData.contactId || ""
      );

      if (result.success) {
        executed++;
      } else {
        errors++;
        console.error(`[Automation] Action failed: ${result.error}`);
      }
    }
  }

  return { executed, errors };
}

/**
 * Check for stale deals and fire stale automations
 */
export async function processStaleDeals(): Promise<{ checked: number; actioned: number }> {
  const staleRules = DEFAULT_AUTOMATIONS.filter(
    (rule) => rule.enabled && rule.trigger === "stale" && rule.staleDays
  );

  let checked = 0;
  let actioned = 0;

  for (const rule of staleRules) {
    const cutoff = new Date(Date.now() - (rule.staleDays! * 24 * 60 * 60 * 1000)).toISOString();

    const { data: staleDeals } = await supabaseAdmin
      .from("deals")
      .select("id, stage, pipeline, amount, updated_at, contact_id, contacts(first_name, last_name, business_name)")
      .eq("stage", rule.stage)
      .eq("pipeline", rule.pipeline)
      .lt("updated_at", cutoff);

    checked += staleDeals?.length || 0;

    for (const deal of staleDeals || []) {
      const c = deal.contacts as unknown as { first_name: string; last_name: string; business_name: string } | null;
      const contactName = c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() : "Unknown";

      // Check if we already fired this stale rule for this deal recently (last 24h)
      const { count } = await supabaseAdmin
        .from("automation_logs")
        .select("*", { count: "exact", head: true })
        .eq("opportunity_id", deal.id)
        .eq("action_type", "stale_check")
        .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      if (count && count > 0) continue;

      const context = buildTemplateContext({
        opportunityId: deal.id,
        contactId: deal.contact_id,
        contactName,
        firstName: contactName.split(" ")[0],
        businessName: c?.business_name || "",
        stageName: deal.stage,
        pipelineName: deal.pipeline,
      });

      await supabaseAdmin.from("automation_logs").insert({
        opportunity_id: deal.id,
        action_type: "stale_check",
        to_stage: rule.stage,
        status: "success",
        metadata: { rule_id: rule.id, stale_days: rule.staleDays },
      });

      for (const action of rule.actions) {
        await executeAction(action, context, deal.id, deal.contact_id || "");
      }

      actioned++;
    }
  }

  return { checked, actioned };
}
