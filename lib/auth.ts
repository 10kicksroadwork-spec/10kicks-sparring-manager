import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { roleForEmail, type Role } from "@/lib/permissions";

const googleReady = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

export const authOptions: NextAuthOptions = {
  secret: process.env.AUTH_SECRET,
  session: { strategy: "jwt" },
  pages: { signIn: "/signin", error: "/signin" },
  providers: googleReady
    ? [
        GoogleProvider({
          clientId: process.env.AUTH_GOOGLE_ID ?? "",
          clientSecret: process.env.AUTH_GOOGLE_SECRET ?? "",
          authorization: { params: { prompt: "select_account", scope: "openid email profile" } },
        }),
      ]
    : [],
  callbacks: {
    async signIn({ profile }) {
      const email = profile?.email?.toLowerCase();
      const verified = Boolean((profile as { email_verified?: boolean } | undefined)?.email_verified);
      if (!email || !verified) return false;
      return Boolean(roleForEmail(email));
    },
    async jwt({ token, profile }) {
      const email = (profile?.email ?? token.email)?.toString().toLowerCase();
      if (email) {
        token.email = email;
        token.role = roleForEmail(email);
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.email = token.email ?? session.user.email;
        session.user.role = (token.role as Role | null) ?? null;
      }
      return session;
    },
  },
};

export async function sessionIdentity(): Promise<{ email: string; role: Role | null } | null> {
  try {
    const { getServerSession } = await import("next-auth");
    const session = await getServerSession(authOptions);
    const email = session?.user?.email?.toLowerCase();
    if (!email) return null;
    return { email, role: roleForEmail(email) };
  } catch {
    return null;
  }
}

declare module "next-auth" {
  interface Session {
    user?: { name?: string | null; email?: string | null; image?: string | null; role?: Role | null };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: Role | null;
  }
}
