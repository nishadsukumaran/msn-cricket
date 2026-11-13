import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
if (
  !process.env.S3_ENDPOINT ||
  !process.env.S3_BUCKET ||
  process.env.NODE_ENV === "production"
)
  throw Error("LOCAL_STORAGE_ONLY");
const client = new S3Client({
  region: process.env.S3_REGION ?? "us-east-1",
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY!,
    secretAccessKey: process.env.S3_SECRET_KEY!,
  },
});
try {
  await client.send(new HeadBucketCommand({ Bucket: process.env.S3_BUCKET }));
} catch (e: any) {
  if (e.$metadata?.httpStatusCode !== 404) throw e;
  await client.send(new CreateBucketCommand({ Bucket: process.env.S3_BUCKET }));
}
console.log("Private local image bucket ready");
