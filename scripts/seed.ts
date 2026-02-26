import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://lzxgdmfkekansixvetgh.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

async function seed() {
  console.log("🌱 Seeding database...\n");

  // Seed Knowledge Base entries
  const knowledgeEntries = [
    {
      title: "Company Overview",
      content: "SRT Agency LLC (Scaling Revenue Together) is an AI-first business financing brokerage. We connect small business owners with the right financing through our network of lending partners. We are NOT a direct lender. Website: srtagency.com. Portal: mission.srtagency.com. CRM: GoHighLevel. Phone: Quo. Email: Microsoft 365. Team: Matthew (CEO/Founder) — strategy, marketing, key relationships. Benjamin (Sales) — daily lead conversions, target 3-7 per day.",
      category: "General",
      tags: ["company", "overview", "team"],
    },
    {
      title: "Products & Requirements",
      content: "We offer 4 financing products: 1) Revolving Line of Credit ($1K-$275K, 650+ credit, 6-24mo terms, ~24hr approval — only pay interest on drawn amount), 2) Hybrid Line of Credit ($1K-$275K, 500+ credit, 6-24mo terms, ~24hr approval — lower credit requirement), 3) Equipment Financing ($1K-$2M, 550+ credit, 12-84mo terms, same-day approval — requires equipment quote + tax return), 4) Working Capital ($5K-$2M, 550+ credit, 3-18mo terms, ~4hr approval — fastest funding). Pre-qualifying: US/Canada/Puerto Rico business, checking account required, $120K+ annual revenue preferred.",
      category: "Products",
      tags: ["products", "financing", "requirements"],
    },
    {
      title: "Sales Process SOP",
      content: "Lead Processing: 1) Lead enters via website form → GHL webhook creates contact + opportunity in Application Pull stage, 2) Auto-SMS sent to lead, 3) Internal notification to team via email + Teams, 4) Benjamin calls within 2-4 hours, 5) Qualify: verify revenue, time in business, credit score, funding needs, 6) If qualified: collect full application, submit to matching funders, 7) Follow up within 24-48hrs with offers, 8) Help merchant select best offer, process funding. Pipeline stages: Application Pull → Pre-Approval → Docs Needed → Docs Received → Submitted → Contracts Out → Waiting Confirmation → Funded/Declined.",
      category: "SOPs",
      tags: ["sales", "process", "sop", "leads"],
    },
    {
      title: "Pipeline Stage Definitions",
      content: "Application Pull: Initial application received, not yet reviewed. Pre-Approval: Application reviewed, basic qualification passed, ready for document collection. Documents Needed: Waiting for voided check, drivers license, bank statements. Documents Received: All docs collected, ready to submit to lenders. Submitted to Lenders: Application package sent to funding partners. Contracts Out: Approval received from lender, contracts sent to merchant for signing. Waiting Confirmation: Contracts signed by merchant, waiting for lender to confirm and disburse funds. Funded: Deal closed, money disbursed to merchant. Declined: Application declined by all submitted lenders.",
      category: "Pipeline",
      tags: ["pipeline", "stages", "definitions"],
    },
    {
      title: "Trustpilot Review Campaign",
      content: "Strategy: Give away free energy drinks at universities near Greensboro, NC to generate Trustpilot reviews for SRT Agency. Plan: 1) Purchase energy drinks in bulk, 2) Set up table at university campus common areas, 3) Offer free drink for honest Trustpilot review, 4) QR code linking to SRT Agency Trustpilot review page, 5) Brief talking points about SRT Agency, 6) Collect email opt-ins where possible, 7) Target: 50+ reviews in first campaign. Status: PLANNED.",
      category: "Marketing",
      tags: ["marketing", "reviews", "trustpilot", "campaign"],
    },
    {
      title: "Business Vision",
      content: "SRT Agency is an AI-first MCA brokerage with planned exit at 12-18 months. Key initiatives: 1) Automated Submission Engine for multi-funder submissions, 2) Sales Rep Performance Engine with AI call scoring, 3) Merchant Communication System for lifecycle automation. Month 6+: Productize internal AI tools as SaaS for other MCA brokers. The Mission Control portal itself is the core product — white-label for other brokers at $299-499/month. Build competitive moat through proprietary data and AI workflows.",
      category: "Strategy",
      tags: ["vision", "strategy", "exit", "saas"],
    },
  ];

  // Check if entries already exist
  const { count } = await supabase
    .from("knowledge_entries")
    .select("*", { count: "exact", head: true });

  if (count === 0) {
    const { error } = await supabase.from("knowledge_entries").insert(knowledgeEntries);
    if (error) console.error("❌ Knowledge entries error:", error.message);
    else console.log("✅ 6 knowledge entries seeded");
  } else {
    console.log("⟳ Knowledge entries already exist, skipping");
  }

  // Seed AI Configuration integration entry
  const { data: existingAiConfig } = await supabase
    .from("integrations")
    .select("*")
    .eq("name", "AI Configuration")
    .single();

  if (!existingAiConfig) {
    await supabase.from("integrations").insert({
      name: "AI Configuration",
      type: "AI",
      status: "disconnected",
      config: { additionalContext: "", priorities: "" },
    });
    console.log("✅ AI Configuration integration entry seeded");
  }

  // Seed Updates
  const { count: updateCount } = await supabase
    .from("updates")
    .select("*", { count: "exact", head: true });

  if (updateCount === 0) {
    // v1.0.0 - Deployed
    const { data: v100 } = await supabase.from("updates").insert({
      version: "v1.0.0",
      title: "Mission Control Launch",
      status: "deployed",
      description: "Initial deployment of SRT Mission Control with dashboard, AI assistant, knowledge base, pipeline kanban, GHL integration, and update planning system.",
      deployed_date: new Date().toISOString(),
    }).select().single();

    if (v100) {
      await supabase.from("update_tasks").insert([
        { update_id: v100.id, task: "Auth system with NextAuth + Supabase", file_path: "src/lib/auth.ts", status: "done", sort_order: 0 },
        { update_id: v100.id, task: "Dashboard with stats and quick actions", file_path: "src/app/dashboard/page.tsx", status: "done", sort_order: 1 },
        { update_id: v100.id, task: "AI Assistant with streaming", file_path: "src/app/dashboard/assistant/page.tsx", status: "done", sort_order: 2 },
        { update_id: v100.id, task: "Knowledge Base CRUD", file_path: "src/app/dashboard/knowledge/page.tsx", status: "done", sort_order: 3 },
        { update_id: v100.id, task: "Pipeline Kanban", file_path: "src/app/dashboard/pipeline/page.tsx", status: "done", sort_order: 4 },
        { update_id: v100.id, task: "GHL API integration", file_path: "src/lib/ghl.ts", status: "done", sort_order: 5 },
        { update_id: v100.id, task: "Integrations management", file_path: "src/app/dashboard/integrations/page.tsx", status: "done", sort_order: 6 },
        { update_id: v100.id, task: "Updates system", file_path: "src/app/dashboard/updates/page.tsx", status: "done", sort_order: 7 },
      ]);
    }
    console.log("✅ v1.0.0 update seeded");

    // v1.1.0 - Planned
    const targetV110 = new Date();
    targetV110.setDate(targetV110.getDate() + 7);
    const { data: v110 } = await supabase.from("updates").insert({
      version: "v1.1.0",
      title: "Quo Phone + GHL Live Sync",
      status: "planned",
      description: "Connect Quo phone system API for call logging and transcription. Enable real-time GHL pipeline sync with webhooks instead of manual sync button.",
      target_date: targetV110.toISOString().split("T")[0],
    }).select().single();

    if (v110) {
      await supabase.from("update_tasks").insert([
        { update_id: v110.id, task: "Quo API client library", file_path: "src/lib/quo.ts", status: "pending", sort_order: 0 },
        { update_id: v110.id, task: "Call log sync endpoint", file_path: "src/app/api/quo/sync/route.ts", status: "pending", sort_order: 1 },
        { update_id: v110.id, task: "Call transcription viewer component", file_path: "src/components/call-viewer.tsx", status: "pending", sort_order: 2 },
        { update_id: v110.id, task: "GHL webhook receiver for real-time updates", file_path: "src/app/api/ghl/webhook/route.ts", status: "pending", sort_order: 3 },
        { update_id: v110.id, task: "Dashboard: add 'Recent Calls' widget", file_path: "src/app/dashboard/page.tsx", status: "pending", sort_order: 4 },
        { update_id: v110.id, task: "Integration page: enable Quo config", file_path: "src/app/dashboard/integrations/page.tsx", status: "pending", sort_order: 5 },
      ]);
    }
    console.log("✅ v1.1.0 update seeded");

    // v1.2.0 - Planned
    const targetV120 = new Date();
    targetV120.setDate(targetV120.getDate() + 14);
    const { data: v120 } = await supabase.from("updates").insert({
      version: "v1.2.0",
      title: "Email Monitoring + Auto-Stage Updates",
      status: "planned",
      description: "Connect Microsoft Graph API to monitor submissions@srtagency.com. AI classifies incoming emails and auto-updates pipeline stages in GHL.",
      target_date: targetV120.toISOString().split("T")[0],
    }).select().single();

    if (v120) {
      await supabase.from("update_tasks").insert([
        { update_id: v120.id, task: "Microsoft Graph API client", file_path: "src/lib/microsoft.ts", status: "pending", sort_order: 0 },
        { update_id: v120.id, task: "Email polling cron job", file_path: "src/app/api/cron/email-monitor/route.ts", status: "pending", sort_order: 1 },
        { update_id: v120.id, task: "AI email classifier", file_path: "src/lib/email-classifier.ts", status: "pending", sort_order: 2 },
        { update_id: v120.id, task: "Auto stage update logic", file_path: "src/lib/auto-stage.ts", status: "pending", sort_order: 3 },
        { update_id: v120.id, task: "OneDrive folder auto-creation", file_path: "src/lib/onedrive.ts", status: "pending", sort_order: 4 },
        { update_id: v120.id, task: "Teams notification webhook", file_path: "src/lib/teams.ts", status: "pending", sort_order: 5 },
      ]);
    }
    console.log("✅ v1.2.0 update seeded");
  } else {
    console.log("⟳ Updates already exist, skipping");
  }

  console.log("\n🎉 Seed complete!");
}

seed().catch(console.error);
