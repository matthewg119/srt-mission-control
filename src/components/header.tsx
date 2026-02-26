"use client";

import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";

interface HeaderProps {
  user: { name?: string | null };
  onMenuClick: () => void;
}

const titleMap: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/dashboard/assistant": "AI Assistant",
  "/dashboard/knowledge": "Knowledge Base",
  "/dashboard/pipeline": "Pipeline",
  "/dashboard/updates": "System Updates",
  "/dashboard/integrations": "Integrations",
  "/dashboard/settings": "Settings",
};

function getPageTitle(pathname: string): string {
  // Try exact match first
  if (titleMap[pathname]) return titleMap[pathname];

  // Try matching parent paths for nested routes
  const segments = pathname.split("/");
  while (segments.length > 1) {
    segments.pop();
    const parentPath = segments.join("/");
    if (titleMap[parentPath]) return titleMap[parentPath];
  }

  return "Dashboard";
}

function getFirstName(name?: string | null): string {
  if (!name) return "there";
  return name.split(" ")[0];
}

export function Header({ user, onMenuClick }: HeaderProps) {
  const pathname = usePathname();
  const pageTitle = getPageTitle(pathname);
  const firstName = getFirstName(user.name);

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between border-b border-[rgba(255,255,255,0.06)] bg-[#0B1426] px-6">
      {/* Left side */}
      <div className="flex items-center gap-4">
        {/* Mobile menu button */}
        <button
          onClick={onMenuClick}
          className="md:hidden rounded-md p-1.5 text-[rgba(255,255,255,0.5)] transition-colors hover:bg-[rgba(255,255,255,0.05)] hover:text-white"
          aria-label="Toggle sidebar"
        >
          <Menu className="h-5 w-5" />
        </button>

        {/* Page title */}
        <h1 className="text-lg font-semibold text-white">{pageTitle}</h1>
      </div>

      {/* Right side */}
      <span className="text-sm text-[rgba(255,255,255,0.5)]">
        Hey, {firstName}
      </span>
    </header>
  );
}
