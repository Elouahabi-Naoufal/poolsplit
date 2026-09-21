import { NextResponse } from "next/server";
import { loginUser } from "@/services/auth";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const result = await loginUser({
      username: String(body?.username ?? ""),
      password: String(body?.password ?? ""),
    });
    if (!result.ok) {
      const status = result.error === "invalidCredentials" ? 401 : 400;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json({ token: result.token, user: result.user });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}