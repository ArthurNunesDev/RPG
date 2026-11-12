import { useEffect } from "react";
import { supabase } from "../lib/supabase.js";
import { useAuth } from "../contexts/AuthContext.jsx";

export default function PresenceTracker() {
  const { user } = useAuth();
  useEffect(() => {
    if (!supabase || !user?.id) return undefined;
    let mounted = true;
    let inactivityTimer;
    let heartbeat;
    let currentStatus = "online";
    const update = async (status) => {
      currentStatus = status;
      if (!mounted) return;
      const { error } = await supabase.rpc("set_my_presence", { p_status: status });
      if (error && mounted) console.warn("Presence update failed:", error.message);
    };
    const markActive = () => {
      if (document.visibilityState !== "visible") {
        window.clearTimeout(inactivityTimer);
        void update("inactive");
        return;
      }
      window.clearTimeout(inactivityTimer);
      if (currentStatus !== "online") void update("online");
      inactivityTimer = window.setTimeout(() => void update("inactive"), 120_000);
    };
    const visibilityChanged = () => {
      if (document.visibilityState === "visible") markActive();
      else { window.clearTimeout(inactivityTimer); void update("inactive"); }
    };
    markActive();
    heartbeat = window.setInterval(() => {
      if (document.visibilityState === "visible") void update(currentStatus);
    }, 45_000);
    window.addEventListener("pointerdown", markActive, { passive: true });
    window.addEventListener("pointermove", markActive, { passive: true });
    window.addEventListener("wheel", markActive, { passive: true });
    window.addEventListener("touchstart", markActive, { passive: true });
    window.addEventListener("keydown", markActive);
    window.addEventListener("focus", markActive);
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      mounted = false;
      window.clearTimeout(inactivityTimer);
      window.clearInterval(heartbeat);
      window.removeEventListener("pointerdown", markActive);
      window.removeEventListener("pointermove", markActive);
      window.removeEventListener("wheel", markActive);
      window.removeEventListener("touchstart", markActive);
      window.removeEventListener("keydown", markActive);
      window.removeEventListener("focus", markActive);
      document.removeEventListener("visibilitychange", visibilityChanged);
      void supabase.rpc("set_my_presence", { p_status: "offline" });
    };
  }, [user?.id]);
  return null;
}
