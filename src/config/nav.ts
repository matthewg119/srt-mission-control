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
    label: "Coaching",
    items: [
      { label: "Coaching Studio", href: "/dashboard/coaching-studio", icon: GraduationCap },
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
