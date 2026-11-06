/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@travel/core"],
  reactStrictMode: true,
  poweredByHeader: false,
  async redirects() {
    // The community area is now called Friends.
    return [{ source: "/community", destination: "/friends", permanent: false }];
  },
};

export default nextConfig;
