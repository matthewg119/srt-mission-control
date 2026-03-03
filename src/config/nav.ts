import {
  LayoutDashboard,
  Kanban,
  Settings,
  Mail,
  FileText,
  ClipboardCheck,
  Building2,
  LayoutGrid,
  Mails,
  Brain,
  GitFork,
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
      { label: "Command Center", href: "/dashboard", icon: LayoutDashboard },
      { label: "Pipeline", href: "/dashboard/pipeline", icon: Kanban },
      { label: "Brain Trust", href: "/dashboard/brain-trust", icon: Brain },
      { label: "Email Agents", href: "/dashboard/email-agents", icon: Mail },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Templates", href: "/dashboard/templates", icon: FileText },
      { label: "Sequences", href: "/dashboard/sequences", icon: Mails },
      { label: "Workflows", href: "/dashboard/workflows", icon: GitFork },
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
