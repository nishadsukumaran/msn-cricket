import { writeFile } from "node:fs/promises";
if (!process.env.S3_ACCESS_KEY || !process.env.S3_SECRET_KEY)
  throw Error("S3 credentials required");
await writeFile(
  "infra/s3.local.json",
  JSON.stringify({
    identities: [
      {
        name: "msn-local",
        credentials: [
          {
            accessKey: process.env.S3_ACCESS_KEY,
            secretKey: process.env.S3_SECRET_KEY,
          },
        ],
        actions: ["Admin", "Read", "Write", "List", "Tagging"],
      },
    ],
  }),
  { mode: 0o600 },
);
