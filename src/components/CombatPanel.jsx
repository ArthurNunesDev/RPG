import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronRight, Flag, Play, RefreshCw, Swords, Timer } from "lucide-react";
import { supabase } from "../lib/supabase.js";
import { getOrderInitiative, getOrderVitals } from "../lib/combat.js";

function getSide(character) {
  if (character.character_type === "player") return "players";
  if (character.npc_role === "enemy") return "enemies";
  if (character.npc_role === "ally") return "allies";
  return "neutral";
}

function formatEvent(event) {
  const result = event.result ?? {};
  if (event.event_type === "initiative") return `${event.actor_name}: iniciativa ${result.total ?? "—"}`;
  if (event.event_type === "turn") return result.message || "Turno atualizado";
  return result.message || event.event_type;
}

export default function CombatPanel({ sessionId, campaignId, characters, userId, isGm, isObserver, onRefreshCharacters }) {
  const [encounter, setEncounter] = useState(null);
  const [combatants, setCombatants] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadCombat = useCallback(async () => {
    if (!supabase || !sessionId) return;
    setLoading(true);
    setError("");
    try {
      const { data: active, error: encounterError } = await supabase
        .from("combat_encounters")
        .select("*")
        .eq("session_id", sessionId)
        .eq("status", "active")
        .maybeSingle();
      if (encounterError) throw encounterError;
      setEncounter(active);
      if (!active) {
        setCombatants([]);
        setEvents([]);
        return;
      }
      const [combatantResult, eventResult] = await Promise.all([
        supabase.from("combatants").select("*").eq("encounter_id", active.id).order("initiative", { ascending: false }).order("sort_order", { ascending: true }),
        supabase.from("combat_events").select("*").eq("encounter_id", active.id).order("created_at", { ascending: false }).limit(40),
      ]);
      if (combatantResult.error) throw combatantResult.error;
      if (eventResult.error) throw eventResult.error;
      setCombatants(combatantResult.data ?? []);
      setEvents(eventResult.data ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar o combate.");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { loadCombat(); }, [loadCombat]);

  useEffect(() => {
    if (!supabase || !sessionId) return undefined;
    const channel = supabase.channel("combat-live:" + sessionId)
      .on("postgres_changes", { event: "*", schema: "public", table: "combat_encounters", filter: "session_id=eq." + sessionId }, loadCombat)
      .on("postgres_changes", { event: "*", schema: "public", table: "combatants" }, (payload) => {
        if (payload.new?.encounter_id === encounter?.id || payload.old?.encounter_id === encounter?.id) loadCombat();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "combat_events" }, (payload) => {
        if (payload.new?.encounter_id === encounter?.id) loadCombat();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [sessionId, encounter?.id, loadCombat]);

  const activeCombatants = useMemo(() => combatants.filter((item) => item.is_active), [combatants]);
  const currentCombatant = activeCombatants[encounter?.turn_index ?? 0] ?? null;
  const isMyTurn = Boolean(currentCombatant?.owner_id === userId);
  const approvedCharacters = useMemo(() => characters.filter((item) =>
    item.campaign_id === campaignId && item.campaign_approval_status === "approved" && item.status === "active"
  ), [characters, campaignId]);

  const startCombat = async () => {
    if (!isGm || busy || !approvedCharacters.length) return;
    setBusy(true);
    setError("");
    try {
      const { data: created, error: createError } = await supabase.from("combat_encounters").insert({
        session_id: sessionId,
        campaign_id: campaignId,
        game_system: "ordem-paranormal",
        started_by: userId,
      }).select("*").single();
      if (createError) throw createError;

      const ordered = approvedCharacters.map((character, index) => {
        const initiative = getOrderInitiative(character);
        const vitals = getOrderVitals(character);
        return {
          encounter_id: created.id,
          character_id: character.id,
          character_name: character.name,
          owner_id: character.owner_id,
          side: getSide(character),
          initiative: initiative.total,
          initiative_rolls: initiative.rolls,
          current_hp: vitals.hp,
          max_hp: vitals.hpMax,
          current_pe: vitals.pe,
          max_pe: vitals.peMax,
          current_pd: vitals.pd,
          max_pd: vitals.pdMax,
          sort_order: index,
        };
      }).sort((a, b) => b.initiative - a.initiative || a.sort_order - b.sort_order)
        .map((item, index) => ({ ...item, sort_order: index }));
      const { error: insertCombatantsError } = await supabase.from("combatants").insert(ordered);
      if (insertCombatantsError) throw insertCombatantsError;
      const initiativeEvents = ordered.map((item) => ({
        encounter_id: created.id,
        actor_character_id: item.character_id,
        actor_name: item.character_name,
        event_type: "initiative",
        result: { total: item.initiative, rolls: item.initiative_rolls },
        created_by: userId,
      }));
      const { error: eventError } = await supabase.from("combat_events").insert(initiativeEvents);
      if (eventError) throw eventError;
      await loadCombat();
      onRefreshCharacters?.();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Não foi possível iniciar o combate.");
    } finally {
      setBusy(false);
    }
  };

  const advanceTurn = async () => {
    if (!isGm || !encounter || busy || !activeCombatants.length) return;
    setBusy(true);
    setError("");
    try {
      const nextIndex = (encounter.turn_index + 1) % activeCombatants.length;
      const nextRound = nextIndex === 0 ? encounter.round_number + 1 : encounter.round_number;
      const next = activeCombatants[nextIndex];
      const { error: updateError } = await supabase.from("combat_encounters").update({
        turn_index: nextIndex,
        round_number: nextRound,
        updated_at: new Date().toISOString(),
      }).eq("id", encounter.id);
      if (updateError) throw updateError;
      const { error: eventError } = await supabase.from("combat_events").insert({
        encounter_id: encounter.id,
        actor_character_id: next?.character_id ?? null,
        actor_name: next?.character_name ?? "Combate",
        event_type: "turn",
        result: { message: nextRound !== encounter.round_number ? `Rodada ${nextRound} iniciada.` : `Turno de ${next?.character_name ?? "—"}.` },
        created_by: userId,
      });
      if (eventError) throw eventError;
      await loadCombat();
    } catch (turnError) {
      setError(turnError instanceof Error ? turnError.message : "Não foi possível avançar o turno.");
    } finally {
      setBusy(false);
    }
  };

  const endCombat = async () => {
    if (!isGm || !encounter || busy) return;
    if (!window.confirm("Encerrar este combate? O histórico será preservado.")) return;
    setBusy(true);
    setError("");
    try {
      const { error: updateError } = await supabase.from("combat_encounters").update({
        status: "completed",
        ended_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", encounter.id);
      if (updateError) throw updateError;
      await loadCombat();
    } catch (endError) {
      setError(endError instanceof Error ? endError.message : "Não foi possível encerrar o combate.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="panel room-combat-empty">Carregando estrutura de combate...</div>;

  return <div className="room-combat-system">
    <div className="room-combat-toolbar">
      <div><span className="eyebrow">ORDEM PARANORMAL</span><h3>{encounter ? `Combate · Rodada ${encounter.round_number}` : "Preparação do combate"}</h3><p>{encounter ? "Iniciativa e turnos sincronizados com todos os participantes." : "O mestre inicia o encontro com os personagens aprovados da campanha."}</p></div>
      {isGm && !encounter && <button className="button button-primary" type="button" disabled={busy || !approvedCharacters.length} onClick={startCombat}><Play size={15}/>{busy ? "Iniciando..." : "Iniciar combate"}</button>}
      {isGm && encounter && <div className="room-combat-toolbar-actions"><button className="button button-secondary" type="button" disabled={busy} onClick={advanceTurn}><ChevronRight size={15}/> Próximo turno</button><button className="button button-secondary" type="button" disabled={busy} onClick={endCombat}><Flag size={14}/> Encerrar</button></div>}
    </div>
    {error && <p className="room-error" role="alert">{error}</p>}
    {!encounter ? <div className="panel room-combat-empty"><Swords size={28}/><strong>Nenhum combate ativo</strong><p>{isGm ? "Todos os personagens aprovados e NPCs ativos entrarão na iniciativa." : "Aguardando o mestre iniciar o combate."}</p><small>{approvedCharacters.length} combatentes disponíveis</small></div> : <>
      <div className="room-combat-status"><span><Timer size={14}/> Rodada {encounter.round_number}</span><strong>{currentCombatant ? `Vez de ${currentCombatant.character_name}` : "Aguardando turno"}</strong>{isMyTurn && <em>Sua vez</em>}</div>
      <div className="room-combatant-list">{activeCombatants.map((combatant, index) => <article key={combatant.id} className={index === encounter.turn_index ? "panel room-combatant active" : "panel room-combatant"}>
        <span className="room-combatant-order">{index + 1}</span><div className="room-combatant-info"><strong>{combatant.character_name}</strong><small>{combatant.side === "players" ? "Aventureiro" : combatant.side === "enemies" ? "Inimigo" : combatant.side === "allies" ? "Aliado" : "Neutro"} · Iniciativa {combatant.initiative}</small><div className="room-combatant-hp"><span style={{width: (combatant.max_hp > 0 ? Math.max(0,Math.min(100,combatant.current_hp/combatant.max_hp*100)) : 0) + "%"}}/></div><small>{combatant.current_hp} / {combatant.max_hp} PV</small></div>{index === encounter.turn_index && <CheckCircle2 size={18}/>}</article>)}</div>
      {isObserver && <p className="room-readonly-note">Você está acompanhando o combate como observador.</p>}
      <section className="panel room-combat-log"><div className="room-battle-heading"><div><span className="eyebrow">REGISTRO DA SESSÃO</span><h3>Histórico do combate</h3></div><button className="icon-button" type="button" onClick={loadCombat} aria-label="Atualizar histórico"><RefreshCw size={15}/></button></div>{events.length ? events.map((event) => <p key={event.id}><time>{new Date(event.created_at).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</time>{formatEvent(event)}</p>) : <small>Nenhuma ação registrada ainda.</small>}</section>
    </>}
  </div>;
}
