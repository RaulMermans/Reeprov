import { NextResponse } from "next/server";
import { AccessKeyError } from "@/lib/auth/requireAccessKey";

export class ApiError extends Error {
  constructor(
    public status: number,
    public error: string,
    message: string,
    public recoverable: boolean,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function apiErrorResponse(error: unknown) {
  const apiError = normalizeApiError(error);

  return NextResponse.json(
    {
      error: apiError.error,
      message: apiError.message,
      recoverable: apiError.recoverable,
    },
    { status: apiError.status },
  );
}

export function invalidRequest(message = "Invalid request body.") {
  return new ApiError(400, "invalid_request", message, true);
}

export function normalizeApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof AccessKeyError) {
    return new ApiError(error.status, error.error, error.message, error.recoverable);
  }

  if (isGitHubError(error)) {
    if (isRateLimitError(error)) {
      return new ApiError(
        429,
        "github_rate_limit",
        "GitHub rate limit reached. Try again after the limit resets.",
        true,
      );
    }

    if (error.status === 401 || error.status === 403) {
      return new ApiError(
        error.status,
        "github_auth_error",
        "GitHub authentication failed. Check the server-side GITHUB_TOKEN.",
        false,
      );
    }

    if (error.status === 404) {
      return new ApiError(
        404,
        "repo_not_found",
        "Repository was not found or the server token cannot access it.",
        true,
      );
    }
  }

  console.error(error);
  return new ApiError(500, "unknown_error", "An unexpected error occurred.", false);
}

function isGitHubError(error: unknown): error is {
  status: number;
  message?: string;
  response?: { headers?: Record<string, string | undefined> };
} {
  return typeof error === "object" && error !== null && "status" in error;
}

function isRateLimitError(error: {
  status: number;
  message?: string;
  response?: { headers?: Record<string, string | undefined> };
}) {
  const remaining = error.response?.headers?.["x-ratelimit-remaining"];

  return (
    error.status === 429 ||
    (error.status === 403 && remaining === "0") ||
    /rate limit/i.test(error.message ?? "")
  );
}
