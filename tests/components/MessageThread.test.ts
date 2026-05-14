/**
 * Component-level tests for MessageThread pure helpers.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  parseImageArray,
  sniffImageMime,
} from "@/app/components/MessageThread";

describe("sniffImageMime", () => {
  it("detects PNG from iVBOR prefix", () => {
    assert.equal(sniffImageMime("iVBORw0KGgo"), "image/png");
  });
  it("detects JPEG from /9j/ prefix", () => {
    assert.equal(sniffImageMime("/9j/4AAQSkZJRg"), "image/jpeg");
  });
  it("detects WebP from UklGR prefix", () => {
    assert.equal(sniffImageMime("UklGRiIAAABXRUJQVlA4"), "image/webp");
  });
  it("falls back to image/png for unknown prefix", () => {
    assert.equal(sniffImageMime("abc123"), "image/png");
  });
});

describe("parseImageArray", () => {
  it("parses JSON array of base64 strings", () => {
    const input = JSON.stringify(["img1", "img2", "img3"]);
    const out = parseImageArray(input);
    assert.deepEqual(out, ["img1", "img2", "img3"]);
  });
  it("returns single-item array for raw base64 string", () => {
    const out = parseImageArray("rawbase64data");
    assert.deepEqual(out, ["rawbase64data"]);
  });
  it("returns single-item array for invalid JSON", () => {
    const out = parseImageArray("{invalid json");
    assert.deepEqual(out, ["{invalid json"]);
  });
  it("returns single-item array for non-array JSON", () => {
    const out = parseImageArray('{"not":"array"}');
    assert.deepEqual(out, ['{"not":"array"}']);
  });
});
