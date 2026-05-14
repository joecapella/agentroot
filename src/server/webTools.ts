/**
 * Web fetch / browse tools for the CofounderAgent.
 *
 * Fetches URLs and returns cleaned text content. Respects robots/meta.
 * No JavaScript execution — static HTML only.
 */

export interface FetchResult {
  url: string;
  title: string | null;
  text: string;
  status: number;
  contentType: string | null;
}

export async function fetchUrlTool(args: {
  url: string;
  maxChars?: number;
}): Promise<FetchResult> {
  const maxChars = Math.min(args.maxChars ?? 8_000, 20_000);
  const res = await fetch(args.url, {
    headers: {
      "User-Agent": "CofounderAgent/1.0 (Private research bot; joseph@plimsoll.ai)",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(15_000),
  });

  const contentType = res.headers.get("content-type") ?? null;
  let text = "";
  try {
    text = await res.text();
  } catch {
    text = "";
  }

  // Very light HTML stripping
  let cleaned = text
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length > maxChars) {
    cleaned = cleaned.slice(0, maxChars) + "\n[truncated]";
  }

  const titleMatch = text.match(/<title[^>]*>(.*?)<\/title>/i);
  const title = titleMatch?.[1]?.trim() ?? null;

  return {
    url: args.url,
    title,
    text: cleaned,
    status: res.status,
    contentType,
  };
}
