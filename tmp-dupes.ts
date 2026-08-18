// READ-ONLY duplicate audit.
import { config } from "dotenv";
config({ path: ".env.local" });
import { getAdminDb } from "./lib/firebase/admin";
import { normalizeKey } from "./lib/csv-import";
const TEAM = "VSI5aSuR45v55WKqthA5";

async function main() {
  const db = getAdminDb();
  const rocks = await db.collection("rocks").where("team_id","==",TEAM).get();
  const rockTitle = new Map(rocks.docs.map(d=>[d.id, String(d.data().title)]));
  const todos = await db.collection("todos").where("team_id","==",TEAM).get();

  const ms = todos.docs.filter(d=>d.data().source_rock_id);
  const plain = todos.docs.filter(d=>!d.data().source_rock_id);

  console.log(`\n=== ${process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID} ===`);
  console.log(`milestones=${ms.length} (imported-id ${ms.filter(d=>d.id.startsWith("imp-milestone-")).length}, hand-made-id ${ms.filter(d=>!d.id.startsWith("imp-milestone-")).length})  plain todos=${plain.length}`);

  // 1. same rock + same normalized title, more than one doc
  const seen = new Map<string, string[]>();
  for (const d of ms) {
    const k = `${d.data().source_rock_id}::${normalizeKey(String(d.data().title))}`;
    seen.set(k, [...(seen.get(k) ?? []), d.id]);
  }
  const dupes = [...seen.entries()].filter(([,v])=>v.length>1);
  console.log(`\n1) exact dupes (same rock + same title): ${dupes.length}`);
  for (const [k,v] of dupes) console.log(`     ${k}\n       ${v.join("\n       ")}`);

  // 2. hand-made milestones (random id) — the ones at risk of pairing with an import
  const hand = ms.filter(d=>!d.id.startsWith("imp-milestone-"));
  console.log(`\n2) hand-created milestones (non-import doc id): ${hand.length}`);
  for (const d of hand) console.log(`     ${JSON.stringify(d.data().title)}  on "${rockTitle.get(d.data().source_rock_id) ?? "?"}"  id=${d.id}`);

  // 3. plain todos whose title resembles any milestone title (near-dupe across the link boundary)
  const msTitles = new Map(ms.map(d=>[normalizeKey(String(d.data().title)), String(d.data().title)]));
  console.log(`\n3) plain to-dos matching a milestone title: `);
  let hits = 0;
  for (const d of plain) {
    const t = normalizeKey(String(d.data().title));
    if (msTitles.has(t)) { hits++; console.log(`     DUP "${d.data().title}"  id=${d.id}`); }
  }
  if (!hits) console.log(`     none`);
  console.log(`\n   all plain to-do titles for eyeballing:`);
  for (const d of plain) console.log(`     - ${JSON.stringify(d.data().title)}${d.data().archived_at?"  [archived]":""}`);
}
main().then(()=>process.exit(0));
