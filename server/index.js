import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createApiFootballProvider } from "./apiFootball.js";

export function createFootballServer({
  apiKey = process.env.API_FOOTBALL_KEY,
  allowedOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:5173",
  provider = createApiFootballProvider({ apiKey }),
} = {}) {
  const clients = new Map();
  return createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Vary", "Origin");
    if (req.headers.origin && req.headers.origin !== allowedOrigin) {
      res.writeHead(403);
      res.end(JSON.stringify({ error: "Origine non autorisée." }));
      return;
    }
    if (req.headers.origin === allowedOrigin)
      res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET");
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method !== "GET") {
      res.writeHead(405);
      res.end(JSON.stringify({ error: "Méthode non autorisée." }));
      return;
    }
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/health") {
      res.end(
        JSON.stringify({
          status: "ok",
          configured: Boolean(apiKey),
          version: "2.1.0",
        }),
      );
      return;
    }
    const client = req.socket.remoteAddress;
    const bucket = clients.get(client);
    const now = Date.now();
    if (bucket && now - bucket.startedAt < 60000 && bucket.count >= 30) {
      res.setHeader("Retry-After", "60");
      res.writeHead(429);
      res.end(
        JSON.stringify({
          error: "Trop de requêtes. Réessayez dans une minute.",
        }),
      );
      return;
    }
    clients.set(
      client,
      bucket && now - bucket.startedAt < 60000
        ? { ...bucket, count: bucket.count + 1 }
        : { startedAt: now, count: 1 },
    );
    if (clients.size > 10000) clients.delete(clients.keys().next().value);
    try {
      const params = Object.fromEntries(url.searchParams);
      if (
        Object.keys(params).some(
          (key) =>
            ![
              "search",
              "competition",
              "status",
              "limit",
              "view",
              "season",
            ].includes(key),
        )
      ) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Paramètre non autorisé." }));
        return;
      }
      if (params.search && params.search.length > 100) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Recherche trop longue." }));
        return;
      }
      let data;
      const match = url.pathname.match(
        /^\/teams\/(\d{1,10})(?:\/(matches|statistics))?$/,
      );
      if (url.pathname === "/competitions")
        data = await provider.competitions();
      else if (url.pathname === "/teams") data = await provider.teams(params);
      else if (url.pathname === "/matches")
        data = await provider.matches(params);
      else if (url.pathname === "/standings")
        data = await provider.standings({
          competition: params.competition || "",
          season: params.season,
        });
      else if (match)
        data = await provider[
          match[2] === "matches"
            ? "recentMatches"
            : match[2] === "statistics"
              ? "statistics"
              : "team"
        ](match[1]);
      else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: "Route inconnue." }));
        return;
      }
      res.end(
        JSON.stringify({
          data,
          source: {
            name: "API-Football / API-Sports",
            url: "https://www.api-football.com/",
          },
          fetchedAt: new Date().toISOString(),
        }),
      );
    } catch (error) {
      res.writeHead(error.status || 502);
      res.end(
        JSON.stringify({
          error: error.status
            ? error.message
            : "Données football indisponibles.",
        }),
      );
    }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createFootballServer();
  const port = Number(process.env.PORT || 8787);
  server.listen(port, "0.0.0.0", () =>
    console.log(
      `Backend Calcito démarré sur le port ${port}. API-Football ${process.env.API_FOOTBALL_KEY ? "configurée" : "non configurée"}.`,
    ),
  );
}
