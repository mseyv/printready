import type { ApiErrorBody } from "@/lib/shared/schema";
import type { Issue } from "@/lib/shared/plan";

/** An error whose message is safe to show to the client. */
export class PublicError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly issues?: Issue[],
  ) {
    super(message);
    this.name = "PublicError";
  }
}

export function jsonError(
  code: string,
  message: string,
  status: number,
  extra?: { issues?: Issue[]; headers?: HeadersInit },
) {
  const body: ApiErrorBody = { error: { code, message, issues: extra?.issues } };
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...extra?.headers } });
}

/** Convert anything thrown in a route into a safe JSON response. Internals are logged, never returned. */
export function toErrorResponse(err: unknown, context: string) {
  if (err instanceof PublicError) {
    return jsonError(err.code, err.message, err.status, { issues: err.issues });
  }
  console.error(`[upscaler] ${context}:`, err instanceof Error ? err.message : err);
  return jsonError("INTERNAL_ERROR", "Something went wrong on the server. Please try again.", 500);
}
