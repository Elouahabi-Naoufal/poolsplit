import { prisma } from "@/lib/prisma";
import { generatePublicUserId } from "@/lib/utils";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { createSession } from "@/server/auth/session";

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  publicId: string;
  isAdmin: boolean;
}

export type AuthResult =
  | { ok: true; token: string; user: AuthUser }
  | { ok: false; error: string };

const registerSchema = z.object({
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/, "Only alphanumeric and underscore"),
  password: z.string().min(6).max(100),
  displayName: z.string().min(2).max(50),
});

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

function toAuthUser(u: {
  id: string;
  username: string;
  displayName: string;
  publicId: string;
  isAdmin: boolean;
}): AuthUser {
  return { id: u.id, username: u.username, displayName: u.displayName, publicId: u.publicId, isAdmin: u.isAdmin };
}

export async function registerUser(input: {
  username: string;
  password: string;
  displayName: string;
}): Promise<AuthResult> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path?.[0] ?? "");
    if (field === "username") return { ok: false, error: "usernameChars" };
    if (field === "displayName") return { ok: false, error: "displayNameLen" };
    return { ok: false, error: "invalidInput" };
  }
  const { username, password, displayName } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) return { ok: false, error: "userExists" };

  const passwordHash = await bcrypt.hash(password, 10);
  const publicId = generatePublicUserId();

  const user = await prisma.user.create({
    data: { username, passwordHash, displayName, publicId },
    select: { id: true, username: true, displayName: true, publicId: true, isAdmin: true },
  });

  const token = await createSession({
    userId: user.id,
    publicId: user.publicId,
    displayName: user.displayName,
    isAdmin: user.isAdmin,
  });

  return { ok: true, token, user: toAuthUser(user) };
}

export async function loginUser(input: { username: string; password: string }): Promise<AuthResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const { username, password } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { username },
    select: { id: true, username: true, displayName: true, publicId: true, isAdmin: true, passwordHash: true },
  });
  if (!user) return { ok: false, error: "invalidCredentials" };

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return { ok: false, error: "invalidCredentials" };

  const token = await createSession({
    userId: user.id,
    publicId: user.publicId,
    displayName: user.displayName,
    isAdmin: user.isAdmin,
  });

  return {
    ok: true,
    token,
    user: toAuthUser({ id: user.id, username: user.username, displayName: user.displayName, publicId: user.publicId, isAdmin: user.isAdmin }),
  };
}