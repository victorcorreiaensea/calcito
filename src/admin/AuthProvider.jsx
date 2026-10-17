import { createContext, useContext, useEffect, useRef, useState } from "react";
import { supabase } from "../services/supabaseClient";
import { databaseRequest } from "../services/databaseRequest.js";
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
  const currentUser = useRef(null);
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    let checkedAdmin = null;
    async function check(session) {
      const current = ++generation.current;
      const sameUser = session?.user.id === currentUser.current;
      currentUser.current = session?.user.id || null;
      if (!session) {
        checkedAdmin = null;
        if (alive)
          setAuth({ loading: false, user: null, admin: false, error: null });
        invalidateManualData();
        return;
      }
      // A token refresh or tab refocus must not unmount an active admin operation.
      if (!sameUser)
        setAuth({
          loading: true,
          user: session.user,
          admin: false,
          error: null,
        });
      const { data, error } = await databaseRequest(
        supabase.rpc("is_calcito_admin"),
        15000,
      );
      if (alive && current === generation.current) {
        const nextAdmin = data === true && !error;
        if (!sameUser || checkedAdmin !== nextAdmin) invalidateManualData();
        checkedAdmin = nextAdmin;
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
      // Leave the auth callback and release its lock before calling another RPC.
      setTimeout(() => {
        if (alive) check(session);
      }, 0);
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
