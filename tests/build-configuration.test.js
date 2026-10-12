import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("Vite rejects a misplaced server key before emitting any public bundle", async () => {
  const dir = await mkdtemp(join(tmpdir(), "calcito-key-guard-"));
  const marker = "sb_secret_TEST_ONLY_NEVER_EMIT";
  try {
    const result = spawnSync(
      process.execPath,
      ["node_modules/vite/bin/vite.js", "build", "--outDir", join(dir, "dist")],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          VITE_SUPABASE_URL: "https://test.supabase.co",
          VITE_SUPABASE_PUBLISHABLE_KEY: marker,
        },
        encoding: "utf8",
      },
    );
    assert.notEqual(result.status, 0);
    assert.ok((result.stderr + result.stdout).includes("clé publique"));
    assert.ok(!(result.stderr + result.stdout).includes(marker));
    await assert.rejects(access(join(dir, "dist", "index.html")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
