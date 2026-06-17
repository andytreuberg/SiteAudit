import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SiteAudit — pay a few cents, an agent audits your site",
  description:
    "Name a URL, pay a few cents of native USDC, and an autonomous agent fetches your site, scans it for SEO, speed and security-header issues, scores it 0–100, and stamps a mini-audit report on-chain. The same job is callable by another agent over x402. On ARC.",
  keywords: "SiteAudit, ARC, USDC, site audit, SEO, security headers, x402, micropayments, agents, agentic commerce",
};

export const viewport: Viewport = { themeColor: "#f49ed7" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
