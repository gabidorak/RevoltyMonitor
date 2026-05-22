import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Use the direct (non-pooled) connection for migrations to avoid pgBouncer issues.
    // Falls back to DATABASE_URL if DIRECT_URL is not set.
    url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"]!,
  },
});
