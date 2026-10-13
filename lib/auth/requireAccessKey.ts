/**
 * @deprecated Legacy access key helper. Use authorizeRequest from @/lib/auth/accessControl instead.
 */

import type {
  AuthCapability,
  AuthorizeResult,
} from "./accessControl";

export class AccessKeyError extends Error {
  status = 401;
  error = "unauthorized";
  recoverable = true;

  constructor(message = "Missing or invalid access key.") {
    super(message);
    this.name = "AccessKeyError";
  }
}

/**
 * @deprecated Legacy compatibility wrapper delegating to authorizeRequest().
 * Use `await authorizeRequest(request, { capability })` from `@/lib/auth/accessControl` instead.
 */
export async function requireAccessKey(
  request: Request,
  capability: AuthCapability = "DASHBOARD_READ"
): Promise<AuthorizeResult> {
  const { authorizeRequest, AccessControlError } = await import("./accessControl");
  try {
    return await authorizeRequest(request, { capability });
  } catch (error) {
    if (error instanceof AccessControlError) {
      const keyError = new AccessKeyError(error.message);
      keyError.status = error.status;
      keyError.error = error.code;
      throw keyError;
    }
    throw error;
  }
}
