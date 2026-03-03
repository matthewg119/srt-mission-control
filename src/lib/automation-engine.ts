import { supabaseAdmin } from "@/lib/db";
import { ghl } from "@/lib/ghl";
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
  opportunityId: string,
  contactId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    switch (action.type) {
      case "send_sms":
      case "send_email": {
        if (!action.templateSlug) {
          return { success: false, error: "No template slug specified" };
        }

        // Fetch the template
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

        // Send via GHL if it's an email and we have a contactId
        let sendStatus = "queued";
        let sendError: string | undefined;

        if (action.type === "send_email" && contactId) {
          try {
            await ghl.sendEmail(contactId, renderedSubject || "SRT Agency", renderedBody);
            sendStatus = "sent";
          } catch (err) {
            sendError = err instanceof Error ? err.message : String(err);
            sendStatus = "send_failed";
            console.error(`[Automation] GHL email send failed:`, sendError);
          }
        }

        await supabaseAdmin.from("automation_logs").insert({
          opportunity_id: opportunityId,
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
              await ghl.addContactTag(contactId, action.tag);
            }
            // GHL doesn't have a simple remove tag endpoint — skip for now
          } catch (err) {
            tagError = err instanceof Error ? err.message : String(err);
            console.error(`[Automation] Tag operation failed:`, tagError);
          }
        }

        await supabaseAdmin.from("automation_logs").insert({
          opportunity_id: opportunityId,
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
          metadata: { opportunityId, contactId, message: action.message },
        });

        await supabaseAdmin.from("automation_logs").insert({
          opportunity_id: opportunityId,
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

    // Log the stage change
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
      // Apply delay if specified (for now just log it)
      if (action.delayMinutes && action.delayMinutes > 0) {
        console.log(`[Automation] Delayed action: ${action.type} in ${action.delayMinutes}min`);
        // TODO: implement actual delay queue
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
      .from("pipeline_cache")
      .select("*")
      .eq("stage", rule.stage)
      .eq("pipeline_name", rule.pipeline)
      .lt("updated_at", cutoff);

    checked += staleDeals?.length || 0;

    for (const deal of staleDeals || []) {
      // Check if we already fired this stale rule for this deal recently (last 24h)
      const { count } = await supabaseAdmin
        .from("automation_logs")
        .select("*", { count: "exact", head: true })
        .eq("opportunity_id", deal.ghl_opportunity_id)
        .eq("action_type", "stale_check")
        .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      if (count && count > 0) continue; // Already notified today

      const context = buildTemplateContext({
        opportunityId: deal.ghl_opportunity_id,
        contactName: deal.contact_name,
        firstName: deal.contact_name?.split(" ")[0],
        businessName: deal.business_name,
        stageName: deal.stage,
        pipelineName: deal.pipeline_name,
      });

      // Log the stale check
      await supabaseAdmin.from("automation_logs").insert({
        opportunity_id: deal.ghl_opportunity_id,
        action_type: "stale_check",
        to_stage: rule.stage,
        status: "success",
        metadata: { rule_id: rule.id, stale_days: rule.staleDays },
      });

      for (const action of rule.actions) {
        await executeAction(
          action,
          context,
          deal.ghl_opportunity_id,
          ""
        );
      }

      actioned++;
    }
  }

  return { checked, actioned };
}
