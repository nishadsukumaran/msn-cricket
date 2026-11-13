import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { seed } from "../../../packages/testing/seed.ts";
import { pool } from "../../../packages/database/src/db.ts";
import { after } from "node:test";
after(() => pool.end());
import { uploadPhoto, readPhoto, sanitizeImage } from "../src/storage.ts";
test("sanitized photo round-trips through a private S3-compatible bucket with metadata removed", async () => {
  const original = await sharp({
    create: { width: 1600, height: 1000, channels: 3, background: "#0759d3" },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const clean = await sanitizeImage(original);
  const meta = await sharp(clean).metadata();
  assert.equal(meta.format, "webp");
  assert.ok(meta.width! <= 800 && meta.height! <= 800);
  assert.equal(meta.exif, undefined);
  assert.equal(meta.orientation, undefined);
  const result = await uploadPhoto((await seed()).managerA, original);
  const stored = await readPhoto(result.key);
  assert.ok(stored);
  assert.deepEqual(Buffer.from(stored!), clean);
  const response = await fetch(
    `${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET}/${result.key}`,
  );
  assert.equal(response.status, 403);
});
