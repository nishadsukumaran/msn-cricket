import sharp from "sharp";
import { transaction } from "../../../packages/database/src/db.ts";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
export async function sanitizeImage(bytes: Buffer) {
  if (bytes.length > 5 * 1024 * 1024) throw Error("IMAGE_TOO_LARGE");
  try {
    const image = sharp(bytes, {
      limitInputPixels: 16_000_000,
      animated: false,
    });
    const meta = await image.metadata();
    if (
      !["jpeg", "png", "webp"].includes(meta.format ?? "") ||
      !meta.width ||
      !meta.height ||
      meta.width < 64 ||
      meta.height < 64 ||
      (meta.pages && meta.pages > 1)
    )
      throw Error("INVALID_IMAGE");
    // Decode, auto-orient, resize and encode a new image. Metadata/EXIF is not copied.
    return await image
      .rotate()
      .resize(800, 800, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    throw Error("INVALID_IMAGE");
  }
}
function client() {
  if (
    !process.env.S3_BUCKET ||
    !process.env.S3_ACCESS_KEY ||
    !process.env.S3_SECRET_KEY
  )
    throw Error("STORAGE_NOT_CONFIGURED");
  return new S3Client({
    region: process.env.S3_REGION ?? "ap-south-1",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: !!process.env.S3_ENDPOINT,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY,
    },
  });
}
export async function uploadPhoto(actor: string, bytes: Buffer) {
  const body = await sanitizeImage(bytes);
  const key = `profiles/${actor}/${randomUUID()}.webp`;
  await client().send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: "image/webp",
      ServerSideEncryption: process.env.S3_ENDPOINT ? undefined : "AES256",
    }),
  );
  await transaction(actor, async (db) => {
    await db.query("INSERT INTO image_objects(key,owner_id) VALUES($1,$2)", [
      key,
      actor,
    ]);
  });
  return { key };
}
export async function readPhoto(key: string) {
  if (!/^profiles\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.webp$/.test(key))
    throw Error("INVALID_IMAGE");
  const result = await client().send(
    new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
  );
  return result.Body?.transformToByteArray();
}

export async function deletePhoto(key: string) {
  if (!/^profiles\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.webp$/.test(key))
    throw Error("INVALID_IMAGE");
  await client().send(
    new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
  );
}
