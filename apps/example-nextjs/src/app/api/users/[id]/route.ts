import { NextRequest, NextResponse } from "next/server";
import { ok, err, type AsyncResult } from "awaitly";
import { eq } from "drizzle-orm";
import { db } from "../../../../lib/db";
import { users, type User } from "../../../../lib/db/schema";

type UserError = "NOT_FOUND" | "UNAUTHORIZED";

async function getUser(
  id: string
): Promise<AsyncResult<User, UserError>> {
  // In a real app we'd check auth for UNAUTHORIZED
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, Number(id)))
    .limit(1);
  if (!user) return err("NOT_FOUND");
  return ok(user);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const numId = Number(id);
  if (Number.isNaN(numId) || numId < 1) {
    return NextResponse.json(
      { ok: false, error: "NOT_FOUND" },
      { status: 404 }
    );
  }
  const result = await getUser(id);

  if (result.ok) {
    return NextResponse.json({ ok: true, value: result.value });
  }
  return NextResponse.json(
    { ok: false, error: result.error },
    { status: result.error === "NOT_FOUND" ? 404 : 401 }
  );
}
