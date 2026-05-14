import { DefaultAzureCredential } from "@azure/identity";

async function tryOnce(url, token) {
  console.log("Fetching", url.split("?")[0]);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(60_000),
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "A minimalist SaaS landing page hero", size: "1024x1024", n: 1 }),
    });
    console.log("HTTP", res.status, res.statusText);
    const data = await res.json();
    if (data.error) { console.error("ERR:", JSON.stringify(data.error, null, 1)); return 1; }
    if (data.data?.[0]) { console.log("OK b64 len:", data.data[0].b64_json?.length); return 0; }
    console.log("Unexpected:", Object.keys(data)); return 1;
  } catch (e) { console.error("EXC:", e.message); return 1; }
}

async function main() {
  const cred = new DefaultAzureCredential();
  const auds = ["https://cognitiveservices.azure.com/.default", "https://ai.azure.com/.default"];
  const endpoint = "https://plimsoll-resource.openai.azure.com";
  const deployment = "gpt-image-2-1";
  for (const aud of auds) {
    const token = (await cred.getToken(aud)).token;
    console.log("\n===", aud, "===");
    const rc = await tryOnce(`${endpoint}/openai/deployments/${deployment}/images/generations?api-version=2025-03-01-preview`, token);
    if (rc === 0) return;
  }
}
main();
