import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { budgetService, HttpError, safeError } from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
type Context = { params: Promise<{ path?: string[] }> };

async function handle(request: NextRequest, context: Context) {
  try {
    if (request.method !== "GET") {
      const origin = request.headers.get("origin");
      const expected = process.env.AUTH_URL ? new URL(process.env.AUTH_URL).origin : request.nextUrl.origin;
      if (!origin || origin !== expected || request.headers.get("sec-fetch-site") === "cross-site") throw new HttpError(403, "forbidden");
      if (!request.headers.get("content-type")?.startsWith("application/json")) throw new HttpError(415, "invalidInput");
    }
    const session = await auth();
    if (!session?.user.id || !session.user.email) throw new HttpError(401, "signInRequired");
    let body: unknown;
    if (request.method !== "GET") {
      if (Number(request.headers.get("content-length") || 0) > 16_384) throw new HttpError(413, "invalidInput");
      const raw = await request.text();
      if (raw.length > 16_384) throw new HttpError(413, "invalidInput");
      try { body = JSON.parse(raw); } catch { throw new HttpError(400, "invalidInput"); }
    }
    const { path = [] } = await context.params;
    const data = await budgetService({ id: session.user.id, name: session.user.name || session.user.email, email: session.user.email }, request.method, path, request.nextUrl, body);
    return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const safe = safeError(error);
    return NextResponse.json({ error: safe.code }, { status: safe.status, headers: { "Cache-Control": "private, no-store" } });
  }
}
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
