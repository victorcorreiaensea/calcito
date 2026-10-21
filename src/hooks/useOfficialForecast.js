import { useState, useEffect, useRef } from "react";
import { useAuth } from "../admin/AuthProvider";
import { arenaQuote } from "../services/arenaRepository";

// Shared explicit loader: reuses the existing action, never places a ticket or touches a wallet.
export function useOfficialForecast(match) {
  const { user } = useAuth();
  const [state, setState] = useState(null);
  const generation = useRef(0);
  const key = JSON.stringify([
    match?.id,
    match?.updated_at,
    match?.kickoff,
    user?.id,
  ]);
  const activeKey = useRef(key);
  activeKey.current = key;
  useEffect(() => {
    generation.current++;
    setState(null);
  }, [key]);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  useEffect(() => {
    const invalidate = () => {
      generation.current++;
      setState(null);
    };
    window.addEventListener("calcito:data-changed", invalidate);
    return () => window.removeEventListener("calcito:data-changed", invalidate);
  }, []);
  async function load() {
    if (!match || !user) return;
    const request = ++generation.current,
      requestKey = key;
    setState({ key, status: "loading" });
    try {
      const data = await arenaQuote(match.id);
      if (generation.current === request && activeKey.current === requestKey)
        setState({ key, status: "ready", data });
    } catch {
      if (generation.current === request && activeKey.current === requestKey)
        setState({
          key,
          status: "error",
          error:
            "Les prévisions officielles sont indisponibles. Réessaie après vérification du modèle et de la rencontre.",
        });
    }
  }
  const current = state?.key === key ? state : null;
  return { user, busy: current?.status === "loading", current, load };
}
