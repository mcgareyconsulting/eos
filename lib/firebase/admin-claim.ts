import type { DecodedIdToken } from "firebase-admin/auth";

/** Org-level admin custom claim (`role: "admin"` on the Identity Platform token). */
export function tokenIsAdmin(decoded: DecodedIdToken): boolean {
  // Custom claims are top-level on the decoded token; types don't list them.
  return (decoded as DecodedIdToken & { role?: string }).role === "admin";
}
