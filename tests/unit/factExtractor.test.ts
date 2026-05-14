import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { extractAndStripFacts } from "@/src/server/factExtractor";

describe("factExtractor", () => {
  it("extracts facts on repeated calls without global-regex lastIndex drift", () => {
    const text = "A\n[MEMORY_FACT:preference:8]\nJoseph likes tabs.\n[/MEMORY_FACT]\nB";
    for (let i = 0; i < 5; i++) {
      const { cleaned, facts } = extractAndStripFacts(text);
      assert.equal(facts.length, 1);
      assert.equal(facts[0].category, "preference");
      assert.equal(facts[0].importance, 8);
      assert.equal(facts[0].fullText, "Joseph likes tabs.");
      assert.doesNotMatch(cleaned, /MEMORY_FACT/);
    }
  });

  it("truncates labels by code point rather than UTF-16 code unit", () => {
    const emoji = "😀".repeat(70);
    const { facts } = extractAndStripFacts(
      `[MEMORY_FACT:context:5]\n${emoji}\n[/MEMORY_FACT]`,
    );
    assert.equal(Array.from(facts[0].label).length, 60);
    assert.equal(facts[0].label, "😀".repeat(60));
  });
});
