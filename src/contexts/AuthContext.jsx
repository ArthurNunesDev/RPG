import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { isSupabaseConfigured, supabase } from "../lib/supabase.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState("");

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return undefined;
    }

    let active = true;

    async function loadProfile(userId) {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, username, display_name, avatar_url, preferred_role")
        .eq("id", userId)
        .maybeSingle();

      if (!active) return;
      if (error) {
        setProfileError(error.message);
        setProfile(null);
        return;
      }
      setProfile(data);
      setProfileError("");
    }

    supabase.auth.getSession().then(async ({ data, error }) => {
      if (!active) return;
      if (error) setProfileError(error.message);
      setSession(data?.session ?? null);
      if (data?.session?.user) await loadProfile(data.session.user.id);
      if (active) setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      if (!nextSession) {
        setProfile(null);
        setProfileError("");
        setLoading(false);
        return;
      }
      // Defer profile I/O until Supabase finishes its auth callback.
      Promise.resolve().then(() => loadProfile(nextSession.user.id))
        .finally(() => { if (active) setLoading(false); });
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(() => ({
    configured: isSupabaseConfigured,
    session,
    user: session?.user ?? null,
    profile,
    loading,
    profileError,
    refreshProfile: async () => {
      if (!supabase || !session?.user?.id) return;
      const { data, error } = await supabase
        .from("profiles")
        .select("id, username, display_name, avatar_url, preferred_role")
        .eq("id", session.user.id)
        .maybeSingle();
      if (error) throw error;
      setProfile(data);
      setProfileError("");
    },
    signOut: async () => {
      if (!supabase) throw new Error("Supabase não está configurado.");
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    },
  }), [session, profile, loading, profileError]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth deve ser usado dentro de AuthProvider.");
  return context;
}
