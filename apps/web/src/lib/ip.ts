/** Best-effort client IP (Vercel sets x-forwarded-for). Used only for hotel-rate requests that require it. */
export const clientIp = (req: Request) =>
  req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "127.0.0.1";
