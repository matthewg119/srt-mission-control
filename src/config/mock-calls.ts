// Mock call data for the AI Call Recap dashboard
// Simulates MCA sales conversations until a real call provider is connected

export interface MockCall {
  id: string;
  contactName: string;
  businessName: string;
  industry: string;
  phone: string;
  durationSeconds: number;
  outcome: "interested" | "applied" | "needs_docs" | "callback" | "not_interested";
  fundingPurpose: string;
  requestedAmount: number;
  summary: string;
  painPoints: string[];
  calledAt: string;
  agentName: string;
}

export interface LeadMagnetIdea {
  id: string;
  title: string;
  description: string;
  industry: string;
  painPoint: string;
  type: "ebook" | "checklist" | "calculator" | "webinar" | "template" | "guide" | "video" | "infographic";
}

export interface MusaPost {
  id: string;
  content: string;
  category: "insight" | "lead_magnet" | "call_highlight" | "daily_recap";
  timestamp: string;
  source?: string;
}

const INDUSTRIES = [
  "Restaurant", "Auto Repair", "Construction", "Trucking", "Salon & Spa",
  "Retail", "Medical Practice", "Landscaping", "Cleaning Service", "HVAC",
  "Plumbing", "Real Estate", "E-Commerce", "Fitness Studio", "Daycare",
];

const BUSINESS_NAMES = [
  "Martinez Auto Repair", "Bella's Restaurante", "GreenScape Landscaping",
  "TechFix Solutions", "Royal Cleaning Co.", "Apex Construction LLC",
  "Sunrise Trucking", "Luna Salon & Spa", "FreshFit Gym",
  "Bright Smiles Dental", "Urban Eats Deli", "PrimeTime Plumbing",
  "NextGen Electric", "Little Stars Daycare", "CrownPoint Real Estate",
  "Swift Delivery Services", "Healthy Harvest Cafe", "ProBuild Contractors",
  "Diamond Auto Detailing", "Summit HVAC Services",
];

const CONTACT_NAMES = [
  "Carlos Martinez", "Isabella Rodriguez", "James Chen", "Maria Santos",
  "David Kim", "Sarah Johnson", "Miguel Rivera", "Patricia Williams",
  "Robert Garcia", "Jennifer Lopez", "Thomas Anderson", "Camila Fernandez",
  "Anthony Brown", "Valentina Cruz", "Marcus Thompson", "Sofia Ramirez",
  "Kevin Patel", "Diana Morales", "Brandon Davis", "Elena Vasquez",
];

const FUNDING_PURPOSES = [
  "Business expansion — opening a second location",
  "Working capital — bridge cash flow gaps between seasons",
  "Equipment purchase — new commercial ovens",
  "Payroll — need to hire 3 more employees",
  "Inventory — stocking up for holiday season",
  "Marketing — want to launch digital ad campaigns",
  "Debt consolidation — consolidate 2 existing MCAs",
  "Real estate — down payment on a commercial property",
  "Vehicle fleet — need 2 new delivery trucks",
  "Renovation — remodeling the storefront",
];

const PAIN_POINTS_POOL = [
  "Cash flow gaps between large jobs",
  "Seasonal revenue dips in winter",
  "Can't get traditional bank loan — too slow",
  "Previous MCA had unfair terms",
  "Need funding fast — opportunity is time-sensitive",
  "Credit score damaged from COVID",
  "Vendor requiring upfront payment",
  "Equipment breaking down, losing customers",
  "Competitors opening nearby",
  "Insurance costs skyrocketing",
  "Can't make payroll next month",
  "Landlord raising rent",
  "Need working capital to accept a big contract",
  "Tax lien making traditional funding impossible",
  "Business partner left — need to buy them out",
];

const OUTCOMES: MockCall["outcome"][] = ["interested", "applied", "needs_docs", "callback", "not_interested"];

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateId(): string {
  return `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function generateMockCall(daysAgo = 0): MockCall {
  const contactName = randomItem(CONTACT_NAMES);
  const businessName = randomItem(BUSINESS_NAMES);
  const industry = randomItem(INDUSTRIES);
  const purpose = randomItem(FUNDING_PURPOSES);
  const amount = randomBetween(15, 300) * 1000;
  const outcome = randomItem(OUTCOMES);
  const painCount = randomBetween(1, 3);
  const painPoints: string[] = [];
  for (let i = 0; i < painCount; i++) {
    const p = randomItem(PAIN_POINTS_POOL);
    if (!painPoints.includes(p)) painPoints.push(p);
  }

  const calledAt = new Date(Date.now() - daysAgo * 86400000 - randomBetween(0, 86400000));

  return {
    id: generateId(),
    contactName,
    businessName,
    industry,
    phone: `(${randomBetween(200, 999)}) ${randomBetween(200, 999)}-${randomBetween(1000, 9999)}`,
    durationSeconds: randomBetween(120, 1800),
    outcome,
    fundingPurpose: purpose,
    requestedAmount: amount,
    summary: `${contactName} from ${businessName} (${industry}) called about ${purpose.toLowerCase()}. Requested $${amount.toLocaleString()}. Outcome: ${outcome.replace("_", " ")}. Key concerns: ${painPoints.join("; ")}.`,
    painPoints,
    calledAt: calledAt.toISOString(),
    agentName: Math.random() > 0.5 ? "Matthew" : "Benjamin",
  };
}

export function generateDailyCalls(count = 8): MockCall[] {
  return Array.from({ length: count }, () => generateMockCall(0));
}

export function generateCallHistory(days = 7, callsPerDay = 6): MockCall[] {
  const calls: MockCall[] = [];
  for (let d = 0; d < days; d++) {
    const count = randomBetween(Math.max(1, callsPerDay - 2), callsPerDay + 2);
    for (let i = 0; i < count; i++) {
      calls.push(generateMockCall(d));
    }
  }
  return calls.sort((a, b) => new Date(b.calledAt).getTime() - new Date(a.calledAt).getTime());
}

export function generateLeadMagnetIdeas(count = 10): LeadMagnetIdea[] {
  const ideas: LeadMagnetIdea[] = [
    { id: "lm-1", title: "Cash Flow Emergency Kit", description: "Step-by-step guide for business owners facing unexpected cash flow shortfalls — includes a calculator to determine exactly how much working capital they need.", industry: "General", painPoint: "Cash flow gaps", type: "guide" },
    { id: "lm-2", title: "MCA vs. Bank Loan: The Real Comparison", description: "Interactive calculator showing true cost of MCA vs. traditional loans, factoring in speed, approval rates, and opportunity cost of waiting.", industry: "General", painPoint: "Can't get bank loan", type: "calculator" },
    { id: "lm-3", title: "Restaurant Revenue Survival Playbook", description: "How restaurants can maintain cash flow through seasonal dips — includes templates for renegotiating vendor terms and a 90-day cash buffer worksheet.", industry: "Restaurant", painPoint: "Seasonal revenue dips", type: "ebook" },
    { id: "lm-4", title: "The Equipment ROI Calculator", description: "Calculate exact payback period for new equipment purchases. Shows how funded equipment pays for itself through increased capacity.", industry: "Construction", painPoint: "Equipment breaking down", type: "calculator" },
    { id: "lm-5", title: "5-Point Credit Repair Checklist for Business Owners", description: "Actionable steps to improve business credit score in 90 days — even after COVID damage. Includes dispute letter templates.", industry: "General", painPoint: "Credit score damaged", type: "checklist" },
    { id: "lm-6", title: "How to Double Your Trucking Fleet Without the Risk", description: "Case study showing how trucking companies use revenue-based financing to add vehicles and take on bigger contracts.", industry: "Trucking", painPoint: "Vehicle fleet expansion", type: "ebook" },
    { id: "lm-7", title: "Payroll Crisis Prevention Template", description: "Cash flow forecasting spreadsheet designed specifically for businesses with 5-20 employees. Predict payroll crunches 30 days out.", industry: "General", painPoint: "Can't make payroll", type: "template" },
    { id: "lm-8", title: "The Salon Owner's Growth Funding Guide", description: "How beauty and spa businesses can fund renovations, new chairs, and marketing campaigns without traditional bank hurdles.", industry: "Salon & Spa", painPoint: "Renovation funding", type: "guide" },
    { id: "lm-9", title: "Seasonal Business Funding Calendar", description: "Month-by-month timeline showing when to apply for funding based on your industry's seasonal patterns. Includes application prep checklist.", industry: "General", painPoint: "Seasonal timing", type: "infographic" },
    { id: "lm-10", title: "MCA Stacking: The Hidden Costs & How to Escape", description: "Webinar revealing the true cost of stacked MCAs and a 3-step consolidation strategy that saves businesses 30-40% in fees.", industry: "General", painPoint: "Debt consolidation", type: "webinar" },
    { id: "lm-11", title: "Commercial Lease Negotiation Toolkit", description: "Templates and scripts for renegotiating rent when your landlord raises prices. Includes leverage calculator based on market rates.", industry: "Retail", painPoint: "Landlord raising rent", type: "template" },
    { id: "lm-12", title: "The Contractor's Bid-to-Fund Playbook", description: "How construction businesses can secure working capital to accept large contracts they'd otherwise turn down.", industry: "Construction", painPoint: "Accept big contracts", type: "guide" },
    { id: "lm-13", title: "Tax Lien Funding Solutions Guide", description: "Options for business owners with tax liens who need funding. Includes IRS payment plan setup guide and funder compatibility checklist.", industry: "General", painPoint: "Tax lien blocking funding", type: "guide" },
    { id: "lm-14", title: "Partner Buyout Financial Planner", description: "Calculator and legal checklist for buying out a business partner. Shows how to structure financing for a clean exit.", industry: "General", painPoint: "Partner buyout", type: "calculator" },
    { id: "lm-15", title: "Digital Marketing ROI Calculator for Local Businesses", description: "Show business owners exactly how much revenue a funded marketing campaign would generate based on their industry benchmarks.", industry: "General", painPoint: "Marketing funding", type: "calculator" },
  ];

  // Shuffle and take count
  const shuffled = [...ideas].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

export function generateMusaPosts(count = 10): MusaPost[] {
  const calls = generateDailyCalls(count);
  const ideas = generateLeadMagnetIdeas(5);
  const posts: MusaPost[] = [];
  const now = Date.now();

  // Call insights
  for (let i = 0; i < Math.min(calls.length, 5); i++) {
    const c = calls[i];
    posts.push({
      id: `musa_${i}`,
      content: `Call with ${c.contactName} (${c.businessName}) — ${c.industry}. Looking for $${c.requestedAmount.toLocaleString()} for ${c.fundingPurpose.split(" — ")[0].toLowerCase()}. Pain points: ${c.painPoints.join(", ")}. ${c.outcome === "interested" ? "Strong lead — follow up within 2 hours." : c.outcome === "applied" ? "Application submitted! Move to underwriting." : c.outcome === "callback" ? "Requested callback — schedule for tomorrow AM." : "Keep in nurture sequence."}`,
      category: "call_highlight",
      timestamp: new Date(now - i * 3600000).toISOString(),
      source: c.agentName,
    });
  }

  // Lead magnet ideas
  for (let i = 0; i < Math.min(ideas.length, 3); i++) {
    posts.push({
      id: `musa_lm_${i}`,
      content: `Lead Magnet Idea: "${ideas[i].title}" — ${ideas[i].description} [${ideas[i].type.toUpperCase()}]`,
      category: "lead_magnet",
      timestamp: new Date(now - (i + 5) * 3600000).toISOString(),
    });
  }

  // Daily recap
  posts.push({
    id: "musa_recap",
    content: `Daily Recap: ${calls.length} calls made today. ${calls.filter((c) => c.outcome === "interested" || c.outcome === "applied").length} hot leads. Top industries: ${[...new Set(calls.map((c) => c.industry))].slice(0, 3).join(", ")}. Total funding requested: $${calls.reduce((s, c) => s + c.requestedAmount, 0).toLocaleString()}. Generated ${ideas.length} new lead magnet ideas.`,
    category: "daily_recap",
    timestamp: new Date(now - 2 * 3600000).toISOString(),
  });

  // General insight
  posts.push({
    id: "musa_insight",
    content: "Trend spotted: 4 out of last 10 calls mention 'cash flow gaps between jobs.' This is a recurring pain point in construction and services industries. Consider creating a targeted landing page: 'Bridge the Gap — Working Capital for Project-Based Businesses.'",
    category: "insight",
    timestamp: new Date(now - 8 * 3600000).toISOString(),
  });

  return posts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}
