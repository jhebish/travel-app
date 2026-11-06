import type { Metadata } from "next";

export const metadata: Metadata = { title: "Plan a trip together · Pylos", robots: { index: false } };

export default function JoinLayout({ children }: { children: React.ReactNode }) {
  return children;
}
