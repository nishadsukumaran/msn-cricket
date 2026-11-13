import { spawnSync } from "node:child_process";
let failures = 0;
for (const [label, command, args] of [
  ["Docker engine", "docker", ["info", "--format", "{{.ServerVersion}}"]],
  [
    "npm registry",
    "npm",
    ["view", "next", "version", "--fetch-retries=0", "--fetch-timeout=10000"],
  ],
]) {
  const r = spawnSync(command, args, { encoding: "utf8", timeout: 15000 });
  console.log(`${r.status === 0 ? "PASS" : "BLOCKED"}: ${label}`);
  if (r.status !== 0) {
    failures++;
    console.log((r.stderr || r.error?.message || "Unavailable").trim());
  }
}
process.exitCode = failures ? 1 : 0;
