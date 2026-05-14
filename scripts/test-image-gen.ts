import { DefaultAzureCredential } from "@azure/identity";

async function tryGenerate(tokenAudience: string, apiVersion: string) {
  const endpoint = "https://plimsoll-resource.openai.azure.com";
  const deployment = "gpt-image-2-1";
  const url = `${endpoint.replace(/\/$/, "")}/openai/deployments/${deployment}/images/generations?api-version=${apiVersion}`;

  const cred = new DefaultAzureCredential();
  const token = await cred.getToken(tokenAudience);
  console.log("Token acquired for", tokenAudience, ":", !!token?.token);

  console.log("POST", url);
  const res = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    headers: {
      Authorization: `Bearer ${token!.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: "A flat vector illustration of a minimal SaaS dashboard header, blue tones",
      size: "1024x1024",
      n: 1,
    }),
  });

  console.log("HTTP", res.status, res.statusText);
  const data = await res.json();
  if (data.error) {
    console.error("API error:", JSON.stringify(data.error, null, 2));
    return false;
  }
  if (data.data && data.data[0]) {
    console.log("Image b64_json length:", data.data[0].b64_json?.length || "missing");
    console.log("Revised prompt:", data.data[0].revised_prompt);
    return true;
  }
  console.log("Unexpected response keys:", Object.keys(data));
  return false;
}

async function main() {
  // Azure OpenAI image endpoints may need the cognitiveservices scope.
  const auds = [
    "https://cognitiveservices.azure.com/.default",
    "https://ai.azure.com/.default",
  ];
  const versions = ["2025-01-01-preview", "2025-03-01-preview"];
  for (const aud of auds) {
    for (const v of versions) {
      console.log("\n---", aud, v, "---");
      try {
        const ok = await tryGenerate(aud, v);
        if (ok) process.exit(0);
      } catch (e) {
        console.error("Fetch failed:", e instanceof Error ? e.message : String(e));
      }
    }
  }
  console.log("All attempts failed.");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
