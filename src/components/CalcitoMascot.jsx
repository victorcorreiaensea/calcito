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
  title,
  message,
  imageSrc = mascotImages[variant],
}) {
  const [failedSource, setFailedSource] = useState(null);
  return (
    <div className={`mascot-block mascot-${variant}`}>
      <div className="mascot-art">
        {imageSrc && failedSource !== imageSrc ? (
          <img
            src={imageSrc}
            alt="Calcito, robot sportif bleu et blanc avec un ballon de football"
            onError={() => setFailedSource(imageSrc)}
            loading="lazy"
          />
        ) : (
          <span className="mascot-placeholder" aria-label="Calcito">
            <Bot size={42} strokeWidth={1.3} />
            <b>C</b>
          </span>
        )}
      </div>
      <div>
        <span className="eyebrow">VOTRE ASSISTANT FOOTBALL</span>
        <h3>{title}</h3>
        <p>{message}</p>
      </div>
    </div>
  );
}
export { mascot as mascotUrl };
