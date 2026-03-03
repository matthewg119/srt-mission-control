import {
  LayoutDashboard,
  MessageSquare,
  BookOpen,
  Kanban,
  Rocket,
  Plug,
  Settings,
  Mail,
  Inbox,
  Zap,
  FileText,
  ClipboardCheck,
  ListChecks,
  Phone,
  Megaphone,
} from "lucide-react";

export interface NavSection {
  label: string;
  items: NavItem[];
}

export interface NavItem {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
}

export const navSections: NavSection[] = [
  {
    label: "Main",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { label: "Pipeline", href: "/dashboard/pipeline", icon: Kanban },
      { label: "Messaging", href: "/dashboard/messaging", icon: Mail },
      { label: "Outlook", href: "/dashboard/mail", icon: Inbox },
      { label: "Call Recap", href: "/dashboard/call-recap", icon: Phone },
    ],
  },
  {
    label: "Automation",
    items: [
      { label: "Templates", href: "/dashboard/templates", icon: FileText },
      { label: "Automations", href: "/dashboard/automations", icon: Zap },
    ],
  },
  {
    label: "Marketing",
    items: [
      { label: "Marketing", href: "/dashboard/marketing", icon: Megaphone },
    ],
  },
  {
    label: "Tools",
    items: [
      { label: "AI Assistant", href: "/dashboard/assistant", icon: MessageSquare },
      { label: "Knowledge Base", href: "/dashboard/knowledge", icon: BookOpen },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Onboarding", href: "/dashboard/onboarding", icon: ListChecks },
      { label: "Integrations", href: "/dashboard/integrations", icon: Plug },
      { label: "QA Checklist", href: "/dashboard/checklist", icon: ClipboardCheck },
      { label: "Updates", href: "/dashboard/updates", icon: Rocket },
      { label: "Settings", href: "/dashboard/settings", icon: Settings },
    ],
  },
];

// Flat list for backwards compat
export const navItems = navSections.flatMap((s) => s.items);
