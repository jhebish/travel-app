/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@travel/core"],
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Link-preview images (src/lib/og.tsx) read their fonts from disk: ship the files with those functions.
    outputFileTracingIncludes: {
      "**/{opengraph,twitter}-image*": ["./src/app/og/fonts/*.woff"],
    },
  },
  async redirects() {
    return [
      // The community area is now called Friends.
      { source: "/community", destination: "/friends", permanent: false },
      // Browse is the home page; the planner lives at /plan. Query strings carry over (?d=kyoto).
      { source: "/browse", destination: "/", permanent: false },
      // Older planner links (/?dest=Egypt&mode=multi, /?from=<trip>) still open the planner.
      { source: "/", has: [{ type: "query", key: "dest" }], destination: "/plan", permanent: false },
      { source: "/", has: [{ type: "query", key: "from" }], destination: "/plan", permanent: false },
    ];
  },
};

export default nextConfig;
