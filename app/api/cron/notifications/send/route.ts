import { NextResponse } from "next/server";
import { sendPendingEmailDeliveries } from "@/lib/notify";

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const got = req.headers.get("x-cron-secret");
    if (got !== secret) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }
  }

  const res = await sendPendingEmailDeliveries(25);
  return NextResponse.json({ ok: true, ...res });
}