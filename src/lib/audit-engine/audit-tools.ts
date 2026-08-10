// The tools the audit-thread agent can reach.
//
// Design rule: every tool here is a THIN wrapper over a generator that already exists and is
// already governed. The agent decides WHICH one to run and with what context; it never writes an
// email, a script or a number itself. That is deliberate. `buildCoachNotes` is built in code so a
// figure cannot be hallucinated, `draft-linter.ts` rejects a draft that breaks the doctrine, and
// `lintSpoken` fails a script that invents a claim. Routing through them keeps all of that intact.
//
// ‼️ NOTHING HERE SENDS. `microsoft.sendMail` and `microsoft.sendDraft` are not imported by this
// file and must not be. The worst outcome of a bad reasoning run is a wrong draft sitting in a
// Slack thread waiting for a 👍. Same doctrine as the price gate: absent beats forbidden.
//
// Big artifacts POST THEMSELVES to the thread and return a short receipt. A call script is 3,000
// tokens of formatted Slack markdown; making the agent re-emit it would triple the cost of every
// run and let it paraphrase a card whose exact wording is the point.

import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import type { ToolExecutionResult } from "@/lib/ai-tools";
import { searchLeads, getLead, getLeadNotes } from "@/lib/zoho";
import { loadReportView, computeWeightedScore, type ReportView } from "./report-view";
import { readThreadTruth, formatThreadTruth, type ThreadTruth } from "./thread-truth";
import {
  buildCallFacts,
  buildCoachNotes,
  buildFollowupScript,
  buildCallScript,
  formatFollowupScript,
  formatCallScript,
} from "./call-script";
import { draftFollowupEmail } from "./followup-email";
import {
  draftPermissionEmail,
  draftRevealMessage,
  draftSequenceEmail,
  draftObjectionReply,
} from "./email-assistant";
import { getNicheAvatars, formatAvatarsCard } from "./niche-avatars";
import { getIntelBrief, formatBriefMarkdown } from "./intel-brief";
import type { AuditReportRow } from "./types";

export interface AuditToolContext {
  report: AuditReportRow;
  channel: string;
  threadTs: string;
  /** Cached per run so five tools do not make five Graph round-trips or five score computations. */
  cache: { view?: ReportView; truth?: ThreadTruth };
}

export const AUDIT_THREAD_TOOLS = [
  {
    name: "get_report",
    description:
      "The AI visibility audit for this business: score, how many buyer questions they appear in and are absent from, the exact absent questions in buyer language, and which competitors the engines recommend instead. Call this before saying anything numeric. These are the ONLY numbers that exist for this prospect.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_email_history",
    description:
      "What has ACTUALLY happened with this prospect over email, read live from Outlook: what we sent and when, whether they replied and what they said verbatim, and how many days it has been silent. Call this before drafting anything or answering any question about where things stand. The stored stage on the report is frequently out of date and this is not.",
    input_schema: {
      type: "object" as const,
      properties: {
        force: { type: "boolean", description: "Bypass the 10 minute cache. Use when he says something just happened." },
      },
      required: [],
    },
  },
  {
    name: "get_zoho_record",
    description:
      "The CRM record for this business: lead status, owner, source, and the notes Matthew has typed after previous calls. Use when asked about call history, what was said before, or the state of the relationship outside email.",
    input_schema: {
      type: "object" as const,
      properties: {
        email: { type: "string", description: "Email to look up. Defaults to the prospect on this report." },
        phone: { type: "string", description: "Phone to look up instead." },
      },
      required: [],
    },
  },
  {
    name: "get_avatars",
    description:
      "The 3 customer types quietly costing this niche money and the 3 worth chasing, with ticket sizes and the question each one asks AI. Cached 30 days per niche. Use for positioning, for who to point the offer at, and whenever the answer needs a customer the owner can picture.",
    input_schema: {
      type: "object" as const,
      properties: { force: { type: "boolean", description: "Rebuild instead of using the 30 day cache." } },
      required: [],
    },
  },
  {
    name: "get_niche_brief",
    description:
      "Researched intel on this niche: the pains, the horror stories, where owners talk, what keeps them up, the objections. Slow (web research) and cached 30 days. Use when the answer needs to sound like someone who knows the trade.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "draft_email",
    description:
      "Write an email and post it to this thread for review. YOU pick the kind, based on where the conversation actually is. Always call get_email_history first: the right kind depends on what was really sent and whether they answered.",
    input_schema: {
      type: "object" as const,
      properties: {
        kind: {
          type: "string",
          enum: ["permission", "nudge", "reveal", "followup", "objection", "belief"],
          description:
            "permission = first cold email, earns a yes, no price no links. nudge = another pre-pitch touch, still no price. reveal = they said yes, hand over the report + video + price. followup = they already got something and went quiet, OR they replied and need an answer. objection = they pushed back and you are answering it. belief = the post-reveal ladder.",
        },
        instruction: {
          type: "string",
          description: "What Matthew asked for, in his words, plus any angle you decided on. Passed to the drafter verbatim.",
        },
        step: { type: "number", description: "For nudge (2 to 5) and belief (2 to 5) only." },
        prospect_said: { type: "string", description: "For objection only: what they actually said." },
      },
      required: ["kind", "instruction"],
    },
  },
  {
    name: "edit_draft",
    description:
      "Edit the draft currently queued in this thread, in place, and repost it. Use this when he is reacting to a draft that is already on screen: 'tighter', 'drop the score line', 'say it warmer'. Do NOT use draft_email for an edit, it rewrites from scratch and throws away everything he already fixed.",
    input_schema: {
      type: "object" as const,
      properties: {
        instruction: { type: "string", description: "What to change, in his words. This is an edit, not a rewrite." },
      },
      required: ["instruction"],
    },
  },
  {
    name: "make_call_script",
    description:
      "Build the phone script and post it to this thread. Slow, 30 to 60 seconds. followup = they have NOT seen the video, the job is to earn the reply and nothing is sold, no price is quoted. closing = they have seen it and are warm, this is the selling script. Pick by what get_email_history actually shows, never by whether a video exists: a recorded video proves it was made, not watched.",
    input_schema: {
      type: "object" as const,
      properties: {
        mode: { type: "string", enum: ["followup", "closing"] },
        context: { type: "string", description: "Anything that should aim the script, e.g. what they said last time." },
      },
      required: ["mode"],
    },
  },
  {
    name: "make_coach_notes",
    description:
      "Post the COACH NOTES block that gets pasted into the SRT Call Coach extension before dialing. Built entirely in code from the audit, so every figure in it is real.",
    input_schema: {
      type: "object" as const,
      properties: { mode: { type: "string", enum: ["followup", "closing"] } },
      required: ["mode"],
    },
  },
  {
    name: "set_stage",
    description:
      "Correct where this prospect is in the outreach flow. Use when Matthew states something that happened outside the system, e.g. 'I already sent the loom' or 'they said yes'. This is what stops later drafts writing as if it never happened.",
    input_schema: {
      type: "object" as const,
      properties: {
        stage: {
          type: "string",
          enum: ["awaiting_intake", "drafted", "revealed"],
          description: "revealed = they have been given the report, the video and the price.",
        },
      },
      required: ["stage"],
    },
  },
  {
    name: "save_asset",
    description: "Store the Loom recording URL or the free redesign URL on this report so later drafts can reference it.",
    input_schema: {
      type: "object" as const,
      properties: {
        kind: { type: "string", enum: ["loom", "redesign"] },
        url: { type: "string" },
      },
      required: ["kind", "url"],
    },
  },
];

/** Shorthand so every branch returns the same shape. */
function ok(data: unknown): ToolExecutionResult {
  return { content: typeof data === "string" ? data : JSON.stringify(data), structuredData: data };
}

async function view(ctx: AuditToolContext): Promise<ReportView> {
  if (!ctx.cache.view) ctx.cache.view = await loadReportView(ctx.report);
  return ctx.cache.view;
}

async function truth(ctx: AuditToolContext, force = false): Promise<ThreadTruth> {
  if (!ctx.cache.truth || force) ctx.cache.truth = await readThreadTruth(ctx.report, { force });
  return ctx.cache.truth;
}

/** Post a card to the thread and hand the agent a receipt instead of the card. */
async function post(ctx: AuditToolContext, text: string): Promise<void> {
  await slack.postThreadReply(ctx.channel, ctx.threadTs, text);
}

export function makeAuditExecutor(ctx: AuditToolContext) {
  return async function executeAuditTool(
    name: string,
    input: Record<string, unknown>
  ): Promise<ToolExecutionResult> {
    try {
      switch (name) {
        case "get_report": {
          const v = await view(ctx);
          const w = computeWeightedScore(v);
          return ok({
            business: ctx.report.client_name ?? ctx.report.website,
            website: ctx.report.website,
            city: ctx.report.city,
            business_type: ctx.report.business_type,
            buyer_persona: ctx.report.buyer_persona,
            score_out_of_100: w.score,
            appears_in: `${w.organicAppeared} of ${w.organicTotal} organic buyer questions`,
            absent_from: `${w.organicTotal - w.organicAppeared} of ${w.organicTotal} organic buyer questions`,
            questions_they_are_absent_from: v.prompts.filter((p) => !p.isBranded && !p.appeared).map((p) => p.prompt),
            recommended_instead: v.mostRecommended.slice(0, 6),
            report_url: ctx.report.slug ? `https://mission.srtagency.com/r/${ctx.report.slug}` : null,
            loom_recorded: Boolean(ctx.report.loom_url),
            redesign_built: Boolean(ctx.report.redesign_url),
            note: "These are the only numbers that exist for this prospect. Do not round them, derive new ones, or add any.",
          });
        }

        case "get_email_history": {
          const t = await truth(ctx, input.force === true);
          return ok(formatThreadTruth(t));
        }

        case "get_zoho_record": {
          const email =
            (input.email as string | undefined) ?? ctx.report.prospect_email ?? ctx.report.requester_email ?? undefined;
          const phone = input.phone as string | undefined;
          if (!email && !phone) return ok("No email or phone on this report, so there is nothing to look up in Zoho.");

          const found = await searchLeads(phone ? { phone } : { email: email! });
          if (!found.length) return ok(`No Zoho record found for ${phone ?? email}. This business may not be in the CRM yet.`);

          const lead = found[0];
          const id = String(lead.id ?? "");
          const [full, notes] = await Promise.all([
            id ? getLead(id).catch(() => lead) : Promise.resolve(lead),
            id ? getLeadNotes(id, 8).catch(() => []) : Promise.resolve([]),
          ]);
          return ok({
            zoho_record: `Leads/${id}`,
            company: full.Company,
            name: [full.First_Name, full.Last_Name].filter(Boolean).join(" ") || null,
            email: full.Email,
            phone: full.Phone,
            lead_status: full.Lead_Status,
            lead_source: full.Lead_Source,
            website: (full as Record<string, unknown>).Website ?? null,
            notes: notes.map((n) => ({
              at: n.Created_Time,
              title: n.Note_Title,
              text: (n.Note_Content ?? "").slice(0, 600),
            })),
            note: "Notes are what Matthew typed after previous calls. They are the record of what was said on the phone.",
          });
        }

        case "get_avatars": {
          const v = await view(ctx);
          const result = await getNicheAvatars(ctx.report, v, { force: input.force === true });
          await post(ctx, formatAvatarsCard(result, ctx.report));
          const a = result.avatars;
          return ok({
            posted: true,
            best: a.best.map((b) => ({ label: b.label, ticket: b.ticket, asksAI: b.aiQuestion })),
            worst: a.worst.map((w) => ({ label: w.label, whyItHurts: w.whyItHurts })),
            pick: a.pick,
            isReposition: a.isReposition,
          });
        }

        case "get_niche_brief": {
          const result = await getIntelBrief(ctx.report);
          await post(ctx, formatBriefMarkdown(result, ctx.report));
          return ok({ posted: true, brief: result.brief });
        }

        case "draft_email": {
          const v = await view(ctx);
          const kind = String(input.kind);
          const instruction = String(input.instruction ?? "");
          let subject = "";
          let body = "";
          let replyTo: string | null = null;
          const flags: string[] = [];

          if (kind === "followup") {
            const t = await truth(ctx);
            const d = await draftFollowupEmail(ctx.report, v, t, instruction);
            subject = d.subject;
            body = d.body;
            replyTo = d.replyToMessageId;
            flags.push(...d.flags);
            if (d.removedLinks.length) flags.push(`Links removed by policy: ${d.removedLinks.join(", ")}`);
          } else if (kind === "reveal") {
            const d = await draftRevealMessage(ctx.report, v, instruction || null);
            subject = d.subject;
            body = d.body;
          } else if (kind === "objection") {
            const said = String(input.prospect_said ?? instruction);
            const d = await draftObjectionReply(ctx.report, v, said);
            subject = d.subject;
            body = d.body;
          } else if (kind === "belief") {
            const d = await draftSequenceEmail(ctx.report, v, Number(input.step ?? 2));
            subject = d.subject;
            body = d.body;
          } else {
            // permission | nudge. Step 1 is email 1; 2 to 5 are the pre-pitch ladder.
            const step = kind === "nudge" ? Number(input.step ?? 2) : 1;
            const d = await draftPermissionEmail(ctx.report, v, step, ctx.report.intake_answers);
            subject = d.subject;
            body = d.body;
            if (d.removedLinks.length) flags.push(`Links removed by policy: ${d.removedLinks.join(", ")}`);
            if (d.formatNote) flags.push(d.formatNote);
          }

          // Stored so the existing "1" picker can turn it into an Outlook draft, exactly as it does
          // for every other drafter. pending_drafts is overwritten per draft, which is its contract.
          await supabaseAdmin
            .from("audit_reports")
            .update({
              pending_drafts: [{ label: kind, subject, body, replyToMessageId: replyTo ?? undefined }],
            })
            .eq("id", ctx.report.id);

          const label = kind === "followup" ? "Follow-up" : kind === "reveal" ? "Reveal" : kind === "objection" ? "Objection reply" : kind === "belief" ? "Belief email" : kind === "nudge" ? `Nudge ${input.step ?? 2}` : "Email 1 · permission";
          await post(
            ctx,
            [
              `:email: *${label}*${replyTo ? " · replies on the existing thread" : " · sends as a new email"}`,
              "",
              `*Subject:* ${subject}`,
              "",
              body,
              flags.length ? `\n:warning: ${flags.join("\n:warning: ")}` : "",
              "\n_Reply_ `1` _to create the Outlook draft. Anything you type edits it._",
            ]
              .filter(Boolean)
              .join("\n")
          );

          return ok({
            posted: true,
            kind,
            subject,
            body_preview: body.slice(0, 500),
            threads_as_reply: Boolean(replyTo),
            flags,
          });
        }

        case "edit_draft": {
          const queued = (ctx.report.pending_drafts ?? [])[0];
          if (!queued) {
            return ok("There is no draft queued in this thread to edit. Write one with draft_email first.");
          }
          const v = await view(ctx);
          // Dynamic import on purpose: thread-assistant.ts imports thread-agent.ts, which imports
          // this file, so a static import here closes a cycle that builds fine in dev and fails on
          // a cold module graph. Resolving it at call time keeps the graph acyclic.
          const { reviseQueuedDraft } = await import("./thread-assistant");
          const done = await reviseQueuedDraft(
            ctx.report,
            ctx.channel,
            ctx.threadTs,
            v,
            String(input.instruction ?? "")
          );
          return ok(
            done
              ? { posted: true, edited: queued.label ?? "the queued draft" }
              : "Nothing was queued, so there was nothing to edit."
          );
        }

        case "make_call_script": {
          const v = await view(ctx);
          const mode = input.mode === "closing" ? "closing" : "followup";
          const extra = String(input.context ?? "");

          // Both formatters already return the card AND its coach-notes block, and the existing
          // `call`/`close` commands post them as two messages. Same two messages here, so a script
          // the agent produced is byte-identical to one the command produced.
          if (mode === "followup") {
            const { facts, script, warnings } = await buildFollowupScript(ctx.report, v, extra);
            const { script: card, notes } = formatFollowupScript(facts, script, warnings);
            await post(ctx, card);
            await post(ctx, notes);
          } else {
            const { facts, script, warnings } = await buildCallScript(ctx.report, v, extra);
            const { script: card, notes } = formatCallScript(facts, script, warnings);
            await post(ctx, card);
            await post(ctx, notes);
          }
          return ok({ posted: true, mode, note: "The script and the coach notes are both in the thread." });
        }

        case "make_coach_notes": {
          const v = await view(ctx);
          const facts = await buildCallFacts(ctx.report, v);
          const mode = input.mode === "closing" ? "closing" : "followup";
          await post(ctx, `:clipboard: Coach notes. Paste this into SRT Call Coach before you dial.\n\`\`\`\n${buildCoachNotes(facts, mode)}\n\`\`\``);
          return ok({ posted: true, mode });
        }

        case "set_stage": {
          const stage = String(input.stage);
          await supabaseAdmin.from("audit_reports").update({ outreach_stage: stage }).eq("id", ctx.report.id);
          ctx.report = { ...ctx.report, outreach_stage: stage as AuditReportRow["outreach_stage"] };
          // The cached truth derived its stage from the old value, so drop it.
          ctx.cache.truth = undefined;
          return ok(`Stage set to "${stage}". Later drafts will write from there.`);
        }

        case "save_asset": {
          const url = String(input.url ?? "");
          if (!/^https?:\/\//i.test(url)) return ok("That is not a URL, so nothing was stored. Give me the full https link.");
          const col = input.kind === "redesign" ? "redesign_url" : "loom_url";
          await supabaseAdmin.from("audit_reports").update({ [col]: url }).eq("id", ctx.report.id);
          ctx.report = { ...ctx.report, [col]: url } as AuditReportRow;
          return ok(`Stored as ${col}. Note this proves the asset EXISTS, not that they watched or read it.`);
        }

        default:
          return ok(`No such tool: ${name}`);
      }
    } catch (e) {
      // A failed tool must not kill the run. The agent sees the failure and can say so, or route
      // around it, which is strictly better than the thread answering ":warning: Couldn't draft that".
      const msg = (e as Error)?.message ?? String(e);
      console.error(`[audit-tools] ${name} failed:`, msg);
      return ok(`TOOL FAILED (${name}): ${msg}. Tell Matthew plainly what could not be done rather than working around it silently.`);
    }
  };
}
