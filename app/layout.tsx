import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Signsbeat MASI — Adaptive Health Coach",
  description:
    "Multi-Agent Swarm Intelligence for personalized longevity and physiological state optimization.",
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-sb-dark antialiased">{children}</body>
    </html>
  );
}
