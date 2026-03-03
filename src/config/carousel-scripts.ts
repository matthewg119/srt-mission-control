// Instagram carousel script bank for Carousel Studio
// 20 scripts across 3 categories, 5 slides each = 100 slides

export interface CarouselSlide {
  hook: string;
  body: string;
}

export interface CarouselScript {
  id: string;
  title: string;
  slides: CarouselSlide[];
}

export interface ScriptCategory {
  name: string;
  icon: string;
  scripts: CarouselScript[];
}

export const ALL_SCRIPTS: Record<string, ScriptCategory> = {
  cash_flow: {
    name: "Cash Flow",
    icon: "\uD83D\uDCB0",
    scripts: [
      {
        id: "cf1",
        title: "Cash Flow Crunch? Here's What Smart Owners Do",
        slides: [
          { hook: "Your business is profitable...", body: "But your bank account says otherwise. Sound familiar?" },
          { hook: "The #1 reason businesses fail", body: "It's not bad products. It's not bad marketing. It's cash flow timing. Money comes in slow, but bills don't wait." },
          { hook: "Smart owners don't wait", body: "They bridge the gap with working capital. $5K-$500K funded in 24-48 hours. No bank lines, no 90-day waits." },
          { hook: "Here's what changes:", body: "Pay vendors on time. Take that bulk discount. Cover payroll without stress. Invest in growth when the opportunity hits." },
          { hook: "Ready to stop stressing?", body: "Apply in 2 minutes. See your options today. Link in bio. \u2192 SRT Agency" },
        ],
      },
      {
        id: "cf2",
        title: "Why Your Business Needs a Cash Reserve",
        slides: [
          { hook: "What if your biggest client pays late?", body: "60-day invoices. Delayed payments. It happens to every business." },
          { hook: "Without a cash reserve...", body: "You're one slow month away from missing payroll, losing vendors, or turning down new jobs." },
          { hook: "The solution isn't a bank loan", body: "Banks take 60-90 days. Your problem is NOW. Working capital gets funded in 1-3 days." },
          { hook: "Real owners, real results:", body: "'Got $85K in 48 hours. Covered my equipment purchase and still had runway.' \u2014 Restaurant owner, Miami" },
          { hook: "Your turn.", body: "See how much you qualify for. 2-minute application. Link in bio." },
        ],
      },
      {
        id: "cf3",
        title: "Stop Letting Cash Flow Kill Your Growth",
        slides: [
          { hook: "You turned down a job last month", body: "Not because you couldn't do it. Because you couldn't afford the materials upfront." },
          { hook: "That's $50K you left on the table", body: "Every 'no' because of cash is revenue you'll never get back." },
          { hook: "What if you never had to say no?", body: "Working capital on demand. $5K to $500K. Use it for materials, payroll, equipment \u2014 anything." },
          { hook: "The math is simple:", body: "Cost of capital < Revenue from the job you can now take. That's how winners think." },
          { hook: "Stop leaving money on the table.", body: "Apply now. Fund tomorrow. Link in bio." },
        ],
      },
      {
        id: "cf4",
        title: "3 Signs You Need Working Capital NOW",
        slides: [
          { hook: "Is your business sending you signals?", body: "Here are 3 signs you need working capital before it's too late." },
          { hook: "Sign #1: You're juggling payments", body: "Robbing Peter to pay Paul. Paying vendors late. Delaying your own paycheck." },
          { hook: "Sign #2: You're turning down work", body: "Jobs are coming in but you can't take them because you don't have the upfront capital." },
          { hook: "Sign #3: Emergency = Catastrophe", body: "One broken piece of equipment or one slow month could shut you down." },
          { hook: "Fix it before it breaks you.", body: "Get funded in 24 hours. Link in bio. \u2192 SRT Agency" },
        ],
      },
      {
        id: "cf5",
        title: "The Hidden Cost of Not Having Capital",
        slides: [
          { hook: "You think you're saving money", body: "By not taking on working capital. But what is it actually costing you?" },
          { hook: "Missed bulk discounts: -15%", body: "Your supplier offers 15% off for early payment. Without cash, you pay full price. Every. Single. Time." },
          { hook: "Lost contracts: -$100K/year", body: "Every job you can't take is revenue that goes to your competitor." },
          { hook: "Emergency scrambles: Priceless stress", body: "When equipment breaks or a client pays late, panic mode costs you time, health, and reputation." },
          { hook: "Smart capital pays for itself.", body: "See your options in 2 minutes. Link in bio." },
        ],
      },
      {
        id: "cf6",
        title: "Banks Said No? We Say Yes.",
        slides: [
          { hook: "We get it.", body: "You walked into the bank with your business plan and walked out with nothing." },
          { hook: "Banks don't fund small businesses", body: "Low credit score? Under 2 years? No collateral? They won't even look at your application." },
          { hook: "We're not a bank.", body: "We fund real businesses. $5K-$500K. Bad credit OK. 6+ months in business is all you need." },
          { hook: "Funded 2,847 businesses this year", body: "Restaurants. Trucking companies. Contractors. Salons. Real businesses with real cash flow needs." },
          { hook: "Your bank said no. We say: Apply.", body: "2 minutes. See your options today. Link in bio." },
        ],
      },
      {
        id: "cf7",
        title: "Payroll Is Friday. Your Client Pays in 30 Days.",
        slides: [
          { hook: "It's Wednesday.", body: "Payroll is in 2 days. Your biggest invoice? Due in 30." },
          { hook: "This is the gap that kills businesses", body: "Not a lack of work. Not a lack of profit. Just terrible timing." },
          { hook: "Bridge the gap.", body: "Working capital deposits in 24-48 hours. Cover payroll. Pay vendors. Keep the lights on." },
          { hook: "Then when that invoice hits...", body: "You're ahead. Not scrambling. Not stressed. Just running your business." },
          { hook: "Stop living invoice to invoice.", body: "Get funded this week. Link in bio." },
        ],
      },
      {
        id: "cf8",
        title: "How $50K Changed Everything for This Owner",
        slides: [
          { hook: "Meet Carlos.", body: "Owns a fleet of 8 trucks. Revenue: $200K/month. But he was drowning." },
          { hook: "3 trucks needed repair. Same week.", body: "$45K in repairs. Insurance wouldn't cover it. Bank said 'come back in 60 days.'" },
          { hook: "He applied with SRT on Monday.", body: "$50K funded by Wednesday. All 3 trucks back on the road by Friday." },
          { hook: "The result?", body: "Didn't lose a single contract. Revenue stayed on track. Stress? Gone." },
          { hook: "Your fleet can't wait for the bank.", body: "Apply now. Fund this week. Link in bio." },
        ],
      },
    ],
  },
  business_growth: {
    name: "Business Growth",
    icon: "\uD83D\uDE80",
    scripts: [
      {
        id: "bg1",
        title: "How to 2X Your Business This Year",
        slides: [
          { hook: "Your business is doing OK.", body: "But OK isn't why you started. You started to build something big." },
          { hook: "The bottleneck isn't ideas", body: "You know what to do. Open a second location. Hire more staff. Buy better equipment. The bottleneck is CAPITAL." },
          { hook: "Remove the bottleneck.", body: "Working capital from $5K to $500K. Funded in 1-3 days. Use it for whatever grows your business." },
          { hook: "What 2X looks like:", body: "Second location. Bigger team. Better equipment. More marketing. More jobs. More revenue." },
          { hook: "Stop planning. Start building.", body: "Apply in 2 minutes. Link in bio. \u2192 SRT Agency" },
        ],
      },
      {
        id: "bg2",
        title: "Your Competitor Just Got Funded",
        slides: [
          { hook: "While you're saving up...", body: "Your competitor just got $100K in working capital and is taking your clients." },
          { hook: "They bought the new equipment.", body: "They hired the extra crew. They're running ads. They're everywhere." },
          { hook: "The difference?", body: "They didn't wait. They used other people's money to grow. Smart leverage, not debt." },
          { hook: "In business, speed wins.", body: "The one who moves first gets the client, the contract, the market share." },
          { hook: "Move first.", body: "See what you qualify for. 2 minutes. Link in bio." },
        ],
      },
      {
        id: "bg3",
        title: "5 Ways to Use Working Capital",
        slides: [
          { hook: "Got approved for working capital?", body: "Here are the 5 smartest ways to use it:" },
          { hook: "#1: Inventory / Materials", body: "Buy in bulk. Get the vendor discount. Never turn down a job because you couldn't afford materials." },
          { hook: "#2: Equipment Upgrade", body: "That old equipment is costing you time and money. Upgrade once. Save every day after." },
          { hook: "#3: Marketing & Ads", body: "Put $10K into ads. Generate $50K in new business. That's a 5X return." },
          { hook: "#4-5: Hiring + Expansion", body: "Hire the team. Open the location. Scale. \u2192 Apply in 2 minutes. Link in bio." },
        ],
      },
      {
        id: "bg4",
        title: "From Side Hustle to Empire",
        slides: [
          { hook: "Every empire started small.", body: "One truck. One chair. One oven. One client." },
          { hook: "But staying small is a choice.", body: "If you're profitable and have demand, the only thing keeping you small is capital." },
          { hook: "Capital is rocket fuel.", body: "The right amount, at the right time, turns a side hustle into a real business." },
          { hook: "We've seen it 2,847 times this year.", body: "Owners who took the leap. Got funded. Grew. Never looked back." },
          { hook: "Your leap starts here.", body: "Apply now. See your options in 2 minutes. Link in bio." },
        ],
      },
      {
        id: "bg5",
        title: "The #1 Growth Hack Nobody Talks About",
        slides: [
          { hook: "It's not a marketing trick.", body: "It's not an AI tool. It's not a course. It's CAPITAL." },
          { hook: "Having cash on hand changes everything.", body: "You negotiate better. You act faster. You take every opportunity." },
          { hook: "The best businesses aren't the best operators", body: "They're the best capitalized. They can afford to take risks and recover from mistakes." },
          { hook: "You don't need to be rich to be well-capitalized.", body: "Working capital from SRT: $5K-$500K, funded in days. Use your revenue as leverage." },
          { hook: "Get capitalized. Get ahead.", body: "2-minute application. Link in bio." },
        ],
      },
      {
        id: "bg6",
        title: "Why Q2 Is the Best Time to Get Funded",
        slides: [
          { hook: "Q2 is when smart owners make their move.", body: "Tax season is done. Summer rush is coming. It's go time." },
          { hook: "Get capital NOW to:", body: "Stock up for summer. Hire seasonal staff. Launch marketing campaigns. Lock in vendor deals." },
          { hook: "Don't wait for the rush.", body: "By the time you're busy, it's too late to prepare. Get ahead now." },
          { hook: "Same-day approvals available.", body: "$5K-$500K. No collateral. Revenue-based. Simple." },
          { hook: "Make Q2 your best quarter ever.", body: "Apply today. Link in bio. \u2192 SRT Agency" },
        ],
      },
    ],
  },
  industry: {
    name: "Industry Specific",
    icon: "\uD83C\uDFED",
    scripts: [
      {
        id: "in1",
        title: "Restaurant Owners: This Is Your Sign",
        slides: [
          { hook: "Running a restaurant is war.", body: "Food costs up 30%. Staff turnover. Equipment breaking. Rent due." },
          { hook: "You don't need a lecture.", body: "You need $50K by Friday to fix the walk-in, cover payroll, and stock up for the weekend rush." },
          { hook: "Banks don't understand restaurants.", body: "They see 'thin margins' and say no. We see a profitable kitchen that just needs runway." },
          { hook: "We've funded 400+ restaurants.", body: "Pizzerias, taquerias, fine dining, food trucks. If you do $10K+/month, you qualify." },
          { hook: "Keep your kitchen running.", body: "Apply in 2 minutes. Funded in 24 hours. Link in bio." },
        ],
      },
      {
        id: "in2",
        title: "Trucking: Stop Parking Trucks for Cash Flow",
        slides: [
          { hook: "Every parked truck costs you $500/day.", body: "Repairs, insurance, broker fees \u2014 they don't stop just because the truck does." },
          { hook: "The bank said 60-90 days.", body: "Your truck can't sit for 60 days. Your drivers can't wait. Your clients won't wait." },
          { hook: "We fund trucking companies fast.", body: "$10K-$500K. 24-48 hour funding. Use it for repairs, fuel, insurance, new trucks." },
          { hook: "Owner-ops. Fleets. Hot shots.", body: "We've funded all of them. Revenue-based. No collateral. Bad credit OK." },
          { hook: "Get your trucks back on the road.", body: "Apply now. Fund this week. Link in bio." },
        ],
      },
      {
        id: "in3",
        title: "Contractors: Take Every Job That Comes",
        slides: [
          { hook: "You just got offered a $200K job.", body: "But you need $40K in materials upfront. And the client pays net-60." },
          { hook: "Do the math:", body: "Turn it down = $0. Take it with working capital = $200K revenue minus small capital cost. Easy choice." },
          { hook: "We fund contractors every day.", body: "GCs, electricians, plumbers, painters, roofers. $5K-$500K funded in 1-3 days." },
          { hook: "Use it for:", body: "Materials. Equipment rental. Payroll. Insurance bonds. Whatever the job needs." },
          { hook: "Never turn down a job again.", body: "Apply in 2 minutes. Link in bio. \u2192 SRT Agency" },
        ],
      },
      {
        id: "in4",
        title: "Med Spas: Scale Without the Bank",
        slides: [
          { hook: "Your med spa is booked solid.", body: "But your equipment is dated and you need that new laser machine to stay competitive." },
          { hook: "$80K for a new device.", body: "The bank wants 2 years of tax returns, a business plan, and 90 days. You need it NOW." },
          { hook: "Revenue-based funding.", body: "If you're doing $15K+/month, you qualify. $5K-$500K. Funded in 24-48 hours." },
          { hook: "The ROI is instant:", body: "New equipment = new services = higher ticket clients = more revenue. It pays for itself." },
          { hook: "Upgrade your practice today.", body: "2-minute application. See your options. Link in bio." },
        ],
      },
      {
        id: "in5",
        title: "Salon Owners: Your Chair Shouldn't Be Empty",
        slides: [
          { hook: "3 of your chairs are empty.", body: "Not because clients aren't out there. Because you can't afford to hire, market, or expand." },
          { hook: "Full chairs = full revenue.", body: "Every empty chair is $500-$1,000/week you're NOT making." },
          { hook: "Working capital for salons:", body: "Hire new stylists. Renovate. Run local ads. Buy premium products. Open a second location." },
          { hook: "We've funded hundreds of salons.", body: "Hair, nails, barber, day spa. If you make $8K+/month, you qualify." },
          { hook: "Fill every chair.", body: "Apply today. Funded by Friday. Link in bio." },
        ],
      },
      {
        id: "in6",
        title: "Auto Repair: Stop Losing Jobs to Cash Flow",
        slides: [
          { hook: "Customer needs a $3K repair.", body: "But you don't have the parts in stock and your supplier wants payment upfront." },
          { hook: "Every turned-away car is lost revenue.", body: "They go to the shop down the street. And they don't come back." },
          { hook: "Stock up. Staff up. Gear up.", body: "Working capital from $5K-$500K lets you run your shop like the big chains." },
          { hook: "Funded 200+ auto shops.", body: "Mechanics, body shops, tire shops, transmission, quick lube. Revenue-based. Simple." },
          { hook: "Keep every car in your bay.", body: "Apply now. Fund this week. Link in bio." },
        ],
      },
    ],
  },
};

// Visual variety for canvas rendering
export const LAYOUTS = [
  "centered",
  "top-left",
  "bottom-right",
  "split",
  "stacked",
] as const;

export const PATTERNS = [
  "none",
  "dots",
  "grid",
  "diagonals",
  "circles",
  "waves",
] as const;

export const GLOWS = [
  "none",
  "center",
  "top-right",
  "bottom-left",
  "radial",
  "dual",
] as const;

export const BARS = [
  "none",
  "top",
  "bottom",
  "both",
  "left",
  "right",
] as const;

export const DECORS = [
  "none",
  "corner-brackets",
  "underline",
  "box",
  "circle-accent",
  "slash",
] as const;

// SRT Brand colors (locked)
export const BRAND = {
  bg: "#0d1117",
  accent: "#e8792b",
  green: "#2ee6a8",
  text: "#ffffff",
  muted: "#8b949e",
} as const;

// Caption templates for generated carousels
export const CAPTION_TEMPLATES = [
  {
    id: "direct",
    name: "Direct CTA",
    template: `{hook}\n\n{summary}\n\nApply now \u2192 Link in bio\n\n#BusinessFunding #WorkingCapital #SRTAgency #SmallBusiness #Entrepreneur`,
  },
  {
    id: "story",
    name: "Story Hook",
    template: `Here's something no one tells you about running a business...\n\n{summary}\n\nDM us "FUND" or tap the link in bio.\n\n#BusinessOwner #Funding #GrowYourBusiness #SRTAgency`,
  },
  {
    id: "question",
    name: "Question Hook",
    template: `Are you leaving money on the table? \uD83E\uDD14\n\n{summary}\n\nComment "INFO" and we'll reach out.\n\n#SmallBiz #BusinessGrowth #Capital #SRTAgency`,
  },
  {
    id: "listicle",
    name: "Listicle",
    template: `Save this for later \u2B07\uFE0F\n\n{summary}\n\n\u2192 Follow @srtagency for more business tips\n\n#BusinessTips #Entrepreneur #Funding #SRTAgency`,
  },
  {
    id: "urgency",
    name: "Urgency",
    template: `\u26A0\uFE0F Business owners \u2014 read this before it's too late.\n\n{summary}\n\n\u23F0 Same-day approvals available. Link in bio.\n\n#Urgent #BusinessFunding #SRTAgency #ApplyNow`,
  },
] as const;

export type LayoutType = (typeof LAYOUTS)[number];
export type PatternType = (typeof PATTERNS)[number];
export type GlowType = (typeof GLOWS)[number];
export type BarType = (typeof BARS)[number];
export type DecorType = (typeof DECORS)[number];
