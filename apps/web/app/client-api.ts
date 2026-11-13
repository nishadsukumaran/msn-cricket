export async function api(path: string, body?: unknown) {
  const response = await fetch("/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.code ?? "INTERNAL_ERROR");
  return data;
}
export async function imageUpload(file: File) {
  if (file.size > 5 * 1024 * 1024) throw Error("IMAGE_TOO_LARGE");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let start = 0; start < bytes.length; start += 32768)
    binary += String.fromCharCode(...bytes.subarray(start, start + 32768));
  return api("/photos", { base64: btoa(binary) });
}
