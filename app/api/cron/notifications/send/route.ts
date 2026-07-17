import { NextResponse } from "next/server";
import { sendPendingEmailDeliveries } from "@/lib/notify";

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const res = await sendPendingEmailDeliveries(100);
  return NextResponse.json({ ok: true, ...res });
}