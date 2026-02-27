import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["playwright-extra", "playwright", "puppeteer-extra-plugin-stealth", "sharp", "@napi-rs/canvas"],
};

export default nextConfig;
