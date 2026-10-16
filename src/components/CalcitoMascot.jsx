import { useState } from "react";
import { Bot } from "lucide-react";

const mascot = `${import.meta.env.BASE_URL}images/mascot/calcito-football.png`;
export const mascotImages = Object.freeze({
  welcome: mascot,
  analysis: mascot,
  compare: mascot,
  empty: mascot,
  error: mascot,
  success: mascot,
});
export default function CalcitoMascot({
  variant = "welcome",
  emotion,
  title,
  message,
  imageSrc = mascotImages[variant],
}) {
  const [failedSource, setFailedSource] = useState(null);
  const [greeted, setGreeted] = useState(false);
  const mood =
    emotion ||
    {
      success: "joyful",
      error: "disappointed",
      compare: "curious",
      analysis: "focused",
      empty: "neutral",
    }[variant] ||
    "neutral";
  return (
    <div
      className={`mascot-block mascot-${variant} mood-${mood} ${greeted ? "is-greeting" : ""}`}
    >
      <button
        type="button"
        className="mascot-art mascot-interactive"
        aria-label="Saluer Calcito"
        onClick={() => setGreeted(!greeted)}
        aria-pressed={greeted}
      >
        {imageSrc && failedSource !== imageSrc ? (
          <span className="mascot-picture">
            <img
              src={imageSrc}
              alt="Calcito, robot sportif bleu et blanc avec un ballon de football"
              onError={() => setFailedSource(imageSrc)}
              loading="lazy"
            />
            <svg
              className="mascot-eyelids"
              viewBox="0 0 1280 1280"
              aria-hidden="true"
            >
              <g>
                <ellipse
                  cx="477"
                  cy="356"
                  rx="43"
                  ry="26"
                  fill="#030c12"
                  transform="rotate(-15 477 356)"
                />
                <ellipse
                  cx="663"
                  cy="334"
                  rx="45"
                  ry="27"
                  fill="#030c12"
                  transform="rotate(-10 663 334)"
                />
                <path
                  d="M449 356 Q478 365 502 348 M635 335 Q664 344 691 327"
                  fill="none"
                  stroke="#5de4ff"
                  strokeWidth="8"
                  strokeLinecap="round"
                />
              </g>
            </svg>
          </span>
        ) : (
          <span className="mascot-placeholder" aria-label="Calcito">
            <Bot size={42} strokeWidth={1.3} />
            <b>C</b>
          </span>
        )}
        <span className="mascot-expression" aria-hidden="true">
          {greeted
            ? "✦ Salut !"
            : {
                joyful: "✦",
                curious: "?",
                surprised: "!",
                focused: "···",
                proud: "★",
                disappointed: "…",
                neutral: "C",
              }[mood]}
        </span>
      </button>
      <div>
        <span className="eyebrow">VOTRE ASSISTANT FOOTBALL</span>
        <h3>{title}</h3>
        <p>{message}</p>
        {greeted && (
          <span className="form-footnote" role="status">
            Salut à toi ! Prêt à lire le jeu ?
          </span>
        )}
      </div>
    </div>
  );
}
export { mascot as mascotUrl };
