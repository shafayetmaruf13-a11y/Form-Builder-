import type { Role, UserStatus } from "@/db/schema";

/**
 * Our own fields on the session.
 *
 * Auth.js knows about identity; role and status are ours, so they have to be
 * declared. Putting them on the session means a server component can decide
 * what to render without a second query.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      status: UserStatus;
      email?: string | null;
      name?: string | null;
      image?: string | null;
    };
  }
}

export {};
