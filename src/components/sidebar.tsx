"use client";

import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { LogOut, X } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { navSections } from "@/config/nav";
import { cn } from "@/lib/utils";

interface SidebarUser {
  name?: string | null;
  email?: string | null;
  role?: string;
  image?: string | null;
}

interface SidebarProps {
  user: SidebarUser;
  isOpen: boolean;
  onClose: () => void;
}

function getInitials(name?: string | null): string {
  if (!name) return "U";
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function SrtLogo() {
  return (
    <div className="flex items-end gap-[3px]">
      <div className="w-[5px] h-[12px] rounded-t-sm bg-[#1B65A7]" />
      <div className="w-[5px] h-[18px] rounded-t-sm bg-[#1B65A7]" />
      <div className="w-[5px] h-[26px] rounded-t-sm bg-[#00C9A7]" />
    </div>
  );
}

export function Sidebar({ user, isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();

  const sidebarContent = (
    <div className="flex h-full flex-col bg-[#0B1426] border-r border-[rgba(255,255,255,0.06)]">
      {/* Logo section */}
      <div className="flex h-16 items-center gap-3 px-6 shrink-0">
        <SrtLogo />
        <span className="text-base font-bold text-white tracking-tight">
          SRT Agency
        </span>
        {/* Close button for mobile */}
        <button
          onClick={onClose}
          className="ml-auto md:hidden text-[rgba(255,255,255,0.5)] hover:text-white transition-colors"
          aria-label="Close sidebar"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {navSections.map((section, sectionIdx) => (
          <div key={section.label} className={sectionIdx > 0 ? "mt-5" : ""}>
            <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-wider text-[rgba(255,255,255,0.25)]">
              {section.label}
            </p>
            <ul className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const isActive =
                  item.href === "/dashboard"
                    ? pathname === "/dashboard"
                    : pathname.startsWith(item.href);
                const Icon = item.icon;

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onClose}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                        isActive
                          ? "bg-[rgba(255,255,255,0.05)] text-white border-l-2 border-[#00C9A7]"
                          : "text-[rgba(255,255,255,0.5)] hover:text-white hover:bg-[rgba(255,255,255,0.03)]"
                      )}
                    >
                      <Icon className="h-[18px] w-[18px] shrink-0" />
                      <span>{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* User section */}
      <div className="shrink-0 border-t border-[rgba(255,255,255,0.06)] p-4">
        <div className="flex items-center gap-3">
          {/* Avatar */}
          {user.image ? (
            <Image
              src={user.image}
              alt={user.name ?? "User avatar"}
              width={36}
              height={36}
              className="h-9 w-9 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[rgba(255,255,255,0.08)] text-xs font-semibold text-white">
              {getInitials(user.name)}
            </div>
          )}

          {/* Name and role */}
          <div className="flex flex-col min-w-0 flex-1">
            <span className="truncate text-sm font-medium text-white">
              {user.name ?? "User"}
            </span>
            {user.role && (
              <span className="inline-flex w-fit items-center rounded-full bg-[rgba(0,201,167,0.1)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[#00C9A7]">
                {user.role}
              </span>
            )}
          </div>

          {/* Sign out button */}
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="shrink-0 rounded-md p-1.5 text-[rgba(255,255,255,0.4)] transition-colors hover:bg-[rgba(255,255,255,0.05)] hover:text-white"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-[260px] md:shrink-0 h-full">
        {sidebarContent}
      </aside>

      {/* Mobile overlay */}
      {isOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden="true"
          />
          {/* Sidebar panel */}
          <aside className="relative z-10 h-full w-[260px] animate-in slide-in-from-left duration-200">
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
}
