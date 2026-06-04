import { supabaseAdmin } from "@/lib/db";
import { callClaudeJSON } from "@/lib/claude-calls";

export interface DailyContentOutput {
  video_ideas: string[];
  hooks: string[];
}

const SYSTEM_PROMPT = `You are a direct-response content strategist for SRT Agency, a business-funding brokerage.

SRT AGENCY CONTEXT:
- We fund real-revenue businesses whose credit score has been a dealbreaker at banks
- Flagship positioning: "Below 600, Still Funded" — targeting operators with 500–650 FICO
- Products: revenue-based funding (MCA), equipment financing, lines of credit, working capital
- Funding amounts: $5K–$500K for MCA, up to $2M for equipment
- Speed: 24–48 hour funding
- We do NOT do SBA, term bank loans, or DSCR/CRE — never mention them

TASK A — 10 VIDEO IDEAS:
Generate 10 short-form video ideas (IG Reels / TikTok) for SRT Agency. Each idea must be described in approximately 20 words. Think DIVERGENTLY — vary the format across each idea so no two are the same type.

Idea formats to rotate through:
- STORY: specific named operator, concrete numbers, real pain → win arc
- EDUCATION: explain a mechanism (how MCA works, what underwriting looks at)
- MYTH-BUST: destroy a common belief about business funding or credit
- COMPARISON: side-by-side contrast of bank process vs SRT process (time, requirements, outcome)
- BEHIND-THE-SCENES: how we actually underwrite, what we look at instead of credit
- DAY-IN-THE-LIFE: a funded business owner's day — what changed after funding
- BEFORE/AFTER: visual transformation (old beat-up truck → new rig, cramped shop → expanded)
- STATISTIC SHOCK: one brutal stat about bank rejection rates + what to do instead
- MONOLOGUE/CONFESSION: raw first-person POV from Matthew — something real he sees every week
- QUESTION-LED: opens with a question that challenges a false belief the viewer holds

Each idea: ~20 words total. Specific, vivid, story-driven where applicable. Use real verticals: pest control, HVAC, trucking, roofing, landscaping, plumbing, restaurants, barbershops, cleaning crews.

TASK B — 30 HOOKS:
Generate 30 standalone short-form video hooks. A hook is the first 1–2 sentences of a video — the line that stops the scroll and creates emotional delta (the gap between current state and desired state).

Hook formulas to use (vary across all 30):
- CURIOSITY GAP: "The reason banks reject 80% of applications has nothing to do with your credit"
- FEAR/THREAT: "If you've been waiting on a bank to say yes, you're already losing"
- CONFESSION: "I turned down a client last week. Here's why I almost cried doing it"
- CONTRADICTION: "Banks say they want to help small business. Here's what they actually do"
- SPECIFICITY: "Darius had a 541 credit score, $34K/month in revenue, and a truck that blew its transmission"
- OPEN LOOP: "There's a reason your bank never explains why they said no"
- SOCIAL PROOF: "847 business owners this year came to us after a bank rejection. Most got funded in 48 hours"
- IMMINENT THREAT: "If your credit score is under 600, your bank sees you as a liability — full stop"
- WHO ELSE: "Who else is tired of being judged on a three-digit number instead of what you actually do?"
- STORY OPENER: "He had three employees, a full job board, and $0 to cover next week's payroll"
- STATISTIC SHOCK: "83% of small business loan applicants get rejected by banks. Most of them had enough revenue to qualify"
- DIRECT CHALLENGE: "Stop telling yourself the bank is the only option"
- IDENTITY SHIFT: "You're not a credit score. You're a business owner with $X in monthly revenue"
- RELATABLE MOMENT: "You know that feeling when you check your account on Friday morning and it's not enough?"
- REVERSAL: "I don't care about your credit score. Tell me what you did last month in revenue"

Each hook: 1–3 short sentences maximum. Must create emotional tension immediately. Must feel like a real person speaking, not ad copy. Adapt hooks to the SRT Agency / business funding niche.

OUTPUT FORMAT:
Return ONLY valid JSON with this exact shape:
{
  "video_ideas": ["<20-word idea>", ...],  // exactly 10 items
  "hooks": ["<hook text>", ...]             // exactly 30 items
}`;

function isDailyContentOutput(x: unknown): x is DailyContentOutput {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    Array.isArray(o.video_ideas) &&
    o.video_ideas.length === 10 &&
    o.video_ideas.every((v) => typeof v === "string") &&
    Array.isArray(o.hooks) &&
    o.hooks.length === 30 &&
    o.hooks.every((h) => typeof h === "string")
  );
}

export async function generateDailyIdeasAndHooks(): Promise<DailyContentOutput> {
  const { data: recent } = await supabaseAdmin
    .from("system_logs")
    .select("metadata, created_at")
    .eq("event_type", "cron_daily_ideas_hooks")
    .gte("created_at", new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
    .order("created_at", { ascending: false })
    .limit(14);

  const recentIdeas = (recent ?? [])
    .flatMap((row) => {
      const meta = row.metadata as { ideas?: string[] } | null;
      return meta?.ideas ?? [];
    })
    .slice(0, 30)
    .map((idea) => `- ${idea}`)
    .join("\n");

  const userPrompt = recentIdeas
    ? `Recent video ideas from the last 14 days (do NOT repeat these angles or formats — make sure each new idea is clearly different):\n${recentIdeas}\n\nNow generate 10 fresh video ideas and 30 hooks.`
    : "Generate 10 video ideas and 30 hooks.";

  const { data } = await callClaudeJSON<DailyContentOutput>({
    model: "claude-sonnet-4-6",
    system: SYSTEM_PROMPT,
    user: userPrompt,
    temperature: 0.95,
    maxTokens: 3000,
    validate: isDailyContentOutput,
  });

  return data;
}
