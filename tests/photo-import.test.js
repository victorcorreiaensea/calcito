import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash, randomBytes, webcrypto } from "node:crypto";
import { gzipSync } from "node:zlib";
import { setup, rpc } from "./support/arena-fixture.js";
import {
  clubCandidates,
  initialPhotoDraft,
  photoReviewPayload,
  openPhotoBundle,
} from "../src/domain/photoImport.js";
import { matchPayload, validateMatch } from "../src/domain/match.js";
const migration = async (db, n) =>
  db.exec(
    await readFile(
      new URL("../supabase/migrations/" + n, import.meta.url),
      "utf8",
    ),
  );
function capture(tag = "one") {
  const image = Buffer.from("private image " + tag);
  return {
    sha256: createHash("sha256").update(image).digest("hex"),
    filename: tag + ".jpg",
    image_data: "data:image/jpeg;base64," + image.toString("base64"),
    home_name: "Club 0",
    away_name: "Club 1",
    competition: "champions-league",
    round: 1,
  };
}
test("Photo import is private, verification is separate from publication, existing values are protected and retries are idempotent", async () => {
  const f = await setup(),
    { db, admin, player, as, teams } = f;
  try {
    await migration(db, "005_europe_preparation.sql");
    await migration(db, "006_photo_import.sql");
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
    for (const t of teams.slice(0, 2))
      await db.query(
        "insert into season_teams(season_id,team_id)values($1,$2)",
        [season, t],
      );
    const match = (
      await db.query(
        "insert into matches(season_id,round,kickoff,home_team_id,away_team_id,status)values($1,'J1','2026-09-08T16:45:00Z',$2,$3,'scheduled') returning *",
        [season, ...teams.slice(0, 2)],
      )
    ).rows[0];
    await db.query(
      "insert into match_team_stats(match_id,team_id,shots) values($1,$2,14)",
      [match.id, teams[0]],
    );
    const cap = capture();
    await as(player);
    await assert.rejects(
      rpc(db, "photo_import_stage", [cap]),
      /Administration/,
    );
    await as(admin);
    await assert.rejects(
      rpc(db, "photo_import_stage", [{ ...cap, sha256: "a".repeat(64) }]),
      /Empreinte/,
    );
    await rpc(db, "photo_import_stage", [cap]);
    await rpc(db, "photo_import_stage", [cap]);
    assert.equal(
      (await db.query("select count(*)::integer n from photo_import_captures"))
        .rows[0].n,
      1,
    );
    await assert.rejects(
      rpc(db, "photo_import_stage", [{ ...cap, round: 2 }]),
      /autre extraction/,
    );
    await as(player);
    assert.equal(
      (await db.query("select * from photo_import_captures")).rows.length,
      0,
    );
    await assert.rejects(
      rpc(db, "photo_import_publish", [[cap.sha256]]),
      /Administration/,
    );
    await as(admin);
    await assert.rejects(
      rpc(db, "photo_import_publish", [[cap.sha256]]),
      /explicitement vérifiées/,
    );
    let draft = {
      competition_id: cid,
      round: "1",
      kickoff: "2026-09-08T16:45:00Z",
      home_team_id: teams[0],
      away_team_id: teams[1],
      goals_home: 2,
      goals_away: 3,
      identity_confirmed: true,
      home_stats: {
        shots: 14,
        shots_on_target: 7,
        corners: 4,
        passes_completed: 532,
        passes_attempted: 602,
        pass_accuracy: 88,
        yellow_cards: 3,
      },
      away_stats: {
        shots: 21,
        shots_on_target: 9,
        corners: 5,
        passes_completed: 280,
        passes_attempted: 337,
        pass_accuracy: 83,
        yellow_cards: 3,
      },
    };
    await assert.rejects(
      rpc(db, "photo_import_review", [
        cap.sha256,
        1,
        { ...draft, identity_confirmed: false },
        true,
      ]),
      /Confirmez/,
    );
    await assert.rejects(
      rpc(db, "photo_import_review", [
        cap.sha256,
        1,
        { ...draft, home_stats: { shots: 15 } },
        true,
      ]),
      /Conflit statistique/,
    );
    await assert.rejects(
      rpc(db, "photo_import_review", [
        cap.sha256,
        1,
        {
          ...draft,
          home_stats: { shots: 14, passes_completed: 20, passes_attempted: 10 },
        },
        true,
      ]),
      /incohérents/,
    );
    await rpc(db, "photo_import_review", [cap.sha256, 1, draft, true]);
    assert.equal(
      (
        await db.query("select is_published from matches where id=$1", [
          match.id,
        ])
      ).rows[0].is_published,
      false,
    );
    assert.equal(
      (
        await db.query(
          "select corners from match_team_stats where match_id=$1 and team_id=$2",
          [match.id, teams[0]],
        )
      ).rows[0].corners,
      null,
    );
    await assert.rejects(
      rpc(db, "photo_import_review", [cap.sha256, 1, draft, false]),
      /changé/,
    );
    let result = await rpc(db, "photo_import_publish", [[cap.sha256]]);
    assert.equal(result.published, 1);
    assert.equal(result.new_clubs, 0);
    result = await rpc(db, "photo_import_publish", [[cap.sha256]]);
    assert.equal(result.published, 0);
    assert.equal(
      (
        await db.query(
          "select count(*)::integer n from matches where season_id=$1",
          [season],
        )
      ).rows[0].n,
      1,
    );
    let saved = (
      await db.query(
        "select * from match_team_stats where match_id=$1 and team_id=$2",
        [match.id, teams[0]],
      )
    ).rows[0];
    assert.equal(saved.corners, 4);
    assert.equal(saved.passes_completed, 532);
    assert.equal(saved.woodwork, null);
    assert.equal(saved.team_rating, null);
    // An old client that knows only the seven original fields must preserve new columns.
    const m = (await db.query("select * from matches where id=$1", [match.id]))
      .rows[0];
    await rpc(db, "save_match", [
      {
        ...m,
        expected_updated_at: m.updated_at,
        home_stats: { shots: 14, shots_on_target: 7 },
        away_stats: { shots: 21 },
      },
    ]);
    saved = (
      await db.query(
        "select * from match_team_stats where match_id=$1 and team_id=$2",
        [match.id, teams[0]],
      )
    ).rows[0];
    assert.equal(saved.corners, 4);
    assert.equal(saved.passes_attempted, 602);
    const second = capture("two");
    await rpc(db, "photo_import_stage", [second]);
    await assert.rejects(
      rpc(db, "photo_import_review", [
        second.sha256,
        1,
        { ...draft, goals_home: 4 },
        true,
      ]),
      /Conflit de date/,
    );
    await rpc(db, "photo_import_review", [
      second.sha256,
      1,
      { ...draft, home_stats: { shots: 14, woodwork: 0 }, away_stats: {} },
      true,
    ]);
    // A concurrent write after verification invalidates the review, even for stats-only changes.
    await db.query(
      "update match_team_stats set shots=15 where match_id=$1 and team_id=$2",
      [match.id, teams[0]],
    );
    await assert.rejects(
      rpc(db, "photo_import_publish", [[second.sha256]]),
      /Conflit statistique|changé/,
    );
    await db.exec("reset role");
    assert.ok(
      (await db.query("select count(*)::integer n from photo_import_audit"))
        .rows[0].n >= 4,
    );
    await db.exec("set role anon");
    await assert.rejects(
      db.query("select * from photo_import_captures"),
      /permission denied/,
    );
    assert.equal(
      (
        await db.query("select * from match_team_stats where match_id=$1", [
          match.id,
        ])
      ).rows.length,
      2,
    );
  } finally {
    await db.close();
  }
});
test("New clubs are created only after explicit verification/publication; private review changes do not touch forms or bank", async () => {
  const f = await setup(),
    { db, admin, as, teams } = f;
  try {
    await migration(db, "005_europe_preparation.sql");
    await migration(db, "006_photo_import.sql");
    const cid = (
      await db.query("select id from competitions where slug='europa-league'")
    ).rows[0].id;
    const bank = (await db.query("select * from arena_bank")).rows;
    const model = (await db.query("select * from arena_model")).rows;
    const cap = capture("newclub");
    await as(admin);
    await rpc(db, "photo_import_stage", [cap]);
    const draft = {
      competition_id: cid,
      round: "1",
      kickoff: "2026-09-17T19:00:00Z",
      home_team_id: teams[0],
      new_away: {
        name: "New verified club",
        slug: "new-verified-club",
        country: "Belgique",
        domestic_league: "Pro League",
      },
      goals_home: 1,
      goals_away: 0,
      identity_confirmed: true,
      home_stats: { shots_on_target: 0 },
      away_stats: {},
    };
    await rpc(db, "photo_import_review", [cap.sha256, 1, draft, true]);
    assert.equal(
      (await db.query("select id from teams where slug='new-verified-club'"))
        .rows.length,
      0,
    );
    await db.exec("reset role");
    assert.deepEqual((await db.query("select * from arena_bank")).rows, bank);
    assert.deepEqual((await db.query("select * from arena_model")).rows, model);
    await as(admin);
    const r = await rpc(db, "photo_import_publish", [[cap.sha256]]);
    assert.equal(r.new_clubs, 1);
    assert.equal(r.published, 1);
    const team = (
      await db.query("select * from teams where slug='new-verified-club'")
    ).rows[0];
    assert.equal(team.logo_url, null);
    assert.equal(team.domestic_league, "Pro League");
    assert.deepEqual(team.external_references, {});
    const m = (
      await db.query("select * from matches where away_team_id=$1", [team.id])
    ).rows[0];
    assert.equal(m.is_published, true);
    assert.equal(
      (
        await db.query(
          "select shots_on_target from match_team_stats where match_id=$1 and team_id=$2",
          [m.id, teams[0]],
        )
      ).rows[0].shots_on_target,
      0,
    );
  } finally {
    await db.close();
  }
});
test("Photo matching requires unambiguous internal identity and absent stats remain null", () => {
  const teams = [{ id: "1", name: "Club Bruges", slug: "bruges" }];
  assert.equal(
    clubCandidates("Aston Villa", [
      { id: "v", name: "Aston Villa FC", slug: "aston-villa-fc" },
    ])[0].id,
    "v",
  );
  assert.equal(
    clubCandidates("Benfica", [
      { id: "b", name: "SL Benfica", slug: "sl-benfica" },
    ])[0].id,
    "b",
  );
  assert.equal(clubCandidates("Club Brugge", teams)[0].id, "1");
  assert.equal(
    clubCandidates("Inter", [
      { id: "i", name: "Inter Milan" },
      { id: "j", name: "Internazionale" },
    ]).length,
    2,
  );
  const row = {
    proposed: {
      home_name: "Club Brugge",
      away_name: "Aston Villa",
      date: "2026-09-08T18:45",
      score: [2, 3],
      round: 1,
      competition: "champions-league",
      stats: { home: { shots: 14 }, away: { shots: 21 } },
    },
  };
  const d = initialPhotoDraft(row, {
    teams,
    competitions: [{ id: "cl", slug: "champions-league" }],
  });
  assert.equal(d.home_team_id, "1");
  assert.equal(d.away_stats.team_rating, null);
  assert.throws(() => photoReviewPayload(d), /Confirmez/);
  const p = photoReviewPayload({ ...d, identity_confirmed: true });
  assert.equal(p.kickoff, "2026-09-08T16:45:00.000Z");
  assert.equal(p.away_stats.corners, null);
  assert.equal(
    validateMatch(
      {
        ...p,
        season_id: "s",
        home_team_id: "h",
        away_team_id: "a",
        round: "1",
        status: "finished",
        home_stats: { passes_completed: 21, passes_attempted: 20 },
      },
      false,
    ).home_passes_completed?.length > 0,
    true,
  );
  assert.equal(
    Object.hasOwn(
      matchPayload({ home_stats: { shots: 0 }, away_stats: {} }, false)
        .home_stats,
      "corners",
    ),
    false,
  );
});
test("Prepared photo bundles are authenticated ciphertext; wrong code and modified data are rejected", async () => {
  const code = "private test code",
    salt = randomBytes(16),
    iv = randomBytes(12),
    api = webcrypto;
  const material = await api.subtle.importKey(
    "raw",
    new TextEncoder().encode(code),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await api.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const plain = JSON.stringify({
    format: "calcito-photos-v1",
    captures: [capture()],
  });
  const cipher = await api.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    gzipSync(plain),
  );
  const bundle = Buffer.concat([
    Buffer.from("CALCIPH1"),
    salt,
    iv,
    Buffer.from(cipher),
  ]);
  assert.equal((await openPhotoBundle(bundle, code, api)).length, 1);
  await assert.rejects(openPhotoBundle(bundle, "bad", api), /Code incorrect/);
  bundle[40] ^= 1;
  await assert.rejects(openPhotoBundle(bundle, code, api), /endommagé/);
});
