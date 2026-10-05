import type { NextConfig } from "next";

const config: NextConfig = {
  // Mastra, pg and agentmail must run as plain Node modules, not bundled (agentmail has an optional @x402/fetch import).
  serverExternalPackages: ["@mastra/core", "@mastra/memory", "@mastra/pg", "pg", "agentmail"],
};

export default config;
