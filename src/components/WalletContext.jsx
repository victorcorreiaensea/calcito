import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../admin/AuthProvider";
import { arenaAccount } from "../services/arenaRepository";
import { formatCoins } from "../domain/arena";
import Calcithune from "./Calcithune";
const Wallet = createContext(null);
export function WalletProvider({ children }) {
  const { user } = useAuth();
  const [state, setState] = useState(null);
  const generation = useRef(0);
  useEffect(() => {
    const g = ++generation.current;
    setState(null);
    if (!user) return;
    let sequence = 0;
    async function refresh() {
      const order = ++sequence;
      try {
        const account = await arenaAccount();
        if (g === generation.current && order === sequence)
          setState({ userId: user.id, account });
      } catch {
        if (g === generation.current && order === sequence) setState(null);
      }
    }
    function receive(event) {
      if (event.detail.userId === user.id) {
        ++sequence;
        setState(event.detail);
      }
    }
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("calcito:wallet-changed", receive);
    const timer = setInterval(refresh, 60000);
    return () => {
      ++generation.current;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("calcito:wallet-changed", receive);
    };
  }, [user?.id]);
  return (
    <Wallet.Provider
      value={state && user && state.userId === user.id ? state.account : null}
    >
      {children}
    </Wallet.Provider>
  );
}
export function WalletBalance() {
  const { user } = useAuth();
  const account = useContext(Wallet);
  return (
    <Link
      className="global-wallet"
      to={user ? "/arene?tab=profile" : "/arene"}
      aria-label={
        user
          ? "Ouvrir mon portefeuille de Calcithunes"
          : "Se connecter à l’Arène"
      }
    >
      <Calcithune small />
      <span>
        {user
          ? account
            ? `${formatCoins(account.wallet.available)} C`
            : "Portefeuille"
          : "Connexion"}
      </span>
    </Link>
  );
}
