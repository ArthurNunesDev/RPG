import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ArrowDown, ArrowUp, Check, CheckCircle2, ChevronRight, CirclePause, CirclePlay, Flag, Lock, LockOpen, RefreshCw, Shield, SkipForward, Swords, Timer, UserCog, X } from "lucide-react";
import { supabase } from "../lib/supabase.js";
import { getOrderInitiative, getOrderVitals, rollDice } from "../lib/combat.js";

function getSide(character) {
  if (character.character_type === "player") return "players";
  if (character.npc_role === "enemy") return "enemies";
  if (character.npc_role === "ally") return "allies";
  return "neutral";
}
function getActions(character, kind) {
  const value = character?.sheet_snapshot?.[kind] ?? [];
  if (Array.isArray(value)) return value.filter((item) => item && typeof item === "object" && item.name);
  return typeof value === "string" ? value.split("\n").filter(Boolean).map((name) => ({ id: name, name, testFormula: "1d20", damageFormula: kind === "attacks" ? "2d10" : "", skill: "Luta" })) : [];
}

function getRequestAction(combatants, request) {
  const actor = combatants.find((item) => item.character_id === request.actor_character_id);
  const kind = request.action_type === "attack" ? "attacks" : "abilities";
  return getActions(actor, kind).find((action) => action.id === request.action_id || action.name === request.action_id) ?? null;
}
function describeEvent(event) {
  const result = event.result ?? {};
  return result.message || (event.event_type === "initiative" ? "Iniciativa registrada." : event.event_type);
}

export default function CombatPanel({ sessionId, campaignId, gameSystemId, characters, userId, isGm, isObserver }) {
  const [encounter, setEncounter] = useState(null);
  const [systemSlug, setSystemSlug] = useState("");
  const [combatants, setCombatants] = useState([]);
  const [events, setEvents] = useState([]);
  const [requests, setRequests] = useState([]);
  const [effects, setEffects] = useState([]);
  const [effectName, setEffectName] = useState("Veneno");
  const [effectDurationFormula, setEffectDurationFormula] = useState("1d5");
  const [effectDamageFormula, setEffectDamageFormula] = useState("1d4");
  const [effectDuplicateMode, setEffectDuplicateMode] = useState("refresh");
  const [editingEffectId, setEditingEffectId] = useState("");
  const [editingEffectName, setEditingEffectName] = useState("");
  const [editingEffectDamage, setEditingEffectDamage] = useState("0");
  const [editingEffectRounds, setEditingEffectRounds] = useState("1");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedActor, setSelectedActor] = useState("");
  const [selectedNewCombatant, setSelectedNewCombatant] = useState("");
  const [selectedTarget, setSelectedTarget] = useState("");
  const [selectedAction, setSelectedAction] = useState("");
  const [manualDamage, setManualDamage] = useState("0");
  const [manualHealing, setManualHealing] = useState("0");

  const loadCombat = useCallback(async (silent = false) => {
    if (!supabase || !sessionId) return;
    if (!silent) setLoading(true);
    try {
      const { data: active, error: encounterError } = await supabase.from("combat_encounters")
        .select("*").eq("session_id", sessionId).eq("status", "active").maybeSingle();
      if (encounterError) throw encounterError;
      setEncounter(active);
      if (!active) {
        setCombatants([]); setEvents([]); setRequests([]); setEffects([]);
        return;
      }
      const [cb, ev, rq, fx] = await Promise.all([
        supabase.from("combatants").select("*").eq("encounter_id", active.id).order("turn_order", { ascending: true }).order("id", { ascending: true }),
        supabase.from("combat_events").select("*").eq("encounter_id", active.id).order("created_at", { ascending: false }).limit(60),
        supabase.from("combat_action_requests").select("*").eq("encounter_id", active.id).order("requested_at", { ascending: false }).limit(30),
        supabase.from("combat_effects").select("*").eq("encounter_id", active.id).gt("remaining_rounds", 0).order("created_at", { ascending: true }),
      ]);
      if (cb.error) throw cb.error;
      if (ev.error) throw ev.error;
      if (rq.error) throw rq.error;
      if (fx.error) throw fx.error;

      const combatantIds = (cb.data ?? []).map((item) => item.id);
      let sheetRows = [];
      if (combatantIds.length) {
        const { data: sheets, error: sheetsError } = await supabase
          .from("combatant_sheets")
          .select("combatant_id,sheet_snapshot")
          .in("combatant_id", combatantIds);
        if (sheetsError) throw sheetsError;
        sheetRows = sheets ?? [];
      }
      const sheetByCombatant = new Map(sheetRows.map((item) => [item.combatant_id, item.sheet_snapshot]));
      setCombatants((cb.data ?? []).map((item) => ({ ...item, sheet_snapshot: sheetByCombatant.get(item.id) ?? null })));
      setEvents(ev.data ?? []); setRequests(rq.data ?? []); setEffects(fx.data ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar o combate.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    if (!gameSystemId) { setSystemSlug(""); return undefined; }
    supabase.from("game_systems").select("slug").eq("id", gameSystemId).maybeSingle()
      .then(({ data, error: systemError }) => {
        if (!cancelled) setSystemSlug(systemError ? "" : data?.slug || "");
      });
    return () => { cancelled = true; };
  }, [gameSystemId]);

  useEffect(() => { loadCombat(); }, [loadCombat]);
  useEffect(() => {
    if (!supabase || !sessionId) return undefined;
    const channel = supabase.channel("combat-live:" + sessionId)
      .on("postgres_changes", { event: "*", schema: "public", table: "combat_encounters", filter: "session_id=eq." + sessionId }, () => loadCombat(true));
    if (encounter?.id) {
      const filter = "encounter_id=eq." + encounter.id;
      channel
        .on("postgres_changes", { event: "*", schema: "public", table: "combatants", filter }, () => loadCombat(true))
        .on("postgres_changes", { event: "*", schema: "public", table: "combat_events", filter }, () => loadCombat(true))
        .on("postgres_changes", { event: "*", schema: "public", table: "combat_action_requests", filter }, () => loadCombat(true))
        .on("postgres_changes", { event: "*", schema: "public", table: "combat_effects", filter }, () => loadCombat(true));
    }
    channel.subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [sessionId, encounter?.id, loadCombat]);

  const isOrderSystem = systemSlug === "ordem-paranormal";
  const approvedCharacters = useMemo(() => characters.filter((item) =>
    item.campaign_id === campaignId && item.status === "active" &&
    (item.campaign_approval_status === "approved" || (isGm && item.character_type === "npc" && item.owner_id === userId))
  ), [characters, campaignId, isGm, userId]);
  const sortedCombatants = useMemo(() => [...combatants].sort((a, b) => a.turn_order - b.turn_order || a.id.localeCompare(b.id)), [combatants]);
  const eligibleCombatants = useMemo(() => sortedCombatants.filter((item) => item.is_active && !item.turn_blocked), [sortedCombatants]);
  const currentCombatant = eligibleCombatants[encounter?.turn_index ?? 0] ?? null;
  const ownCombatant = sortedCombatants.find((item) => item.owner_id === userId && item.side === "players" && item.is_active && !item.turn_blocked && item.turn_control === "player") ?? null;
  const pendingRequests = requests.filter((request) => request.status === "pending");
  const availableToAdd = approvedCharacters.filter((character) => !combatants.some((item) => item.character_id === character.id));
  const actorForControls = sortedCombatants.find((item) => item.character_id === selectedActor) ?? currentCombatant;
  const actorAttacks = getActions(actorForControls, "attacks");
  const actorAbilities = getActions(actorForControls, "abilities");
  const selectedActionObject = [...actorAttacks, ...actorAbilities].find((item) => item.id === selectedAction || item.name === selectedAction) ?? null;
  const targetCombatant = sortedCombatants.find((item) => item.character_id === selectedTarget) ?? null;
  const isMyTurn = Boolean(currentCombatant?.owner_id === userId && currentCombatant.turn_control === "player");

  const report = (message) => { setNotice(message); setError(""); };
  const fail = (err, fallback) => { setError(err instanceof Error ? err.message : fallback); setNotice(""); };

  const startCombat = async () => {
    if (!isGm || !isOrderSystem || busy || !approvedCharacters.length) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const ordered = approvedCharacters.map((character, index) => {
        const initiative = getOrderInitiative(character);
        const vitals = getOrderVitals(character);
        return {
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
          defense: Number(character.sheet?.vitals?.defense) || 10,
          sheet_snapshot: character.sheet && typeof character.sheet === "object" ? character.sheet : {},
          turn_order: index + 1,
          sort_order: index,
          turn_control: getSide(character) === "players" ? "player" : "gm",
        };
      }).sort((a, b) => b.initiative - a.initiative || a.sort_order - b.sort_order)
        .map((item, index) => ({ ...item, turn_order: index + 1, sort_order: index }));

      const { error: createError } = await supabase.rpc("start_combat_encounter", {
        p_session_id: sessionId,
        p_campaign_id: campaignId,
        p_game_system: "ordem-paranormal",
        p_combatants: ordered,
      });
      if (createError) throw createError;
      await loadCombat();
      report("Combate iniciado. O mestre pode ajustar a ordem e o controle de cada turno.");
    } catch (err) { fail(err, "Não foi possível iniciar o combate."); }
    finally { setBusy(false); }
  };

  const addCombatant = async () => {
    if (!isGm || !encounter || busy || !selectedNewCombatant) return;
    const character = availableToAdd.find((item) => item.id === selectedNewCombatant);
    if (!character) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const initiative = getOrderInitiative(character);
      const vitals = getOrderVitals(character);
      const { data, error: insertError } = await supabase.rpc("add_combatant_to_encounter", {
        p_encounter_id: encounter.id,
        p_combatant: {
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
          defense: Number(character.sheet?.vitals?.defense) || 10,
          turn_order: sortedCombatants.length ? Math.max(...sortedCombatants.map((item) => item.turn_order)) + 1 : 1,
          sort_order: sortedCombatants.length,
          turn_control: getSide(character) === "players" ? "player" : "gm",
          sheet_snapshot: character.sheet && typeof character.sheet === "object" ? character.sheet : {},
        },
      });
      if (insertError) throw insertError;
      setSelectedNewCombatant("");
      await loadCombat(true);
      report(data?.message || `${character.name} adicionado ao combate.`);
    } catch (err) { fail(err, "Não foi possível adicionar o combatente."); }
    finally { setBusy(false); }
  };

  const updateCombatant = async (combatant, patch, message) => {
    if (!isGm || busy || !encounter) return;
    setBusy(true);
    try {
      const { error: updateError } = await supabase.from("combatants").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", combatant.id);
      if (updateError) throw updateError;
      if (Object.prototype.hasOwnProperty.call(patch, "turn_blocked") || Object.prototype.hasOwnProperty.call(patch, "is_active")) {
        const { data: refreshed, error: refreshError } = await supabase.from("combatants")
          .select("id,is_active,turn_blocked,turn_order").eq("encounter_id", encounter.id).order("turn_order", { ascending: true });
        if (refreshError) throw refreshError;
        const available = (refreshed || []).filter((item) => item.is_active && !item.turn_blocked);
        const safeIndex = available.length ? Math.min(encounter.turn_index, available.length - 1) : 0;
        const { error: turnError } = await supabase.from("combat_encounters").update({ turn_index: safeIndex, updated_at: new Date().toISOString() }).eq("id", encounter.id);
        if (turnError) throw turnError;
      }
      await loadCombat(true); if (message) report(message);
    } catch (err) { fail(err, "Não foi possível atualizar o combatente."); }
    finally { setBusy(false); }
  };

  const setTurn = async (index, message = "Turno definido pelo mestre.") => {
    if (!isGm || !encounter || busy || index < 0 || index >= eligibleCombatants.length || eligibleCombatants[index]?.id === currentCombatant?.id) return;
    setBusy(true);
    try {
      const next = eligibleCombatants[index];
      const { data, error: turnError } = await supabase.rpc("advance_combat_turn", {
        p_encounter_id: encounter.id,
        p_target_character_id: next.character_id,
        p_advance_round: false,
        p_skip: false,
      });
      if (turnError) throw turnError;
      await loadCombat(true);
      report(data?.message || message);
    } catch (err) { fail(err, "Não foi possível definir o turno."); }
    finally { setBusy(false); }
  };

  const applyPeriodicEffect = async () => {
    if (!isGm || !encounter || !targetCombatant || !effectName.trim() || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const duration = rollDice(effectDurationFormula);
      const damage = rollDice(effectDamageFormula);
      if (!Number.isInteger(duration.total) || duration.total < 1 || duration.total > 100 || !Number.isInteger(damage.total) || damage.total < 0) {
        throw new Error("Duração ou dano inválido. Use duração entre 1 e 100 turnos e dano não negativo.");
      }
      const { data, error: applyError } = await supabase.rpc("apply_combat_effect", {
        p_encounter_id: encounter.id,
        p_target_character_id: targetCombatant.character_id,
        p_effect_name: effectName.trim(),
        p_duration: duration.total,
        p_damage: damage.total,
        p_duplicate_mode: effectDuplicateMode,
        p_source_name: actorForControls?.character_name || "Mestre",
      });
      if (applyError) throw applyError;
      await loadCombat(true);
      report(data?.message || "Efeito periódico aplicado.");
    } catch (err) { fail(err, "Não foi possível aplicar o efeito."); }
    finally { setBusy(false); }
  };

  const beginEditPeriodicEffect = (effect) => {
    setEditingEffectId(effect.id);
    setEditingEffectName(effect.effect_name);
    setEditingEffectDamage(String(effect.damage_per_round));
    setEditingEffectRounds(String(effect.remaining_rounds));
  };

  const savePeriodicEffect = async (effect) => {
    if (!isGm || busy) return;
    const damage = Number(editingEffectDamage);
    const rounds = Number(editingEffectRounds);
    if (!editingEffectName.trim() || !Number.isInteger(damage) || damage < 0 || !Number.isInteger(rounds) || rounds < 0 || rounds > 100) {
      setError("Informe um nome, dano não negativo e duração entre 0 e 100 turnos.");
      return;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      const { data, error: updateError } = await supabase.rpc("update_combat_effect", {
        p_effect_id: effect.id,
        p_effect_name: editingEffectName.trim(),
        p_damage: damage,
        p_remaining_rounds: rounds,
      });
      if (updateError) throw updateError;
      setEditingEffectId("");
      await loadCombat(true);
      report(data?.message || "Efeito atualizado.");
    } catch (err) { fail(err, "Não foi possível atualizar o efeito."); }
    finally { setBusy(false); }
  };

  const removePeriodicEffect = async (effect) => {
    if (!isGm || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const { data, error: updateError } = await supabase.rpc("update_combat_effect", {
        p_effect_id: effect.id,
        p_effect_name: effect.effect_name,
        p_damage: effect.damage_per_round,
        p_remaining_rounds: 0,
      });
      if (updateError) throw updateError;
      if (editingEffectId === effect.id) setEditingEffectId("");
      await loadCombat(true);
      report(data?.message || `${effect.effect_name} encerrado.`);
    } catch (err) { fail(err, "Não foi possível encerrar o efeito."); }
    finally { setBusy(false); }
  };

  const advanceTurn = async (skip = false) => {
    if (!isGm || !encounter || busy || !eligibleCombatants.length) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const { data, error: turnError } = await supabase.rpc("advance_combat_turn", {
        p_encounter_id: encounter.id,
        p_target_character_id: null,
        p_advance_round: true,
        p_skip: skip,
      });
      if (turnError) throw turnError;
      await loadCombat(true);
      report(data?.message || "Turno avançado.");
    } catch (err) { fail(err, "Não foi possível avançar o turno."); }
    finally { setBusy(false); }
  };

  const togglePause = async () => {
    if (!isGm || !encounter || busy) return;
    setBusy(true);
    try {
      const paused = !encounter.turns_paused;
      const { error: updateError } = await supabase.from("combat_encounters").update({ turns_paused: paused, updated_at: new Date().toISOString() }).eq("id", encounter.id);
      if (updateError) throw updateError;
      await loadCombat(true); report(paused ? "Turnos pausados." : "Turnos retomados.");
    } catch (err) { fail(err, "Não foi possível alterar os turnos."); }
    finally { setBusy(false); }
  };

  const reorderCombatant = async (combatant, direction) => {
    const index = sortedCombatants.findIndex((item) => item.id === combatant.id);
    const other = sortedCombatants[index + direction];
    if (!isGm || !other || busy) return;
    setBusy(true);
    try {
      const { error: swapError } = await supabase.rpc("swap_combatant_turn_order", {
        p_encounter_id: encounter.id,
        p_first_combatant_id: combatant.id,
        p_second_combatant_id: other.id,
      });
      if (swapError) throw swapError;
      await loadCombat(true);
    } catch (err) { fail(err, "Não foi possível reorganizar os turnos."); }
    finally { setBusy(false); }
  };

  const endCombat = async () => {
    if (!isGm || !encounter || busy) return;
    if (!window.confirm("Encerrar este combate? O histórico será preservado.")) return;
    setBusy(true);
    try {
      const { error: updateError } = await supabase.from("combat_encounters").update({ status: "completed", ended_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", encounter.id);
      if (updateError) throw updateError;
      await loadCombat(true); report("Combate encerrado. O histórico foi preservado.");
    } catch (err) { fail(err, "Não foi possível encerrar o combate."); }
    finally { setBusy(false); }
  };

  const submitAction = async (actor, target, action, kind, asGm = false) => {
    if (!encounter || !actor || !action || ((kind === "attack" || (kind === "ability" && (action.effectType !== "utility" || action.statusEffect))) && !target) || busy) return;
    const isReaction = ["dodge", "counterattack", "defend"].includes(action.actionType);
    if (!asGm && ((!isMyTurn && !isReaction) || encounter.turns_paused || actor.owner_id !== userId || actor.turn_blocked || actor.turn_control !== "player" || (isReaction && actor.actions_used?.reaction))) {
      setError("Você não pode agir neste turno. Aguarde a liberação do mestre."); return;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      const payload = {
        action: { name: action.name, description: action.description },
        message: `${actor.character_name} solicitou ${action.name}.`,
      };
      const { data: createdRequest, error: insertError } = await supabase.from("combat_action_requests").insert({
        encounter_id: encounter.id, actor_character_id: actor.character_id,
        target_character_id: target?.character_id ?? null, action_id: action.id || action.name,
        action_type: kind === "attack" ? "attack" : (["dodge","counterattack","defend"].includes(action.actionType) ? action.actionType : "ability"), payload, requested_by: userId,
      }).select("id").single();
      if (insertError) throw insertError;
      if (asGm) {
        const { data, error: resolveError } = await supabase.rpc("resolve_combat_action", {
          p_request_id: createdRequest.id,
          p_resolution: {},
        });
        if (resolveError) throw resolveError;
        report(data?.message || "Ação executada.");
      } else report("Ação enviada ao mestre para confirmação.");
      setSelectedAction("");
      await loadCombat(true);
    } catch (err) { fail(err, "Não foi possível executar a ação."); }
    finally { setBusy(false); }
  };

  const resolveRequest = async (request, approved) => {
    if (!isGm || busy) return;
    setBusy(true); setError(""); setNotice("");
    let resolvedMessage = "";
    try {
      if (approved) {
        const { data, error: rpcError } = await supabase.rpc("resolve_combat_action", {
          p_request_id: request.id,
          p_resolution: {},
        });
        if (rpcError) throw rpcError;
        resolvedMessage = data?.message || "Ação aprovada e aplicada.";
      } else {
        const { error: updateError } = await supabase.from("combat_action_requests").update({
          status: "rejected", resolved_by: userId, resolved_at: new Date().toISOString(),
        }).eq("id", request.id).eq("status", "pending");
        if (updateError) throw updateError;
      }
      await loadCombat(true); report(approved ? (resolvedMessage || "Ação aprovada e aplicada.") : "Ação recusada.");
    } catch (err) { fail(err, "Não foi possível resolver a solicitação."); }
    finally { setBusy(false); }
  };

  const applyManualChange = async () => {
    if (!isGm || !encounter || !targetCombatant || busy) return;
    const damage = Math.max(0, Number(manualDamage) || 0);
    const healing = Math.max(0, Number(manualHealing) || 0);
    if (!damage && !healing) return;
    if (damage > 0 && healing > 0) { setError("Aplique dano ou cura em uma operação por vez."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const { data, error: updateError } = await supabase.rpc("apply_manual_combat_vitals", {
        p_combatant_id: targetCombatant.id,
        p_damage: damage,
        p_healing: healing,
      });
      if (updateError) throw updateError;
      setManualDamage("0"); setManualHealing("0");
      await loadCombat(true);
      report(data?.message || "Pontos de vida atualizados.");
    } catch (err) { fail(err, "Não foi possível alterar os pontos de vida."); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="panel room-combat-empty">Carregando estrutura de combate...</div>;
  return <div className="room-combat-system">
    <div className="room-combat-toolbar">
      <div><span className="eyebrow">ORDEM PARANORMAL</span><h3>{encounter ? `Combate · Rodada ${encounter.round_number}` : "Preparação do combate"}</h3><p>{encounter ? "O mestre controla a ordem, a liberação e o bloqueio de cada turno." : "O mestre inicia o encontro e define quem poderá agir."}</p></div>
      {isGm && !encounter && <button className="button button-primary" type="button" disabled={busy || !isOrderSystem || !approvedCharacters.length} onClick={startCombat}><Swords size={15}/>{busy ? "Iniciando..." : "Iniciar combate"}</button>}
      {isGm && encounter && <div className="room-combat-toolbar-actions">
        <button className="button button-secondary" type="button" disabled={busy} onClick={togglePause}>{encounter.turns_paused ? <CirclePlay size={15}/> : <CirclePause size={15}/>} {encounter.turns_paused ? "Retomar" : "Pausar"}</button>
        <button className="button button-secondary" type="button" disabled={busy || !eligibleCombatants.length} onClick={() => advanceTurn()}><ChevronRight size={15}/> Próximo turno</button>
        <button className="button button-secondary" type="button" disabled={busy} onClick={endCombat}><Flag size={14}/> Encerrar</button>
      </div>}
    </div>
    {!isOrderSystem && <p className="room-readonly-note">O motor de combate está disponível inicialmente para campanhas de Ordem Paranormal. Os demais sistemas serão integrados em etapas próprias.</p>}
    {error && <p className="room-error" role="alert">{error}</p>}
    {notice && <p className="room-combat-notice" role="status">{notice}</p>}
    {!encounter ? <div className="panel room-combat-empty"><Swords size={28}/><strong>Nenhum combate ativo</strong><p>{isGm ? "Personagens aprovados e NPCs criados pelo mestre estarão disponíveis na iniciativa." : "Aguardando o mestre iniciar o combate."}</p><small>{approvedCharacters.length} combatentes disponíveis</small></div> : <>
      <div className="room-combat-status"><span><Timer size={14}/> Rodada {encounter.round_number}</span><strong>{encounter.turns_paused ? "Turnos pausados" : currentCombatant ? `Vez de ${currentCombatant.character_name}` : "Sem turno liberado"}</strong>{isMyTurn && !encounter.turns_paused && <em>Sua vez</em>}</div>
      <div className="room-combat-layout">
        <section className="room-combat-main">
          <div className="room-combatant-list">{sortedCombatants.map((combatant, index) => {
            const activeIndex = eligibleCombatants.findIndex((item) => item.id === combatant.id);
            const isCurrent = activeIndex === encounter.turn_index && activeIndex >= 0;
            return <article key={combatant.id} className={`panel room-combatant ${isCurrent ? "active" : ""} ${combatant.turn_blocked ? "blocked" : ""}`}>
              <span className="room-combatant-order">{index + 1}</span>
              <div className="room-combatant-info"><strong>{combatant.character_name}</strong><small>{combatant.side === "players" ? "Jogador" : combatant.side === "enemies" ? "Inimigo" : combatant.side === "allies" ? "Aliado" : "Neutro"} · Iniciativa {combatant.initiative} · Defesa {combatant.defense}</small>
                <div className="room-combatant-hp"><span style={{width:(combatant.max_hp>0?Math.max(0,Math.min(100,combatant.current_hp/combatant.max_hp*100)):0)+"%"}}/></div>
                <small>{combatant.current_hp}/{combatant.max_hp} PV · {combatant.current_pe}/{combatant.max_pe} PE</small>
                <small>{!combatant.is_active ? "Fora de combate" : combatant.turn_blocked ? "Turno bloqueado" : combatant.turn_control === "player" ? "Ação do jogador liberada" : "Ação controlada pelo mestre"}</small>
                {combatant.conditions?.length > 0 && <small className="room-combat-conditions">Condições: {combatant.conditions.join(", ")}</small>}
              </div>
              {isCurrent && <CheckCircle2 size={18}/>}
              {isGm && <div className="room-combatant-controls">
                <button className="icon-button" type="button" aria-label="Mover para cima" disabled={busy || index===0} onClick={() => reorderCombatant(combatant,-1)}><ArrowUp size={14}/></button>
                <button className="icon-button" type="button" aria-label="Mover para baixo" disabled={busy || index===sortedCombatants.length-1} onClick={() => reorderCombatant(combatant,1)}><ArrowDown size={14}/></button>
                <button className="icon-button" type="button" aria-label={combatant.turn_blocked ? "Desbloquear turno" : "Bloquear turno"} disabled={busy} onClick={() => updateCombatant(combatant,{turn_blocked:!combatant.turn_blocked},"Permissão de turno atualizada.")}>{combatant.turn_blocked?<Lock size={14}/>:<LockOpen size={14}/>}</button>
                <button className="icon-button" type="button" aria-label="Alternar controle do turno" disabled={busy} onClick={() => updateCombatant(combatant,{turn_control:combatant.turn_control==="player"?"gm":"player"},"Controle do turno atualizado.")}><UserCog size={14}/></button>
                <button className="icon-button" type="button" aria-label={combatant.is_active ? "Marcar fora de combate" : "Reativar combatente"} disabled={busy} onClick={() => updateCombatant(combatant,{is_active:!combatant.is_active},"Estado do combatente atualizado.")}>{combatant.is_active?<X size={14}/>:<Check size={14}/>}</button>
                {combatant.conditions?.length > 0 && <button className="icon-button" type="button" aria-label="Remover condições" disabled={busy} onClick={() => updateCombatant(combatant,{conditions:[]},"Condições removidas.")}><Shield size={14}/></button>}
                {!combatant.turn_blocked && combatant.is_active && <button className="icon-button" type="button" aria-label="Definir como turno atual" disabled={busy || activeIndex === encounter.turn_index} onClick={() => setTurn(activeIndex)}><Check size={14}/></button>}
              </div>}
            </article>;
          })}</div>
          {isGm && <div className="panel room-combat-admin">
            <div className="room-battle-heading"><div><span className="eyebrow">CONTROLE DO MESTRE</span><h3>Ajustes de combate</h3></div><Shield size={18}/></div>
            <label className="room-combat-field"><span>Combatente para gerenciar</span><select value={selectedActor} onChange={(event)=>{setSelectedActor(event.target.value);setSelectedAction("");}}><option value="">Selecione</option>{sortedCombatants.map((item)=><option key={item.id} value={item.character_id}>{item.character_name}</option>)}</select></label>
            {actorForControls && <div className="room-combat-actions-row"><label><span>Dano</span><input type="number" min="0" value={manualDamage} onChange={(e)=>setManualDamage(e.target.value)}/></label><label><span>Cura</span><input type="number" min="0" value={manualHealing} onChange={(e)=>setManualHealing(e.target.value)}/></label><button className="button button-secondary" type="button" disabled={busy || !targetCombatant || (!Number(manualDamage)&&!Number(manualHealing))} onClick={applyManualChange}>Aplicar ao alvo</button></div>}
            <label className="room-combat-field"><span>Alvo para dano ou cura</span><select value={selectedTarget} onChange={(e)=>setSelectedTarget(e.target.value)}><option value="">Selecione o alvo</option>{sortedCombatants.map((item)=><option key={item.id} value={item.character_id}>{item.character_name}</option>)}</select></label>
            {actorForControls && <div className="room-combat-actions-row"><label><span>Ação do combatente</span><select value={selectedAction} onChange={(e)=>setSelectedAction(e.target.value)}><option value="">Selecione ataque/habilidade</option>{actorAttacks.map((a,i)=><option key={a.id||i} value={a.id||a.name}>Ataque · {a.name}</option>)}{actorAbilities.map((a,i)=><option key={a.id||i} value={a.id||a.name}>Habilidade · {a.name}</option>)}</select></label><button className="button button-primary" type="button" disabled={busy || !selectedActionObject || (actorAttacks.includes(selectedActionObject)&&!targetCombatant)||((selectedActionObject?.effectType!=="utility"||selectedActionObject?.statusEffect)&&actorAbilities.includes(selectedActionObject)&&!targetCombatant)} onClick={()=>submitAction(actorForControls,targetCombatant,selectedActionObject,actorAttacks.includes(selectedActionObject)?"attack":"ability",true)}>Executar ação</button></div>}
            <div className="room-combat-actions-row"><label><span>Adicionar personagem / NPC</span><select value={selectedNewCombatant} onChange={(e)=>setSelectedNewCombatant(e.target.value)}><option value="">Selecione</option>{availableToAdd.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button className="button button-secondary" type="button" disabled={busy || !selectedNewCombatant} onClick={addCombatant}>Adicionar</button></div>
            <div className="room-combat-actions-row"><label><span>Efeito periódico</span><input value={effectName} onChange={(e)=>setEffectName(e.target.value)} placeholder="Veneno"/></label><label><span>Duração (dados)</span><input value={effectDurationFormula} onChange={(e)=>setEffectDurationFormula(e.target.value)} placeholder="1d5"/></label><label><span>Dano por turno</span><input value={effectDamageFormula} onChange={(e)=>setEffectDamageFormula(e.target.value)} placeholder="1d4"/></label><label><span>Se já existir</span><select value={effectDuplicateMode} onChange={(e)=>setEffectDuplicateMode(e.target.value)}><option value="refresh">Renovar duração</option><option value="replace">Substituir</option><option value="stack">Acumular</option></select></label><button className="button button-secondary" type="button" disabled={busy||!targetCombatant||!effectName.trim()} onClick={applyPeriodicEffect}>Aplicar efeito</button></div>
            <button className="button button-secondary" type="button" disabled={busy || !eligibleCombatants.length} onClick={()=>advanceTurn(true)}><SkipForward size={14}/> Pular turno atual</button>
          </div>}
          {!isGm && currentCombatant?.owner_id===userId && currentCombatant.turn_control==="player" && !currentCombatant.turn_blocked && !encounter.turns_paused && !isObserver && <div className="panel room-player-actions">
            <span className="eyebrow">SEU TURNO</span><h3>Escolha sua ação</h3>
            <label className="room-combat-field"><span>Alvo</span><select value={selectedTarget} onChange={(e)=>setSelectedTarget(e.target.value)}><option value="">Selecione o alvo</option>{sortedCombatants.filter((item)=>item.character_id!==currentCombatant.character_id&&item.is_active&&!item.turn_blocked).map((item)=><option key={item.id} value={item.character_id}>{item.character_name} · {item.current_hp}/{item.max_hp} PV</option>)}</select></label>
            <div className="room-combat-action-cards">{[...getActions(currentCombatant,"attacks").map((a)=>({...a,kind:"attack"})),...getActions(currentCombatant,"abilities").map((a)=>({...a,kind:"ability"}))].map((action,index)=><article key={action.id||index}><div><strong>{action.name}</strong><small>{action.kind==="attack"?(action.damageFormula||"Sem dano definido"):(action.actionType==="dodge"?"Esquiva":action.actionType==="counterattack"?"Contra-ataque":action.actionType==="defend"?"Defesa":"Habilidade")} · {Number(action.peCost)||0} PE</small><p>{action.description}</p></div><button className="button button-secondary" type="button" disabled={busy || ((action.kind==="attack"||(action.kind==="ability"&&(action.effectType!=="utility"||action.statusEffect)))&&!targetCombatant)} onClick={()=>submitAction(currentCombatant,targetCombatant,action,action.kind,false)}>Usar</button></article>)}</div>
            {!getActions(currentCombatant,"attacks").length&&!getActions(currentCombatant,"abilities").length&&<p className="room-readonly-note">Sua ficha ainda não possui ataques ou habilidades cadastrados.</p>}
          </div>}
          {!isGm && !isObserver && ownCombatant && !isMyTurn && !encounter.turns_paused && <div className="panel room-player-actions room-player-reactions">
            <span className="eyebrow">REAÇÃO DISPONÍVEL</span><h3>Esquiva e contra-ataque</h3>
            <p>Você pode usar uma reação por rodada. O mestre receberá a solicitação para confirmar o resultado.</p>
            <label className="room-combat-field"><span>Alvo da reação (quando necessário)</span><select value={selectedTarget} onChange={(e)=>setSelectedTarget(e.target.value)}><option value="">Selecione</option>{sortedCombatants.filter((item)=>item.side==="enemies"&&item.is_active).map((item)=><option key={item.id} value={item.character_id}>{item.character_name}</option>)}</select></label>
            <div className="room-combat-action-cards">{getActions(ownCombatant,"abilities").filter((action)=>["dodge","counterattack","defend"].includes(action.actionType)).map((action,index)=><article key={action.id||index}><div><strong>{action.actionType==="dodge"?"Esquiva":action.actionType==="counterattack"?"Contra-ataque":"Defender"} · {action.name}</strong><small>Reação · {Number(action.peCost)||0} PE</small><p>{action.description}</p></div><button className="button button-secondary" type="button" disabled={busy||ownCombatant.actions_used?.reaction||((action.actionType==="counterattack"||action.effectType==="damage")&&!targetCombatant)} onClick={()=>submitAction(ownCombatant,targetCombatant,action,"ability",false)}>Reagir</button></article>)}</div>
            {ownCombatant.actions_used?.reaction && <small>Reação já utilizada nesta rodada.</small>}
            {!getActions(ownCombatant,"abilities").some((action)=>["dodge","counterattack","defend"].includes(action.actionType)) && <small>Cadastre esquiva, contra-ataque ou defesa como reação na ficha.</small>}
          </div>}
          {isObserver && <p className="room-readonly-note">Você está acompanhando o combate como observador.</p>}
        </section>
        <aside className="room-combat-side">
          {isGm && <section className="panel room-combat-requests"><div className="room-battle-heading"><div><span className="eyebrow">AGUARDANDO MESTRE</span><h3>Solicitações ({pendingRequests.length})</h3></div><Activity size={17}/></div>
            {pendingRequests.length ? pendingRequests.map((request) => {
              const actor = combatants.find((item) => item.character_id === request.actor_character_id);
              const action = getRequestAction(combatants, request);
              return <article key={request.id}>
                <strong>{actor?.character_name || "Personagem"} · {action?.name || "Ação não encontrada na ficha"}</strong>
                <small>{action?.description || "Ação solicitada"}</small>
                <div>
                  <button className="button button-primary" type="button" disabled={busy || !action} onClick={() => resolveRequest(request, true)}>Aprovar e aplicar</button>
                  <button className="button button-secondary" type="button" disabled={busy} onClick={() => resolveRequest(request, false)}>Recusar</button>
                </div>
              </article>;
            }) : <small>Nenhuma ação aguardando aprovação.</small>}
          </section>}
          {effects.length>0 && <section className="panel room-combat-effects"><div className="room-battle-heading"><div><span className="eyebrow">EFEITOS ATIVOS</span><h3>Durações e condições</h3></div><Timer size={17}/></div>{effects.map((effect)=><article key={effect.id}><div><strong>{effect.effect_name} · {effect.target_name}</strong><small>{effect.damage_per_round} de dano por turno · {effect.remaining_rounds} turno(s) restante(s)</small></div>{isGm && (editingEffectId === effect.id ? <div className="room-combat-actions-row"><label><span>Nome</span><input value={editingEffectName} onChange={(e)=>setEditingEffectName(e.target.value)}/></label><label><span>Dano por turno</span><input type="number" min="0" value={editingEffectDamage} onChange={(e)=>setEditingEffectDamage(e.target.value)}/></label><label><span>Turnos restantes</span><input type="number" min="0" max="100" value={editingEffectRounds} onChange={(e)=>setEditingEffectRounds(e.target.value)}/></label><button className="button button-primary" type="button" disabled={busy} onClick={()=>savePeriodicEffect(effect)}>Salvar</button><button className="button button-secondary" type="button" disabled={busy} onClick={()=>setEditingEffectId("")}>Cancelar</button></div> : <div className="room-combat-actions-row"><button className="button button-secondary" type="button" disabled={busy} onClick={()=>beginEditPeriodicEffect(effect)}>Editar</button><button className="button button-secondary" type="button" disabled={busy} onClick={()=>removePeriodicEffect(effect)}>Encerrar</button></div>)}</article>)}</section>}<section className="panel room-combat-log"><div className="room-battle-heading"><div><span className="eyebrow">REGISTRO DA SESSÃO</span><h3>Histórico do combate</h3></div><button className="icon-button" type="button" onClick={()=>loadCombat()} aria-label="Atualizar histórico"><RefreshCw size={15}/></button></div>{events.length?events.map((event)=><p key={event.id}><time>{new Date(event.created_at).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</time>{describeEvent(event)}</p>):<small>Nenhuma ação registrada ainda.</small>}</section>
        </aside>
      </div>
    </>}
  </div>;
}
