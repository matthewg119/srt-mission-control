import { auth } from "@/lib/auth";
import { CommandCenter } from "@/components/command-center";

export const metadata = { title: "Command Center | SRT Mission Control" };

export default async function DashboardPage() {
  const session = await auth();
  const userName = session?.user?.name || undefined;

  return <CommandCenter userName={userName} />;
}
