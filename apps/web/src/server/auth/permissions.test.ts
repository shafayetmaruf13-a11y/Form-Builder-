import { ROLES, type Role } from "@/db/schema";
import { describe, expect, it } from "vitest";

import {
  type Actor,
  allowedActions,
  atLeast,
  can,
  canActOnMember,
  canReadForm,
  canReadSubmissions,
  canSetRole,
  canTransferOwnership,
  canWriteForm,
  rank,
} from "./permissions";

function actor(role: Role, overrides: Partial<Actor> = {}): Actor {
  return { id: "u_self", role, status: "active", ...overrides };
}

describe("the role hierarchy", () => {
  it("ranks least to most privileged", () => {
    expect([...ROLES]).toEqual(["user", "moderator", "admin", "owner"]);
    expect(rank("user")).toBeLessThan(rank("moderator"));
    expect(rank("moderator")).toBeLessThan(rank("admin"));
    expect(rank("admin")).toBeLessThan(rank("owner"));
  });

  it("is transitive: anything a lesser role may do, a greater role may do", () => {
    // The property that makes a hierarchy a hierarchy. If this ever fails,
    // somebody has written a rule that a lower role passes and a higher one
    // does not, which is never what was meant.
    for (const lower of ROLES) {
      for (const higher of ROLES) {
        if (!atLeast(higher, lower)) continue;

        for (const action of allowedActions(lower)) {
          expect(
            can(higher, action),
            `${higher} should inherit ${action} from ${lower}`,
          ).toBe(true);
        }
      }
    }
  });
});

describe("what each role may do", () => {
  it("lets any account holder build their own forms", () => {
    for (const role of ROLES) {
      expect(can(role, "form:create"), role).toBe(true);
      expect(can(role, "form:updateOwn"), role).toBe(true);
      expect(can(role, "form:publish"), role).toBe(true);
    }
  });

  it("keeps a moderator out of other people's forms", () => {
    // Moderators police responses, not other people's designs. This is the
    // distinction between the two middle roles, so it is worth pinning.
    expect(can("moderator", "form:readAny")).toBe(false);
    expect(can("moderator", "form:updateAny")).toBe(false);
    expect(can("moderator", "form:deleteAny")).toBe(false);

    expect(can("moderator", "submission:readAny")).toBe(true);
    expect(can("moderator", "submission:export")).toBe(true);
    expect(can("moderator", "submission:delete")).toBe(true);
  });

  it("keeps a plain user out of everyone else's everything", () => {
    expect(can("user", "form:readAny")).toBe(false);
    expect(can("user", "submission:readAny")).toBe(false);
    expect(can("user", "member:invite")).toBe(false);
    expect(can("user", "member:setRole")).toBe(false);
  });

  it("lets everyone see who is in the workspace", () => {
    for (const role of ROLES) {
      expect(can(role, "member:read"), role).toBe(true);
    }
  });

  it("reserves member management for admins and above", () => {
    for (const action of [
      "member:invite",
      "member:setRole",
      "member:suspend",
      "member:remove",
    ] as const) {
      expect(can("user", action), action).toBe(false);
      expect(can("moderator", action), action).toBe(false);
      expect(can("admin", action), action).toBe(true);
      expect(can("owner", action), action).toBe(true);
    }
  });

  it("reserves ownership transfer for the owner alone", () => {
    expect(can("admin", "owner:transfer")).toBe(false);
    expect(can("owner", "owner:transfer")).toBe(true);
  });
});

describe("a suspended account", () => {
  it("can do nothing, whatever its role", () => {
    // Suspension is a separate column precisely so it does not lose what the
    // person was. It must therefore be checked separately, everywhere.
    for (const role of ROLES) {
      const suspended = actor(role, { status: "suspended" });

      expect(canReadForm(suspended, suspended.id), role).toBe(false);
      expect(canWriteForm(suspended, suspended.id), role).toBe(false);
      expect(
        canSetRole(suspended, { id: "u_other", role: "user" }, "moderator"),
      ).toBe("not-active");
      expect(
        canActOnMember(
          suspended,
          { id: "u_other", role: "user" },
          "member:remove",
        ),
      ).toBe("not-active");
    }
  });

  it("and neither can an invited one who has never signed in", () => {
    const invited = actor("admin", { status: "invited" });
    expect(canReadForm(invited, invited.id)).toBe(false);
    expect(
      canSetRole(invited, { id: "u_other", role: "user" }, "moderator"),
    ).toBe("not-active");
  });
});

describe("changing someone's role", () => {
  const admin = actor("admin");

  it("lets an admin promote a user to moderator", () => {
    expect(
      canSetRole(admin, { id: "u_a", role: "user" }, "moderator"),
    ).toBeNull();
  });

  it("refuses to act on a peer or a superior", () => {
    // Otherwise admins demote each other, or demote the owner.
    expect(canSetRole(admin, { id: "u_a", role: "admin" }, "user")).toBe(
      "outranked",
    );
    expect(canSetRole(admin, { id: "u_a", role: "owner" }, "user")).toBe(
      "outranked",
    );
  });

  it("refuses to grant a role at or above the actor's own", () => {
    // Otherwise an admin promotes a colleague to admin and has escalated by
    // proxy. Granting owner is refused too, under its own clearer reason.
    expect(canSetRole(admin, { id: "u_a", role: "user" }, "admin")).toBe(
      "outranked",
    );
    expect(
      canSetRole(admin, { id: "u_a", role: "user" }, "owner"),
    ).not.toBeNull();
  });

  it("refuses to change your own role", () => {
    expect(canSetRole(admin, { id: admin.id, role: "admin" }, "owner")).toBe(
      "self",
    );
    expect(canSetRole(admin, { id: admin.id, role: "admin" }, "user")).toBe(
      "self",
    );
  });

  it("never creates an owner — only a transfer does, and says so", () => {
    // The refusal reason is shown to people, so "outranked" would be a lie
    // here: the owner is not outranked, ownership just does not move this way.
    const owner = actor("owner");
    expect(canSetRole(owner, { id: "u_a", role: "admin" }, "owner")).toBe(
      "use-transfer",
    );
    expect(
      canSetRole(actor("admin"), { id: "u_a", role: "user" }, "owner"),
    ).toBe("use-transfer");
  });

  it("lets the owner manage admins", () => {
    const owner = actor("owner");
    expect(canSetRole(owner, { id: "u_a", role: "admin" }, "user")).toBeNull();
    expect(canSetRole(owner, { id: "u_a", role: "user" }, "admin")).toBeNull();
  });

  it("refuses a plain user outright", () => {
    expect(
      canSetRole(actor("user"), { id: "u_a", role: "user" }, "admin"),
    ).toBe("not-permitted");
  });
});

describe("suspending and removing", () => {
  const admin = actor("admin");

  it("lets an admin remove someone junior", () => {
    expect(
      canActOnMember(admin, { id: "u_a", role: "user" }, "member:remove"),
    ).toBeNull();
    expect(
      canActOnMember(admin, { id: "u_a", role: "moderator" }, "member:suspend"),
    ).toBeNull();
  });

  it("never lets anyone remove the owner", () => {
    for (const role of ROLES) {
      expect(
        canActOnMember(
          actor(role),
          { id: "u_o", role: "owner" },
          "member:remove",
        ),
        role,
      ).not.toBeNull();
    }
  });

  it("refuses self-removal", () => {
    expect(
      canActOnMember(admin, { id: admin.id, role: "admin" }, "member:remove"),
    ).toBe("self");
  });

  it("refuses to act on a peer", () => {
    expect(
      canActOnMember(admin, { id: "u_a", role: "admin" }, "member:suspend"),
    ).toBe("outranked");
  });
});

describe("transferring ownership", () => {
  const owner = actor("owner");

  it("is the owner's alone", () => {
    expect(
      canTransferOwnership(actor("admin"), {
        id: "u_a",
        role: "admin",
        status: "active",
      }),
    ).toBe("not-permitted");

    expect(
      canTransferOwnership(owner, {
        id: "u_a",
        role: "admin",
        status: "active",
      }),
    ).toBeNull();
  });

  it("refuses handing it to yourself", () => {
    expect(
      canTransferOwnership(owner, {
        id: owner.id,
        role: "owner",
        status: "active",
      }),
    ).toBe("self");
  });

  it("refuses handing it to someone who cannot use it", () => {
    // Transferring to a suspended or never-signed-in account would leave the
    // workspace with nobody able to administer it.
    for (const status of ["invited", "suspended"] as const) {
      expect(
        canTransferOwnership(owner, { id: "u_a", role: "admin", status }),
        status,
      ).toBe("not-permitted");
    }
  });
});

describe("form access", () => {
  it("lets anyone read and write their own", () => {
    for (const role of ROLES) {
      const self = actor(role);
      expect(canReadForm(self, self.id), role).toBe(true);
      expect(canWriteForm(self, self.id), role).toBe(true);
    }
  });

  it("hides other people's forms from users and moderators", () => {
    for (const role of ["user", "moderator"] as const) {
      expect(canReadForm(actor(role), "someone_else"), role).toBe(false);
      expect(canWriteForm(actor(role), "someone_else"), role).toBe(false);
    }
  });

  it("opens them to admins and the owner", () => {
    for (const role of ["admin", "owner"] as const) {
      expect(canReadForm(actor(role), "someone_else"), role).toBe(true);
      expect(canWriteForm(actor(role), "someone_else"), role).toBe(true);
    }
  });
});

describe("submission access", () => {
  it("lets anyone read the responses to their own form", () => {
    // The gap this closes: `submission:readAny` starts at moderator, so
    // without `submission:readOwn` a plain user could publish a form and never
    // see a single reply to it.
    for (const role of ROLES) {
      const self = actor(role);
      expect(canReadSubmissions(self, self.id), role).toBe(true);
    }
  });

  it("keeps a user out of someone else's responses", () => {
    expect(canReadSubmissions(actor("user"), "someone_else")).toBe(false);
  });

  it("lets a moderator and above in, which is what moderation is", () => {
    for (const role of ["moderator", "admin", "owner"] as const) {
      expect(canReadSubmissions(actor(role), "someone_else"), role).toBe(true);
    }
  });

  it("refuses a suspended owner their own responses", () => {
    const suspended = actor("owner", { status: "suspended" });
    expect(canReadSubmissions(suspended, suspended.id)).toBe(false);
  });
});
