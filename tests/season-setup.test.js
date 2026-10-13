import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  prepareSeasonCatalog,
  resolveCatalog,
  mappedSeasonRows,
} from "../src/domain/seasonSetup.js";
import {
  calculateSimplifiedForm,
  formCoverage,
} from "../src/domain/simplified.js";
import {
  readMatchCSV,
  planMatchImport,
  executeMatchImport,
} from "../src/domain/matchImport.js";

const bundle = JSON.parse(
  await readFile(
    new URL("../public/data/season-2026-2027.json", import.meta.url),
    "utf8",
  ),
);
test("results benchmark has exact standard-points boundaries, no missing-as-zero and identical outputs for enriched matches", () => {
  const win = {
    goals_for: 2,
    goals_against: 0,
    entry_type: "complete",
    stats: null,
  };
  const draw = { ...win, goals_for: 0, goals_against: 0 };
  const loss = { ...win, goals_for: 0, goals_against: 1 };
  assert.equal(calculateSimplifiedForm(Array(5).fill(win)).score, 100);
  assert.equal(calculateSimplifiedForm(Array(5).fill(loss)).score, 0);
  assert.equal(calculateSimplifiedForm(Array(5).fill(draw)).score, 100 / 3);
  assert.equal(calculateSimplifiedForm([win, win, draw, loss, loss]).points, 7);
  assert.equal(calculateSimplifiedForm(Array(4).fill(win)).score, null);
  assert.equal(
    calculateSimplifiedForm([{ ...win, goals_for: null }, win, win, win, win])
      .score,
    null,
  );
  const enriched = {
    ...win,
    stats: {
      shots: 12,
      shots_on_target: 5,
      big_chances: 3,
      team_rating: 7,
      bonuses: [],
    },
  };
  const basic = formCoverage(Array(5).fill(win));
  const mixed = formCoverage([enriched, win, win, win, win]);
  const detailed = formCoverage(Array(5).fill(enriched));
  assert.deepEqual([basic.score, mixed.score, detailed.score], [100, 100, 100]);
  assert.deepEqual(
    [basic.dataMode, mixed.dataMode, detailed.dataMode],
    ["simplifié", "mixte", "complet"],
  );
  assert.equal(basic.compatibilityGroup, "results-points-v1");
  assert.equal(formCoverage([]).score, null);
});
test("partial six-league CSV is structurally valid, unique and uses the exact published French and Portuguese names", async () => {
  const rows = readMatchCSV(
    await readFile(
      new URL(
        "../public/downloads/calcito_resultats_2026_2027.csv",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(rows.length, 348);
  assert.equal(bundle.clubs.length, 114);
  assert.equal(
    new Set(
      rows.map((r) =>
        [r.competition, r.date, r.home_team, r.away_team].join(":"),
      ),
    ).size,
    348,
  );
  for (const row of rows) {
    assert.ok(row.date <= "2026-10-13");
    assert.ok(bundle.clubs.some((c) => c.name === row.home_team));
    assert.ok(bundle.clubs.some((c) => c.name === row.away_team));
    for (const k of Object.keys(row).slice(7, 15)) assert.equal(row[k], "");
  }
  assert.ok(rows.some((r) => r.home_team === "SL Benfica"));
  assert.ok(rows.some((r) => r.home_team === "Paris Saint Germain"));
  assert.ok(bundle.partial);
  assert.ok(bundle.report.every((r) => r.latestResult >= "2026-10-10"));
  assert.equal(bundle.conflicts.length, 6);
  assert.equal(bundle.verification.licensedAdditions, 42);
  for (const conflict of bundle.conflicts)
    assert.ok(
      !rows.some(
        (r) =>
          r.competition === conflict.competition &&
          r.home_team === conflict.home_team &&
          r.away_team === conflict.away_team,
      ),
    );
});
test("authenticated catalog preparation preserves protected clubs and adjustments, imports all available results exactly once through real RPC and denies anonymous writes", async () => {
  const db = new PGlite();
  const admin = randomUUID();
  try {
    await db.exec(
      `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);grant usage on schema auth to anon,authenticated;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;insert into auth.users values('${admin}');`,
    );
    for (const name of [
      "001_manual_platform.sql",
      "002_simplified_results.sql",
    ])
      await db.exec(
        await readFile(
          new URL("../supabase/migrations/" + name, import.meta.url),
          "utf8",
        ),
      );
    await db.exec(
      `insert into admin_users(user_id)values('${admin}');set role authenticated;select set_config('request.jwt.claim.sub','${admin}',false);update competitions set is_published=true;`,
    );
    async function mutate(table, action, payload, id) {
      const keys = Object.keys(payload);
      const values = Object.values(payload);
      if (action === "insert")
        await db.query(
          `insert into ${table}(${keys.join(",")})values(${keys.map((_, i) => "$" + (i + 1)).join(",")})`,
          values,
        );
      else
        await db.query(
          `update ${table} set ${keys.map((k, i) => k + "=$" + (i + 1)).join(",")} where id=$${keys.length + 1}`,
          [...values, id],
        );
    }
    async function dataset() {
      const select = async (table) =>
        (await db.query(`select to_jsonb(t)as r from ${table} t`)).rows.map(
          (x) => x.r,
        );
      return {
        competitions: await select("competitions"),
        seasons: await select("seasons"),
        teams: await select("teams"),
        members: await select("season_teams"),
        matches: await select("matches"),
        stats: await select("match_team_stats"),
        simplified: await select("simplified_results"),
      };
    }
    for (const c of bundle.clubs.filter((c) => !c.allowCreate))
      await mutate("teams", "insert", {
        id: c.existingId,
        slug: c.slug,
        name: c.name,
        short: c.short,
        country: c.country,
        logo_url: c.logo_url,
        is_published: true,
      });
    const protectedTeams = (await dataset()).teams;
    const prepared = await prepareSeasonCatalog(bundle, await dataset(), {
      published: true,
      mutate,
      uuid: randomUUID,
    });
    assert.equal(prepared.report.teams, 78);
    assert.equal(prepared.report.seasons, 6);
    let d = await dataset();
    assert.equal(d.teams.length, 114);
    assert.equal(d.members.length, 114);
    assert.deepEqual(
      d.teams.filter((t) => protectedTeams.some((p) => p.id === t.id)),
      protectedTeams,
    );
    const first = d.members[0];
    await db.query(
      "update season_teams set point_adjustment=-2,adjustment_reason=$1 where team_id=$2 and season_id=$3",
      ["Verified test sanction", first.team_id, first.season_id],
    );
    const rerun = await prepareSeasonCatalog(bundle, await dataset(), {
      published: true,
      mutate,
      uuid: randomUUID,
    });
    assert.deepEqual(rerun.report, {
      teams: 0,
      seasons: 0,
      competitions: 0,
      members: 0,
    });
    d = await dataset();
    assert.equal(
      d.members.find(
        (m) => m.team_id === first.team_id && m.season_id === first.season_id,
      ).point_adjustment,
      -2,
    );
    const rows = mappedSeasonRows(bundle, prepared.mapping, { ids: true });
    const plan = planMatchImport(rows, d, {
      verified: true,
      published: true,
      now: new Date("2026-10-13T21:00:00Z"),
    });
    assert.ok(
      plan.every((r) => !r.errors.length),
      JSON.stringify(plan.filter((r) => r.errors.length).slice(0, 2)),
    );
    const save = async (payload) =>
      (
        await db.query("select save_match($1::jsonb)as id", [
          JSON.stringify(payload),
        ])
      ).rows[0].id;
    const imported = await executeMatchImport(plan, { save });
    assert.equal(imported.imported, 348);
    assert.equal(imported.rejected, 0);
    const after = await dataset();
    assert.equal(after.stats.length, 696);
    assert.ok(
      after.stats.every((s) => s.shots === null && s.team_rating === null),
    );
    const duplicates = await executeMatchImport(
      planMatchImport(rows, after, { verified: true, published: true }),
      { save },
    );
    assert.equal(duplicates.ignored, 348);
    for (const team of after.teams)
      assert.ok(
        after.matches.some((m) =>
          [m.home_team_id, m.away_team_id].includes(team.id),
        ),
      );
    const missing = resolveCatalog(bundle.clubs, {
      ...d,
      teams: d.teams.filter((t) => t.name !== "SL Benfica"),
    });
    assert.ok(
      missing.find((p) => p.club.sourceName === "Sport Lisboa e Benfica").error,
    );
    await db.exec(
      "reset role;set role anon;select set_config('request.jwt.claim.sub','',false);",
    );
    await assert.rejects(
      mutate("teams", "insert", {
        slug: "denied",
        name: "Denied",
        short: "D",
        country: "France",
      }),
    );
  } finally {
    await db.close();
  }
});
