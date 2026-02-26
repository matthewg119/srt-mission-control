import {
  LayoutDashboard,
  MessageSquare,
  BookOpen,
  Kanban,
  Rocket,
  Plug,
  Settings,
} from "lucide-react";

export const navItems = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "AI Assistant", href: "/dashboard/assistant", icon: MessageSquare },
  { label: "Knowledge Base", href: "/dashboard/knowledge", icon: BookOpen },
  { label: "Pipeline", href: "/dashboard/pipeline", icon: Kanban },
  { label: "Updates", href: "/dashboard/updates", icon: Rocket },
  { label: "Integrations", href: "/dashboard/integrations", icon: Plug },
  { label: "Settings", href: "/dashboard/settings", icon: Settings },
];
