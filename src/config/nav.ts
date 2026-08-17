import {
  Brain,
  Kanban,
  CheckSquare,
  Send,
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
      { label: "BrainHeart", href: "/dashboard", icon: Brain },
      { label: "Vektor", href: "/dashboard/assistant", icon: MessageSquare },
      { label: "Call list", href: "/dashboard/worklist", icon: PhoneCall },
      { label: "Leads", href: "/dashboard/leads", icon: Users },
      // Clients we deliver for. Not /dashboard/onboarding, which is our own
      // team-member setup checklist and a different thing entirely.
      { label: "Clients", href: "/dashboard/clients", icon: Building2 },
      { label: "Pipeline", href: "/dashboard/pipeline", icon: Kanban },
      { label: "Tasks", href: "/dashboard/tasks", icon: CheckSquare },
      { label: "Submissions", href: "/dashboard/email-agents", icon: Send },
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
      { label: "Lenders", href: "/dashboard/lenders", icon: Building2 },
      { label: "Integrations", href: "/dashboard/integrations", icon: LayoutList },
      { label: "Settings", href: "/dashboard/settings", icon: Settings },
    ],
  },
];

// Flat list for backwards compat
export const navItems = navSections.flatMap((s) => s.items);
