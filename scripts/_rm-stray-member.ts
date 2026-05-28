import { config } from "dotenv";
config({ path: ".env.local" });

import { getAdminDb } from "../lib/firebase/admin";

async function main() {
  const docId = "an9oTCbB8yxCKOIetLYB__hpb-eos";
  await getAdminDb().collection("team_members").doc(docId).delete();
  console.log(`removed team_members/${docId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
