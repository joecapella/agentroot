import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireSameOriginHeader } from "@/src/server/auth";
import { runRoute, sanitizedError } from "@/src/server/errors";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_FILES = [
  "orchestrator.prompt.md",
  "code-assistant.prompt.md",
  "brand-designer.prompt.md",
  "ops-agent.prompt.md",
  "vision-agent.prompt.md",
];

const SOURCE_DIR = join(process.cwd(), "agent-config");
const TARGET_DIR = join(process.cwd(), "src", "CofounderAgent", "prompts");

export async function POST(req: NextRequest) {
  const principal = requireAuth(req);
  if (principal instanceof NextResponse) return principal;
  const csrf = requireSameOriginHeader(req);
  if (csrf) return csrf;

  return runRoute("settings.bake.POST", async () => {
    const copied: string[] = [];
    const skipped: string[] = [];

    for (const file of ALLOWED_FILES) {
      const src = join(SOURCE_DIR, file);
      const dst = join(TARGET_DIR, file);
      if (!existsSync(src)) {
        skipped.push(file);
        continue;
      }
      mkdirSync(dirname(dst), { recursive: true });
      copyFileSync(src, dst);
      copied.push(file);
    }

    if (copied.length === 0) {
      return sanitizedError("no_files_to_bake", 400, { skipped }, "settings.bake");
    }

    return NextResponse.json({
      baked: true,
      copied,
      skipped,
      note: "Run `azd up` or rebuild the container to deploy these prompts.",
    });
  });
}
