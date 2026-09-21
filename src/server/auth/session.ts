import * as jose from "jose";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

// Lazy on purpose: evaluated on first auth use, NOT at import time, so
// `next build` (NODE_ENV=production without runtime env) still succeeds.
// At runtime without JWT_SECRET in production, the first sign/verify throws
// loudly instead of silently forging sessions with a fallback.
function getJwtSecret(): Uint8Array {
  const s = process.env.JWT_SECRET;
  if (!s && process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET is not set. Refusing to sign sessions without a secret.");
  }
  return new TextEncoder().encode(s || "dev-only-insecure-secret-change-me");
}
const alg = "HS256";

export interface SessionPayload {
  userId: string;
  publicId: string;
  displayName: string;
  isAdmin: boolean;
  iat?: number;
  exp?: number;
}

export async function createSession(payload: Omit<SessionPayload, "iat" | "exp">): Promise<string> {
  const jwt = await new jose.SignJWT(payload as unknown as jose.JWTPayload)
    .setProtectedHeader({ alg })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getJwtSecret());
  return jwt;
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jose.jwtVerify(token, getJwtSecret());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;
  if (!token) return null;
  return verifySession(token);
}

export function getBearerToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

/**
 * Resolve a session from either the browser `session` cookie or an
 * `Authorization: Bearer <jwt>` header (used by the mobile API clients).
 * Same JWT payload/secret as the cookie flow — no token migration needed.
 */
export async function getSessionFromRequest(req: NextRequest): Promise<SessionPayload | null> {
  const token = req.cookies.get("session")?.value ?? getBearerToken(req);
  if (!token) return null;
  return verifySession(token);
}

export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");
  return session;
}

export async function getCurrentUser() {
  const session = await getSession();
  if (!session) return null;
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  return user;
}
