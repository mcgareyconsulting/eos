// Last-admin guard (permissions P0). The org-admin claim lives on Identity
// Platform (`customClaims.role === "admin"`), so removing it from — or
// deleting — the only admin would lock everyone out of admin tooling with no
// in-app way back. Same listUsers pass as getOrgAdmins in teams.ts.

import type { Auth } from "firebase-admin/auth";

export const LAST_ADMIN_MESSAGE =
  "That would leave the org with no admin. Make someone else an admin first.";

/** Count admin accounts other than `exceptUid`; stops at the first one found. */
export async function hasOtherAdmin(
  auth: Pick<Auth, "listUsers">,
  exceptUid: string,
): Promise<boolean> {
  let page = await auth.listUsers(1000);
  for (;;) {
    for (const u of page.users) {
      if (u.uid !== exceptUid && u.customClaims?.role === "admin") return true;
    }
    if (!page.pageToken) return false;
    page = await auth.listUsers(1000, page.pageToken);
  }
}

/** Throws unless some admin other than `uid` would remain. */
export async function assertAnotherAdminRemains(
  auth: Pick<Auth, "listUsers">,
  uid: string,
): Promise<void> {
  if (!(await hasOtherAdmin(auth, uid))) throw new Error(LAST_ADMIN_MESSAGE);
}
