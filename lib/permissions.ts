export type Role = "admin" | "coach" | "viewer";

export type Action =
  | "read"
  | "runSession"
  | "editRoster"
  | "deactivateAthlete"
  | "manageRestrictions"
  | "cancelSession";

const RANK: Record<Role, number> = { viewer: 1, coach: 2, admin: 3 };

function listed(raw: string | undefined, email: string): boolean {
  return (raw ?? "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .includes(email);
}

/** Allowlist is explicit emails only. A gmail.com domain is not access. */
export function roleForEmail(email: string | null | undefined): Role | null {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes("@")) return null;
  if (listed(process.env.ADMIN_EMAILS, normalized)) return "admin";
  if (listed(process.env.COACH_EMAILS, normalized)) return "coach";
  if (listed(process.env.VIEWER_EMAILS, normalized)) return "viewer";
  return null;
}

export function can(role: Role, action: Action): boolean {
  if (action === "read") return RANK[role] >= RANK.viewer;
  if (action === "manageRestrictions" || action === "deactivateAthlete") return role === "admin";
  return RANK[role] >= RANK.coach;
}
