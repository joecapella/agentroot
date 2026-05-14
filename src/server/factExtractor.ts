/**
 * Shared MEMORY_FACT extraction for both the single-turn handler and the
 * ReAct loop final-text path. Lives outside the chat route so the loop can
 * call it without circular-dep gymnastics.
 *
 * Format (taught to the model via `EXTRACTION_GUIDE` in `src/memory.ts`):
 *   [MEMORY_FACT:<category>:<importance>]
 *   <one or more lines of fact body>
 *   [/MEMORY_FACT]
 *
 * The extractor returns the assistant text with the markers stripped and a
 * deduped list of facts ready to persist via `createFact()`.
 */

function memoryFactRegex(): RegExp {
  // Keep the `g` regex instance local to each extraction. A module-level
  // global regex carries mutable `lastIndex` state across requests and can
  // skip facts on alternating/concurrent calls.
  return /\[MEMORY_FACT:(\w+):(\d+)\]\s*([\s\S]*?)\s*\[\/MEMORY_FACT\]/g;
}

function firstCodePoints(value: string, max: number): string {
  return Array.from(value).slice(0, max).join("");
}

export interface ExtractedFact {
  category: string;
  importance: number;
  label: string;
  fullText: string;
}

export function extractAndStripFacts(text: string): {
  cleaned: string;
  facts: ExtractedFact[];
} {
  const facts: ExtractedFact[] = [];
  const re = memoryFactRegex();
  let match: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((match = re.exec(text)) !== null) {
    const category = match[1];
    const importance = Math.min(Math.max(parseInt(match[2], 10), 1), 10);
    const fullText = match[3].trim();
    if (!fullText) continue;
    const label = firstCodePoints(fullText.split(/\n/)[0], 60);
    const key = `${category}:${label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    facts.push({ category, importance, label, fullText });
  }
  const cleaned = text
    .replace(memoryFactRegex(), "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { cleaned, facts };
}
