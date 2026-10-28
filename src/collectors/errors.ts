export type CollectorCode = "login_required" | "verification_required" | "layout_changed" | "profile_in_use" | "browser_unavailable" | "rate_limited" | "unsafe_source" | "source_timeout" | "source_http_error" | "navigation_failed" | "script_injection_failed" | "capture_timeout" | "user_interrupted";
export function retryAfterMs(header: string | null, now = Date.now()) {
  if (!header?.trim()) return 15 * 60_000;
  const seconds = Number(header);
  const until = Number.isFinite(seconds) ? (seconds >= 0 ? now + seconds * 1000 : NaN) : Date.parse(header);
  return Number.isSafeInteger(Math.round(until)) && until >= now ? Math.max(1000, until - now) : 15 * 60_000;
}
export class CollectorError extends Error {
  constructor(public code: CollectorCode, message: string, public retryAfterMs?: number) { super(message); this.name = "CollectorError"; }
}
