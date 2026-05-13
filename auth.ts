// auth.ts (NextAuth v4 style)
import type { NextAuthOptions } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { getPrisma } from "@/lib/prisma";

type AppUser = {
  id: string;
  role: string;
  workerType?: string | null;
  archivedAt?: string | null;
};

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(getPrisma()),
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },

  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        identifier: { label: "Email or Username", type: "text" },
        password: { label: "Password", type: "password" },
      },

      async authorize(credentials) {
        const identifier = (credentials?.identifier ?? "").toString().trim();
        const password = (credentials?.password ?? "").toString();

        if (!identifier || !password) return null;

        const prisma = getPrisma();

        // IMPORTANT: DO NOT exclude archived users here.
        // We allow auth, then middleware/layout redirects them to /archived.
        const user = await prisma.user.findFirst({
          where: {
            OR: [{ email: identifier }, { username: identifier }],
          },
          select: {
            id: true,
            role: true,
            workerType: true,
            passwordHash: true,
            email: true,
            username: true,
            fullName: true,
            archivedAt: true,
          },
        });

        if (!user?.passwordHash) return null;

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;

        return {
          id: user.id,
          name: user.fullName ?? user.username ?? user.email,
          email: user.email,
          role: user.role,
          workerType: user.workerType,
          archivedAt: user.archivedAt ? user.archivedAt.toISOString() : null,
        } as any;
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      const prisma = getPrisma();

      // Persist a stable user id on the token
      const uid =
        (user as any)?.id ??
        (token as any)?.uid ??
        (token as any)?.sub;

      if (!uid) return token;
      (token as any).uid = uid;

      // On initial login, seed from `user`
      if (user) {
        const u = user as any as AppUser;
        (token as any).role = (u as any).role;
        (token as any).workerType = (u as any).workerType ?? null;
        (token as any).archivedAt = (u as any).archivedAt ?? null;
        return token;
      }

      // On subsequent requests, refresh from DB to prevent stale sessions
      const dbUser = await prisma.user.findUnique({
        where: { id: uid },
        select: { id: true, role: true, workerType: true, archivedAt: true },
      });

      if (!dbUser) return token;

      (token as any).role = dbUser.role;
      (token as any).workerType = dbUser.workerType ?? null;
      (token as any).archivedAt = dbUser.archivedAt
        ? dbUser.archivedAt.toISOString()
        : null;

      return token;
    },

    async session({ session, token }) {
      (session.user as any).id = (token as any).uid;
      (session.user as any).role = (token as any).role;
      (session.user as any).workerType = (token as any).workerType ?? null;
      (session.user as any).archivedAt = (token as any).archivedAt ?? null;
      return session;
    },
  },
};
