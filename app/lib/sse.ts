/**
 * Minimal SSE (Server-Sent Events) encoder/decoder.
 *
 * We deliberately avoid EventSource on the client because we need to POST
 * a JSON body. Instead we use fetch + ReadableStream + this parser.
 */

export interface SSEEvent {
  event: string;
  data: string;
}

export function encodeSSE(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Parse a chunk of SSE text into events.
 * Handles partial chunks across stream reads.
 */
export function parseSSE(buffer: string): { events: SSEEvent[]; remainder: string } {
  const events: SSEEvent[] = [];
  const lines = buffer.split("\n");
  let currentEvent = "";
  let currentData = "";
  let remainder = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("event: ")) {
      currentEvent = line.slice(7).trim();
    } else if (line.startsWith("data: ")) {
      currentData = line.slice(6).trim();
    } else if (line.trim() === "" && currentEvent) {
      events.push({ event: currentEvent, data: currentData });
      currentEvent = "";
      currentData = "";
    } else if (i === lines.length - 1 && line.trim() !== "") {
      // Incomplete line at end — keep as remainder
      remainder = line + "\n";
    }
  }

  return { events, remainder };
}
