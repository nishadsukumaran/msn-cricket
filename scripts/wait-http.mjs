const endpoint = process.argv[2];
if (!endpoint) throw Error("URL required");
let ready = false;
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    const response = await fetch(endpoint, {
      signal: AbortSignal.timeout(1500),
    });
    if (response.ok) {
      ready = true;
      break;
    }
  } catch {
    /* Server is still starting. */
  }
  await new Promise((r) => setTimeout(r, 1000));
}
if (!ready) throw Error("Server did not become ready: " + endpoint);
console.log("Ready:", endpoint);
