import { timingSafeEqual } from "crypto";

export class AccessKeyError extends Error {
  status = 401;
  error = "unauthorized";
  recoverable = true;

  constructor(message = "Missing or invalid access key.") {
    super(message);
    this.name = "AccessKeyError";
  }
}

export function requireAccessKey(request: Request) {
  const expected = process.env.AGENTPULSE_ACCESS_KEY;
  const provided = request.headers.get("x-agentpulse-key");

  if (!expected || !provided || !constantTimeEqual(provided, expected)) {
    throw new AccessKeyError();
  }
}

function constantTimeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
