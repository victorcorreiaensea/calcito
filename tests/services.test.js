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
  const data = await provider.recentMatches("1");
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
