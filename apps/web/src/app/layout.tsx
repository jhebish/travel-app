import type { Metadata, Viewport } from "next";
import "./globals.css";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { fontVariables } from "./fonts";

export const metadata: Metadata = {
  // Absolute URLs for link-preview images. NEXT_PUBLIC_SITE_URL can point them at another domain.
  metadataBase: new URL([process.env.NEXT_PUBLIC_SITE_URL?.trim(), "https://www.pylos.ai"].find((u) => !!u && URL.canParse(u))!),
  title: "Pylos",
  description: "Journeys built around you, from the people who live there.",
  openGraph: { siteName: "Pylos", type: "website" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontVariables}>
      <body>
        <Nav />
        <div className="shell">
          <div className="app">
            <main className="main">{children}</main>
            <footer className="sitefoot">
              <span className="sitefoot-word">Pylos</span>
              <nav aria-label="About Pylos">
                <Link href="/about">About</Link>
                <Link href="/privacy">Privacy</Link>
                <Link href="/terms">Terms</Link>
                <a href="mailto:team@newcenturydevelopment.com">Contact</a>
              </nav>
            </footer>
          </div>
        </div>
      </body>
    </html>
  );
}
