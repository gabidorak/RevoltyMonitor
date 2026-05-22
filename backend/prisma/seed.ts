/**
 * Prisma seed script — creates the initial admin user.
 *
 * Usage (from the backend/ directory):
 *   ADMIN_PASSWORD=yourpassword npx tsx prisma/seed.ts
 *
 * Optional:
 *   ADMIN_USERNAME=admin  (default: "admin")
 */
// @ts-nocheck
import "dotenv/config"; // loads .env → DATABASE_URL, etc.
import { neonConfig } from "@neondatabase/serverless";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import ws from "ws";
import bcrypt from "bcryptjs";

// Required for local Node.js (no native WebSocket)
if (typeof globalThis.WebSocket === "undefined") {
  neonConfig.webSocketConstructor = ws;
}

const adapter = new PrismaNeon({
  connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD;

  if (!password) {
    console.error(
      "❌ ADMIN_PASSWORD env var is required.\n" +
        "   Usage: ADMIN_PASSWORD=yourpassword npx tsx prisma/seed.ts"
    );
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.adminUser.upsert({
    where: { username },
    update: { passwordHash },
    create: { username, passwordHash, role: "ADMIN" },
  });

  console.log(`✅ Admin user "${user.username}" created/updated.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
