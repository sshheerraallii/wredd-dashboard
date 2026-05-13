// /lib/auth.ts
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { Role, WorkerType } from "@prisma/client";

export type AppSession = {
  user: {
    id: string;
    email: string;
    name?: string | null;
    role: Role;
    workerType?: WorkerType | null;
    archivedAt?: string | null; // or Date | null depending on what you inject
  };
};

export function readSession() {
  return getServerSession(authOptions) as unknown as Promise<AppSession | null>;
}
