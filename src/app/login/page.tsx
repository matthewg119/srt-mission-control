import type { Metadata } from "next";
import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = {
  title: "Login | SRT Mission Control",
};

export default function LoginPage() {
  return (
    <div className="grid-pattern relative flex min-h-screen items-center justify-center bg-[#0B1426]">
      <div className="w-full max-w-[420px] px-4">
        <div className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] p-8">
          {/* Logo + Brand */}
          <div className="mb-8 flex flex-col items-center gap-4">
            <div className="flex items-center gap-3">
              {/* CSS 3-bar chart logo */}
              <div className="flex items-end gap-[3px]">
                <div className="h-[12px] w-[5px] rounded-t-sm bg-[#1B65A7]" />
                <div className="h-[18px] w-[5px] rounded-t-sm bg-[#1B65A7]" />
                <div className="h-[26px] w-[5px] rounded-t-sm bg-[#00C9A7]" />
              </div>
              <span className="text-lg font-bold text-white">SRT Agency</span>
            </div>

            <h1
              className="text-center text-[28px] font-bold text-white"
              style={{
                textShadow: "0 0 40px rgba(0, 201, 167, 0.3)",
              }}
            >
              Mission Control
            </h1>
          </div>

          {/* Login Form (client component) */}
          <LoginForm />
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-sm text-[rgba(255,255,255,0.5)]">
          SRT Agency Internal Operations
        </p>
      </div>
    </div>
  );
}
