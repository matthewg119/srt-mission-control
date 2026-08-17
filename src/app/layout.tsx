import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

// noindex is the default for this whole host: it is the internal ops app and
// nothing here is meant to be public. src/app/scan/page.tsx deliberately
// overrides it back to index:true, which still works because page metadata beats
// layout metadata. The real crawl block is public/robots.txt.
export const metadata: Metadata = {
  title: "SRT Mission Control",
  description:
    "Internal operations application for SRT Agency LLC, a marketing and AI-visibility (AEO) agency.",
  robots: { index: false, follow: false, nocache: true },
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link
          href="https://api.fontshare.com/v2/css?f[]=general-sans@200,300,400,500,600,700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        className={`${jetbrainsMono.variable} antialiased`}
        style={{ fontFamily: "'General Sans', system-ui, sans-serif" }}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
