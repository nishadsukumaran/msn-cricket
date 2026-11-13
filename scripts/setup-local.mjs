import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
try {
  await readFile(".env");
  console.log("Existing .env preserved.");
  process.exit(0);
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
let template = await readFile(".env.example", "utf8");
for (const placeholder of [
  "replace-with-local-random-secret",
  "replace-with-runtime-secret",
  "replace-with-worker-secret",
  "replace-with-storage-secret",
  "replace-with-at-least-32-random-characters",
])
  template = template.replaceAll(placeholder, randomBytes(32).toString("hex"));
await writeFile(".env", template, { mode: 0o600, flag: "wx" });
console.log(
  "Created private local environment with random development secrets.",
);
