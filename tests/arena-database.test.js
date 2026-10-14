import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
async function setup() {
  const db = new PGlite();
  const admin = randomUUID(),
    player = randomUUID(),
    other = randomUUID();
  await db.exec(
    `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);grant usage on schema auth to anon,authenticated;create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;insert into auth.users values('${admin}'),('${player}'),('${other}');`,
  );
  for (const f of [
    "001_manual_platform.sql",
    "002_simplified_results.sql",
    "003_arena.sql",
  ])
    await db.exec(
      await readFile(
        new URL("../supabase/migrations/" + f, import.meta.url),
        "utf8",
      ),
    );
  await db.exec(
    `insert into admin_users(user_id)values('${admin}');update competitions set is_published=true;`,
  );
  const comp = (
    await db.query("select id from competitions where slug='ligue-1'")
  ).rows[0].id;
  const season = (
    await db.query(
      "insert into seasons(competition_id,label,start_year,end_year,is_published)values($1,'2026–2027',2026,2027,true)returning id",
      [comp],
    )
  ).rows[0].id;
  const teams = [];
  for (let i = 0; i < 4; i++) {
    const id = randomUUID();
    teams.push(id);
    await db.query(
      "insert into teams(id,name,short,slug,country,is_published)values($1,$2,'T',$3,'France',true)",
      [id, "Club " + i, "club-" + i],
    );
    await db.query("insert into season_teams(season_id,team_id)values($1,$2)", [
      season,
      id,
    ]);
  }
  const match = (
    await db.query(
      "insert into matches(season_id,round,kickoff,home_team_id,away_team_id,status,is_published,source,verified_at)values($1,'J1',now()+interval '3 days',$2,$3,'scheduled',true,'Source vérifiée',now())returning *",
      [season, teams[0], teams[1]],
    )
  ).rows[0];
  const stamp = (
    await db.query(
      "update arena_model set enabled=true,trained_at=now()-interval '1 minute' returning trained_at",
    )
  ).rows[0].trained_at;
  const quote = (
    await db.query(
      "insert into arena_quotes(creator,match_id,market,forecast,probability,odds,model_version,model_at,match_revision,kickoff,expires_at)values($1,$2,'home','{\"home\":0.5,\"draw\":0.25,\"away\":0.25}',.5,2,'poisson-goals-v1',$3,$4,$5,now()+interval '10 minutes')returning id",
      [player, match.id, stamp, match.updated_at, match.kickoff],
    )
  ).rows[0].id;
  const as = async (id) => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec("set role authenticated");
  };
  return { db, admin, player, other, match, quote, as, teams, season, stamp };
}
const rpc = async (db, name, args = []) =>
  (
    await db.query(
      `select ${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) as result`,
      args,
    )
  ).rows[0].result;
test("virtual wallet operations enforce exact 5% floor, ownership, nonce idempotence, available/reserved separation and private helpers", async () => {
  const { db, player, other, quote, as } = await setup();
  try {
    await as(player);
    const initial = await rpc(db, "arena_account");
    assert.equal(initial.wallet.available, 20000);
    assert.equal(initial.limit, 1000);
    assert.equal((await rpc(db, "arena_account")).wallet.available, 20000);
    await assert.rejects(
      () => db.exec("update arena_wallets set available=999999"),
      /permission denied/,
    );
    await assert.rejects(
      () => rpc(db, "_arena_adjust", [player, 100000]),
      /permission denied/,
    );
    await assert.rejects(() =>
      rpc(db, "arena_place_ticket", [
        [quote],
        1001,
        "challenge",
        null,
        randomUUID(),
      ]),
    );
    const nonce = randomUUID();
    const ticket = await rpc(db, "arena_place_ticket", [
      [quote],
      1000,
      "challenge",
      null,
      nonce,
    ]);
    assert.equal(ticket.accepted, true);
    const w = await rpc(db, "arena_account");
    assert.equal(w.wallet.available, 19000);
    assert.equal(w.wallet.reserved, 1000);
    assert.equal(w.limit, 950);
    assert.equal(
      (
        await rpc(db, "arena_place_ticket", [
          [quote],
          1000,
          "challenge",
          null,
          nonce,
        ])
      ).ticket.id,
      ticket.ticket.id,
    );
    await assert.rejects(() =>
      rpc(db, "arena_place_ticket", [[quote], 950, "challenge", null, nonce]),
    );
    await as(other);
    assert.equal((await db.query("select *from arena_wallets")).rows.length, 0);
    await assert.rejects(() =>
      rpc(db, "arena_place_ticket", [
        [quote],
        100,
        "challenge",
        null,
        randomUUID(),
      ]),
    );
    await db.exec("reset role");
    for (const [c, limit] of [
      [5000, 250],
      [5001, 250],
      [10000, 500],
      [15000, 750],
      [50000, 1000],
    ])
      assert.equal(
        (await db.query("select _arena_limit($1) as n", [c])).rows[0].n,
        limit,
      );
  } finally {
    await db.close();
  }
});
test("settlement is atomic/idempotent, corrections reverse credits safely, and missions cannot be farmed or bypassed with missing answers", async () => {
  const { db, player, match, quote, as } = await setup();
  try {
    await as(player);
    const ticket = await rpc(db, "arena_place_ticket", [
      [quote],
      500,
      "challenge",
      null,
      randomUUID(),
    ]);
    await db.exec("reset role");
    await db.exec(
      "update arena_tickets set created_at=now()-interval '1 minute'",
    );
    await db.query(
      "update matches set kickoff=now()-interval '10 seconds',status='finished',goals_home=2,goals_away=0,verified_at=now()where id=$1",
      [match.id],
    );
    let w = (
      await db.query("select *from arena_wallets where user_id=$1", [player])
    ).rows[0];
    assert.equal(w.available, 20500);
    assert.equal(w.reserved, 0);
    assert.equal(w.xp, 500);
    await db.query("select _arena_settle($1)", [ticket.ticket.id]);
    assert.equal(
      (
        await db.query("select available from arena_wallets where user_id=$1", [
          player,
        ])
      ).rows[0].available,
      20500,
    );
    await db.query(
      "update matches set goals_home=0,goals_away=2,verified_at=now()where id=$1",
      [match.id],
    );
    w = (
      await db.query("select *from arena_wallets where user_id=$1", [player])
    ).rows[0];
    assert.equal(w.available, 19500);
    assert.equal(w.xp, 0);
    await as(player);
    await assert.rejects(() =>
      rpc(db, "arena_claim_mission", ["daily_coach", { x: 1 }]),
    );
    assert.equal(
      (await rpc(db, "arena_claim_mission", ["daily_coach", { risk: "limit" }]))
        .reward,
      200,
    );
    assert.equal(
      (await rpc(db, "arena_claim_mission", ["daily_coach", { risk: "limit" }]))
        .claimed,
      false,
    );
    assert.equal((await rpc(db, "arena_account")).wallet.available, 19700);
  } finally {
    await db.close();
  }
});
test("bookmaker acceptance is based on EV and bounded liability; rejected offers cost nothing; repeated settlement cannot double-credit", async () => {
  const { db, player, match, quote, as } = await setup();
  try {
    await as(player);
    await rpc(db, "arena_account");
    const reject = await rpc(db, "arena_place_ticket", [
      [quote],
      100,
      "bookmaker",
      1.5,
      randomUUID(),
    ]);
    assert.equal(reject.accepted, false);
    assert.equal((await rpc(db, "arena_account")).wallet.available, 20000);
    const t = await rpc(db, "arena_place_ticket", [
      [quote],
      100,
      "bookmaker",
      2.2,
      randomUUID(),
    ]);
    assert.equal(t.ticket.user_risk, 120);
    assert.equal(t.ticket.bot_risk, 100);
    await db.exec("reset role");
    await db.exec(
      "update arena_tickets set created_at=now()-interval '1 minute'",
    );
    await db.query(
      "update matches set kickoff=now()-interval '10 seconds',status='finished',goals_home=0,goals_away=2,verified_at=now()where id=$1",
      [match.id],
    );
    assert.equal(
      (
        await db.query("select available from arena_wallets where user_id=$1", [
          player,
        ])
      ).rows[0].available,
      20100,
    );
    await db.query("select _arena_settle($1)", [t.ticket.id]);
    assert.equal(
      (
        await db.query("select available from arena_wallets where user_id=$1", [
          player,
        ])
      ).rows[0].available,
      20100,
    );
  } finally {
    await db.close();
  }
});

test("expired quotes, same-match combinations, private parents and kickoff changes cannot reserve funds", async () => {
  const { db, player, quote, match, as } = await setup();
  try {
    await as(player);
    await rpc(db, "arena_account");
    await assert.rejects(
      () =>
        rpc(db, "arena_place_ticket", [
          [quote, quote],
          100,
          "challenge",
          null,
          randomUUID(),
        ]),
      /corrélées/,
    );
    await db.exec("reset role");
    await db.query(
      "update arena_quotes set expires_at=now()-interval '1 second' where id=$1",
      [quote],
    );
    await as(player);
    await assert.rejects(
      () =>
        rpc(db, "arena_place_ticket", [
          [quote],
          100,
          "challenge",
          null,
          randomUUID(),
        ]),
      /expirée/,
    );
    await db.exec("reset role");
    await db.query(
      "update arena_quotes set expires_at=now()+interval '10 minutes' where id=$1",
      [quote],
    );
    await db.query("update teams set is_published=false where id=$1", [
      match.home_team_id,
    ]);
    await as(player);
    await assert.rejects(
      () =>
        rpc(db, "arena_place_ticket", [
          [quote],
          100,
          "challenge",
          null,
          randomUUID(),
        ]),
      /Modèle non validé|non publiés/,
    );
    await db.exec("reset role");
    await db.query("update teams set is_published=true where id=$1", [
      match.home_team_id,
    ]);
    await db.exec("update arena_model set enabled=true");
    await db.query(
      "update matches set kickoff=now()-interval '1 second' where id=$1",
      [match.id],
    );
    await as(player);
    await assert.rejects(
      () =>
        rpc(db, "arena_place_ticket", [
          [quote],
          100,
          "challenge",
          null,
          randomUUID(),
        ]),
      /verrouillée/,
    );
    assert.equal((await rpc(db, "arena_account")).wallet.available, 20000);
    assert.equal((await rpc(db, "arena_account")).wallet.reserved, 0);
    await assert.rejects(() => rpc(db, "arena_calibrate"), /Administration/);
    await assert.rejects(() => rpc(db, "arena_admin_log"), /Administration/);
  } finally {
    await db.close();
  }
});

test("cancelled combination legs stay neutralized after rescheduling; only an audited owner correction reopens them", async () => {
  const { db, admin, player, other, match, quote, as, teams, season, stamp } =
    await setup();
  try {
    const next = (
      await db.query(
        "insert into matches(season_id,round,kickoff,home_team_id,away_team_id,status,is_published,source,verified_at)values($1,'J2',now()+interval '4 days',$2,$3,'scheduled',true,'Verified calendar',now())returning *",
        [season, teams[2], teams[3]],
      )
    ).rows[0];
    const q = (
      await db.query(
        "insert into arena_quotes(creator,match_id,market,forecast,probability,odds,model_version,model_at,match_revision,kickoff,expires_at)values($1,$2,'home','{\"home\":0.5,\"draw\":0.25,\"away\":0.25}',.5,2,'poisson-goals-v1',$3,$4,$5,now()+interval '10 minutes')returning id",
        [player, next.id, stamp, next.updated_at, next.kickoff],
      )
    ).rows[0].id;
    await as(player);
    const t = await rpc(db, "arena_place_ticket", [
      [quote, q],
      100,
      "challenge",
      null,
      randomUUID(),
    ]);
    assert.equal(t.ticket.odds, 4);
    await db.exec("reset role");
    await db.query("update matches set status='cancelled'where id=$1", [
      match.id,
    ]);
    await db.exec(
      "update arena_tickets set created_at=now()-interval '1 minute'",
    );
    await db.query(
      "update matches set status='finished',kickoff=now()-interval '10 seconds',goals_home=2,goals_away=1 where id=$1",
      [next.id],
    );
    await as(player);
    let a = await rpc(db, "arena_account");
    assert.equal(a.wallet.available, 20100);
    assert.equal(a.wallet.reserved, 0);
    assert.equal(a.wallet.xp, 100);
    assert.equal(a.tickets[0].legs.filter((l) => l.voided).length, 1);
    await db.exec("reset role");
    await db.query(
      "update matches set status='finished',kickoff=now()-interval '10 seconds',goals_home=3,goals_away=0 where id=$1",
      [match.id],
    );
    await as(player);
    assert.equal((await rpc(db, "arena_account")).wallet.available, 20100);
    await assert.rejects(
      () =>
        rpc(db, "arena_correct_void", [
          match.id,
          "Correction confirmée du report",
        ]),
      /Administration/,
    );
    await as(admin);
    assert.equal(
      (
        await rpc(db, "arena_correct_void", [
          match.id,
          "Correction confirmée du report",
        ])
      ).recomputed,
      1,
    );
    assert.equal((await rpc(db, "arena_admin_log")).length, 1);
    await as(player);
    a = await rpc(db, "arena_account");
    assert.equal(a.wallet.available, 20300);
    assert.equal(a.wallet.xp, 300);
    assert.equal((await rpc(db, "arena_export")).tickets.length, 1);
    await as(other);
    assert.equal((await rpc(db, "arena_export")).tickets.length, 0);
  } finally {
    await db.close();
  }
});

test("official score corrections after spending gains create a bounded adjustment and free missions repay it without negative balances", async () => {
  const { db, player, match, quote, as } = await setup();
  try {
    await as(player);
    await rpc(db, "arena_place_ticket", [
      [quote],
      500,
      "challenge",
      null,
      randomUUID(),
    ]);
    await db.exec("reset role");
    await db.exec(
      "update arena_tickets set created_at=now()-interval '1 minute'",
    );
    await db.query(
      "update matches set kickoff=now()-interval '10 seconds',status='finished',goals_home=2,goals_away=0 where id=$1",
      [match.id],
    );
    // Simulates available credits having been consumed by later operations, without exposing this privileged operation in the application.
    await db.query("update arena_wallets set available=0 where user_id=$1", [
      player,
    ]);
    await db.query("update matches set goals_home=0,goals_away=2 where id=$1", [
      match.id,
    ]);
    await as(player);
    let a = await rpc(db, "arena_account");
    assert.equal(a.wallet.available, 0);
    assert.equal(a.wallet.debt, 1000);
    assert.equal(a.limit, 0);
    assert.equal(a.wallet.xp, 0);
    await assert.rejects(
      () => rpc(db, "arena_claim_mission", ["daily_coach", null]),
      /incorrecte/,
    );
    await rpc(db, "arena_claim_mission", ["daily_coach", { risk: "limit" }]);
    a = await rpc(db, "arena_account");
    assert.equal(a.wallet.debt, 800);
    assert.equal(a.wallet.available, 0);
    await rpc(db, "arena_claim_mission", [
      "form_discovery",
      { form: "not_probability" },
    ]);
    a = await rpc(db, "arena_account");
    assert.equal(a.wallet.debt, 0);
    assert.equal(a.wallet.available, 200);
    assert.equal(a.limit, 10);
  } finally {
    await db.close();
  }
});

test("probabilistic model uses strictly prior public verified results, normalizes 1/N/2, rejects insufficient calibration and gates unsupported markets", async () => {
  const { db, admin, player, match, teams, season, as } = await setup();
  try {
    await as(admin);
    assert.equal((await rpc(db, "arena_calibrate")).enabled, false);
    await db.exec("reset role");
    const dates = [];
    for (let day = 1; day <= 45; day++) {
      const at = new Date(Date.UTC(2026, 7, day, 18)).toISOString();
      dates.push(at);
      await db.query(
        "insert into matches(season_id,round,kickoff,home_team_id,away_team_id,status,goals_home,goals_away,is_published,source,verified_at)values($1,$2,$3,$4,$5,'finished',2,1,true,'Test fixture only',now())",
        [season, "H" + day, at, teams[0], teams[1]],
      );
    }
    const p = (
      await db.query("select _arena_probs($1,.5,now()) as p", [match.id])
    ).rows[0].p;
    assert.ok(Math.abs(p.home + p.draw + p.away - 1) < 1e-10);
    assert.ok(Math.abs(p.over_2_5 + p.under_2_5 - 1) < 1e-10);
    assert.ok(p.home > p.away);
    const cutoff = "2026-09-15T12:00:00Z";
    const before = (
      await db.query("select _arena_probs($1,.5,$2) as p", [match.id, cutoff])
    ).rows[0].p;
    await db.query(
      "insert into matches(season_id,round,kickoff,home_team_id,away_team_id,status,goals_home,goals_away,is_published,source,verified_at)values($1,'Later', '2026-09-15T08:00:00Z',$2,$3,'finished',15,0,true,'Test',now())",
      [season, teams[0], teams[1]],
    );
    assert.deepEqual(
      (await db.query("select _arena_probs($1,.5,$2) as p", [match.id, cutoff]))
        .rows[0].p,
      before,
      "same-day scores must never leak into the pre-match forecast",
    );
    await db.query(
      'update arena_model set enabled=true,trained_at=now(),report=\'{"markets":["home","draw","away"]}\'',
    );
    await as(player);
    const quoted = await rpc(db, "arena_quote", [match.id]);
    assert.equal(quoted.quotes.length, 3);
    assert.ok(
      quoted.quotes.every((q) => ["home", "draw", "away"].includes(q.market)),
    );
    await db.exec("reset role");
    await db.query("update teams set is_published=false where id=$1", [
      teams[1],
    ]);
    assert.equal(
      (await db.query("select _arena_probs($1,.5,now()) as p", [match.id]))
        .rows[0].p,
      null,
    );
  } finally {
    await db.close();
  }
});

test("calibration executes the complete chronological training and held-out market validation without using future fixtures", async () => {
  const { db, admin, teams, season, as } = await setup();
  try {
    // Synthetic games only inside an ephemeral database; never production data or a claim of real-world accuracy.
    await db.query(
      "insert into matches(season_id,round,kickoff,home_team_id,away_team_id,status,goals_home,goals_away,is_published,source,verified_at)select $1,'Synthetic '||i,date_trunc('day',now())-(280-i)*interval '1 day',$2,$3,'finished',2,1,true,'Isolated test',now()from generate_series(1,250)i",
      [season, teams[0], teams[1]],
    );
    await as(admin);
    const report = await rpc(db, "arena_calibrate");
    assert.equal(report.training, 140);
    assert.equal(report.validation, 80);
    assert.equal(report.enabled, true);
    assert.ok(report.logLoss < report.baselineLogLoss);
    assert.ok(report.brier < report.baselineBrier);
    assert.ok(report.markets.includes("home"));
    assert.ok(
      !report.markets.includes("over_2_5"),
      "a derived market must beat its own held-out binary baseline",
    );
  } finally {
    await db.close();
  }
});

test("existing owner save_match keeps its atomic permission and version checks while future official results are rejected", async () => {
  const { db, admin, player, as, season, teams } = await setup();
  try {
    const id = randomUUID(),
      payload = {
        id,
        season_id: season,
        round: "Next matchday",
        kickoff: new Date(Date.now() + 86400000 * 5).toISOString(),
        home_team_id: teams[0],
        away_team_id: teams[2],
        status: "scheduled",
        goals_home: null,
        goals_away: null,
        is_published: true,
        verified_at: new Date().toISOString(),
        source: "Verified calendar",
        home_stats: {},
        away_stats: {},
      };
    await as(player);
    await assert.rejects(() => rpc(db, "arena_match_guard"), /Administration/);
    await assert.rejects(
      () => rpc(db, "save_match", [payload]),
      /Administration/,
    );
    await as(admin);
    assert.equal(await rpc(db, "save_match", [payload]), id);
    const old = (await db.query("select *from matches where id=$1", [id]))
      .rows[0];
    await assert.rejects(
      () => rpc(db, "save_match", [{ ...payload, round: "Different round" }]),
      /changé/,
    );
    await assert.rejects(
      () =>
        rpc(db, "save_match", [
          {
            ...payload,
            expected_updated_at: old.updated_at,
            status: "finished",
            goals_home: 3,
            goals_away: 1,
          },
        ]),
      /coup d’envoi/,
    );
    assert.equal(
      (await db.query("select status from matches where id=$1", [id])).rows[0]
        .status,
      "scheduled",
    );
    assert.equal(
      (await db.query("select *from match_team_stats where match_id=$1", [id]))
        .rows.length,
      2,
    );
  } finally {
    await db.close();
  }
});
