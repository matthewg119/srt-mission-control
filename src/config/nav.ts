import {
  Brain,
  CheckSquare,
  Building2,
  Zap,
  Settings,
  Mail,
  FileText,
  LayoutList,
  GraduationCap,
  TrendingUp,
  MessageSquare,
  Users,
  Smartphone,
  Clapperboard,
  PhoneCall,
  Sunrise,
  Rocket,
} from "lucide-react";

export interface NavSection {
  label: string;
  items: NavItem[];
}

export interface NavItem {
  label: string;
  href: string;
  icon: typeof Brain;
}

export const navSections: NavSection[] = [
  {
    label: "Main",
    items: [
      // ‼️ FIRST, BECAUSE IT IS THE QUESTION EVERY MORNING STARTS WITH. The post-login redirect still
      // lands on /dashboard (BrainHeart), so there are two front doors until that moves. Worth doing
      // deliberately rather than as a side effect of adding a nav line.
      { label: "Today", href: "/dashboard/today", icon: Sunrise },
      // ‼️ SECOND, AND IT IS THE ONLY WAY INTO THE LAUNCH LANE FROM THE CHROME.
      // /dashboard/launch has existed since the lane shipped and was reachable only by typing the
      // URL, which is why onboarding a client meant finding an old message with the link in it.
      // Matthew asked for it near the top; the order below is a default a person can change, see
      // nav-customize.tsx.
      { label: "Onboarding", href: "/dashboard/launch", icon: Rocket },
      { label: "BrainHeart", href: "/dashboard", icon: Brain },
      { label: "Vektor", href: "/dashboard/assistant", icon: MessageSquare },
      { label: "Call list", href: "/dashboard/worklist", icon: PhoneCall },
      { label: "Leads", href: "/dashboard/leads", icon: Users },
      // Clients we deliver for. Not /dashboard/onboarding, which is our own
      // team-member setup checklist and a different thing entirely.
      { label: "Clients", href: "/dashboard/clients", icon: Building2 },
      { label: "Tasks", href: "/dashboard/tasks", icon: CheckSquare },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Templates", href: "/dashboard/templates", icon: FileText },
      { label: "Sequences", href: "/dashboard/sequences", icon: Mail },
      { label: "Email Director", href: "/dashboard/email-sequences", icon: Users },
      { label: "Automations", href: "/dashboard/automations", icon: Zap },
      { label: "Campaigns", href: "/dashboard/campaigns", icon: MessageSquare },
    ],
  },
  {
    label: "Content",
    items: [
      { label: "Content Studio", href: "/dashboard/content-workflows", icon: Clapperboard },
    ],
  },
  {
    label: "Coaching",
    items: [
      { label: "Coaching Studio", href: "/dashboard/coaching-studio", icon: GraduationCap },
    ],
  },
  {
    label: "Voice",
    items: [
      { label: "SMS Simulator", href: "/dashboard/simulator", icon: Smartphone },
    ],
  },
  {
    label: "Trading",
    items: [
      { label: "Options Bot", href: "/bot", icon: TrendingUp },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Integrations", href: "/dashboard/integrations", icon: LayoutList },
      { label: "Settings", href: "/dashboard/settings", icon: Settings },
    ],
  },
];

// Flat list for backwards compat
export const navItems = navSections.flatMap((s) => s.items);
