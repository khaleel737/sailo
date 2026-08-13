import { present } from "@sailo/core/invariant";
import type { Config } from "drizzle-kit";

export default {
  schema: "../../packages/db/src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Migrations cannot run without it, and the assertion would report the
    // failure as a type error from drizzle-kit rather than a missing variable.
    url: present(process.env.DATABASE_URL, "DATABASE_URL"),
  },
} satisfies Config;
