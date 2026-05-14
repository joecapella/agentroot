import { describe, it } from "node:test";
import assert from "node:assert";
import { isSecretFile, redactSecrets, safeReadFileResult } from "@/src/server/secretsPolicy";

describe("secretsPolicy", () => {
  it("detects .env as secret", () => {
    assert.strictEqual(isSecretFile(".env"), true);
    assert.strictEqual(isSecretFile(".env.local"), true);
  });

  it("detects .pem as secret", () => {
    assert.strictEqual(isSecretFile("cert.pem"), true);
  });

  it("allows normal files", () => {
    assert.strictEqual(isSecretFile("README.md"), false);
    assert.strictEqual(isSecretFile("package.json"), false);
  });

  it("redacts API keys in text", () => {
    const text = "API_KEY=sk-1234567890abcdef";
    const redacted = redactSecrets(text);
    assert.ok(!redacted.includes("sk-1234567890abcdef"));
    assert.ok(redacted.includes("REDACTED"));
  });

  it("redacts bearer tokens", () => {
    const text = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
    const redacted = redactSecrets(text);
    assert.ok(!redacted.includes("eyJhbGci"));
    assert.ok(redacted.includes("REDACTED"));
  });

  it("safeReadFileResult blocks secret files", () => {
    const result = safeReadFileResult(".env", "SECRET=123");
    assert.strictEqual(result.allowed, false);
    assert.ok(result.redacted.includes("REDACTED"));
  });

  it("safeReadFileResult allows normal files", () => {
    const result = safeReadFileResult("README.md", "# Hello");
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.redacted, "# Hello");
  });
});
