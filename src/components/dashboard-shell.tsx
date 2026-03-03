"use client";

import { useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";

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

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar user={user} isOpen={sidebarOpen} onClose={handleSidebarClose} />

      <main className="flex flex-1 flex-col overflow-hidden">
        <Header user={user} onMenuClick={handleMenuClick} />

        <div className={`flex-1 overflow-hidden ${pathname === "/dashboard" ? "" : "overflow-y-auto p-6"}`}>{children}</div>
      </main>
    </div>
  );
}
