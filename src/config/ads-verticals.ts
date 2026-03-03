// 100 verticals across 10 categories for Meta Ads Command Center
// Based on Eugene Schwartz awareness levels + Propaganda & Indoctrination layers

export interface Vertical {
  key: string;
  name: string;
  short: string;
  icon: string;
}

export interface VerticalCategory {
  name: string;
  icon: string;
  verticals: Vertical[];
}

export interface AwarenessLevel {
  level: number;
  name: string;
  label: string;
  color: string;
  description: string;
  strategy: string;
  adType: string;
  cta: string;
}

export const CATEGORIES: Record<string, VerticalCategory> = {
  food: {
    name: "Food & Beverage",
    icon: "\uD83C\uDF54",
    verticals: [
      { key: "restaurant", name: "Restaurant", short: "Rest.", icon: "\uD83C\uDF7D\uFE0F" },
      { key: "fast_casual", name: "Fast Casual", short: "Fast", icon: "\uD83C\uDF2F" },
      { key: "food_truck", name: "Food Truck", short: "Truck", icon: "\uD83D\uDE9A" },
      { key: "coffee_shop", name: "Coffee Shop", short: "Coffee", icon: "\u2615" },
      { key: "bar", name: "Bar / Nightclub", short: "Bar", icon: "\uD83C\uDF7A" },
      { key: "bakery", name: "Bakery", short: "Bakery", icon: "\uD83C\uDF70" },
      { key: "pizzeria", name: "Pizzeria", short: "Pizza", icon: "\uD83C\uDF55" },
      { key: "taqueria", name: "Taquer\u00EDa", short: "Taq.", icon: "\uD83C\uDF2E" },
      { key: "catering", name: "Catering", short: "Cater", icon: "\uD83C\uDF7E" },
      { key: "juice_bar", name: "Juice Bar", short: "Juice", icon: "\uD83E\uDD64" },
      { key: "ice_cream", name: "Ice Cream Shop", short: "Ice Cr.", icon: "\uD83C\uDF66" },
      { key: "deli", name: "Deli", short: "Deli", icon: "\uD83E\uDD6A" },
      { key: "donut", name: "Donut Shop", short: "Donut", icon: "\uD83C\uDF69" },
      { key: "brewery", name: "Brewery", short: "Brew", icon: "\uD83C\uDF7B" },
      { key: "ghost_kitchen", name: "Ghost Kitchen", short: "Ghost", icon: "\uD83D\uDC7B" },
    ],
  },
  construction: {
    name: "Construction & Trades",
    icon: "\uD83D\uDEA7",
    verticals: [
      { key: "gc", name: "General Contractor", short: "GC", icon: "\uD83C\uDFD7\uFE0F" },
      { key: "electrician", name: "Electrician", short: "Elec.", icon: "\u26A1" },
      { key: "plumber", name: "Plumber", short: "Plumb.", icon: "\uD83D\uDEB0" },
      { key: "hvac", name: "HVAC", short: "HVAC", icon: "\u2744\uFE0F" },
      { key: "roofing", name: "Roofing", short: "Roof", icon: "\uD83C\uDFE0" },
      { key: "painting", name: "Painting", short: "Paint", icon: "\uD83C\uDFA8" },
      { key: "flooring", name: "Flooring", short: "Floor", icon: "\uD83E\uDDF1" },
      { key: "concrete", name: "Concrete", short: "Conc.", icon: "\uD83E\uDDF1" },
      { key: "demolition", name: "Demolition", short: "Demo", icon: "\uD83D\uDCA5" },
      { key: "excavation", name: "Excavation", short: "Excav.", icon: "\uD83D\uDE9C" },
      { key: "fencing", name: "Fencing", short: "Fence", icon: "\uD83E\uDE9C" },
      { key: "solar", name: "Solar Installation", short: "Solar", icon: "\u2600\uFE0F" },
      { key: "remodeling", name: "Remodeling", short: "Remod.", icon: "\uD83D\uDD28" },
      { key: "restoration", name: "Restoration", short: "Restor.", icon: "\uD83C\uDFDA\uFE0F" },
      { key: "drywall", name: "Drywall", short: "Drywall", icon: "\uD83E\uDDF1" },
    ],
  },
  trucking: {
    name: "Trucking & Transport",
    icon: "\uD83D\uDE9B",
    verticals: [
      { key: "owner_op", name: "Owner-Operator", short: "Owner", icon: "\uD83D\uDE9B" },
      { key: "fleet", name: "Fleet Owner", short: "Fleet", icon: "\uD83D\uDE9A" },
      { key: "hot_shot", name: "Hot Shot Trucking", short: "HotShot", icon: "\uD83D\uDD25" },
      { key: "moving", name: "Moving Company", short: "Moving", icon: "\uD83D\uDCE6" },
      { key: "towing", name: "Towing", short: "Tow", icon: "\uD83D\uDEFB" },
      { key: "courier", name: "Courier / Delivery", short: "Courier", icon: "\uD83D\uDCE8" },
      { key: "freight", name: "Freight Broker", short: "Freight", icon: "\uD83D\uDCCB" },
      { key: "shuttle", name: "Shuttle Service", short: "Shuttle", icon: "\uD83D\uDE90" },
      { key: "limo", name: "Limo / Black Car", short: "Limo", icon: "\uD83D\uDE95" },
      { key: "auto_transport", name: "Auto Transport", short: "AutoTr.", icon: "\uD83D\uDE97" },
    ],
  },
  automotive: {
    name: "Automotive",
    icon: "\uD83D\uDE97",
    verticals: [
      { key: "auto_repair", name: "Auto Repair", short: "Repair", icon: "\uD83D\uDD27" },
      { key: "body_shop", name: "Body Shop", short: "Body", icon: "\uD83D\uDE98" },
      { key: "car_wash", name: "Car Wash", short: "Wash", icon: "\uD83D\uDCA6" },
      { key: "detailing", name: "Auto Detailing", short: "Detail", icon: "\u2728" },
      { key: "tire_shop", name: "Tire Shop", short: "Tires", icon: "\uD83D\uDEDE" },
      { key: "used_cars", name: "Used Car Dealer", short: "Used", icon: "\uD83C\uDFB0" },
      { key: "quick_lube", name: "Quick Lube", short: "Lube", icon: "\uD83D\uDEE2\uFE0F" },
      { key: "transmission", name: "Transmission Shop", short: "Trans.", icon: "\u2699\uFE0F" },
    ],
  },
  health: {
    name: "Health & Medical",
    icon: "\uD83C\uDFE5",
    verticals: [
      { key: "dental", name: "Dental Practice", short: "Dental", icon: "\uD83E\uDDB7" },
      { key: "chiro", name: "Chiropractor", short: "Chiro", icon: "\uD83E\uDDB4" },
      { key: "vet", name: "Veterinarian", short: "Vet", icon: "\uD83D\uDC3E" },
      { key: "pt", name: "Physical Therapy", short: "PT", icon: "\uD83C\uDFCB\uFE0F" },
      { key: "med_spa", name: "Med Spa", short: "MedSpa", icon: "\uD83D\uDC86" },
      { key: "urgent_care", name: "Urgent Care", short: "Urgent", icon: "\uD83D\uDE91" },
      { key: "pharmacy", name: "Pharmacy", short: "Pharm.", icon: "\uD83D\uDC8A" },
      { key: "home_health", name: "Home Health", short: "Home", icon: "\uD83C\uDFE0" },
      { key: "mental_health", name: "Mental Health", short: "Mental", icon: "\uD83E\uDDE0" },
      { key: "optical", name: "Optical / Eye Care", short: "Optical", icon: "\uD83D\uDC41\uFE0F" },
    ],
  },
  beauty: {
    name: "Beauty & Personal Care",
    icon: "\uD83D\uDC87",
    verticals: [
      { key: "hair_salon", name: "Hair Salon", short: "Salon", icon: "\uD83D\uDC87" },
      { key: "barber", name: "Barber Shop", short: "Barber", icon: "\u2702\uFE0F" },
      { key: "nail_salon", name: "Nail Salon", short: "Nails", icon: "\uD83D\uDC85" },
      { key: "day_spa", name: "Day Spa", short: "Spa", icon: "\uD83E\uDDD6" },
      { key: "tattoo", name: "Tattoo Studio", short: "Tattoo", icon: "\uD83C\uDFA8" },
      { key: "tanning", name: "Tanning Salon", short: "Tan", icon: "\u2600\uFE0F" },
      { key: "lash_brow", name: "Lash & Brow", short: "Lash", icon: "\uD83D\uDC41\uFE0F" },
      { key: "beauty_supply", name: "Beauty Supply", short: "Supply", icon: "\uD83D\uDC84" },
    ],
  },
  retail: {
    name: "Retail",
    icon: "\uD83D\uDED2",
    verticals: [
      { key: "bodega", name: "Bodega / Corner Store", short: "Bodega", icon: "\uD83C\uDFEA" },
      { key: "boutique", name: "Boutique", short: "Boutique", icon: "\uD83D\uDC57" },
      { key: "smoke_shop", name: "Smoke Shop", short: "Smoke", icon: "\uD83D\uDEAC" },
      { key: "liquor", name: "Liquor Store", short: "Liquor", icon: "\uD83C\uDF7E" },
      { key: "pet_store", name: "Pet Store", short: "Pets", icon: "\uD83D\uDC36" },
      { key: "furniture", name: "Furniture Store", short: "Furn.", icon: "\uD83D\uDECB\uFE0F" },
      { key: "florist", name: "Florist", short: "Florist", icon: "\uD83C\uDF3A" },
      { key: "jewelry", name: "Jewelry Store", short: "Jewel", icon: "\uD83D\uDC8D" },
      { key: "phone_repair", name: "Phone Repair", short: "Phone", icon: "\uD83D\uDCF1" },
      { key: "dollar_store", name: "Dollar Store", short: "Dollar", icon: "\uD83D\uDCB2" },
    ],
  },
  home_services: {
    name: "Home Services",
    icon: "\uD83C\uDFE1",
    verticals: [
      { key: "landscaping", name: "Landscaping", short: "Landsc.", icon: "\uD83C\uDF33" },
      { key: "lawn_care", name: "Lawn Care", short: "Lawn", icon: "\uD83C\uDF3F" },
      { key: "tree_service", name: "Tree Service", short: "Tree", icon: "\uD83C\uDF32" },
      { key: "cleaning", name: "Cleaning Service", short: "Clean", icon: "\uD83E\uDDF9" },
      { key: "junk_removal", name: "Junk Removal", short: "Junk", icon: "\uD83D\uDDD1\uFE0F" },
      { key: "pest_control", name: "Pest Control", short: "Pest", icon: "\uD83D\uDC1C" },
      { key: "pool", name: "Pool Service", short: "Pool", icon: "\uD83C\uDFCA" },
      { key: "pressure_wash", name: "Pressure Washing", short: "Wash", icon: "\uD83D\uDCA8" },
      { key: "garage_door", name: "Garage Door", short: "Garage", icon: "\uD83D\uDEAA" },
      { key: "locksmith", name: "Locksmith", short: "Lock", icon: "\uD83D\uDD11" },
    ],
  },
  professional: {
    name: "Professional Services",
    icon: "\uD83D\uDCBC",
    verticals: [
      { key: "staffing", name: "Staffing Agency", short: "Staff", icon: "\uD83D\uDC65" },
      { key: "tax_prep", name: "Tax Preparation", short: "Tax", icon: "\uD83D\uDCCA" },
      { key: "insurance", name: "Insurance Agency", short: "Insur.", icon: "\uD83D\uDEE1\uFE0F" },
      { key: "real_estate", name: "Real Estate", short: "RE", icon: "\uD83C\uDFE2" },
      { key: "marketing_agency", name: "Marketing Agency", short: "Mktg.", icon: "\uD83D\uDCE3" },
      { key: "it_services", name: "IT Services", short: "IT", icon: "\uD83D\uDCBB" },
      { key: "security", name: "Security Company", short: "Sec.", icon: "\uD83D\uDD12" },
    ],
  },
  other: {
    name: "Other High-Volume",
    icon: "\u2B50",
    verticals: [
      { key: "gas_station", name: "Gas Station", short: "Gas", icon: "\u26FD" },
      { key: "laundromat", name: "Laundromat", short: "Laund.", icon: "\uD83E\uDDFA" },
      { key: "daycare", name: "Daycare / Childcare", short: "Daycare", icon: "\uD83D\uDC76" },
      { key: "gym", name: "Gym / Fitness", short: "Gym", icon: "\uD83D\uDCAA" },
      { key: "hotel", name: "Hotel / Motel", short: "Hotel", icon: "\uD83C\uDFE8" },
      { key: "print_shop", name: "Print Shop", short: "Print", icon: "\uD83D\uDDA8\uFE0F" },
      { key: "event_venue", name: "Event Venue", short: "Event", icon: "\uD83C\uDF89" },
    ],
  },
};

// Flat array of all 100 verticals
export const ALL_VERTICALS: Vertical[] = Object.values(CATEGORIES).flatMap(
  (cat) => cat.verticals
);

// 7 Awareness Levels: Eugene Schwartz 5 + Propaganda + Indoctrination
export const AWARENESS_LEVELS: AwarenessLevel[] = [
  {
    level: 1,
    name: "unaware",
    label: "Unaware",
    color: "#EF4444",
    description: "They don't know they have a problem. Pattern interrupt with stories and curiosity hooks.",
    strategy: "Pattern interrupt, storytelling, curiosity hooks. No pitch — just stop the scroll.",
    adType: "Video testimonial, story ad, UGC-style reel",
    cta: "Watch this",
  },
  {
    level: 2,
    name: "problem_aware",
    label: "Problem Aware",
    color: "#F97316",
    description: "They know the problem but not the solution. Agitate pain and cost of waiting.",
    strategy: "Agitate the pain. Cost of inaction. 'Sound familiar?' angles.",
    adType: "Carousel, image ad, 'Are you tired of...' hooks",
    cta: "See how others fixed this",
  },
  {
    level: 3,
    name: "solution_aware",
    label: "Solution Aware",
    color: "#EAB308",
    description: "They know solutions exist but haven't chosen one. Differentiate SRT from banks/competitors.",
    strategy: "Differentiation. SRT vs banks, speed vs paperwork, approval rates.",
    adType: "Comparison ad, infographic, 'Why SRT' explainer",
    cta: "See why SRT is different",
  },
  {
    level: 4,
    name: "product_aware",
    label: "Product Aware",
    color: "#22C55E",
    description: "They know about SRT but haven't applied. Testimonials, FAQs, overcome objections.",
    strategy: "Social proof, FAQ answers, objection handling, case studies.",
    adType: "Testimonial video, before/after, FAQ carousel",
    cta: "Apply in 2 minutes",
  },
  {
    level: 5,
    name: "most_aware",
    label: "Most Aware",
    color: "#3B82F6",
    description: "They're ready — just need a push. Direct CTA, urgency, retargeting.",
    strategy: "Direct offer, urgency, scarcity, retargeting warm audiences.",
    adType: "Direct response ad, countdown, limited offer",
    cta: "Apply Now \u2014 Same-Day Approval",
  },
  {
    level: 6,
    name: "propaganda",
    label: "Propaganda",
    color: "#8B5CF6",
    description: "Install buying beliefs before they need funding. No pitch \u2014 pure value and worldview.",
    strategy: "Belief installation. 'Smart owners do X.' No ask, no pitch \u2014 pure top-of-funnel authority building.",
    adType: "Educational reel, quote card, industry insight post",
    cta: "Follow for more",
  },
  {
    level: 7,
    name: "indoctrination",
    label: "Indoctrination",
    color: "#EC4899",
    description: "Brand philosophy, founder story, mission. Bottom-of-funnel loyalty building.",
    strategy: "Brand story, founder journey, behind-the-scenes, mission content. Converts product-aware to advocates.",
    adType: "Founder story video, day-in-the-life, team culture reel",
    cta: "Join the SRT family",
  },
];
