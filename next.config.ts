import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Allow next/image to proxy YouTube thumbnails for the videos sub-tab.
    // Even though we render with `unoptimized`, declaring the pattern here
    // avoids compatibility issues with future image optimization choices.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "i.ytimg.com",
      },
    ],
  },
};

export default nextConfig;
