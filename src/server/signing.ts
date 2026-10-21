import { createHmac, timingSafeEqual } from "node:crypto";

export type UrlKind = "download" | "preview";

function signature(secret: Buffer, jobId: string, kind: UrlKind, exp: number) {
  return createHmac("sha256", secret).update(`${jobId}\n${kind}\n${exp}`).digest("base64url");
}

/** Relative, expiring, tamper-proof URL for a job's file. */
export function signedUrl(secret: Buffer, jobId: string, kind: UrlKind, expiresAt: number): string {
  const exp = Math.floor(expiresAt / 1000);
  const sig = signature(secret, jobId, kind, exp);
  return `/api/upscale/${jobId}/${kind}?exp=${exp}&sig=${sig}`;
}

export type VerifyResult = "ok" | "invalid" | "expired";

export function verifySignedUrl(
  secret: Buffer,
  jobId: string,
  kind: UrlKind,
  params: URLSearchParams,
  now = Date.now(),
): VerifyResult {
  const exp = Number(params.get("exp"));
  const sig = params.get("sig") ?? "";
  if (!Number.isInteger(exp) || !/^[A-Za-z0-9_-]{43}$/.test(sig)) return "invalid";
  const expected = Buffer.from(signature(secret, jobId, kind, exp));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return "invalid";
  return exp * 1000 < now ? "expired" : "ok";
}
