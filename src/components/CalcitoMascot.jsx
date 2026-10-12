import { useState } from "react";
import { Bot } from "lucide-react";

// Assets are optional: provide only real public image paths in this map once supplied.
export const mascotImages = Object.freeze({});
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
            alt="Calcito, le robot assistant football"
            onError={() => setFailedSource(imageSrc)}
          />
        ) : (
          <span
            className="mascot-placeholder"
            aria-label="Emplacement de la mascotte Calcito"
          >
            <Bot size={42} strokeWidth={1.3} />
            <b>C</b>
          </span>
        )}
      </div>
      <div>
        <span className="eyebrow">L’ASSISTANT CALCITO</span>
        <h3>{title}</h3>
        <p>{message}</p>
      </div>
    </div>
  );
}
