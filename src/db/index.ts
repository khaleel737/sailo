import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return drizzle(neon(url), { schema });
}

// Lazy so `next build` doesn't need a live connection string.
let cached: ReturnType<typeof createDb> | null = null;

export function getDb() {
  if (!cached) cached = createDb();
  return cached;
}

export { schema };
