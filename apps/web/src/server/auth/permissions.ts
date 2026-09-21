import { ROLES, type Role, type UserStatus } from "@/db/schema";

/**
 * What each role may do.
 *
 * Pure functions over a role, with no database and no request. Authorization is
 * the one thing in this app where a quiet mistake is a security bug rather than
 * a wrong pixel, so it lives here where it can be exhaustively tested instead of
 * being spread across route handlers as `if (role === "admin")`.
 *
 * Roles are a strict hierarchy, ranked in `ROLES`. Anything an admin may do, an
 * owner may do. Rules are written as a minimum rank wherever that is honestly
 * the rule, and spelled out where it is not.
 */

export type Action =
  // Forms
  | "form:create"
  | "form:readOwn"
  | "form:readAny"
  | "form:updateOwn"
  | "form:updateAny"
  | "form:deleteOwn"
  | "form:deleteAny"
  | "form:publish"
  // Submissions
  | "submission:readAny"
  | "submission:export"
  | "submission:delete"
  // Members
  | "member:read"
  | "member:invite"
  | "member:setRole"
  | "member:suspend"
  | "member:remove"
  | "owner:transfer";

/** Least to most privileged. Index into `ROLES` is the rank. */
export function rank(role: Role): number {
  return ROLES.indexOf(role);
}

export function atLeast(role: Role, minimum: Role): boolean {
  return rank(role) >= rank(minimum);
}

/**
 * The minimum role for each action.
 *
 * Read this as the whole policy — there is nowhere else a permission is
 * decided.
 */
const MINIMUM: Record<Action, Role> = {
  // Anyone with an account builds forms; that is what an account is for.
  "form:create": "user",
  "form:readOwn": "user",
  "form:updateOwn": "user",
  "form:deleteOwn": "user",
  "form:publish": "user",

  // Reaching into someone else's forms is an administrative act. A moderator
  // deliberately cannot: they police responses, not other people's designs.
  "form:readAny": "admin",
  "form:updateAny": "admin",
  "form:deleteAny": "admin",

  // What moderation is: seeing responses, exporting them, removing rubbish.
  "submission:readAny": "moderator",
  "submission:export": "moderator",
  "submission:delete": "moderator",

  // Everyone can see who is in the workspace; only admins change it.
  "member:read": "user",
  "member:invite": "admin",
  "member:setRole": "admin",
  "member:suspend": "admin",
  "member:remove": "admin",

  // Handing over the workspace is the owner's alone.
  "owner:transfer": "owner",
};

/** Whether a role may perform an action. */
export function can(role: Role, action: Action): boolean {
  return atLeast(role, MINIMUM[action]);
}

/** Every action a role may perform — handy for a UI that hides what it can't do. */
export function allowedActions(role: Role): Action[] {
  return (Object.keys(MINIMUM) as Action[]).filter((action) =>
    can(role, action),
  );
}

// ---------------------------------------------------------------------------
// Rules that depend on more than the actor's rank
// ---------------------------------------------------------------------------

export interface Actor {
  id: string;
  role: Role;
  status: UserStatus;
}

export interface TargetMember {
  id: string;
  role: Role;
}

/**
 * A suspended account can do nothing at all.
 *
 * Checked separately from role so that suspending somebody is one column
 * change rather than a demotion that loses what they were.
 */
export function isActive(actor: Actor): boolean {
  return actor.status === "active";
}

/** The effective check: active, and the role permits it. */
export function actorCan(actor: Actor, action: Action): boolean {
  return isActive(actor) && can(actor.role, action);
}

export type Refusal =
  | "not-active"
  | "not-permitted"
  | "outranked"
  | "self"
  | "last-owner"
  | "use-transfer";

/**
 * Whether an actor may change another member's role.
 *
 * Three rules beyond rank, each of which exists because of a specific way this
 * goes wrong:
 *
 *   - You cannot act on someone at or above your own rank. Otherwise an admin
 *     demotes the owner, or demotes a peer mid-argument.
 *   - You cannot grant a role above your own. Otherwise an admin makes
 *     themselves owner by way of a colleague.
 *   - You cannot change your own role. Self-demotion of the only owner would
 *     strand the workspace, and self-promotion is the whole thing we are
 *     guarding against.
 *
 * Handing over ownership is a different operation with a different rule, so it
 * is `canTransferOwnership` rather than a special case here.
 */
export function canSetRole(
  actor: Actor,
  target: TargetMember,
  nextRole: Role,
): Refusal | null {
  if (!isActive(actor)) return "not-active";
  if (!can(actor.role, "member:setRole")) return "not-permitted";
  if (actor.id === target.id) return "self";

  // Checked before the rank rules so the *reason* is right. An owner doing
  // this would otherwise be told they are "outranked", which is nonsense —
  // the real answer is that promotion is not how ownership moves.
  if (nextRole === "owner") return "use-transfer";

  if (rank(target.role) >= rank(actor.role)) return "outranked";
  if (rank(nextRole) >= rank(actor.role)) return "outranked";

  return null;
}

/** Whether an actor may suspend or remove a member. */
export function canActOnMember(
  actor: Actor,
  target: TargetMember,
  action: Extract<Action, "member:suspend" | "member:remove">,
): Refusal | null {
  if (!isActive(actor)) return "not-active";
  if (!can(actor.role, action)) return "not-permitted";
  if (actor.id === target.id) return "self";
  if (rank(target.role) >= rank(actor.role)) return "outranked";
  // Belt and braces: the owner is never removable, whoever is asking.
  if (target.role === "owner") return "last-owner";

  return null;
}

/**
 * Whether an actor may hand the workspace to someone else.
 *
 * Only the owner, never to themselves, and never to an account that cannot use
 * it — handing ownership to a suspended or never-signed-in member would leave
 * nobody able to administer the workspace.
 */
export function canTransferOwnership(
  actor: Actor,
  target: TargetMember & { status: UserStatus },
): Refusal | null {
  if (!isActive(actor)) return "not-active";
  if (!can(actor.role, "owner:transfer")) return "not-permitted";
  if (actor.id === target.id) return "self";
  if (target.status !== "active") return "not-permitted";

  return null;
}

/** Whether an actor may see a particular form. */
export function canReadForm(actor: Actor, formOwnerId: string): boolean {
  if (!isActive(actor)) return false;
  if (formOwnerId === actor.id) return can(actor.role, "form:readOwn");
  return can(actor.role, "form:readAny");
}

/** Whether an actor may edit or delete a particular form. */
export function canWriteForm(actor: Actor, formOwnerId: string): boolean {
  if (!isActive(actor)) return false;
  if (formOwnerId === actor.id) return can(actor.role, "form:updateOwn");
  return can(actor.role, "form:updateAny");
}

/** Human-readable reason, for an API response or a disabled button's title. */
export const REFUSAL_MESSAGE: Record<Refusal, string> = {
  "not-active": "Your account is not active",
  "not-permitted": "You do not have permission to do that",
  outranked: "You cannot act on a member at or above your own role",
  self: "You cannot do that to your own account",
  "last-owner": "The owner cannot be removed — transfer ownership first",
  "use-transfer": "Promote nobody to owner — use Transfer ownership instead",
};
