import type { Metadata, Viewport } from "next";
import { Inter, Manrope } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";
import { MobileNav, Sidebar } from "@/components/nav";
import { TopBarStatus } from "@/components/topbar";
import { Skeleton } from "@/components/ui";
import { GlobalToaster } from "@/components/global-toast";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"], display: "swap", weight: ["500", "600", "700", "800"] });

export const metadata: Metadata = {
  title: { default: "Freshroots Demand Planning", template: "%s · Freshroots Demand Planning" },
  description: "Rule-based demand classification, stock-risk flags and reorder recommendations with planner review.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#050405", colorScheme: "dark" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-IN" className={`${inter.variable} ${manrope.variable} h-full antialiased`}>
      <body className="rn-grid-bg min-h-full">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface-2 focus:px-3 focus:py-2">
          Skip to content
        </a>
        <div className="relative z-10 flex min-h-dvh">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <MobileNav />
            <div className="border-b border-line bg-bg/60 px-4 py-2.5 backdrop-blur md:px-8">
              <Suspense fallback={<Skeleton className="h-8 w-full max-w-xl" />}>
                <TopBarStatus />
              </Suspense>
            </div>
            <main id="main" className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 md:px-8 md:py-8">
              {children}
            </main>
          </div>
        </div>
        <GlobalToaster />
      </body>
    </html>
  );
}
