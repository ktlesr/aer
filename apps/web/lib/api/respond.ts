import { ApiError, type ApiErrorCode } from "./errors";

function withRequestId(requestId: string): HeadersInit {
  return { "x-request-id": requestId };
}

export function jsonOk(
  data: unknown,
  status: number,
  requestId: string,
): Response {
  return Response.json(data, { status, headers: withRequestId(requestId) });
}

export function jsonError(
  code: ApiErrorCode,
  message: string,
  status: number,
  requestId: string,
): Response {
  return Response.json(
    { error: { code, message, request_id: requestId } },
    { status, headers: withRequestId(requestId) },
  );
}

/** Map any thrown value to a safe error response. Never logs raw payloads, keys, or PII. */
export function toErrorResponse(err: unknown, requestId: string): Response {
  if (err instanceof ApiError) {
    return jsonError(err.code, err.message, err.status, requestId);
  }
  // Prisma unique-constraint violation (e.g. duplicate (runId, seq)).
  if (err && typeof err === "object" && "code" in err && err.code === "P2002") {
    return jsonError(
      "validation_error",
      "Value violates a unique constraint",
      422,
      requestId,
    );
  }
  // Log only a correlation id + error name — never the message/body/keys.
  const name = err instanceof Error ? err.name : "UnknownError";
  console.error(`[${requestId}] internal_error: ${name}`);
  return jsonError("internal_error", "Internal server error", 500, requestId);
}
