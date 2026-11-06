import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";

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
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Marcellus&family=EB+Garamond:ital,wght@0,400..700;1,400..600&display=swap"
        />
      </head>
      <body>
        <Nav />
        <div className="shell">
          <div className="app">
            <main className="main">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
