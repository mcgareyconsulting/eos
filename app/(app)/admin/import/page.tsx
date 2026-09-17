import { requireAdmin } from "@/lib/firebase/teams";
import { AdminHeader } from "../admin-header";
import { SeedUploader } from "./seed-uploader";

export default async function AdminImportPage() {
  await requireAdmin();

  return (
    // Wide: the dry-run preview is a table of real rows, same reason the team
    // Import page is 6xl.
    <div className="mx-auto max-w-6xl space-y-6">
      <AdminHeader
        title="Import seed file"
        blurb="Drop a CSV or Excel file of First, Last, Email, Team and Role. It creates the people, creates any team the file names that doesn't exist yet, and puts each person on their teams. Preview first — nothing is written until you apply."
      />
      <SeedUploader />
    </div>
  );
}
