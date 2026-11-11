import { defineConfig } from "vitest/config";
import path from "node:path";

/* Tests run against a separate database so they never pollute the demo data (TEST_DATABASE_URL or paysettle_test). */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"], environment: "node", fileParallelism: false,
    /* many tests hash passwords and write to Postgres; 5 s (the default) is too tight on a busy machine or CI runner */
    testTimeout: 20_000, hookTimeout: 30_000,
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/paysettle_test", PAYSETTLE_ENV: "sandbox" },
  },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
