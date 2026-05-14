import { describe, it } from "node:test";
import assert from "node:assert";
import { truncateHistory } from "@/src/server/loopSafety";

describe("loopSafety", () => {
  it("truncateHistory keeps all messages when under limit", () => {
    const msgs = [
      { role: "user" as const, content: "hi" },
      { role: "assistant" as const, content: "hello" },
    ];
    const result = truncateHistory(msgs, 5);
    assert.strictEqual(result.length, 2);
  });

  it("truncateHistory keeps first user message and tail", () => {
    const msgs = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `msg ${i}`,
    }));
    const result = truncateHistory(msgs, 10);
    assert.strictEqual(result.length, 10);
    assert.strictEqual(result[0].role, "user");
    assert.strictEqual(result[0].content, "msg 0");
  });

  it("truncateHistory works without user messages", () => {
    const msgs = Array.from({ length: 30 }, (_, i) => ({
      role: "assistant" as const,
      content: `msg ${i}`,
    }));
    const result = truncateHistory(msgs, 10);
    assert.strictEqual(result.length, 10);
    assert.strictEqual(result[0].content, "msg 20");
  });
});
