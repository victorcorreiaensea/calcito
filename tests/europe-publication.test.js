import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setup, rpc } from "./support/arena-fixture.js";
import { translateError } from "../src/services/manualRepository.js";

test("Supabase errors retain actionable diagnostics and distinguish uncertain network outcomes", () => {
  assert.match(
    translateError({ code: "42703", message: "column example does not exist" })
      .message,
    /42703.*column example/,
  );
  assert.match(
    translateError({ code: "21000", message: "UPDATE requires a WHERE clause" })
      .message,
    /Correctif SQL de publication requis/,
  );
  assert.match(
    translateError({ code: "57014", message: "canceling statement" }).message,
    /vérifier si elle a abouti/,
  );
});

test("Authenticated owner publishes all 72 imported matches without rewriting their statistics, with all current migrations", async () => {
  const { db, as, admin, player } = await setup();
  try {
    for (const name of [
      "004_calendar_bookmaker.sql",
      "005_europe_preparation.sql",
      "007_native_match_statistics.sql",
    ])
      await db.exec(
        await readFile(
          new URL("../supabase/migrations/" + name, import.meta.url),
          "utf8",
        ),
      );
    const definition = (
      await db.query(
        "select pg_get_functiondef('public._arena_result_trigger()'::regprocedure) as body",
      )
    ).rows[0].body;
    // Recreate the old installed function before applying the upgrade.
    await db.exec(definition.replace(/WHERE singleton = TRUE;/i, ";"));
    const rights = (
      await db.query(
        "select proacl::text as acl from pg_proc where oid='public._arena_result_trigger()'::regprocedure",
      )
    ).rows;
    const fix = await readFile(
      new URL(
        "../supabase/migrations/008_safe_match_publication.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.exec(fix);
    await db.exec(fix);
    assert.deepEqual(
      (
        await db.query(
          "select proacl::text as acl from pg_proc where oid='public._arena_result_trigger()'::regprocedure",
        )
      ).rows,
      rights,
    );
    const corrected = (
      await db.query(
        "select pg_get_functiondef('public._arena_result_trigger()'::regprocedure) as body",
      )
    ).rows[0].body;
    const modelUpdate = corrected.match(/UPDATE\s+arena_model\b[^;]*;/i)?.[0];
    assert.match(
      modelUpdate,
      /WHERE\s+singleton\s*=\s*TRUE/i,
      "The singleton update must have an explicit WHERE for Supabase safeupdate",
    );
    assert.doesNotMatch(fix, /safeupdate\s*=|ALTER\s+ROLE|DISABLE\s+TRIGGER/i);
    const bankBefore = (await db.query("select * from arena_bank")).rows;
    const bundle = JSON.parse(
      await readFile(
        new URL(
          "../data/imports/europe-2026-match-statistics.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await as(admin);
    const report = await rpc(db, "import_match_statistics", [
      bundle,
      "publish-regression",
    ]);
    assert.deepEqual(report.errors, []);
    const rows = (
      await db.query(
        "select id,updated_at::text as revision from matches where not is_published order by kickoff,id",
      )
    ).rows;
    assert.equal(rows.length, 72);
    const before = (
      await db.query("select * from match_team_stats order by match_id,team_id")
    ).rows;
    await as(player);
    assert.equal(
      (
        await db.query(
          "update matches set is_published=true,verified_at=now() where id=$1 returning id",
          [rows[0].id],
        )
      ).rows.length,
      0,
    );
    await as(admin);
    for (const row of rows) {
      const result = await db.query(
        "update matches set is_published=true,verified_at=now() where id=$1 and not is_published and updated_at=$2::timestamptz returning id",
        [row.id, row.revision],
      );
      assert.equal(result.rows.length, 1);
    }
    assert.deepEqual(
      (
        await db.query(
          "select * from match_team_stats order by match_id,team_id",
        )
      ).rows,
      before,
    );
    assert.equal(
      (
        await db.query(
          "update matches set is_published=true where id=$1 and not is_published returning id",
          [rows[0].id],
        )
      ).rows.length,
      0,
    );
    await db.exec("reset role");
    assert.equal(
      (await db.query("select enabled from arena_model where singleton = TRUE"))
        .rows[0].enabled,
      false,
    );
    assert.deepEqual(
      (await db.query("select * from arena_bank")).rows,
      bankBefore,
    );
  } finally {
    await db.close();
  }
});
