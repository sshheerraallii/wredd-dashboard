import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";

const prisma = getPrisma();

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  // Delete notifications older than 180 days
  const olderThan = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);

  const timeCleanup = await prisma.notification.deleteMany({
    where: {
      createdAt: { lt: olderThan },
    },
  });

  return NextResponse.json({
    ok: true,
    deletedOld: timeCleanup.count,
  });
}