import { defineConfig } from "drizzle-kit";

/* Scripts do not read .env.local on their own; Next.js does. */
try { process.loadEnvFile(".env.local"); } catch { /* no file: the default address is used */ }

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/db/schema.ts", "./src/db/schema-*.ts"],
  out: "./drizzle",
  casing: "snake_case",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/paysettle" },
});
