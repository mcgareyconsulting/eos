import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/firebase/teams";

/** /admin is the seed import — people and teams live on /directory now. */
export default async function AdminIndexPage() {
  await requireAdmin();
  redirect("/admin/import");
}
