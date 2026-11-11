import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const url = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/paysettle";
const g = globalThis as unknown as { __psPool?: Pool };
export const pool = g.__psPool ?? new Pool({ connectionString: url, max: 10 });
if (process.env.NODE_ENV !== "production") g.__psPool = pool;
export const db = drizzle(pool, { schema, casing: "snake_case" });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export { schema };
