import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  Coins,
  ShieldCheck,
  Sparkles,
  Trophy,
  X,
  RefreshCw,
} from "lucide-react";
import { useAuth } from "../admin/AuthProvider";
import { supabase } from "../services/supabaseClient";
import { useFootball } from "../hooks/useFootball";
import {
  arenaStatus,
  arenaAccount,
  arenaQuote,
  arenaTicket,
  arenaMission,
  arenaExport,
} from "../services/arenaRepository";
import {
  arenaMarkets,
  formatCoins,
  parseCoins,
  levelFor,
  levels,
  missions,
  ticketNumbers,
} from "../domain/arena";
import CalcitoMascot from "../components/CalcitoMascot";
import Calcithune from "../components/Calcithune";
import { TeamBadge, Notice } from "../components/FootballUI";
const coachLessons = [
  [
    "La bankroll",
    "C’est ton solde disponible. Les engagements déjà réservés n’en font plus partie.",
  ],
  [
    "La cote",
    "Gain brut = mise × cote. Le bénéfice net est le gain brut moins la mise.",
  ],
  [
    "L’incertitude",
    "Une probabilité est une estimation. Même un favori peut perdre.",
  ],
  [
    "Les combinés",
    "Chaque sélection ajoute une condition : toutes doivent réussir. Le produit des probabilités reste une approximation.",
  ],
  [
    "La limite du jeu",
    "5 % du disponible, au maximum 10 C par ticket. Cette limite ne garantit aucun gain.",
  ],
  [
    "Après une perte",
    "Une nouvelle mise ne répare pas une ancienne perte. Les missions gratuites permettent de continuer à apprendre.",
  ],
];
export default function Arena() {
  const auth = useAuth(),
    data = useFootball("dataset");
  const [status, setStatus] = useState(null),
    [account, setAccount] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [mode, setMode] = useState("challenge"),
    [basket, setBasket] = useState([]),
    [stake, setStake] = useState(""),
    [offer, setOffer] = useState(""),
    [notice, setNotice] = useState(""),
    [reaction, setReaction] = useState(""),
    [uncertain, setUncertain] = useState(false),
    [fixtureCompetition, setFixtureCompetition] = useState(""),
    [fixturePage, setFixturePage] = useState(0),
    [tab, setTab] = useState("play");
  const request = useRef(null),
    lock = useRef(false),
    generation = useRef(0);
  const load = useCallback(async () => {
    const g = ++generation.current;
    setError("");
    try {
      const s = await arenaStatus();
      if (g !== generation.current) return;
      setStatus(s);
      if (auth.user) {
        const a = await arenaAccount();
        if (g === generation.current) setAccount(a);
      } else setAccount(null);
    } catch (e) {
      if (g !== generation.current) return;
      if (["PGRST202", "42P01", "PGRST205"].includes(e.code)) {
        setStatus({ installed: false });
        setAccount(null);
      } else
        setError(
          "Connexion à l’Arène impossible. Réessaie sans valider un nouveau ticket.",
        );
    }
  }, [auth.user?.id]);
  useEffect(() => {
    setAccount(null);
    setBasket([]);
    setNotice("");
    setReaction("");
    setStake("");
    setOffer("");
    request.current = null;
    try {
      const value = JSON.parse(
        sessionStorage.getItem(`calcito:arena-pending:${auth.user?.id}`) ||
          "null",
      );
      if (
        value?.nonce &&
        Array.isArray(value.ids) &&
        value.ids.length <= 10 &&
        Number.isInteger(value.amount)
      )
        request.current = value;
    } catch {
      /* Optional recovery intent, never a balance or confirmed ticket. */
    }
    setUncertain(Boolean(request.current));
    load();
    return () => {
      generation.current++;
    };
  }, [load]);
  function clearRequest() {
    request.current = null;
    try {
      sessionStorage.removeItem(`calcito:arena-pending:${auth.user?.id}`);
    } catch {
      /* Recovery storage is optional. */
    }
  }
  const d = data.result?.data;
  const fixtures = (d?.matches || [])
    .filter(
      (m) =>
        m.is_published &&
        (!fixtureCompetition ||
          d.seasons.find((s) => s.id === m.season_id)?.competition_id ===
            fixtureCompetition) &&
        m.status === "scheduled" &&
        Date.parse(m.kickoff) > Date.now(),
    )
    .sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
  const fixturePages = Math.max(1, Math.ceil(fixtures.length / 30)),
    visiblePage = Math.min(fixturePage, fixturePages - 1);
  const playerLimit = Number(account?.limit || 0),
    botLimit = Number(status?.botLimit || 0),
    amount = parseCoins(stake),
    math = basket.length
      ? ticketNumbers(basket, amount || 0, mode, offer)
      : null;
  const canSubmit =
    account &&
    status?.enabled &&
    basket.length > 0 &&
    basket.length <= 10 &&
    amount > 0 &&
    amount <= 1000 &&
    math &&
    math.userRisk >= 1 &&
    math.botRisk >= 1 &&
    math.odds <= 1000000 &&
    math.userRisk <= playerLimit &&
    math.botRisk <= botLimit &&
    (mode !== "bookmaker" ||
      (basket.length === 1 && math.odds >= 1.01 && math.odds <= 1000));
  const level = levelFor(Number(account?.wallet.xp || 0)),
    next = levels.find((l) => l.xp > Number(account?.wallet.xp || 0));
  function add(q, m) {
    if (uncertain) return;
    setReaction("");
    setNotice("");
    request.current = null;
    if (mode === "bookmaker") {
      setBasket([{ ...q, match: m }]);
      return;
    }
    if (basket.length >= 10) {
      setNotice("Dix sélections maximum.");
      return;
    }
    if (
      basket.some(
        (l) =>
          l.match_id === q.match_id ||
          [l.match.home_team_id, l.match.away_team_id].some((id) =>
            [m.home_team_id, m.away_team_id].includes(id),
          ),
      )
    ) {
      setNotice(
        "Une seule sélection par rencontre, avec des équipes distinctes.",
      );
      return;
    }
    setBasket((b) => [...b, { ...q, match: m }]);
  }
  async function submit() {
    if (lock.current || (!request.current && !canSubmit)) return;
    lock.current = true;
    setBusy(true);
    setNotice("");
    const payload = request.current || {
      ids: basket.map((l) => l.id),
      amount,
      mode,
      odds: mode === "bookmaker" ? offer.replace(",", ".") : null,
      nonce: crypto.randomUUID(),
    };
    request.current = payload;
    try {
      sessionStorage.setItem(
        `calcito:arena-pending:${auth.user.id}`,
        JSON.stringify(payload),
      );
    } catch {
      /* The server nonce still protects retries in this tab. */
    }
    try {
      const r = await arenaTicket(
        payload.ids,
        payload.amount,
        payload.mode,
        payload.odds,
        payload.nonce,
      );
      setNotice(
        r.accepted
          ? "Ticket enregistré : les engagements sont maintenant réservés."
          : r.reason,
      );
      setReaction(
        r.accepted
          ? "Marché conclu. Les engagements sont réservés."
          : "Non merci, cette offre ne me paraît pas intéressante.",
      );
      setBasket([]);
      setStake("");
      setUncertain(false);
      clearRequest();
      await load();
    } catch (e) {
      const unknown = !e.code || e.code === "FETCH_ERROR";
      setUncertain(unknown);
      setNotice(
        unknown
          ? "Réponse non confirmée : vérifie ton historique. Réessayer utilisera le même identifiant et ne créera pas un deuxième ticket."
          : e.message,
      );
      if (!unknown) clearRequest();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function claim(mission, answers) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const r = await arenaMission(mission, answers);
      setNotice(
        r.claimed
          ? `${formatCoins(r.reward)} C créditées par le serveur.`
          : r.reason,
      );
      await load();
    } catch (e) {
      setNotice(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function verify() {
    setBusy(true);
    try {
      const a = await arenaAccount();
      setAccount(a);
      if (request.current) {
        const t = a.tickets.find((t) => t.nonce === request.current.nonce);
        if (t) {
          setNotice(
            "Ticket retrouvé dans ton historique. Aucun nouvel engagement.",
          );
          setBasket([]);
          setUncertain(false);
          clearRequest();
        } else
          setNotice(
            "Aucun ticket confirmé pour cet identifiant. Tu peux réessayer la même demande.",
          );
      }
    } catch {
      setNotice(
        "Vérification impossible pour le moment. Ne crée pas un autre ticket.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="container page-content arena-page">
      <div className="arena-hero">
        <div>
          <span className="eyebrow">
            UN TERRAIN DE JEU. UN VRAI ESPRIT D’ANALYSE.
          </span>
          <h1>
            L’Arène <span>Calcito.</span>
          </h1>
          <p>Défie le robot, propose tes cotes et apprends à lire le risque.</p>
          <div className="arena-promises">
            <span>
              <Coins size={14} />
              Calcithunes virtuelles
            </span>
            <span>
              <ShieldCheck size={14} />
              Aucun achat ni retrait
            </span>
            <span>
              <Sparkles size={14} />
              Des missions gratuites
            </span>
          </div>
        </div>
        <Calcithune />
      </div>
      <Notice>
        Un jeu entièrement gratuit : sans argent réel ni récompense financière.
        La limite de 5 % / 10 C est une règle de prudence du jeu, pas une
        méthode de gain.
      </Notice>
      {!status && !error && <p role="status">Connexion à l’Arène…</p>}
      {error && (
        <p role="alert">
          {error}
          <button onClick={load} className="text-link">
            Réessayer
          </button>
        </p>
      )}
      {status?.installed === false && (
        <div className="arena-setup">
          <h2>L’ouverture se prépare.</h2>
          <p>
            L’interface est prête ; le serveur Calcithunes doit être installé
            dans Supabase avant de créer un portefeuille ou un ticket.
          </p>
          {auth.admin && (
            <a
              href={`${import.meta.env.BASE_URL}downloads/calcito-v5-arene.sql`}
              className="button button-secondary"
              download
            >
              Télécharger le SQL de l’Arène
            </a>
          )}
          <p>
            Le Coach reste accessible ci-dessous. Aucun solde ou enregistrement
            n’est simulé.
          </p>
        </div>
      )}
      {!auth.user && !auth.loading && <ArenaLogin />}
      {account && (
        <div className="arena-wallet">
          <div className="wallet-main">
            <Calcithune small />
            <span>Bankroll disponible</span>
            <strong>
              {formatCoins(account.wallet.available)} <small>C</small>
            </strong>
            <p>Disponible pour les nouveaux tickets</p>
          </div>
          <div>
            <span>Engagements en cours</span>
            <strong>{formatCoins(account.wallet.reserved)} C</strong>
            <p>Réservés, hors bankroll disponible</p>
          </div>
          <div>
            <span>Limite serveur par ticket</span>
            <strong>{formatCoins(playerLimit)} C</strong>
            <p>Arrondie au centime inférieur</p>
          </div>
          <div>
            <span>{level.name}</span>
            <strong>
              {formatCoins(account.wallet.xp)} <small>C d’expérience</small>
            </strong>
            <div className="arena-xp">
              <i
                style={{
                  width: `${next ? Math.min(100, (Number(account.wallet.xp) / next.xp) * 100) : 100}%`,
                }}
              />
            </div>
            <p>
              {next
                ? `${next.name} à ${formatCoins(next.xp)} C gagnées cumulées`
                : "Maître Calcito atteint"}
            </p>
          </div>
          {Number(account.wallet.debt) > 0 && (
            <p className="arena-debt">
              Ajustement après correction : {formatCoins(account.wallet.debt)}{" "}
              C. Les nouveaux crédits le compensent avant de redevenir
              disponibles ; aucun paiement réel n’est demandé.
            </p>
          )}
        </div>
      )}
      <div className="arena-tabs">
        {[
          ["play", "L’Arène"],
          ["coach", "Le Coach"],
          ["profile", "Mon profil"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
            disabled={busy}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "play" && (
        <>
          <div className="arena-layout">
            <div>
              <div className="arena-mode">
                <button
                  className={mode === "challenge" ? "active" : ""}
                  disabled={busy || uncertain}
                  onClick={() => {
                    setMode("challenge");
                    setReaction("");
                    setBasket([]);
                    request.current = null;
                  }}
                >
                  Défie Calcito
                </button>
                <button
                  className={mode === "bookmaker" ? "active" : ""}
                  disabled={busy || uncertain}
                  onClick={() => {
                    setMode("bookmaker");
                    setReaction("");
                    setBasket([]);
                    request.current = null;
                  }}
                >
                  Deviens le bookmaker
                </button>
              </div>
              <CalcitoMascot
                variant={reaction ? "success" : "analysis"}
                title={
                  reaction ||
                  (mode === "challenge"
                    ? "Le défi commence par le contexte."
                    : "Propose une cote. Je regarde sa valeur.")
                }
                message={
                  mode === "challenge"
                    ? "La cote estime un résultat. Elle ne promet rien : même un favori peut perdre."
                    : "Je ne décide pas au hasard : j’accepte un rendement théorique supérieur à 5 %, si nos budgets couvrent le défi."
                }
              />
              {status?.installed && !status.enabled && (
                <div className="arena-model-note">
                  <h3>Les cotes attendent leur validation.</h3>
                  <p>
                    {status.model?.reason ||
                      "Le modèle probabiliste doit être testé sur les résultats historiques."}
                  </p>
                  {status.model?.training != null && (
                    <p>
                      {status.model.training} rencontres d’apprentissage ·{" "}
                      {status.model.validation} de contrôle.
                    </p>
                  )}
                  <p>
                    Aucune probabilité n’est déduite directement de l’indice de
                    forme.
                  </p>
                </div>
              )}
              {d?.competitions?.length > 0 && (
                <label className="arena-calendar-filter">
                  Compétition du calendrier
                  <select
                    value={fixtureCompetition}
                    onChange={(e) => {
                      setFixtureCompetition(e.target.value);
                      setFixturePage(0);
                    }}
                  >
                    {[
                      <option value="" key="all">
                        Toutes les compétitions
                      </option>,
                      ...d.competitions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      )),
                    ]}
                  </select>
                </label>
              )}
              {data.loading ? (
                <p role="status">Chargement des rencontres…</p>
              ) : data.error ? (
                <p role="alert">Calendrier indisponible.</p>
              ) : !fixtures.length ? (
                <div className="arena-empty">
                  <h3>Le prochain défi se prépare.</h3>
                  <p>
                    Les rencontres apparaissent après publication du calendrier.
                    Aucune affiche n’est inventée.
                  </p>
                  <Link to="/methodologie" className="text-link">
                    Comprendre les analyses <ArrowUpRight size={15} />
                  </Link>
                </div>
              ) : (
                <div className="arena-fixtures">
                  {fixtures
                    .slice(visiblePage * 30, (visiblePage + 1) * 30)
                    .map((m) => (
                      <ArenaFixture
                        key={m.id}
                        match={m}
                        dataset={d}
                        enabled={Boolean(status?.enabled && auth.user)}
                        onSelect={add}
                        locked={busy || uncertain}
                      />
                    ))}
                </div>
              )}
              {fixturePages > 1 && (
                <nav
                  className="arena-calendar-pages"
                  aria-label="Pages du calendrier"
                >
                  <button
                    className="button button-secondary"
                    disabled={visiblePage === 0}
                    onClick={() => setFixturePage(visiblePage - 1)}
                  >
                    Précédente
                  </button>
                  <span>
                    {visiblePage + 1} / {fixturePages} · {fixtures.length}{" "}
                    rencontres
                  </span>
                  <button
                    className="button button-secondary"
                    disabled={visiblePage === fixturePages - 1}
                    onClick={() => setFixturePage(visiblePage + 1)}
                  >
                    Suivante
                  </button>
                </nav>
              )}
              <p className="form-footnote">
                Marchés statistiques : indisponibles tant que les données de
                règlement et leur modèle ne sont pas garantis. Les combinés
                refusent une même rencontre ou des équipes communes.
              </p>
            </div>
            <aside className="arena-slip">
              <div className="panel-heading">
                <h2>
                  {mode === "bookmaker"
                    ? "Ton offre à Calcito"
                    : basket.length >= 2
                      ? "Ton combiné"
                      : "Ton ticket"}
                </h2>
                <span>{basket.length}/10</span>
              </div>
              {!basket.length ? (
                <p className="muted-text">
                  Choisis un marché disponible sur une rencontre à venir.
                </p>
              ) : (
                basket.map((q, i) => (
                  <div className="slip-leg" key={q.id}>
                    <div>
                      <strong>{arenaMarkets[q.market] || q.market}</strong>
                      <span>
                        {team(d, q.match.home_team_id)?.name} ·{" "}
                        {team(d, q.match.away_team_id)?.name}
                      </span>
                      <small>
                        Cote capturée :{" "}
                        {Number(q.odds).toLocaleString("fr-FR", {
                          maximumFractionDigits: 4,
                        })}
                      </small>
                    </div>
                    <button
                      aria-label={`Retirer la sélection ${i + 1}`}
                      disabled={busy || uncertain}
                      onClick={() => {
                        setBasket((b) => b.filter((l) => l.id !== q.id));
                        request.current = null;
                      }}
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))
              )}
              {mode === "bookmaker" && (
                <>
                  <p className="form-footnote">
                    Calcito mise. S’il réussit, tu paies son bénéfice ; s’il
                    perd, sa mise te revient. Ton engagement est cette
                    responsabilité, pas sa mise.
                  </p>
                  <label>
                    Cote que tu proposes
                    <input
                      inputMode="decimal"
                      value={offer}
                      onChange={(e) => {
                        setOffer(e.target.value);
                        request.current = null;
                      }}
                      disabled={busy || uncertain}
                      placeholder="Ex. 3.20"
                    />
                  </label>
                </>
              )}
              <label>
                {mode === "bookmaker" ? "Mise de Calcito (C)" : "Ta mise (C)"}
                <input
                  inputMode="decimal"
                  value={stake}
                  onChange={(e) => {
                    setStake(e.target.value);
                    request.current = null;
                  }}
                  disabled={busy || uncertain}
                  placeholder="0,00"
                />
              </label>
              <div className="slip-metrics">
                <span>
                  Ton engagement maximal
                  <strong>{formatCoins(playerLimit)} C</strong>
                </span>
                <span>
                  Budget de risque Calcito
                  <strong>{formatCoins(botLimit)} C</strong>
                </span>
                {math && (
                  <>
                    <span>
                      Cote totale
                      <strong>
                        {math.odds.toLocaleString("fr-FR", {
                          maximumFractionDigits: 4,
                        })}
                      </strong>
                    </span>
                    <span>
                      Probabilité estimée
                      <strong>
                        {(math.probability * 100).toLocaleString("fr-FR", {
                          maximumFractionDigits: 2,
                        })}{" "}
                        %
                      </strong>
                    </span>
                    <span>
                      {mode === "bookmaker"
                        ? "Ta responsabilité réservée"
                        : "Gain brut potentiel"}
                      <strong>
                        {formatCoins(
                          mode === "bookmaker" ? math.userRisk : math.gross,
                        )}{" "}
                        C
                      </strong>
                    </span>
                    <span>
                      {mode === "bookmaker"
                        ? "Gain si Calcito perd"
                        : "Bénéfice net potentiel"}
                      <strong>
                        {formatCoins(mode === "bookmaker" ? amount : math.net)}{" "}
                        C
                      </strong>
                    </span>
                  </>
                )}
              </div>
              {basket.length > 1 && (
                <p className="form-footnote">
                  Probabilité approximative sous indépendance. Toutes les
                  sélections doivent réussir ; une sélection annulée est
                  neutralisée à 1,00.
                </p>
              )}
              {math &&
                (math.userRisk > playerLimit || math.botRisk > botLimit) && (
                  <p className="field-error">
                    L’engagement dépasse un budget autorisé. Une forte cote peut
                    nécessiter une mise plus petite.
                  </p>
                )}
              <button
                className="button button-primary"
                disabled={busy || (!canSubmit && !uncertain)}
                onClick={submit}
              >
                {busy
                  ? "Validation serveur…"
                  : uncertain
                    ? "Réessayer la même demande"
                    : "Valider le défi"}
              </button>
              {uncertain && (
                <button
                  className="button button-secondary"
                  disabled={busy}
                  onClick={verify}
                >
                  Vérifier mon historique
                </button>
              )}
              <p className="form-footnote">
                Limites revérifiées par le serveur. Retour brut arrondi vers le
                bas au centime. Cotes valables 15 minutes au maximum, puis
                verrouillées au coup d’envoi.
              </p>
            </aside>
          </div>
        </>
      )}
      {tab === "coach" && (
        <ArenaCoach
          account={account}
          claim={claim}
          busy={busy}
          installed={status?.installed}
        />
      )}
      {tab === "profile" && (
        <ArenaProfile account={account} auth={auth} reload={load} busy={busy} />
      )}
      {notice && (
        <p className="arena-message" role="status">
          {notice}
        </p>
      )}
      <section className="arena-lesson-grid">
        <h2>Les conseils de Calcito</h2>
        {coachLessons.map(([title, text]) => (
          <article key={title}>
            <ShieldCheck size={18} />
            <h3>{title}</h3>
            <p>{text}</p>
          </article>
        ))}
      </section>
      <p className="form-footnote">
        La précision du modèle est identique pour tous les niveaux. Tes
        Calcithunes n’ont aucune valeur monétaire.
      </p>
    </section>
  );
}
function team(d, id) {
  const t = d?.teams.find((t) => t.id === id);
  return t ? { ...t, logo: t.logo_url } : null;
}
function ArenaFixture({ match, dataset, enabled, onSelect, locked }) {
  const [quote, setQuote] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function get() {
    setBusy(true);
    setError("");
    try {
      setQuote(await arenaQuote(match.id));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="arena-match">
      <header>
        <span>
          {
            dataset.competitions.find(
              (c) =>
                c.id ===
                dataset.seasons.find((s) => s.id === match.season_id)
                  ?.competition_id,
            )?.name
          }
        </span>
        <time>
          {new Date(match.kickoff).toLocaleString("fr-FR", {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </time>
      </header>
      <div className="arena-versus">
        <TeamBadge team={team(dataset, match.home_team_id)} small />
        <h3>
          {team(dataset, match.home_team_id)?.name}
          <span>vs</span>
          {team(dataset, match.away_team_id)?.name}
        </h3>
        <TeamBadge team={team(dataset, match.away_team_id)} small />
      </div>
      {!quote && (
        <button
          className="button button-secondary"
          onClick={get}
          disabled={!enabled || busy || locked}
        >
          {busy ? "Calcul serveur…" : "Consulter les cotes"}
        </button>
      )}
      {quote?.forecast && (
        <p className="form-footnote">
          1 / N / 2 :{" "}
          {["home", "draw", "away"]
            .map(
              (k) =>
                (Number(quote.forecast[k]) * 100).toLocaleString("fr-FR", {
                  maximumFractionDigits: 1,
                }) + " %",
            )
            .join(" / ")}{" "}
          · probabilités normalisées, arrondies à l’affichage.
        </p>
      )}
      {quote?.quotes?.length > 0 && (
        <>
          <div className="arena-market-grid">
            {quote.quotes.map((q) => (
              <button
                key={q.id}
                disabled={locked || Date.parse(q.expires_at) <= Date.now()}
                onClick={() => onSelect(q, match)}
              >
                <span>{arenaMarkets[q.market]}</span>
                <strong>
                  {Number(q.odds).toLocaleString("fr-FR", {
                    maximumFractionDigits: 3,
                  })}
                </strong>
                <small>
                  {(Number(q.probability) * 100).toLocaleString("fr-FR", {
                    maximumFractionDigits: 1,
                  })}{" "}
                  % estimés
                </small>
              </button>
            ))}
          </div>
          <button className="text-link" onClick={get} disabled={busy || locked}>
            <RefreshCw size={14} />
            Actualiser les cotes
          </button>
        </>
      )}
      {quote?.reason && <p className="muted-text">{quote.reason}</p>}
      {error && <p role="alert">{error}</p>}
    </article>
  );
}
function ArenaLogin() {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function submit(signup) {
    setBusy(true);
    setMessage("");
    try {
      const result = signup
        ? await supabase.auth.signUp({
            email,
            password,
            options: {
              emailRedirectTo: `${location.origin}${import.meta.env.BASE_URL}`,
            },
          })
        : await supabase.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      setMessage(
        signup
          ? "Compte demandé : confirme le lien reçu par e-mail si Supabase le demande."
          : "Connexion effectuée.",
      );
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="arena-login"
      onSubmit={(e) => {
        e.preventDefault();
        submit(false);
      }}
    >
      <div>
        <h2>Entre dans l’Arène.</h2>
        <p>
          Un compte personnel pour conserver tes tickets et ton portefeuille sur
          le serveur.
        </p>
      </div>
      <label>
        E-mail de l’Arène
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
      </label>
      <label>
        Mot de passe de l’Arène
        <input
          type="password"
          minLength="8"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
        />
      </label>
      <button className="button button-primary" disabled={busy || !supabase}>
        Se connecter à l’Arène
      </button>
      <button
        className="button button-secondary"
        type="button"
        onClick={() => submit(true)}
        disabled={busy || !email || password.length < 8 || !supabase}
      >
        Créer mon compte
      </button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
function ArenaCoach({ account, claim, busy, installed }) {
  const [answers, setAnswers] = useState({});
  return (
    <section className="arena-missions">
      <div className="section-heading">
        <div>
          <span className="eyebrow">APPRENDRE SANS MISER</span>
          <h2>Des missions, pas une course aux mises.</h2>
        </div>
      </div>
      <div>
        {missions.map((m) => (
          <article key={m.id}>
            <span className="eyebrow">{m.type}</span>
            <h3>{m.title}</h3>
            <p>
              <Calcithune small />
              {formatCoins(m.reward)} C · expérience indépendante du solde
            </p>
            {m.question && (
              <label>
                {m.question}
                <select
                  value={answers[m.id] || ""}
                  onChange={(e) =>
                    setAnswers((a) => ({ ...a, [m.id]: e.target.value }))
                  }
                >
                  <option value="">Choisir une réponse</option>
                  {m.answers.map(([id, t]) => (
                    <option key={id} value={id}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              className="button button-secondary"
              disabled={
                busy ||
                !account ||
                !installed ||
                Boolean(m.question && !answers[m.id])
              }
              onClick={() =>
                claim(m.id, m.key ? { [m.key]: answers[m.id] } : {})
              }
            >
              Vérifier et réclamer
            </button>
            <small>
              Éligibilité et récompense vérifiées sur le serveur.{" "}
              {m.type === "Permanente"
                ? "Une fois par compte."
                : "Une fois par période."}
            </small>
          </article>
        ))}
      </div>
    </section>
  );
}
function ArenaProfile({ account, auth, reload, busy }) {
  const [exporting, setExporting] = useState(false),
    [exportError, setExportError] = useState("");
  async function exportHistory() {
    setExporting(true);
    setExportError("");
    try {
      const content = await arenaExport();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(content, null, 2)], {
          type: "application/json",
        }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "calcito-mon-historique.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setExportError(e.message);
    } finally {
      setExporting(false);
    }
  }
  if (!account)
    return (
      <div className="arena-empty">
        <h2>Ton espace personnel</h2>
        <p>Connecte-toi lorsque le serveur de l’Arène est installé.</p>
      </div>
    );
  const s = account.stats,
    p = account.performance || [],
    hits = p.reduce((n, r) => n + r.player, 0),
    botHits = p.reduce((n, r) => n + r.calcito, 0);
  return (
    <section className="arena-profile">
      <div className="section-heading">
        <div>
          <span className="eyebrow">{auth.user.email}</span>
          <h2>Qui connaît le mieux le football ?</h2>
        </div>
        <button
          className="button button-secondary"
          onClick={reload}
          disabled={busy}
        >
          <RefreshCw size={15} />
          Actualiser
        </button>
      </div>
      <div className="arena-duel">
        <div>
          <Trophy size={25} />
          <h3>Toi</h3>
          <strong>
            {p.length ? Math.round((hits / p.length) * 100) + " %" : "—"}
          </strong>
          <p>
            {hits} choix corrects / {p.length}
          </p>
        </div>
        <div>
          <CalcitoMascot
            variant="compare"
            title="Calcito"
            message={
              p.length
                ? `${botHits} choix corrects / ${p.length}`
                : "Les premiers résultats établiront la comparaison."
            }
          />
          <strong>
            {p.length ? Math.round((botHits / p.length) * 100) + " %" : "—"}
          </strong>
        </div>
      </div>
      <p className="form-footnote">
        Même échantillon : premier choix 1 / N / 2 par rencontre. Les refus,
        annulations et résultats non vérifiés ne comptent pas. La précision est
        distincte des gains fictifs.
      </p>
      {p.length > 1 && <PrecisionChart points={p} />}
      <div className="arena-records">
        <article>
          <h3>Les confrontations</h3>
          <p>
            {s.accepted} tickets acceptés · {s.pending} en attente
          </p>
          <p>
            {s.won} tickets gagnés par le joueur · {s.lost} par Calcito
          </p>
          <p>
            Résultat net des tickets réglés :{" "}
            {formatCoins(Number(s.returns) - Number(s.riskSettled))} C
          </p>
          <h3>Succès et missions récompensées</h3>
          {account.missions.length ? (
            account.missions.map((m) => (
              <span className="arena-badge" key={m.mission + ":" + m.period}>
                <Sparkles size={12} />
                {missions.find((x) => x.id === m.mission)?.title} · {m.period}
              </span>
            ))
          ) : (
            <p>Aucun succès récompensé pour le moment.</p>
          )}
        </article>
        <article>
          <h3>Historique des tickets</h3>
          <p className="form-footnote">
            Les 100 derniers tickets. L’export contient tout ton historique.
          </p>
          {account.tickets.length ? (
            account.tickets.map((t) => (
              <div className="arena-history-row" key={t.id}>
                <span>
                  {new Date(t.created_at).toLocaleDateString("fr-FR")} ·{" "}
                  {t.mode === "bookmaker" ? "Bookmaker" : "Défi"} ·{" "}
                  {
                    {
                      open: "En cours",
                      won: "Gagné",
                      lost: "Perdu",
                      void: "Annulé",
                    }[t.status]
                  }
                </span>
                <strong>
                  Engagement {formatCoins(t.user_risk)} C · Retour{" "}
                  {formatCoins(t.user_credit)} C
                </strong>
                <small>
                  Cote figée{" "}
                  {Number(t.odds).toLocaleString("fr-FR", {
                    maximumFractionDigits: 4,
                  })}{" "}
                  · {t.id.slice(0, 8)}
                </small>
                {t.legs?.map((leg) => (
                  <small key={leg.match_id}>
                    {leg.home_name} — {leg.away_name} ·{" "}
                    {arenaMarkets[leg.market]} ·{" "}
                    {Number(leg.odds).toLocaleString("fr-FR")}{" "}
                    {leg.voided ? "(neutralisé)" : ""}
                  </small>
                ))}
              </div>
            ))
          ) : (
            <p>Aucun ticket enregistré.</p>
          )}
        </article>
        <article className="arena-ledger">
          <h3>Journal des opérations</h3>
          <p className="form-footnote">
            Les 100 dernières opérations. Montants du serveur, aucune édition
            locale.
          </p>
          {account.transactions.map((t) => (
            <div className="arena-history-row" key={t.id}>
              <span>
                {new Date(t.created_at).toLocaleString("fr-FR")} ·{" "}
                {{
                  welcome: "Bienvenue",
                  reserve: "Engagement réservé",
                  settlement: "Règlement",
                  correction: "Correction officielle",
                  mission: "Mission",
                }[t.kind] || t.kind}
              </span>
              <strong>
                {Number(t.amount) > 0 ? "+" : ""}
                {formatCoins(t.amount)} C
              </strong>
            </div>
          ))}
        </article>
      </div>
      <button
        className="button button-secondary"
        onClick={exportHistory}
        disabled={busy || exporting}
      >
        {exporting ? "Lecture du serveur…" : "Exporter tout mon historique"}
      </button>
      {exportError && <p role="alert">{exportError}</p>}
      <button
        className="button button-secondary"
        onClick={auth.signOut}
        disabled={busy}
      >
        Se déconnecter de l’Arène
      </button>
    </section>
  );
}
function PrecisionChart({ points }) {
  let a = 0,
    b = 0;
  const start = Date.parse(points[0].date),
    span = Math.max(1, Date.parse(points.at(-1).date) - start);
  const series = points.map((p, i) => {
    a += p.player;
    b += p.calcito;
    return {
      x: 20 + ((Date.parse(p.date) - start) / span) * 760,
      a: 180 - (a / (i + 1)) * 150,
      b: 180 - (b / (i + 1)) * 150,
    };
  });
  return (
    <div className="arena-precision">
      <h3>La précision au fil des résultats</h3>
      <svg
        viewBox="0 0 800 210"
        role="img"
        aria-label="Précision cumulative sur les rencontres réglées : joueur bleu continu, Calcito doré discontinu"
      >
        <polyline
          points={series.map((r) => `${r.x},${r.a}`).join(" ")}
          fill="none"
          stroke="#2f8cff"
          strokeWidth="3"
        />
        <polyline
          points={series.map((r) => `${r.x},${r.b}`).join(" ")}
          fill="none"
          stroke="#f4c369"
          strokeWidth="3"
          strokeDasharray="7 5"
        />
      </svg>
      <p className="form-footnote">
        Du {new Date(points[0].date).toLocaleDateString("fr-FR")} au{" "}
        {new Date(points.at(-1).date).toLocaleDateString("fr-FR")} ·{" "}
        {points.length} rencontres évaluées.
      </p>
    </div>
  );
}
