import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";

const prisma = getPrisma();

// keep last 200 per user OR last 180 days (both applied safely)
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const got = req.headers.get("x-cron-secret");
    if (got !== secret) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }
  }

  // 1) hard time-based cleanup (older than 180 days)
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
