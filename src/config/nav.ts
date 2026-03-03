import {
  LayoutDashboard,
  MessageSquare,
  Kanban,
  Settings,
  Mail,
  FileText,
  ClipboardCheck,
  Building2,
  LayoutGrid,
  Inbox,
  Mails,
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
      { label: "AI Assistant", href: "/dashboard/assistant", icon: MessageSquare },
      { label: "Email Agents", href: "/dashboard/email-agents", icon: Mail },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Messaging", href: "/dashboard/messaging", icon: Inbox },
      { label: "Templates", href: "/dashboard/templates", icon: FileText },
      { label: "Sequences", href: "/dashboard/sequences", icon: Mails },
      { label: "Systems", href: "/dashboard/systems", icon: LayoutGrid },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Lenders", href: "/dashboard/lenders", icon: Building2 },
      { label: "Checklist", href: "/dashboard/checklist", icon: ClipboardCheck },
      { label: "Settings", href: "/dashboard/settings", icon: Settings },
    ],
  },
];

// Flat list for backwards compat
export const navItems = navSections.flatMap((s) => s.items);
