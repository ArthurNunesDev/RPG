import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { isSupabaseConfigured, supabase } from "../lib/supabase.js";

const AuthContext = createContext(null);

async function fetchProfileData(userId) {
  const [profileResult, privateResult] = await Promise.all([
    supabase.from("profiles")
      .select("id, username, display_name, avatar_url, preferred_role")
      .eq("id", userId)
      .maybeSingle(),
    supabase.from("profile_private_data")
      .select("preferences")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (profileResult.error) throw profileResult.error;
  if (privateResult.error) throw privateResult.error;

  return profileResult.data
    ? { ...profileResult.data, preferences: privateResult.data?.preferences ?? {} }
    : null;
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState("");
  const authRevisionRef = useRef(0);
  const profileRequestRef = useRef(0);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return undefined;
    }

    let active = true;
    let currentUserId = null;

    async function loadProfile(userId, authRevision) {
      const requestRevision = ++profileRequestRef.current;
      try {
        const nextProfile = await fetchProfileData(userId);
        if (!active || authRevision !== authRevisionRef.current || requestRevision !== profileRequestRef.current) return;
        setProfile(nextProfile);
        setProfileError("");
      } catch (error) {
        if (!active || authRevision !== authRevisionRef.current || requestRevision !== profileRequestRef.current) return;
        setProfile(null);
        setProfileError(error instanceof Error ? error.message : "Não foi possível carregar o perfil.");
      } finally {
        if (active && authRevision === authRevisionRef.current && requestRevision === profileRequestRef.current) {
          setLoading(false);
        }
      }
    }

    function applySession(nextSession, forceProfileReload = false) {
      const nextUserId = nextSession?.user?.id ?? null;
      setSession(nextSession);

      if (nextUserId === currentUserId && !forceProfileReload) return;

      currentUserId = nextUserId;
      authRevisionRef.current += 1;
      profileRequestRef.current += 1;
      const authRevision = authRevisionRef.current;

      if (!nextUserId) {
        setProfile(null);
        setProfileError("");
        setLoading(false);
        return;
      }

      setLoading(true);
      void loadProfile(nextUserId, authRevision);
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      const shouldReloadProfile = ["INITIAL_SESSION", "SIGNED_IN", "USER_UPDATED"].includes(event);
      applySession(nextSession, shouldReloadProfile);
    });

    supabase.auth.getSession()
      .then(({ data, error }) => {
        if (!active || authRevisionRef.current !== 0) return;
        if (error) setProfileError(error.message);
        applySession(data?.session ?? null, true);
      })
      .catch((error) => {
        if (!active || authRevisionRef.current !== 0) return;
        setProfileError(error instanceof Error ? error.message : "Não foi possível recuperar a sessão.");
        setLoading(false);
      });

    return () => {
      active = false;
      authRevisionRef.current += 1;
      profileRequestRef.current += 1;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = profile?.preferences?.theme === "light" ? "light" : "dark";
    document.documentElement.dataset.density = profile?.preferences?.compactMode ? "compact" : "comfortable";
    document.documentElement.dataset.motion = profile?.preferences?.animations === false ? "reduced" : "full";
  }, [profile?.preferences]);

  const value = useMemo(() => ({
    configured: isSupabaseConfigured,
    session,
    user: session?.user ?? null,
    profile,
    loading,
    profileError,
    refreshProfile: async () => {
      const userId = session?.user?.id;
      if (!supabase || !userId) return;
      const requestRevision = ++profileRequestRef.current;
      const nextProfile = await fetchProfileData(userId);
      if (requestRevision !== profileRequestRef.current) return;
      setProfile(nextProfile);
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
