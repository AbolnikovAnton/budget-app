import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { randomUUID } from "node:crypto";
import { database } from "@/lib/db";

interface UserDocument {
  _id: string; googleSub: string; name: string; email: string; familyCount: number; createdAt: string;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET ? [Google({
    clientId: process.env.AUTH_GOOGLE_ID,
    clientSecret: process.env.AUTH_GOOGLE_SECRET,
    authorization: { params: { scope: "openid email profile" } }
  })] : [],
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 },
  pages: { signIn: "/", error: "/" },
  // Vercel supplies the trusted proxy host; set AUTH_URL to the canonical origin.
  trustHost: Boolean(process.env.VERCEL || process.env.AUTH_URL) || process.env.NODE_ENV !== "production",
  callbacks: {
    async signIn({ account, profile }) {
      return account?.provider === "google" && profile?.email_verified === true && Boolean(profile.email);
    },
    async jwt({ token, account, profile }) {
      if (account?.provider === "google" && profile?.email) {
        const users = (await database()).collection<UserDocument>("users");
        const googleSub = account.providerAccountId;
        const email = profile.email.trim().toLowerCase();
        const name = typeof profile.name === "string" ? profile.name : email.split("@")[0];
        try {
          await users.updateOne({ googleSub }, {
            $set: { name, email },
            $setOnInsert: { _id: randomUUID(), googleSub, familyCount: 0, createdAt: new Date().toISOString() }
          }, { upsert: true });
        } catch (error) {
          // A simultaneous first login can win the unique-googleSub insert.
          if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error;
        }
        const user = await users.findOne({ googleSub });
        if (!user) throw new Error("userUnavailable");
        token.userId = user._id;
        token.name = name;
        token.email = email;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = typeof token.userId === "string" ? token.userId : "";
      return session;
    }
  },
  logger: { error(error) { console.error("Authentication failed:", error.name); } }
});
