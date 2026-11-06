import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Plan a trip · Pylos",
  description: "Tell Pylos who's coming and what you're into. Your plan is built from the places locals actually go.",
};

export default function PlanLayout({ children }: { children: React.ReactNode }) {
  return children;
}
