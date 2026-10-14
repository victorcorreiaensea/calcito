import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  HashRouter,
  NavLink,
  Link,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { Activity, Menu, X, Search } from "lucide-react";
import { DataBanner } from "./components/DataContext";
import { PageHeading } from "./components/FootballUI";
import Home from "./pages/Home";
import Matches from "./pages/Matches";
import Standings, { EuropeanRanking } from "./pages/Standings";
const Admin = lazy(() => import("./admin/Admin"));
const Arena = lazy(() => import("./pages/Arena"));
import { AuthProvider } from "./admin/AuthProvider";
import Teams, { TeamDetail } from "./pages/Teams";
import Compare from "./pages/Compare";
import Predictions from "./pages/Predictions";
import Methodology from "./pages/Methodology";

const navigation = [
  ["Accueil", "/"],
  ["Matchs", "/matchs"],
  ["Classements", "/classements"],
  ["Équipes", "/equipes"],
  ["Comparateur", "/comparateur"],
  ["Pronostics", "/pronostics"],
  ["L’Arène", "/arene"],
  ["Méthodologie", "/methodologie"],
];
function Logo() {
  return (
    <Link className="logo" to="/" aria-label="Calcito, accueil">
      <span className="logo-mark">
        <Activity size={21} strokeWidth={2.7} />
      </span>
      CALCITO<span className="logo-dot">.</span>
    </Link>
  );
}
function Navbar() {
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  const toggle = useRef(null);
  const location = useLocation();
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    if (!open) return;
    function close(event) {
      if (event.key === "Escape") {
        setOpen(false);
        toggle.current?.focus();
      }
    }
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  return (
    <header className="header">
      <div className="container nav-inner">
        <Logo />
        <nav
          id="main-navigation"
          className={`navigation ${open ? "is-open" : ""}`}
          aria-label="Navigation principale"
        >
          {navigation.map(([label, path]) => (
            <NavLink
              key={path}
              to={path}
              end={path === "/"}
              className={({ isActive }) => (isActive ? "nav-home" : "")}
              onClick={() => setOpen(false)}
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <button
          className="global-search-toggle"
          aria-label="Recherche globale d’équipes"
          aria-expanded={searchOpen}
          onClick={() => setSearchOpen((value) => !value)}
        >
          <Search size={19} />
        </button>
        <span className="version-badge">V5</span>
        {searchOpen && (
          <form
            className="global-search-form"
            onSubmit={(event) => {
              event.preventDefault();
              navigate(`/equipes?search=${encodeURIComponent(search)}`);
              setSearchOpen(false);
              setOpen(false);
            }}
          >
            <label className="sr-only" htmlFor="global-team-search">
              Nom de l’équipe
            </label>
            <input
              id="global-team-search"
              autoFocus
              type="search"
              placeholder="Rechercher une équipe…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <button>Rechercher</button>
          </form>
        )}
        <button
          ref={toggle}
          className="menu-toggle"
          onClick={() => setOpen((value) => !value)}
          aria-label={open ? "Fermer le menu" : "Ouvrir le menu"}
          aria-expanded={open}
          aria-controls="main-navigation"
        >
          {open ? <X /> : <Menu />}
        </button>
      </div>
    </header>
  );
}
function RouteEffects() {
  const location = useLocation();
  useEffect(() => {
    const label =
      navigation.find(([, path]) => path === location.pathname)?.[0] ||
      {
        "/admin": "Administration",
        "/classement-europeen": "Classement européen Calcito",
      }[location.pathname] ||
      "Équipe";
    document.title = `${label} — CALCITO · Football Intelligence`;
    window.scrollTo({ top: 0, behavior: "instant" });
    document.getElementById("main-content")?.focus({ preventScroll: true });
  }, [location.pathname]);
  return null;
}
function Footer() {
  return (
    <footer className="container footer">
      <div>
        <Logo />
        <p>
          Football intelligence.
          <br />
          Un autre regard sur le jeu.
        </p>
      </div>
      <nav aria-label="Navigation de pied de page">
        {navigation.slice(1).map(([label, path]) => (
          <Link key={path} to={path}>
            {label}
          </Link>
        ))}
      </nav>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} CALCITO</span>
        <span>V5 · Football intelligence & Calcithunes virtuelles</span>
        <Link to="/admin">Administration privée</Link>
        <button
          onClick={() =>
            window.scrollTo({
              top: 0,
              behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
                .matches
                ? "instant"
                : "smooth",
            })
          }
        >
          Retour en haut ↑
        </button>
      </div>
    </footer>
  );
}
function NotFound() {
  return (
    <section className="container page-content">
      <PageHeading
        label="404"
        title="Page introuvable"
        description="Cette page n’existe pas. Retrouvez les équipes, les matchs et les analyses depuis l’accueil."
      />
      <Link className="button button-primary" to="/">
        Retour à l’accueil
      </Link>
    </section>
  );
}
export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <a
          className="skip-link"
          href="#main-content"
          onClick={(event) => {
            event.preventDefault();
            document.getElementById("main-content")?.focus();
          }}
        >
          Aller au contenu
        </a>
        <Navbar />
        <DataBanner />
        <main id="main-content" tabIndex={-1}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/matchs" element={<Matches />} />
            <Route path="/classements" element={<Standings />} />
            <Route path="/classement-europeen" element={<EuropeanRanking />} />
            <Route
              path="/admin"
              element={
                <Suspense
                  fallback={
                    <div className="container state-panel" role="status">
                      Chargement de l’espace privé…
                    </div>
                  }
                >
                  <Admin />
                </Suspense>
              }
            />
            <Route path="/equipes" element={<Teams />} />
            <Route path="/equipes/:teamId" element={<TeamDetail />} />
            <Route path="/comparateur" element={<Compare />} />
            <Route path="/pronostics" element={<Predictions />} />
            <Route
              path="/arene"
              element={
                <Suspense
                  fallback={
                    <div className="container state-panel" role="status">
                      Chargement de l’Arène…
                    </div>
                  }
                >
                  <Arena />
                </Suspense>
              }
            />
            <Route path="/methodologie" element={<Methodology />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
        <Footer />
        <RouteEffects />
      </HashRouter>
    </AuthProvider>
  );
}
