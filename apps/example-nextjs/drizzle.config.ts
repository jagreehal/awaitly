import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./.data/migrations",
  dialect: "sqlite",
  dbCredentials: { url: ".data/sqlite.db" },
});
