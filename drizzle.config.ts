import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
  // Mastra memory creates its own mastra_* tables in the same DB; don't let push drop them.
  tablesFilter: ["!mastra_*"],
});
