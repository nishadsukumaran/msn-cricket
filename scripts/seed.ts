import { seed } from "../packages/testing/seed.ts";
import { writeFile, mkdir } from "node:fs/promises";
const fixture = await seed({ rehearsal: true });
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/rehearsal.json", JSON.stringify(fixture), {
  mode: 0o600,
});
console.log(
  JSON.stringify(
    { fixtureId: fixture.id, auctionId: fixture.auction, clubId: fixture.club },
    null,
    2,
  ),
);
