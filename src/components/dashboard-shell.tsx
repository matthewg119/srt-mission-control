"use client";

import { useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";
import { ChatPopup } from "@/components/chat-popup";

interface DashboardShellUser {
  name?: string | null;
  email?: string | null;
  role?: string;
  image?: string | null;
}

interface DashboardShellProps {
  user: DashboardShellUser;
  children: React.ReactNode;
}

export function DashboardShell({ user, children }: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();

  const handleMenuClick = useCallback(() => {
    setSidebarOpen(true);
  }, []);

  const handleSidebarClose = useCallback(() => {
    setSidebarOpen(false);
  }, []);

  /**
   * A client preview renders BARE: no sidebar, no header, no chat bubble, no padding.
   *
   * ‼️ THE CHROME WAS MAKING THE PREVIEW LIE. These pages exist to show a client's own hub or review
   * page exactly as their customer will see it, and every one of them was being judged inside Mission
   * Control's dark shell, on a 6rem-narrower viewport, with a chat bubble over the bottom-right corner.
   * A white review page cannot be assessed through a navy panel, and the one thing the page is FOR is
   * deciding whether it looks right. Matthew, 2026-09-28: "avoid the mission control panel background
   * so we can have a full preview".
   *
   * ‼️ AUTH IS UNTOUCHED. The route still sits under /dashboard, so dashboard/layout.tsx still calls
   * auth() before this component renders. This drops the CHROME, never the session check: a preview is
   * a client's real page and the id in the URL is not a secret anybody may trade for one.
   */
  if (pathname.includes("/preview")) {
    return <div className="h-screen overflow-y-auto">{children}</div>;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar user={user} isOpen={sidebarOpen} onClose={handleSidebarClose} />

      <main className="flex flex-1 flex-col overflow-hidden">
        <Header user={user} onMenuClick={handleMenuClick} />

        <div className={`flex-1 overflow-hidden ${pathname === "/dashboard" ? "" : "overflow-y-auto p-6"}`}>{children}</div>
      </main>

      {/* BrainHeart chat popup on all pages */}
      {pathname !== "/dashboard" && <ChatPopup />}
    </div>
  );
}
