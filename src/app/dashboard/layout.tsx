import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { DashboardShell } from "@/components/dashboard-shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const user = {
    name: session.user.name ?? null,
    email: session.user.email ?? null,
    role: (session.user as { role?: string }).role ?? "member",
    image: session.user.image ?? null,
  };

  return <DashboardShell user={user}>{children}</DashboardShell>;
}
