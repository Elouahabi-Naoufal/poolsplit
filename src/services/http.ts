import { NextResponse } from "next/server";
import type { ServiceResult } from "./types";

export function respond<T>(result: ServiceResult<T>): NextResponse {
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.data);
}

export async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await req.json();
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return data as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

export function reqString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" ? value : undefined;
}

export function reqStringArray(body: Record<string, unknown>, key: string): string[] | undefined {
  const value = body[key];
  if (!Array.isArray(value)) return undefined;
  return value.filter((v): v is string => typeof v === "string");
}

export function reqInt(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key];
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}
