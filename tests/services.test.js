import test from "node:test";
import assert from "node:assert/strict";
import {
  createFootballService,
  createProxyAdapter,
  demoAdapter,
} from "../src/services/footballService.js";
import { createApiFootballProvider } from "../server/apiFootball.js";
import { createFootballServer } from "../server/index.js";

const source = { name: "Test provider", url: "https://example.org" };
const fetchedAt = "2030-01-01T00:00:00Z";
test("cache deduplicates requests, expires and retries failures", async () => {
  let count = 0,
    time = 0;
  const service = createFootballService(
    {
      mode: "real",
      teams: async () => {
        count++;
        return { data: [] };
      },
    },
    { ttl: 10, now: () => time },
  );
  await Promise.all([service.get("teams"), service.get("teams")]);
  assert.equal(count, 1);
  time = 11;
  await service.get("teams");
  assert.equal(count, 2);
  service.clearCache();
  await service.get("teams");
  assert.equal(count, 3);
  let tries = 0;
  const flaky = createFootballService({
    teams: () => {
      if (++tries === 1) throw new Error("temporary");
      return [];
    },
  });
  await assert.rejects(flaky.get("teams"));
  await flaky.get("teams");
  assert.equal(tries, 2);
});
test("configured proxy does not accept credentials or manufacture real form scores", async () => {
  assert.throws(() => createProxyAdapter("https://key@example.org"));
  assert.throws(() => createProxyAdapter("https://example.org?key=secret"));
  const adapter = createProxyAdapter("https://example.org/api", {
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        source,
        fetchedAt,
        data: [
          { id: "1", name: "Club", score: 99, logo: "javascript:alert(1)" },
        ],
      }),
    }),
  });
  const result = await adapter.teams({ search: "club" });
  assert.equal(result.mode, "real");
  assert.equal(result.data[0].score, null);
  assert.equal(result.data[0].logo, null);
});
test("invalid provider responses and quota errors are explicit", async () => {
  const invalid = createProxyAdapter("https://example.org", {
    fetchImpl: async () => ({ ok: true, json: async () => ({ data: [] }) }),
  });
  await assert.rejects(invalid.teams({}), /Source ou date/);
  const throttled = createProxyAdapter("https://example.org", {
    fetchImpl: async () => ({ ok: false, status: 429 }),
  });
  await assert.rejects(throttled.teams({}), /Limite/);
});
test("demo mode never supplies an official standings table or invented match statistics", async () => {
  await assert.rejects(demoAdapter.standings(), /Aucun classement officiel/);
  assert.equal((await demoAdapter.statistics("riviera")).data, null);
  assert.deepEqual((await demoAdapter.recentMatches("riviera")).data, []);
});
test("API-Football requires a server key and redacts provider error contents", async () => {
  await assert.rejects(
    createApiFootballProvider({ apiKey: "" }).competitions(),
    /non configurée/,
  );
  const provider = createApiFootballProvider({
    apiKey: "test-only",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        errors: { token: "sensitive provider error" },
        response: [],
      }),
    }),
  });
  await assert.rejects(
    provider.competitions(),
    (error) => !error.message.includes("sensitive"),
  );
});
test("API-Football preserves missing advanced statistics instead of guessing", async () => {
  const rawFixture = {
    fixture: { id: 1, date: fetchedAt, status: { short: "FT" } },
    teams: { home: { id: 1, name: "A" }, away: { id: 2, name: "B" } },
    league: { id: 61, name: "League" },
    goals: { home: 2, away: 0 },
  };
  const provider = createApiFootballProvider({
    apiKey: "test-only",
    fetchImpl: async (url) => ({
      ok: true,
      json: async () => ({
        errors: [],
        response: url.pathname.endsWith("/statistics")
          ? [
              {
                team: { id: 1 },
                statistics: [{ type: "Total Shots", value: 8 }],
              },
            ]
          : [rawFixture],
      }),
    }),
  });
  const data = await provider.recentMatches("1", { includeStatistics: true });
  assert.equal(data[0].teamStats.shots, 8);
  assert.equal(data[0].teamStats.bigChances, null);
  assert.equal(data[0].teamStats.rating, null);
  assert.equal(data[0].teamStats.bonuses, null);
});
test("backend exposes readiness without a key, refuses unknown origins and does not proxy arbitrary URLs", async () => {
  const server = createFootballServer({ apiKey: "" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.deepEqual(await (await fetch(`${base}/health`)).json(), {
      status: "ok",
      configured: false,
      version: "2.1.0",
    });
    assert.equal((await fetch(`${base}/competitions`)).status, 503);
    assert.equal(
      (
        await fetch(`${base}/teams`, {
          headers: { Origin: "https://untrusted.example" },
        })
      ).status,
      403,
    );
    assert.equal(
      (await fetch(`${base}/proxy?url=https://example.org`)).status,
      400,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("free-plan standings use only a provider-confirmed accessible season and retain every group", async () => {
  const requested = [];
  const provider = createApiFootballProvider({
    apiKey: "test-only",
    fetchImpl: async (url) => {
      requested.push(url.href);
      let response;
      if (url.pathname === "/leagues")
        response = [
          {
            league: { id: 61, name: "Test League" },
            seasons: [
              { year: 2026, current: true },
              { year: 2024, current: false },
            ],
          },
        ];
      else if (url.searchParams.get("season") === "2026")
        return {
          ok: true,
          json: async () => ({
            errors: {
              plan: "Free plans do not have access to this season, try from 2022 to 2024.",
            },
            response: [],
          }),
        };
      else
        response = [
          {
            league: {
              standings: [
                [
                  {
                    rank: 1,
                    team: { id: 1, name: "A" },
                    group: "Groupe A",
                    all: {
                      played: 5,
                      win: 3,
                      draw: 1,
                      lose: 1,
                      goals: { for: 9, against: 4 },
                    },
                    points: 10,
                  },
                ],
                [
                  {
                    rank: 1,
                    team: { id: 2, name: "B" },
                    group: "Groupe B",
                    all: { played: 5 },
                    points: 8,
                  },
                ],
              ],
            },
          },
        ];
      return { ok: true, json: async () => ({ errors: [], response }) };
    },
  });
  const rows = await provider.standings({ competition: "61" });
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.group),
    ["Groupe A", "Groupe B"],
  );
  assert.ok(rows.every((row) => row.season === 2024));
  assert.equal(rows[0].points, 10);
  assert.equal(rows[1].won, null);
  assert.equal(requested.filter((url) => url.includes("/standings")).length, 2);
  await assert.rejects(
    provider.standings({ competition: "61", season: "2026" }),
    (error) => error.code === "SEASON_ACCESS",
  );
});
test("quota and authentication failures never trigger historical-season guesses", async () => {
  let standingCalls = 0;
  const provider = createApiFootballProvider({
    apiKey: "test-only",
    fetchImpl: async (url) => {
      if (url.pathname === "/leagues")
        return {
          ok: true,
          json: async () => ({
            errors: [],
            response: [
              { league: { id: 61 }, seasons: [{ year: 2026, current: true }] },
            ],
          }),
        };
      standingCalls++;
      return { ok: false, status: 429 };
    },
  });
  await assert.rejects(provider.standings("61"), /Quota/);
  assert.equal(standingCalls, 1);
});
test("basic recent results do not consume advanced-statistics API requests", async () => {
  const calls = [];
  const provider = createApiFootballProvider({
    apiKey: "test-only",
    fetchImpl: async (url) => {
      calls.push(url.pathname);
      return {
        ok: true,
        json: async () => ({
          errors: [],
          response: [
            {
              fixture: { id: 1, date: fetchedAt, status: { short: "FT" } },
              teams: { home: { id: 1, name: "A" }, away: { id: 2, name: "B" } },
              league: { id: 61, name: "League" },
              goals: { home: 2, away: 0 },
            },
          ],
        }),
      };
    },
  });
  const rows = await provider.recentMatches("1");
  assert.equal(rows[0].goalsHome, 2);
  assert.equal(rows[0].teamStats.shots, null);
  assert.deepEqual(calls, ["/fixtures"]);
});
