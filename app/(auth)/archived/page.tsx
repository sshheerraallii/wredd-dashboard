import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { SignOutButton } from "./_components/signout-button";

export default async function ArchivedPage() {
  const session = await readSession();

  // Not logged in → login
  if (!session?.user) redirect("/login");

  // Logged in but restored → dashboard
  if (!(session.user as any).archivedAt) redirect("/app");

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="max-w-md w-full rounded-xl border bg-card p-6 space-y-5">
        <h1 className="text-lg font-semibold text-center">
          Account Access Restricted
        </h1>

        <p className="text-sm text-muted-foreground text-center">
          Your access to the <strong>WREDD Dashboard</strong> has been restricted.
        </p>

        <div className="text-sm text-muted-foreground space-y-3">
          <p>
            For further clarification regarding this decision, please contact your{" "}
            <strong>reporting manager, collaborators, or the HR department</strong>.
          </p>

          <p>
            Any <strong>pending payments or outstanding dues</strong>, where applicable,
            will be reviewed and processed according to the standard payment cycle,
            with settlement scheduled for the{" "}
            <strong>10th of the upcoming month</strong>.
          </p>

          <p>
            If there are any open or unresolved matters, we appreciate your patience
            and cooperation while they are addressed. Please be assured that all
            processes are handled with due diligence and fairness.
          </p>
        </div>

        <p className="text-sm text-center text-muted-foreground pt-2">
          We wish you continued success in your future professional endeavors.
        </p>

        <div className="text-sm text-center font-medium">
          — Team WREDD
        </div>

        {/* Sign out */}
        <div className="pt-2">
          <SignOutButton />
        </div>
      </div>
    </div>
  );
}
