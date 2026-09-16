import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/firebase/teams";

/** /admin is the People tab — there is no separate landing screen. */
export default async function AdminIndexPage() {
  await requireAdmin();
  redirect("/admin/people");
}
