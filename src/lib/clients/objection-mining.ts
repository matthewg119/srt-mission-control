// Real sales objections, from what prospects actually said to us, into question_bank.
//
// Matthew, 2026-09-15: "I want real sale objections." The seed list (config/objections) is what owners
// usually say. This is what OUR prospects said: texts, call-coach transcripts, the onboarding chat, and
// notes a person wrote after a call. Stored as source 'sales_call', kind 'objection', speaker 'buyer', with
// `source_ref` pointing at the message it came from and `frequency_score` counting how often it was heard.
//
// ‼️ MEASURED BEFORE IT WAS WRITTEN (2026-09-16), AND THE NUMBER IS THE FINDING. Since the AEO pivot
// (first audit activity 2026-08-18) the database holds: 0 inbound texts, 0 call-coach transcripts, 118
// notes that are all system lines ("Client: <id>", "Funnel: /home", Instagram extension reports), and 31
// call rows whose bodies are email addresses. The 30k Zoho notes and calls are the funding business and
// are excluded by date on purpose. So a run today finds almost nothing, and that is the truth rather than
// a bug: the calls are not being recorded or transcribed anywhere this can read. `objection: <words>` in
// step 13's thread is the door for what is heard on a call until they are.
//
// ‼️ VERBATIM OR NOTHING. The model is asked for exact quotes, and a quote that is not a substring of the
// message it claims to come from is dropped. A paraphrase is our words, and our words are what the
// seed list already is.

import { supabaseAdmin } from "@/lib/db";
import { callClaudeJSON } from "@/lib/claude-calls";
import { classifyPhrase } from "./phrase-kind";
import { normalizePhrase } from "./phrase-quality";
import { BELIEF_THEMES, type BeliefTheme } from "@/config/objections/aeo-agency-owner";

/** The first AEO audit activity. Everything before it is the funding business. */
export const AEO_PIVOT = "2026-08-18T00:00:00Z";

/** A message that is about funding, not about visibility, whatever its date. */
const FUNDING = /\b(mca|merchant cash|funding|loan|line of credit|factor rate|advance|underwrit|bank statements?|credit score|sba)\b/i;

/** Notes the system writes about itself. Nothing a prospect said is in them. */
const SYSTEM_ACTORS = new Set(["lead-intake", "Audit engine", "Instagram extension", "Mission Control", "system"]);

export interface MinedMessage {
  ref: string;
  text: string;
}

export interface MinedObjection {
  phrase: string;
  normalized: string;
  belief: BeliefTheme | null;
  refs: string[];
}

export async function readSalesMessages(since = AEO_PIVOT): Promise<{ messages: MinedMessage[]; counts: Record<string, number> }> {
  const messages: MinedMessage[] = [];
  const counts: Record<string, number> = {};
  const keep = (source: string, ref: string, text: unknown) => {
    const t = typeof text === "string" ? text.trim() : "";
    if (t.length < 12 || FUNDING.test(t)) return;
    messages.push({ ref: `${source}:${ref}`, text: t.slice(0, 4000) });
    counts[source] = (counts[source] ?? 0) + 1;
  };

  const sms = await supabaseAdmin
    .from("sms_messages")
    .select("id, body")
    .eq("direction", "inbound")
    .gte("sent_at", since)
    .limit(5000);
  for (const r of (sms.data ?? []) as Array<Record<string, unknown>>) keep("sms_messages", String(r.id), r.body);

  const coach = await supabaseAdmin
    .from("call_coach_transcripts")
    .select("id, text")
    .eq("speaker", "merchant")
    .gte("created_at", since)
    .limit(5000);
  for (const r of (coach.data ?? []) as Array<Record<string, unknown>>) keep("call_coach_transcripts", String(r.id), r.text);

  const chat = await supabaseAdmin
    .from("onboarding2_chat_turns")
    .select("id, content")
    .eq("role", "user")
    .gte("created_at", since)
    .limit(5000);
  for (const r of (chat.data ?? []) as Array<Record<string, unknown>>) keep("onboarding2_chat_turns", String(r.id), r.content);

  const notes = await supabaseAdmin
    .from("lead_activities")
    .select("id, actor, body")
    .in("activity_type", ["call", "note"])
    .gte("occurred_at", since)
    .limit(5000);
  for (const r of (notes.data ?? []) as Array<Record<string, unknown>>) {
    if (SYSTEM_ACTORS.has(String(r.actor ?? ""))) continue;
    const body = String(r.body ?? "");
    // An email address, a URL or a client id on its own is a log line, not a conversation.
    if (/^[\s\w.@+-]+$/.test(body) || /^(client|funnel):/i.test(body)) continue;
    keep("lead_activities", String(r.id), body);
  }

  return { messages, counts };
}

const SYSTEM = `You read messages from prospects (med spa owners) talking to a marketing agency that sells AI visibility.
Return the objections they raised: the exact words where they hesitate, push back, doubt, or say why they will not buy.
Rules:
- Quote VERBATIM, copied character for character from the message. Never paraphrase, never fix grammar.
- Only the prospect's own words. Skip anything the agency wrote, scheduling chatter, greetings, and questions that do not hesitate.
- One quote per objection, under 25 words.
- belief: which belief would make the objection fall away, one of ${Object.keys(BELIEF_THEMES).join(", ")}, or null.
No em dashes anywhere.`;

export async function extractObjections(batch: readonly MinedMessage[]): Promise<Array<{ ref: string; quote: string; belief: BeliefTheme | null }>> {
  if (batch.length === 0) return [];
  const user = batch.map((m, i) => `[${i}] ${m.text}`).join("\n\n");
  const res = await callClaudeJSON<{ objections: Array<{ index: number; quote: string; belief: string | null }> }>({
    model: "claude-haiku-4-5-20251001",
    system: SYSTEM,
    user: `Messages:\n\n${user}`,
    maxTokens: 4000,
    temperature: 0,
    schemaHint: '{ "objections": [ { "index": 0, "quote": "...", "belief": "worth_the_money" } ] }',
    validate: (v): v is { objections: Array<{ index: number; quote: string; belief: string | null }> } =>
      Array.isArray((v as { objections?: unknown } | null)?.objections),
    describeInvalid: () => 'Return { "objections": [ ... ] }, an empty list when there are none.',
    timeoutMs: 90_000,
  });

  const out: Array<{ ref: string; quote: string; belief: BeliefTheme | null }> = [];
  for (const o of res.data.objections) {
    const msg = batch[o.index];
    const quote = typeof o.quote === "string" ? o.quote.trim().replace(/^["“]|["”]$/g, "") : "";
    if (!msg || !quote) continue;
    // Verbatim or nothing.
    if (!msg.text.toLowerCase().includes(quote.toLowerCase())) continue;
    const belief = o.belief && o.belief in BELIEF_THEMES ? (o.belief as BeliefTheme) : null;
    out.push({ ref: msg.ref, quote, belief });
  }
  return out;
}

/** Merge quotes heard more than once into one row with a count. */
export function mergeMined(found: ReadonlyArray<{ ref: string; quote: string; belief: BeliefTheme | null }>): MinedObjection[] {
  const by = new Map<string, MinedObjection>();
  for (const f of found) {
    const normalized = normalizePhrase(f.quote);
    if (!normalized) continue;
    const cur = by.get(normalized);
    if (cur) {
      if (!cur.refs.includes(f.ref)) cur.refs.push(f.ref);
      cur.belief = cur.belief ?? f.belief;
    } else {
      by.set(normalized, { phrase: f.quote, normalized, belief: f.belief, refs: [f.ref] });
    }
  }
  return [...by.values()].sort((a, b) => b.refs.length - a.refs.length);
}

/**
 * Store objections as sales_call rows in a vertical. Vertical-wide (avatar null): a prospect's words are
 * about the offer, not about which of our clients' buyers they are. A repeat raises the count.
 */
export async function storeSalesObjections(args: {
  vertical: string;
  objections: readonly MinedObjection[];
}): Promise<{ stored: number; error?: string }> {
  let stored = 0;
  for (const o of args.objections) {
    const reading = classifyPhrase(o.phrase, "sales_call");
    const { data: existing } = await supabaseAdmin
      .from("question_bank")
      .select("id, frequency_score, source_ref")
      .eq("vertical", args.vertical)
      .is("avatar", null)
      .eq("normalized", o.normalized)
      .maybeSingle();

    if (existing) {
      const { error } = await supabaseAdmin
        .from("question_bank")
        .update({
          frequency_score: Number(existing.frequency_score ?? 0) + o.refs.length,
          source: "sales_call",
          kind: "objection",
          speaker: "buyer",
          belief_key: o.belief,
          source_ref: [existing.source_ref, ...o.refs].filter(Boolean).join(",").slice(0, 2000),
          excluded_at: null,
        })
        .eq("id", existing.id);
      if (error) return { stored, error: error.message };
    } else {
      const { error } = await supabaseAdmin.from("question_bank").insert({
        vertical: args.vertical,
        phrase: o.phrase,
        normalized: o.normalized,
        source: "sales_call",
        source_ref: o.refs.join(",").slice(0, 2000),
        frequency_score: o.refs.length,
        commercial_intent_score: 2,
        objection_phrase: true,
        kind: "objection",
        speaker: reading.speaker === "unknown" ? "buyer" : reading.speaker,
        belief_key: o.belief,
        avatar: null,
      });
      if (error) return { stored, error: error.message };
    }
    stored += 1;
  }
  return { stored };
}

/** Guess the belief an objection needs, by its words. The model does this for mined rows; this is for typed ones. */
export function beliefFor(text: string): BeliefTheme | null {
  const t = text.toLowerCase();
  if (/\b(cost|price|afford|expensive|worth|money|pay)\b/.test(t)) return "worth_the_money";
  if (/\b(guarantee|contract|cancel|locked|risk|catch|what if|how long)\b/.test(t)) return "low_risk";
  if (/\b(seo|agency|already|google|rank)\b/.test(t)) return "different_from_seo";
  if (/\b(chatgpt|ai|hype|real|fad|patients (actually|really))\b/.test(t)) return "ai_search_is_real";
  if (/\b(scam|trust|know you|proof|done this|myself|in-house|tried)\b/.test(t)) return "this_team_can_deliver";
  if (/\b(time|busy|later|wait)\b/.test(t)) return "now_not_later";
  if (/\b(referrals?|busy enough|full|don'?t need)\b/.test(t)) return "problem_is_real";
  return null;
}

const OBJECTION_COMMAND = /^\s*[`*_]*objection\s*:\s*([\s\S]+?)\s*[`*_]*\s*$/i;

/** `objection: <what they said>` in step 13's thread. Stores it as heard on a call and redrafts the set. */
export async function handleObjectionThreadReply(args: {
  clientId: string;
  stepKey: string | null;
  text: string;
  by: string;
}): Promise<{ message: string; after?: () => Promise<void> } | null> {
  if (args.stepKey !== "custom_question_set") return null;
  const m = OBJECTION_COMMAND.exec(args.text);
  if (!m) return null;

  const [phraseRaw, beliefRaw] = m[1].split(/\s*\|\s*belief\s*:\s*/i);
  const phrase = phraseRaw.trim().replace(/^["“]|["”]$/g, "");
  if (phrase.length < 6) return { message: ":warning: That is too short to be something a prospect said. Nothing was saved." };
  if (/—/.test(phrase)) return { message: ":warning: That contains an em dash. Type it the way they said it. Nothing was saved." };

  const { verticalFor } = await import("./harvest");
  const resolved = await verticalFor(args.clientId);
  if (!resolved.ok) return { message: `:warning: ${resolved.error}` };

  const belief =
    beliefRaw && beliefRaw.trim() in BELIEF_THEMES ? (beliefRaw.trim() as BeliefTheme) : beliefFor(phrase);
  const res = await storeSalesObjections({
    vertical: resolved.vertical,
    objections: [{ phrase, normalized: normalizePhrase(phrase), belief, refs: [`slack:${args.by}:${Date.now()}`] }],
  });
  if (res.error) return { message: `:warning: Not saved: ${res.error}` };

  return {
    message: [
      `:white_check_mark: Saved as an objection heard on a sales call: "${phrase}"`,
      belief
        ? `Belief it needs: *${BELIEF_THEMES[belief].label}*. Add \`| belief: <key>\` to change it (${Object.keys(BELIEF_THEMES).join(", ")}).`
        : `No belief matched. Add \`| belief: <key>\` (${Object.keys(BELIEF_THEMES).join(", ")}).`,
      "Every client in this vertical gets it, ranked above the seed list. Redrafting this set now.",
    ].join("\n"),
    after: async () => {
      const { generateCustomQuestionSet } = await import("./artifacts/custom-question-set");
      const out = await generateCustomQuestionSet(args.clientId);
      if (!out.ok) {
        const { notifyStep } = await import("./step-board");
        await notifyStep(args.clientId, "custom_question_set", `:warning: Not redrafted: ${out.error}`).catch(() => {});
      }
    },
  };
}
