import { NextResponse } from "next/server";
import { spawnWetty, killWetty } from "@/lib/wetty-manager";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed } from "@/lib/file-access";

/** Same gate as /api/files and /api/worktrees: only session cwds / project
 *  roots / explicitly allowed dirs may host a terminal. */
async function checkCwdAllowed(cwd: string): Promise<NextResponse | null> {
  const allowedRoots = await getAllowedFileRoots();
  if (!isFilePathAllowed(cwd, allowedRoots) || !isExistingFilePathAllowed(cwd, allowedRoots)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  return null;
}

// POST /api/terminal/[id]  body: { cwd }  →  { id, port }
// The [id] segment is supplied by the client so it matches its own tab id;
// spawnWetty is idempotent (returns existing entry on repeat calls).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await req.json() as { cwd?: string };
    if (!body.cwd || typeof body.cwd !== "string") {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }
    const denied = await checkCwdAllowed(body.cwd);
    if (denied) return denied;

    const handle = await spawnWetty(id, body.cwd);
    return NextResponse.json({ id: handle.id, port: handle.port, cwd: handle.cwd });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/terminal/[id]  →  { ok: true }
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const killed = killWetty(id);
    return NextResponse.json({ ok: killed });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
