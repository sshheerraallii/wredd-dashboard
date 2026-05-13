// prisma/seed-system-bd.ts
import dotenv from "dotenv";

// Load .env then .env.local (local overrides)
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

import crypto from "crypto";
import bcrypt from "bcryptjs";

import { getPrisma } from "../lib/prisma";
import { upsertSystemBd } from "../lib/bd-commission/systemBd";

const prisma = getPrisma();

async function main() {
  const fullName = "Wredd System BD";

  const randomPassword = crypto.randomBytes(32).toString("hex");
  const passwordHash = await bcrypt.hash(randomPassword, 10);

  const user = await upsertSystemBd(prisma as any, { fullName, passwordHash });

  console.log("System BD ensured:", {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    archivedAt: user.archivedAt,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });