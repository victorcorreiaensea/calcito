import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { setup, rpc } from "./support/arena-fixture.js";
import {
  comparativeStat,
  analyzeMatchStatistics,
} from "../src/domain/matchAnalysis.js";
import { clubCandidates } from "../src/domain/clubIdentity.js";
const read = (name) => readFile(new URL("../" + name, import.meta.url), "utf8");
test("Native comparisons and Calcito analysis only describe available numbers, preserve zero and do not confuse xG with ratings", () => {
  assert.deepEqual(comparativeStat(null, 9), {
    home: null,
    away: 9,
    complete: false,
    homeShare: 0,
    awayShare: 0,
  });
  assert.equal(comparativeStat(0, 0).complete, true);
  assert.equal(comparativeStat(0, 9).awayShare, 100);
  assert.equal(comparativeStat(undefined, 9).home, null);
  const m = {
    home: { name: "Club Brugge" },
    away: { name: "Aston Villa" },
    teamStatistics: {
      home: { shots: 14, shots_on_target: 7, xg: 1.53, possession: 64 },
      away: { shots: 21, shots_on_target: 9, xg: 3.22, possession: 36 },
    },
  };
  const text = analyzeMatchStatistics(m);
  assert.match(
    text,
    /Aston Villa a tenté 21 tirs, dont 9 cadrés, contre 14 tirs et 7 cadrés pour Club Brugge/,
  );
  assert.match(
    text,
    /Avec 36 % de possession, Aston Villa a produit 3,22 xG, contre 1,53/,
  );
  assert.doesNotMatch(text, /note|probabilité|domination|victoire certaine/i);
  assert.match(
    analyzeMatchStatistics({
      ...m,
      teamStatistics: { home: { team_rating: 8 }, away: { team_rating: 7 } },
    }),
    /ne suffisent pas/,
  );
  assert.doesNotMatch(
    analyzeMatchStatistics({
      ...m,
      teamStatistics: { home: { corners: 0 }, away: { corners: 2 } },
    }),
    /xG|possession|tirs/,
  );
  assert.equal(
    clubCandidates("Aston Villa", [{ id: "v", name: "Aston Villa FC" }])[0].id,
    "v",
  );
  assert.equal(
    clubCandidates("Club Brugge", [{ id: "b", name: "Club Bruges" }])[0].id,
    "b",
  );
});
test("72 numeric records include verified crest assets and no images; imports fill real private matches, reuse UUIDs, preserve statistics and never publish", async () => {
  const f = await setup(),
    { db, as, admin, player } = f;
  try {
    await db.exec(await read("supabase/migrations/005_europe_preparation.sql"));
    await db.exec(
      await read("supabase/migrations/007_native_match_statistics.sql"),
    );
    const bundle = JSON.parse(
      await read("data/imports/europe-2026-match-statistics.json"),
    );
    assert.equal(bundle.matches.length, 72);
    assert.doesNotMatch(JSON.stringify(bundle), /image_data|data:image/);
    const uniqueClubs = new Map(
      bundle.matches
        .flatMap((m) => [m.home_club, m.away_club])
        .map((c) => [c.slug, c]),
    );
    assert.equal(uniqueClubs.size, 72);
    for (const c of uniqueClubs.values()) {
      const bytes = await readFile(
        new URL(
          "../public/" + c.logo_url.split("/calcito/")[1],
          import.meta.url,
        ),
      );
      assert.equal(
        createHash("sha1")
          .update(
            Buffer.concat([Buffer.from("blob " + bytes.length + "\0"), bytes]),
          )
          .digest("hex"),
        c.logo_blob_sha,
      );
      assert.match(c.logo_source_url, /^https:\/\/github.com\//);
    }
    const cid = (
      await db.query(
        "select id from competitions where slug='champions-league'",
      )
    ).rows[0].id;
    const season = (
      await db.query(
        "insert into seasons(competition_id,label,start_year,end_year,is_published)values($1,'2026–2027',2026,2027,true)returning id",
        [cid],
      )
    ).rows[0].id;
    const bruges = (
      await db.query(
        "insert into teams(name,short,slug,country,is_published)values('Club Bruges','BRU','club-bruges','Belgique',true)returning id",
      )
    ).rows[0].id;
    const villa = (
      await db.query(
        "insert into teams(name,short,slug,country,is_published,logo_url,external_references)values('Aston Villa FC','AVL','aston-villa-fc','Angleterre',true,'https://existing.example/villa.png','{\"api-football\":\"66\"}')returning id",
      )
    ).rows[0].id;
    for (const t of [bruges, villa])
      await db.query(
        "insert into season_teams(season_id,team_id)values($1,$2)",
        [season, t],
      );
    const mid = (
      await db.query(
        "insert into matches(season_id,round,kickoff,home_team_id,away_team_id,status)values($1,'Phase de ligue · Journée 1','2026-09-08T16:45:00Z',$2,$3,'scheduled')returning id",
        [season, bruges, villa],
      )
    ).rows[0].id;
    await db.query(
      "insert into match_team_stats(match_id,team_id,shots)values($1,$2,14)",
      [mid, bruges],
    );
    await db.query(
      "insert into teams(name,short,slug,country,is_published)values('Sabah FC','SAB','sabah-malaysia','Malaysia',true)",
    );
    const bank = (await db.query("select * from arena_bank")).rows,
      model = (await db.query("select * from arena_model")).rows;
    await as(player);
    await assert.rejects(
      rpc(db, "import_match_statistics", [bundle, "test-batch"]),
      /Administration/,
    );
    await as(admin);
    const report = await rpc(db, "import_match_statistics", [
      bundle,
      "test-batch",
    ]);
    assert.deepEqual(report.errors, []);
    assert.equal(report.completed, 72);
    assert.equal(report.created, 71);
    assert.equal(report.new_clubs, 70);
    assert.equal(report.published, 0);
    const azeri = (
      await db.query("select * from teams where country='Azerbaïdjan'")
    ).rows;
    assert.equal(azeri.length, 1);
    assert.equal(azeri[0].name, "FK Sabah");
    assert.match(azeri[0].logo_url, /sabah-fc.png$/);

    const m = (await db.query("select * from matches where id=$1", [mid]))
      .rows[0];
    assert.equal(m.home_team_id, bruges);
    assert.equal(m.away_team_id, villa);
    assert.equal(m.goals_home, 2);
    assert.equal(m.goals_away, 3);
    assert.equal(m.is_published, false);
    assert.equal(m.verified_at, null);
    const s = (
      await db.query(
        "select * from match_team_stats where match_id=$1 and team_id=$2",
        [mid, bruges],
      )
    ).rows[0];
    assert.equal(Number(s.xg), 1.53);
    assert.equal(s.passes_completed, 532);
    assert.equal(s.passes_attempted, 602);
    assert.equal(Number(s.pass_accuracy), 88);
    assert.equal(s.corners, 4);
    assert.equal(s.yellow_cards, 3);
    assert.equal(s.team_rating, null);
    assert.equal(s.woodwork, null);
    const v = (await db.query("select * from teams where id=$1", [villa]))
      .rows[0];
    assert.equal(v.logo_url, "https://existing.example/villa.png");
    assert.deepEqual(v.external_references, { "api-football": "66" });
    assert.equal(
      (await db.query("select count(*)::int n from match_statistics_imports"))
        .rows[0].n,
      72,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from match_team_stats t join match_statistics_imports i on i.match_id=t.match_id",
        )
      ).rows[0].n,
      144,
    );
    assert.equal(
      (await rpc(db, "import_match_statistics", [bundle, "test-batch"]))
        .already_imported,
      72,
    );
    const changed = structuredClone(bundle);
    changed.matches[1].source_key = "a".repeat(64);
    changed.matches[1].home_stats.shots = 15;
    const conflicts = await rpc(db, "import_match_statistics", [
      changed,
      "test-conflict",
    ]);
    assert.equal(conflicts.errors.length, 1);
    assert.match(conflicts.errors[0].reason, /Conflit statistique/);
    assert.equal(
      (
        await db.query(
          "select shots from match_team_stats where match_id=$1 and team_id=$2",
          [mid, bruges],
        )
      ).rows[0].shots,
      14,
    );
    await db.exec("reset role");
    assert.deepEqual((await db.query("select * from arena_bank")).rows, bank);
    assert.deepEqual((await db.query("select * from arena_model")).rows, model);
    await as(admin);
    await db.query(
      "update matches set is_published=true,verified_at=now() where id=$1",
      [mid],
    );
    const publishedAttempt = structuredClone(bundle);
    publishedAttempt.matches = publishedAttempt.matches.filter(
      (r) => r.id === "CL-02",
    );
    publishedAttempt.matches[0].source_key = "b".repeat(64);
    publishedAttempt.matches[0].home_stats.woodwork = 0;
    const denied = await rpc(db, "import_match_statistics", [
      publishedAttempt,
      "public-skip",
    ]);
    assert.equal(denied.public_matches_awaiting_approval, 1);
    assert.equal(denied.completed, 0);
    assert.equal(
      (
        await db.query(
          "select woodwork from match_team_stats where match_id=$1 and team_id=$2",
          [mid, bruges],
        )
      ).rows[0].woodwork,
      null,
    );
    await db.exec("set role anon");
    assert.equal((await db.query("select * from matches")).rows.length, 2);
    await assert.rejects(
      db.query("select * from match_statistics_imports"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
test("The single SQL installer bootstraps missing 005 and writes numeric drafts without requiring migration 006 or image tables", async () => {
  const f = await setup();
  try {
    await f.db.exec(
      await read("public/downloads/calcito-statistiques-europe-brouillons.sql"),
    );
    const report = (
      await f.db.query("select report from match_statistics_batches")
    ).rows[0].report;
    assert.deepEqual(report.errors, []);
    assert.equal(report.completed, 72);
    assert.equal(report.published, 0);
    assert.equal(
      (
        await f.db.query(
          "select to_regclass('public.photo_import_captures') as t",
        )
      ).rows[0].t,
      null,
    );
    await f.db.exec(
      await read("public/downloads/calcito-statistiques-europe-brouillons.sql"),
    );
    assert.equal(
      (await f.db.query("select report from match_statistics_batches")).rows[0]
        .report.already_imported,
      72,
    );
  } finally {
    await f.db.close();
  }
});

test("Migration 007 retires the old image endpoints while retaining useful stats and private historical archives", async () => {
  const f = await setup();
  try {
    for (const m of [
      "005_europe_preparation.sql",
      "006_photo_import.sql",
      "007_native_match_statistics.sql",
    ])
      await f.db.exec(await read("supabase/migrations/" + m));
    await f.as(f.admin);
    await assert.rejects(rpc(f.db, "photo_import_status"), /permission denied/);
    assert.equal((await rpc(f.db, "statistics_storage_status")).ready, true);
  } finally {
    await f.db.close();
  }
});
