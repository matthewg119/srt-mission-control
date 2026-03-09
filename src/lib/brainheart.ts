import { supabaseAdmin } from "./db";
import { slack } from "./slack-bot";
import { isAIConfigured } from "./ai";

interface PulseResult {
  summary: string;
  tasksCreated: number;
  pulseId: string;
}

interface SystemState {
  activeDealsByStage: Record<string, number>;
  totalActiveDeals: number;
  newLeads24h: number;
  staleDeals: Array<{ contact_name: string; business_name: string; stage: string; updated_at: string }>;
  pendingTasks: number;
  recentLogs: Array<{ event_type: string; description: string; created_at: string }>;
  pendingDrafts: number;
}

/** Gather all system state for BrainHeart analysis */
async function gatherSystemState(): Promise<SystemState> {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();

  // Run all queries in parallel
  const [pipelineResult, newLeadsResult, staleResult, tasksResult, logsResult, draftsResult] = await Promise.all([
    // Active deals by stage
    supabaseAdmin
      .from("deals")
      .select("stage, pipeline, contact_id, contacts(first_name, last_name, business_name)")
      .eq("pipeline", "Active Deals"),

    // New leads in last 24h
    supabaseAdmin
      .from("deals")
      .select("id")
      .eq("pipeline", "New Deals")
      .eq("stage", "Open - Not Contacted")
      .gte("created_at", yesterday),

    // Stale deals (no update in 3 days)
    supabaseAdmin
      .from("deals")
      .select("stage, updated_at, contact_id, contacts(first_name, last_name, business_name)")
      .eq("pipeline", "Active Deals")
      .lt("updated_at", threeDaysAgo)
      .not("stage", "in", '("Closed","Deal Lost")'),

    // Pending tasks
    supabaseAdmin
      .from("tasks")
      .select("id", { count: "exact" })
      .eq("status", "pending"),

    // Recent system logs
    supabaseAdmin
      .from("system_logs")
      .select("event_type, description, created_at")
      .order("created_at", { ascending: false })
      .limit(20),

    // Pending email drafts
    supabaseAdmin
      .from("email_drafts")
      .select("id", { count: "exact" })
      .eq("status", "pending_review"),
  ]);

  // Aggregate active deals by stage
  const activeDealsByStage: Record<string, number> = {};
  for (const deal of pipelineResult.data || []) {
    const stage = deal.stage as string;
    activeDealsByStage[stage] = (activeDealsByStage[stage] || 0) + 1;
  }

  // Map stale deals to expected shape
  const staleDeals = (staleResult.data || []).map((d: Record<string, unknown>) => {
    const c = d.contacts as { first_name?: string; last_name?: string; business_name?: string } | null;
    return {
      contact_name: c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() : "Unknown",
      business_name: c?.business_name || "",
      stage: d.stage as string,
      updated_at: d.updated_at as string,
    };
  });

  return {
    activeDealsByStage,
    totalActiveDeals: pipelineResult.data?.length || 0,
    newLeads24h: newLeadsResult.data?.length || 0,
    staleDeals,
    pendingTasks: tasksResult.count || 0,
    recentLogs: (logsResult.data || []) as SystemState["recentLogs"],
    pendingDrafts: draftsResult.count || 0,
  };
}

/** Analyze system state with Claude and generate insights */
async function analyzeWithClaude(
  state: SystemState,
  pulseType: string
): Promise<{ summary: string; tasks: Array<{ type: string; title: string; description: string; priority: string; department: string }> }> {
  if (!isAIConfigured()) {
    return { summary: "AI not configured. BrainHeart cannot analyze.", tasks: [] };
  }

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY!;

  const stateDescription = `
CURRENT SYSTEM STATE:
- Total Active Deals: ${state.totalActiveDeals}
- Active Deals by Stage: ${JSON.stringify(state.activeDealsByStage)}
- New Leads (24h): ${state.newLeads24h}
- Stale Deals (3+ days no activity): ${state.staleDeals.length}${state.staleDeals.length > 0 ? "\n  " + state.staleDeals.map((d) => `${d.business_name || d.contact_name} — ${d.stage}`).join("\n  ") : ""}
- Pending Tasks: ${state.pendingTasks}
- Pending Email Drafts: ${state.pendingDrafts}
- Recent Activity: ${state.recentLogs.slice(0, 5).map((l) => l.description).join("; ")}
`;

  const promptByType: Record<string, string> = {
    morning_briefing: `Generate a morning briefing for the CEO. Include: today's priorities, deals needing attention, suggested call order, any urgent items. Be motivational but practical.`,
    routine: `Generate a mid-day pulse check. What's changed, what needs attention, any blocked deals, suggestions for the rest of the day.`,
    checkin: `Generate an end-of-day summary. What was accomplished, what's still open, what to prep for tomorrow. Keep it brief and actionable.`,
  };

  const systemPrompt = `You are BrainHeart, the AI brain of SRT Agency (business financing brokerage). You think autonomously and create actionable insights.

${stateDescription}

${promptByType[pulseType] || promptByType.routine}

Respond with ONLY valid JSON (no markdown) in this format:
{
  "summary": "Your analysis in 2-4 sentences, direct and actionable",
  "tasks": [
    {
      "type": "follow_up|call_prep|bank_statement_needed|stale_deal|new_lead_contact|general|daily_action",
      "title": "Short task title",
      "description": "Brief description of what to do",
      "priority": "urgent|high|medium|low",
      "department": "general|underwriting|submissions"
    }
  ]
}

Rules:
- Only create tasks that are genuinely needed based on the data
- Don't create duplicate tasks for things that already have pending tasks
- Be specific with task titles (include business names when relevant)
- Max 5 tasks per pulse
- If everything looks good, return an empty tasks array with a positive summary`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        messages: [{ role: "user", content: systemPrompt }],
      }),
    });

    if (!response.ok) {
      console.error("BrainHeart Claude error:", await response.text());
      return { summary: "Failed to analyze — API error.", tasks: [] };
    }

    const data = await response.json();
    const text = data.content?.find((c: { type: string }) => c.type === "text")?.text || "";

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { summary: "Failed to parse analysis.", tasks: [] };

    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error("BrainHeart analysis error:", error);
    return { summary: "Analysis failed due to an error.", tasks: [] };
  }
}

/** Main pulse function — called by cron */
export async function runBrainHeartPulse(
  pulseType: "morning_briefing" | "routine" | "checkin"
): Promise<PulseResult> {
  // 1. Gather system state
  const state = await gatherSystemState();

  // 2. Analyze with Claude
  const analysis = await analyzeWithClaude(state, pulseType);

  // 3. Save pulse to database
  const { data: pulse } = await supabaseAdmin
    .from("brainheart_pulses")
    .insert({
      pulse_type: pulseType,
      summary: analysis.summary,
      findings: { state },
      actions_taken: [],
      tasks_created: analysis.tasks.map((t) => t.title),
      metrics: {
        activeDeals: state.totalActiveDeals,
        newLeads: state.newLeads24h,
        staleDeals: state.staleDeals.length,
        pendingTasks: state.pendingTasks,
      },
    })
    .select("id")
    .single();

  const pulseId = pulse?.id || "";

  // 4. Create tasks from analysis (skip duplicates)
  let tasksCreated = 0;
  for (const task of analysis.tasks) {
    // Check for duplicate (same title, still pending)
    const { data: existing } = await supabaseAdmin
      .from("tasks")
      .select("id")
      .eq("title", task.title)
      .eq("status", "pending")
      .limit(1);

    if (existing && existing.length > 0) continue;

    await supabaseAdmin.from("tasks").insert({
      type: task.type,
      title: task.title,
      description: task.description,
      priority: task.priority,
      department: task.department,
      source: "brainheart",
      pulse_id: pulseId || null,
    });
    tasksCreated++;
  }

  // 5. Post to Slack
  if (slack.isConfigured() && slack.channels.ceo) {
    const blocks = slack.formatPulseReport({
      summary: analysis.summary,
      metrics: {
        "Active Deals": state.totalActiveDeals,
        "New Leads (24h)": state.newLeads24h,
        "Stale Deals": state.staleDeals.length,
        "Pending Tasks": state.pendingTasks + tasksCreated,
      },
      tasks: analysis.tasks.map((t) => ({ title: t.title, priority: t.priority })),
    });

    await slack.postMessage(
      slack.channels.ceo,
      `BrainHeart ${pulseType === "morning_briefing" ? "Morning Briefing" : pulseType === "checkin" ? "End of Day" : "Pulse"}: ${analysis.summary}`,
      blocks
    );
  }

  // 6. Random check-in (20% chance on non-morning pulses)
  if (pulseType === "routine" && Math.random() < 0.2 && slack.isConfigured() && slack.channels.ceo) {
    const checkins = [
      "Hey Matthew — just checking in. Pipeline looks solid today. Keep pushing! 💪",
      "Quick thought: those stale deals might be worth a second touch. Want me to prep call notes?",
      "Numbers are looking good this week. Let me know if you need anything.",
      "Just ran a pulse check — everything's running smooth. You're killing it. 🔥",
      "Reminder: I'm here whenever you need me. Just say the word.",
    ];
    const msg = checkins[Math.floor(Math.random() * checkins.length)];
    await slack.postMessage(slack.channels.ceo, msg);
  }

  return {
    summary: analysis.summary,
    tasksCreated,
    pulseId,
  };
}
