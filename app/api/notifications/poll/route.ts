import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";

const prisma = getPrisma();

export async function GET(req: Request) {
  const session = await readSession();
  if (!session?.user) return NextResponse.json({ ok: false }, { status: 401 });

  const url = new URL(req.url);
  const since = url.searchParams.get("since"); // ISO string
  const sinceDate = since ? new Date(since) : null;

  const where: any = {
    userId: session.user.id,
  };

  if (sinceDate && !Number.isNaN(sinceDate.getTime())) {
    // strictly newer than last seen
    where.createdAt = { gt: sinceDate };
  }

  const latest = await prisma.notification.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      title: true,
      body: true,
      href: true,
      createdAt: true,
      readAt: true,
    },
  });

  const unreadCount = await prisma.notification.count({
    where: { userId: session.user.id, readAt: null },
  });

  // Return newest timestamp so client can advance cursor
  const newest = latest[0]?.createdAt?.toISOString() ?? null;

  return NextResponse.json({
    ok: true,
    unreadCount,
    newest,
    items: latest.reverse(), // oldest -> newest for nicer stacking
  });
}
