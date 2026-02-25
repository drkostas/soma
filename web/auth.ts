import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    signIn({ profile }) {
      const owner = process.env.GITHUB_OWNER_USERNAME;
      if (!owner) return false;
      return (profile as any)?.login === owner;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
});
