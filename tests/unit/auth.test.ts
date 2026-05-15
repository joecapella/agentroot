import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { type NextRequest } from "next/server";

import {
  requireAuth,
  requireSameOriginHeader,
  validateAppToken,
  ownsConversation,
  SERVER_USER_ID,
} from "@/src/server/auth";

describe("auth helpers", () => {
  it("returns the constant principal from requireAuth", () => {
    const principal = requireAuth({} as NextRequest);
    assert.equal(principal.userId, SERVER_USER_ID);
  });

  it("returns null for requireSameOriginHeader in local mode", () => {
    assert.equal(requireSameOriginHeader({} as NextRequest), null);
  });

  it("accepts any presented token in local mode", () => {
    assert.equal(validateAppToken("anything"), true);
  });

  it("ownsConversation matches on user id", () => {
    const principal = { userId: SERVER_USER_ID };
    assert.equal(ownsConversation(principal, null), false);
    assert.equal(ownsConversation(principal, { userId: "someone-else" }), false);
    assert.equal(ownsConversation(principal, { userId: SERVER_USER_ID }), true);
  });
});
