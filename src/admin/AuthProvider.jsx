import { createContext, useContext, useEffect, useRef, useState } from "react";
import { supabase } from "../services/supabaseClient";
import { invalidateManualData } from "../services/manualRepository";

const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  const [auth, setAuth] = useState({
    loading: Boolean(supabase),
    user: null,
    admin: false,
    error: null,
  });
  const generation = useRef(0);
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    async function check(session) {
      const current = ++generation.current;
      if (!session) {
        if (alive)
          setAuth({ loading: false, user: null, admin: false, error: null });
        invalidateManualData();
        return;
      }
      setAuth({ loading: true, user: session.user, admin: false, error: null });
      const { data, error } = await supabase.rpc("is_calcito_admin");
      if (alive && current === generation.current) {
        invalidateManualData();
        setAuth({
          loading: false,
          user: session.user,
          admin: data === true && !error,
          error: error
            ? "Les autorisations n’ont pas pu être vérifiées."
            : null,
        });
      }
    }
    supabase.auth.getSession().then(({ data, error }) => {
      if (error && alive)
        setAuth({
          loading: false,
          user: null,
          admin: false,
          error: "La session ne peut pas être récupérée.",
        });
      else if (alive) check(data.session);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      queueMicrotask(() => {
        if (alive) check(session);
      });
    });
    return () => {
      alive = false;
      generation.current++;
      data.subscription.unsubscribe();
    };
  }, []);
  async function signOut() {
    try {
      if (auth.user)
        sessionStorage.removeItem(`calcito:matchday:${auth.user.id}`);
      if (auth.user)
        sessionStorage.removeItem(`calcito:arena-pending:${auth.user.id}`);
    } catch {
      /* Storage may be unavailable. */
    }
    await supabase?.auth.signOut();
    invalidateManualData();
  }
  return (
    <AuthContext.Provider value={{ ...auth, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  return useContext(AuthContext);
}
