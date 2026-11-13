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
  return typeof value === "string" ? value.split("\n").filter(Boolean).map((name, index) => ({ id: kind + index, name, testFormula: "1d20", damageFormula: kind === "attacks" ? "2d10" : "", skill: "Luta" })) : [];
}
function getSkillBonus(sheet, skillName) {
  const skill = sheet?.skills?.[skillName] ?? {};
  return Number(skill.training || 0) + Number(skill.bonus || 0) + Number(skill.other || 0);
}
function resolveActionRoll(actor, target, action, kind) {
  const effectType = action.effectType || (kind === "attack" ? "damage" : "utility");
  if (kind === "ability" && effectType === "healing") {
    if (!target) throw new Error("Selecione o alvo que receberá a cura.");
    const healing = action.healingFormula ? rollDice(action.healingFormula) : { total: 0, rolls: [] };
    return { outcome: "healing", healing, totalHealing: healing.total, message: `${action.name}: cura de ${healing.total} PV.` };
  }
  if (kind === "ability" && effectType === "utility") {
    const test = rollDice(action.testFormula || "1d20");
    return { outcome: "utility", attackRoll: test, totalDamage: 0, totalHealing: 0, message: `${action.name}: resultado ${test.total}.` };
  }
  if (!target) throw new Error("Selecione um alvo para esta ação.");
  const attackRoll = rollDice(action.testFormula || "1d20");
  const bonus = getSkillBonus(actor.sheet_snapshot, action.skill || "Luta");
  const totalAttack = { ...attackRoll, total: attackRoll.total + bonus };
  const disaster = attackRoll.minimum;
  const hit = !disaster && totalAttack.total >= Number(target.defense || 10);
  let damage = null;
  let criticalExtra = null;
  if (hit && action.damageFormula) {
    damage = rollDice(action.damageFormula);
    if (damage.maximum && action.criticalExtraFormula) criticalExtra = rollDice(action.criticalExtraFormula);
  }
  return {
    outcome: disaster ? "disaster" : !hit ? "miss" : damage?.maximum ? "critical" : "hit",
    attackRoll: { ...totalAttack, bonus }, defense: Number(target.defense || 10),
    damage, criticalExtra, totalDamage: (damage?.total || 0) + (criticalExtra?.total || 0),
    totalHealing: 0,
    message: disaster ? "Desastre: resultado mínimo no dado. O mestre define a consequência."
      : !hit ? "Ataque não superou a defesa do alvo."
      : damage?.maximum ? "Acerto crítico: dano máximo no dado."
      : kind === "attack" ? "Ataque acertou." : "Habilidade acertou.",
  };
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
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedActor, setSelectedActor] = useState("");
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
        setCombatants([]); setEvents([]); setRequests([]);
        return;
      }
      const [cb, ev, rq, sheets] = await Promise.all([
        supabase.from("combatants").select("*").eq("encounter_id", active.id).order("turn_order", { ascending: true }),
        supabase.from("combat_events").select("*").eq("encounter_id", active.id).order("created_at", { ascending: false }).limit(60),
        supabase.from("combat_action_requests").select("*").eq("encounter_id", active.id).order("requested_at", { ascending: false }).limit(30),
        supabase.from("combatant_sheets").select("combatant_id,sheet_snapshot"),
      ]);
      if (cb.error) throw cb.error;
      if (ev.error) throw ev.error;
      if (rq.error) throw rq.error;
      if (sheets.error) throw sheets.error;
      const sheetByCombatant = new Map((sheets.data ?? []).map((item) => [item.combatant_id, item.sheet_snapshot]));
      setCombatants((cb.data ?? []).map((item) => ({ ...item, sheet_snapshot: sheetByCombatant.get(item.id) ?? null })));
      setEvents(ev.data ?? []); setRequests(rq.data ?? []);
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
      .on("postgres_changes", { event: "*", schema: "public", table: "combat_encounters", filter: "session_id=eq." + sessionId }, () => loadCombat(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "combatants" }, () => loadCombat(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "combat_events" }, () => loadCombat(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "combat_action_requests" }, () => loadCombat(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "combatant_sheets" }, () => loadCombat(true))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [sessionId, loadCombat]);

  const isOrderSystem = systemSlug === "ordem-paranormal";\n  const approvedCharacters = useMemo(() => characters.filter((item) =>
    item.campaign_id === campaignId && item.status === "active" &&
    (item.campaign_approval_status === "approved" || (isGm && item.character_type === "npc" && item.owner_id === userId))
  ), [characters, campaignId, isGm, userId]);
  const sortedCombatants = useMemo(() => [...combatants].sort((a, b) => a.turn_order - b.turn_order), [combatants]);
  const eligibleCombatants = useMemo(() => sortedCombatants.filter((item) => item.is_active && !item.turn_blocked), [sortedCombatants]);
  const currentCombatant = eligibleCombatants[encounter?.turn_index ?? 0] ?? null;
  const pendingRequests = requests.filter((request) => request.status === "pending");
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
      const { data: created, error: createError } = await supabase.from("combat_encounters").insert({
        session_id: sessionId, campaign_id: campaignId, game_system: "ordem-paranormal", started_by: userId,
      }).select("*").single();
      if (createError) throw createError;
      const ordered = approvedCharacters.map((character, index) => {
        const initiative = getOrderInitiative(character);
        const vitals = getOrderVitals(character);
        return {
          encounter_id: created.id, character_id: character.id, character_name: character.name,
          owner_id: character.owner_id, side: getSide(character), initiative: initiative.total,
          initiative_rolls: initiative.rolls, current_hp: vitals.hp, max_hp: vitals.hpMax,
          current_pe: vitals.pe, max_pe: vitals.peMax, current_pd: vitals.pd, max_pd: vitals.pdMax,
          defense: Number(character.sheet?.vitals?.defense) || 10,
          sheet_snapshot: character.sheet && typeof character.sheet === "object" ? character.sheet : {},
          turn_order: index + 1, sort_order: index, turn_control: getSide(character) === "players" ? "player" : "gm",
        };
      }).sort((a, b) => b.initiative - a.initiative || a.sort_order - b.sort_order)
        .map((item, index) => ({ ...item, turn_order: index + 1, sort_order: index }));
      const combatantRows = ordered.map(({ sheet_snapshot, ...item }) => item);
      const { data: insertedCombatants, error: insertError } = await supabase.from("combatants").insert(combatantRows).select("id,character_id,owner_id");
      if (insertError) throw insertError;
      const sheetRows = insertedCombatants.map((item) => ({
        combatant_id: item.id, character_id: item.character_id, owner_id: item.owner_id,
        sheet_snapshot: ordered.find((combatant) => combatant.character_id === item.character_id)?.sheet_snapshot ?? {},
      }));
      const { error: sheetError } = await supabase.from("combatant_sheets").insert(sheetRows);
      if (sheetError) {
        await supabase.from("combat_encounters").delete().eq("id", created.id);
        throw sheetError;
      }
      const { error: eventError } = await supabase.from("combat_events").insert(ordered.map((item) => ({
        encounter_id: created.id, actor_character_id: item.character_id, actor_name: item.character_name,
        event_type: "initiative", result: { total: item.initiative, rolls: item.initiative_rolls }, created_by: userId,
      })));
      if (eventError) throw eventError;
      await loadCombat();
      report("Combate iniciado. O mestre pode ajustar a ordem e o controle de cada turno.");
    } catch (err) { fail(err, "Não foi possível iniciar o combate."); }
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
    if (!isGm || !encounter || busy || index < 0 || index >= eligibleCombatants.length) return;
    setBusy(true);
    try {
      const next = eligibleCombatants[index];
      const { error: updateError } = await supabase.from("combat_encounters").update({
        turn_index: index, current_turn_note: "", updated_at: new Date().toISOString(),
      }).eq("id", encounter.id);
      if (updateError) throw updateError;
      const { error: eventError } = await supabase.from("combat_events").insert({
        encounter_id: encounter.id, actor_character_id: next.character_id, actor_name: next.character_name,
        event_type: "turn", result: { message: `Mestre definiu o turno de ${next.character_name}.` }, created_by: userId,
      });
      if (eventError) throw eventError;
      await loadCombat(true); report(message);
    } catch (err) { fail(err, "Não foi possível definir o turno."); }
    finally { setBusy(false); }
  };

  const advanceTurn = async (skip = false) => {
    if (!isGm || !encounter || busy || !eligibleCombatants.length) return;
    setBusy(true);
    try {
      const nextIndex = (encounter.turn_index + 1) % eligibleCombatants.length;
      const nextRound = nextIndex === 0 ? encounter.round_number + 1 : encounter.round_number;
      const next = eligibleCombatants[nextIndex];
      const { error: updateError } = await supabase.from("combat_encounters").update({
        turn_index: nextIndex, round_number: nextRound, current_turn_note: "", updated_at: new Date().toISOString(),
      }).eq("id", encounter.id);
      if (updateError) throw updateError;
      if (nextRound !== encounter.round_number) {
        const { error: resetError } = await supabase.from("combatants").update({
          actions_used: { standard: false, movement: false, reaction: false }, updated_at: new Date().toISOString(),
        }).eq("encounter_id", encounter.id).eq("is_active", true);
        if (resetError) throw resetError;
      }
      const { error: eventError } = await supabase.from("combat_events").insert({
        encounter_id: encounter.id, actor_character_id: next.character_id, actor_name: next.character_name,
        event_type: "turn", result: { message: `${skip ? "Turno pulado. " : ""}${nextRound !== encounter.round_number ? `Rodada ${nextRound} iniciada.` : `Vez de ${next.character_name}.`}` }, created_by: userId,
      });
      if (eventError) throw eventError;
      await loadCombat(true);
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
      const updates = await Promise.all([
        supabase.from("combatants").update({ turn_order: other.turn_order, updated_at: new Date().toISOString() }).eq("id", combatant.id),
        supabase.from("combatants").update({ turn_order: combatant.turn_order, updated_at: new Date().toISOString() }).eq("id", other.id),
      ]);
      const failed = updates.find((item) => item.error);
      if (failed?.error) throw failed.error;
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
    if (!encounter || !actor || !action || ((kind === "attack" || (kind === "ability" && action.effectType !== "utility")) && !target) || busy) return;
    if (!asGm && (!isMyTurn || encounter.turns_paused || actor.owner_id !== userId || actor.turn_blocked || actor.turn_control !== "player")) {
      setError("Você não pode agir neste turno. Aguarde a liberação do mestre."); return;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      const result = target ? resolveActionRoll(actor, target, action, kind) : null;
      const payload = {
        action: { name: action.name, description: action.description, skill: action.skill, testFormula: action.testFormula, damageFormula: action.damageFormula, criticalExtraFormula: action.criticalExtraFormula, healingFormula: action.healingFormula, effectType: action.effectType, statusEffect: action.statusEffect, actionCost: action.actionCost || "padrão", peCost: Number(action.peCost) || 0 },
        roll: result,
        totalDamage: result?.totalDamage || 0,
        message: result?.message || `${actor.character_name} usou ${action.name}.`,
      };
      const { data: createdRequest, error: insertError } = await supabase.from("combat_action_requests").insert({
        encounter_id: encounter.id, actor_character_id: actor.character_id,
        target_character_id: target?.character_id ?? null, action_id: action.id || action.name,
        action_type: kind === "attack" ? "attack" : "ability", payload, requested_by: userId,
      }).select("id").single();
      if (insertError) throw insertError;
      if (asGm) {
        const { data, error: resolveError } = await supabase.rpc("resolve_combat_action", {
          p_request_id: createdRequest.id,
          p_resolution: { damage: result?.totalDamage || 0, healing: result?.totalHealing || 0, pe_cost: Number(action.peCost) || 0, message: payload.message, condition: action.statusEffect || null },
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
    try {
      if (approved) {
        const result = request.payload?.roll;
        const { error: rpcError } = await supabase.rpc("resolve_combat_action", {
          p_request_id: request.id,
          p_resolution: {
            damage: result?.totalDamage || 0,
            pe_cost: Number(request.payload?.action?.peCost) || 0,
            healing: result?.totalHealing || 0,
            message: request.payload?.message || "Ação aprovada pelo mestre.",
            condition: request.payload?.action?.statusEffect || null,
          },
        });
        if (rpcError) throw rpcError;
      } else {
        const { error: updateError } = await supabase.from("combat_action_requests").update({
          status: "rejected", resolved_by: userId, resolved_at: new Date().toISOString(),
        }).eq("id", request.id).eq("status", "pending");
        if (updateError) throw updateError;
      }
      await loadCombat(true); report(approved ? "Ação aprovada e aplicada." : "Ação recusada.");
    } catch (err) { fail(err, "Não foi possível resolver a solicitação."); }
    finally { setBusy(false); }
  };

  const applyManualChange = async () => {
    if (!isGm || !encounter || !targetCombatant || busy) return;
    const damage = Math.max(0, Number(manualDamage) || 0);
    const healing = Math.max(0, Number(manualHealing) || 0);
    if (!damage && !healing) return;
    setBusy(true);
    try {
      const hp = Math.max(0, Math.min(targetCombatant.max_hp, targetCombatant.current_hp - damage + healing));
      const snapshot = targetCombatant.sheet_snapshot && typeof targetCombatant.sheet_snapshot === "object" ? targetCombatant.sheet_snapshot : {};
      const nextSheet = { ...snapshot, vitals: { ...(snapshot.vitals || {}), hp } };
      const { error: characterError } = await supabase.from("characters").update({ sheet: nextSheet, updated_at: new Date().toISOString() }).eq("id", targetCombatant.character_id);
      if (characterError) throw characterError;
      const { error: updateError } = await supabase.from("combatants").update({ current_hp: hp, sheet_snapshot: nextSheet, updated_at: new Date().toISOString() }).eq("id", targetCombatant.id);
      if (updateError) throw updateError;
      const { error: eventError } = await supabase.from("combat_events").insert({
        encounter_id: encounter.id, actor_character_id: null, target_character_id: targetCombatant.character_id,
        actor_name: "Mestre", target_name: targetCombatant.character_name,
        event_type: healing ? "healing" : "damage",
        result: { message: healing ? `Mestre recuperou ${healing} PV de ${targetCombatant.character_name}.` : `Mestre aplicou ${damage} de dano em ${targetCombatant.character_name}.`, damage, healing },
        created_by: userId,
      });
      if (eventError) throw eventError;
      setManualDamage("0"); setManualHealing("0"); await loadCombat(true); report("Pontos de vida atualizados.");
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
                {!combatant.turn_blocked && combatant.is_active && <button className="icon-button" type="button" aria-label="Definir como turno atual" disabled={busy} onClick={() => setTurn(activeIndex)}><Check size={14}/></button>}
              </div>}
            </article>;
          })}</div>
          {isGm && <div className="panel room-combat-admin">
            <div className="room-battle-heading"><div><span className="eyebrow">CONTROLE DO MESTRE</span><h3>Ajustes de combate</h3></div><Shield size={18}/></div>
            <label className="room-combat-field"><span>Combatente para gerenciar</span><select value={selectedActor} onChange={(event)=>{setSelectedActor(event.target.value);setSelectedAction("");}}><option value="">Selecione</option>{sortedCombatants.map((item)=><option key={item.id} value={item.character_id}>{item.character_name}</option>)}</select></label>
            {actorForControls && <div className="room-combat-actions-row"><label><span>Dano</span><input type="number" min="0" value={manualDamage} onChange={(e)=>setManualDamage(e.target.value)}/></label><label><span>Cura</span><input type="number" min="0" value={manualHealing} onChange={(e)=>setManualHealing(e.target.value)}/></label><button className="button button-secondary" type="button" disabled={busy || !targetCombatant || (!Number(manualDamage)&&!Number(manualHealing))} onClick={applyManualChange}>Aplicar ao alvo</button></div>}
            <label className="room-combat-field"><span>Alvo para dano ou cura</span><select value={selectedTarget} onChange={(e)=>setSelectedTarget(e.target.value)}><option value="">Selecione o alvo</option>{sortedCombatants.map((item)=><option key={item.id} value={item.character_id}>{item.character_name}</option>)}</select></label>
            {actorForControls && <div className="room-combat-actions-row"><label><span>Ação do combatente</span><select value={selectedAction} onChange={(e)=>setSelectedAction(e.target.value)}><option value="">Selecione ataque/habilidade</option>{actorAttacks.map((a,i)=><option key={a.id||i} value={a.id||a.name}>Ataque · {a.name}</option>)}{actorAbilities.map((a,i)=><option key={a.id||i} value={a.id||a.name}>Habilidade · {a.name}</option>)}</select></label><button className="button button-primary" type="button" disabled={busy || !selectedActionObject || (actorAttacks.includes(selectedActionObject)&&!targetCombatant)||(selectedActionObject?.effectType!=="utility"&&actorAbilities.includes(selectedActionObject)&&!targetCombatant)} onClick={()=>submitAction(actorForControls,targetCombatant,selectedActionObject,actorAttacks.includes(selectedActionObject)?"attack":"ability",true)}>Executar ação</button></div>}
            <button className="button button-secondary" type="button" disabled={busy || !eligibleCombatants.length} onClick={()=>advanceTurn(true)}><SkipForward size={14}/> Pular turno atual</button>
          </div>}
          {!isGm && currentCombatant?.owner_id===userId && currentCombatant.turn_control==="player" && !currentCombatant.turn_blocked && !encounter.turns_paused && !isObserver && <div className="panel room-player-actions">
            <span className="eyebrow">SEU TURNO</span><h3>Escolha sua ação</h3>
            <label className="room-combat-field"><span>Alvo</span><select value={selectedTarget} onChange={(e)=>setSelectedTarget(e.target.value)}><option value="">Selecione o alvo</option>{sortedCombatants.filter((item)=>item.character_id!==currentCombatant.character_id&&item.is_active&&!item.turn_blocked).map((item)=><option key={item.id} value={item.character_id}>{item.character_name} · {item.current_hp}/{item.max_hp} PV</option>)}</select></label>
            <div className="room-combat-action-cards">{[...getActions(currentCombatant,"attacks").map((a)=>({...a,kind:"attack"})),...getActions(currentCombatant,"abilities").map((a)=>({...a,kind:"ability"}))].map((action,index)=><article key={action.id||index}><div><strong>{action.name}</strong><small>{action.kind==="attack"?(action.damageFormula||"Sem dano definido"):"Habilidade"} · {Number(action.peCost)||0} PE</small><p>{action.description}</p></div><button className="button button-secondary" type="button" disabled={busy || ((action.kind==="attack"||(action.kind==="ability"&&action.effectType!=="utility"))&&!targetCombatant)} onClick={()=>submitAction(currentCombatant,targetCombatant,action,action.kind,false)}>Usar</button></article>)}</div>
            {!getActions(currentCombatant,"attacks").length&&!getActions(currentCombatant,"abilities").length&&<p className="room-readonly-note">Sua ficha ainda não possui ataques ou habilidades cadastrados.</p>}
          </div>}
          {isObserver && <p className="room-readonly-note">Você está acompanhando o combate como observador.</p>}
        </section>
        <aside className="room-combat-side">
          {isGm && <section className="panel room-combat-requests"><div className="room-battle-heading"><div><span className="eyebrow">AGUARDANDO MESTRE</span><h3>Solicitações ({pendingRequests.length})</h3></div><Activity size={17}/></div>
            {pendingRequests.length ? pendingRequests.map((request)=><article key={request.id}><strong>{combatants.find((item)=>item.character_id===request.actor_character_id)?.character_name||"Personagem"} · {request.payload?.action?.name||request.action_type}</strong><small>{request.payload?.roll?.message||request.payload?.message||"Ação solicitada"}</small>{request.payload?.roll?.attackRoll&&<small>Teste: {request.payload.roll.attackRoll.total} · Defesa: {request.payload.roll.defense} · Dano: {request.payload.roll.totalDamage||0}</small>}<div><button className="button button-primary" type="button" disabled={busy} onClick={()=>resolveRequest(request,true)}>Aprovar e aplicar</button><button className="button button-secondary" type="button" disabled={busy} onClick={()=>resolveRequest(request,false)}>Recusar</button></div></article>) : <small>Nenhuma ação aguardando aprovação.</small>}
          </section>}
          <section className="panel room-combat-log"><div className="room-battle-heading"><div><span className="eyebrow">REGISTRO DA SESSÃO</span><h3>Histórico do combate</h3></div><button className="icon-button" type="button" onClick={()=>loadCombat()} aria-label="Atualizar histórico"><RefreshCw size={15}/></button></div>{events.length?events.map((event)=><p key={event.id}><time>{new Date(event.created_at).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</time>{describeEvent(event)}</p>):<small>Nenhuma ação registrada ainda.</small>}</section>
        </aside>
      </div>
    </>}
  </div>;
}
