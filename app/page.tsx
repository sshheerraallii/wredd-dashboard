import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";

export default async function Home() {
  const session = await readSession();

  if (!session?.user) {
    redirect("/login");
  }

  // If archived, force them to the archived page
  if ((session.user as any).archivedAt) {
    redirect("/archived");
  }

  // Logged in and active → go to dashboard
  redirect("/app");
}
