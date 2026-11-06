import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "Pylos",
  description: "Journeys built around you, from the people who live there.",
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
        <div className="shell">
          <div className="app">
            <Nav />
            <main className="main">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
