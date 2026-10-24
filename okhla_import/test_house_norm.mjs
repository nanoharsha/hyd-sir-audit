// Runs the same vectors through src/okhla_house.ts (Node strips the types) and compares with the Python builder's answers.
import { houseNorm, houseId } from "./.okhla_house_under_test.mts";
import fs from "node:fs";
const v = JSON.parse(fs.readFileSync(new URL("./test_house_vectors.json", import.meta.url)));
let bad = 0;
for (const { in: raw, out } of v) {
  const id = houseId(raw);
  const got = id ? houseNorm(raw) : null;
  if (got !== out) { bad++; console.log("MISMATCH", JSON.stringify(raw), "py:", out, "ts:", got); }
}
console.log(bad ? `${bad} mismatches` : `all ${v.length} vectors agree`);
process.exit(bad ? 1 : 0);
