import { NextResponse } from "next/server";
import { registerUser } from "@/services/auth";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const result = await registerUser({
      username: String(body?.username ?? ""),
      password: String(body?.password ?? ""),
      displayName: String(body?.displayName ?? ""),
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ token: result.token, user: result.user });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}