/**
 * Local-only authentication shim.
 *
 * Joseph is the only intended user of this app and it runs on his own machine.
 * There is intentionally no login/session/CSRF gate in this local mode. API
 * routes still call `requireAuth(req)` so ownership remains centralized and a
 * future hosted mode can reintroduce real auth behind the same function names.
 */
import { NextRequest } from "next/server";

export interface Principal {
  /** The single owner of all data in v1. Constant — not derived from input. */
  userId: string;
}

/** Server-side constant user. Routes must use this, NOT a value from the
 *  request body/query. */
export const SERVER_USER_ID = "joseph";

/** Kept for compatibility with tests/docs that may import it. Not used in local mode. */
export const SESSION_COOKIE_NAME = "cofounder_session";

/** Always returns the local single-user principal. */
export function requireAuth(req: NextRequest): Principal {
  void req;
  return { userId: SERVER_USER_ID };
}

/** No-op in local-only mode. Kept so route code stays future-auth-ready. */
export function requireSameOriginHeader(req: NextRequest): null {
  void req;
  return null;
}

/** Local unlock is a no-op success marker for compatibility. */
export function validateAppToken(presented: string): true {
  void presented;
  return true;
}

/** Helper: returns true if the principal owns the conversation. */
export function ownsConversation(
  principal: Principal,
  conv: { userId: string } | null
): conv is { userId: string } {
  return !!conv && conv.userId === principal.userId;
}
