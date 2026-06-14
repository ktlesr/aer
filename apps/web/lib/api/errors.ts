// Shared API error type + request-id helper. Response shape: { error: { code, message, request_id } }.

export type ApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "validation_error"
  | "rate_limited"
  | "internal_error";

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function makeRequestId(): string {
  return `req_${crypto.randomUUID().replace(/-/g, "")}`;
}
