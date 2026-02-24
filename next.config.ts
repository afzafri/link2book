import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["playwright-extra", "playwright", "puppeteer-extra-plugin-stealth", "sharp"],
};

export default nextConfig;
