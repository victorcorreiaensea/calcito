import {
  Trophy,
  Crosshair,
  ShieldCheck,
  Plane,
  ScanLine,
  ArrowUpRight,
} from "lucide-react";
import { Link } from "react-router-dom";
import CalcitoMascot from "./CalcitoMascot";
const factors = [
  {
    Icon: Trophy,
    name: "Résultats",
    tag: "La dynamique",
    text: "Les victoires et les nuls portent la forme.",
    glyph: "V · V · N",
    kind: "results",
  },
  {
    Icon: Crosshair,
    name: "Attaque",
    tag: "Les buts marqués",
    text: "Marquer davantage renforce l’indice.",
    glyph: "↗",
    kind: "attack",
  },
  {
    Icon: ShieldCheck,
    name: "Défense",
    tag: "Les buts encaissés",
    text: "Encaisser moins et garder sa cage inviolée à domicile comptent.",
    glyph: "0",
    kind: "defence",
  },
  {
    Icon: Plane,
    name: "Extérieur",
    tag: "Loin de son stade",
    text: "Les victoires, les nuls et les buts à l’extérieur sont valorisés.",
    glyph: "↗",
    kind: "away",
  },
  {
    Icon: ScanLine,
    name: "Données avancées",
    tag: "Un éclairage complémentaire",
    text: "Tirs et occasions enrichissent la lecture, sans modifier l’indice actuel.",
    glyph: "···",
    kind: "advanced",
  },
];
export function FormFactors({ heading = true }) {
  return (
    <section className="form-education">
      {heading && (
        <div className="section-heading">
          <div>
            <span className="eyebrow">LIRE LE JEU AUTREMENT</span>
            <h2>Qu’est-ce qui fait la forme d’une équipe ?</h2>
          </div>
        </div>
      )}
      <div className="form-factor-grid">
        {factors.map(({ Icon, name, tag, text, glyph, kind }) => (
          <article className={`form-factor factor-${kind}`} key={kind}>
            <div className="factor-symbol">
              <Icon size={23} />
              <span className="factor-glyph" aria-hidden="true">
                {glyph}
              </span>
            </div>
            <span className="eyebrow">{tag}</span>
            <h3>{name}</h3>
            <p>{text}</p>
            <div
              className={`factor-illustration illustration-${kind}`}
              aria-hidden="true"
            >
              {Array.from({ length: 5 }, (_, i) => (
                <i key={i} />
              ))}
            </div>
          </article>
        ))}
      </div>
      <p className="form-footnote">
        Illustrations explicatives, sans données d’équipe. La différence de buts
        compte aussi. La régularité se lit dans la série : aucun bonus distinct
        de régularité n’est ajouté.
      </p>
    </section>
  );
}
export function MascotEditorial() {
  return (
    <aside className="form-mascot-editorial">
      <CalcitoMascot
        variant="analysis"
        title="Le résultat n’est que le début."
        message="Ici, on regarde aussi les buts et le terrain : un même nombre de victoires peut raconter deux dynamiques différentes."
      />
      <Link className="text-link" to="/methodologie">
        Comprendre l’indice <ArrowUpRight size={16} />
      </Link>
    </aside>
  );
}
