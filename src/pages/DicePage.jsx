import { useCallback, useEffect, useState } from "react";
import { Dice1, Dice5, Dices, RotateCcw, Sparkles, Users, UserRound } from "lucide-react";
import { supabase } from "../lib/supabase.js";
import { useAuth } from "../contexts/AuthContext.jsx";

const diceOptions = [4, 6, 8, 10, 12, 20, 100];

function rollDie(sides) {
  if (!globalThis.crypto?.getRandomValues) throw new Error("Seu navegador não oferece um gerador seguro de números aleatórios.");
  const range = 0x1_0000_0000;
  const limit = range - (range % sides);
  const values = new Uint32Array(1);
  let value;
  do { globalThis.crypto.getRandomValues(values); value = values[0]; } while (value >= limit);
  return (value % sides) + 1;
}

function playRollSound() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const now = context.currentTime;
  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(320, now);
  oscillator.frequency.exponentialRampToValueAtTime(720, now + 0.12);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.055, now + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
  oscillator.connect(gain); gain.connect(context.destination);
  oscillator.start(now); oscillator.stop(now + 0.21);
  oscillator.onended = () => context.close();
}

function formatDate(value) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

export default function DicePage({ campaignId: campaignIdProp = "", embedded = false, readOnly = false }) {
  const { user, profile } = useAuth();
  const [sides, setSides] = useState(profile?.preferences?.defaultDie ?? 20);
  const [quantity, setQuantity] = useState(1);
  const [modifier, setModifier] = useState(0);
  const [mode, setMode] = useState("normal");
  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState(campaignIdProp);
  const campaignId = campaignIdProp || selectedCampaignId;
  const [scope, setScope] = useState(campaignIdProp ? "campaign" : "personal");
  const [history, setHistory] = useState([]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rolling, setRolling] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setSides(profile?.preferences?.defaultDie ?? 20);
  }, [profile?.preferences?.defaultDie]);

  useEffect(() => {
    if (campaignIdProp) { setSelectedCampaignId(campaignIdProp); setScope("campaign"); setLoading(false); return undefined; }
    let active = true;
    async function loadCampaigns() {
      if (!supabase || !user?.id) { setLoading(false); return; }
      const { data, error: campaignError } = await supabase
        .from("campaign_members")
        .select("campaign_id, role, campaigns(id, title)")
        .eq("user_id", user.id);
      if (!active) return;
      if (campaignError) { setError(campaignError.message); setLoading(false); return; }
      const available = (data ?? []).filter((item) => item.campaigns?.id);
      setCampaigns(available);
      if (available.length) setSelectedCampaignId((current) => current || available[0].campaign_id);
      setLoading(false);
    }
    loadCampaigns();
    return () => { active = false; };
  }, [user?.id, campaignIdProp]);


  const loadHistory = useCallback(async () => {
    if (!supabase || !user?.id) return;
    setLoading(true); setError("");
    try {
      let request = supabase.from("roll_history")
        .select("id, user_id, scope, formula, rolls, total, created_at, profiles(username)")
        .eq("scope", scope)
        .order("created_at", { ascending: false })
        .limit(40);

      if (campaignId) request = request.eq("campaign_id", campaignId);
      else request = request.is("campaign_id", null).eq("scope", "personal");

      const { data, error: historyError } = await request;
      if (historyError) throw historyError;
      setHistory(data ?? []);
    } catch (historyError) {
      setError(historyError instanceof Error ? historyError.message : "Não foi possível carregar o histórico.");
    } finally { setLoading(false); }
  }, [campaignId, scope, user?.id]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  function handleRoll() {
    if (!supabase || !user?.id || rolling || readOnly) return;
    if (scope === "campaign" && !campaignId) {
      setError("Selecione uma campanha para compartilhar a rolagem.");
      return;
    }
    setRolling(true); setError("");
    try {
      const rollCount = mode === "normal" ? quantity : 2;
      const rolls = Array.from({ length: rollCount }, () => ({ sides, value: rollDie(sides), kept: true }));
      if (mode !== "normal") {
        const keptIndex = rolls[0].value === rolls[1].value
          ? 0
          : mode === "advantage"
            ? (rolls[0].value > rolls[1].value ? 0 : 1)
            : (rolls[0].value < rolls[1].value ? 0 : 1);
        rolls.forEach((die, index) => { die.kept = index === keptIndex; });
      }
      if (profile?.preferences?.soundEffects) { try { playRollSound(); } catch { /* Audio is optional. */ } }
      const sum = rolls.reduce((total, die) => total + (die.kept ? die.value : 0), 0);
      const total = sum + Number(modifier || 0);
      const modeLabel = mode === "advantage" ? " (vantagem)" : mode === "disadvantage" ? " (desvantagem)" : "";
      const formula = `${mode === "normal" ? quantity : 1}d${sides}${modeLabel}${modifier >= 0 ? "+" : ""}${modifier || 0}`;
      const entry = { id: crypto.randomUUID(), formula, rolls, total, scope, campaign_id: campaignId || null, created_at: new Date().toISOString(), profiles: { username: profile?.username ?? "você" } };
      setResult(entry);
      supabase.from("roll_history").insert({
        user_id: user.id,
        campaign_id: campaignId || null,
        scope,
        formula,
        rolls,
        total,
      }).select("id").single().then(({ error: insertError }) => {
        if (insertError) setError(insertError.message);
        else loadHistory();
      });
    } catch (rollError) {
      setError(rollError instanceof Error ? rollError.message : "Não foi possível rolar os dados.");
    } finally { setRolling(false); }
  }

  async function clearHistory() {
    if (!supabase || !user?.id || !history.length) return;
    const ownIds = history.filter((entry) => entry.user_id === user.id).map((entry) => entry.id);
    if (!ownIds.length) { setError("Você não possui rolagens próprias para limpar neste histórico."); return; }
    setError("");
    const { error: deleteError } = await supabase.from("roll_history").delete().in("id", ownIds);
    if (deleteError) setError(deleteError.message);
    else { setResult(null); await loadHistory(); }
  }

  const isShared = scope === "campaign";
  const canShare = Boolean(campaignId);
  const canUseCampaignHistory = Boolean(campaignId);

  return (
    <section className={embedded ? "module-page dice-page dice-page-expanded dice-page-embedded" : "module-page dice-page dice-page-expanded"}>
      {!embedded && <><p className="eyebrow"><Sparkles size={14} /> A SORTE ESTÁ LANÇADA</p><h1>Rolagem de dados</h1><p className="page-lead">Monte sua rolagem, acompanhe cada resultado e consulte os registros da campanha.</p></>}

      {!embedded && <div className="dice-context panel">
        <label><span>Campanha vinculada</span><select value={campaignId} onChange={(event) => setSelectedCampaignId(event.target.value)}><option value="">Rolagem sem campanha</option>{campaigns.map((item) => <option value={item.campaign_id} key={item.campaign_id}>{item.campaigns.title}</option>)}</select></label>
        <div className="dice-scope-control" role="group" aria-label="Visibilidade do histórico">
          <button type="button" className={!isShared ? "dice-scope--active" : ""} onClick={() => setScope("personal")}><UserRound size={14} /> Pessoal</button>
          <button type="button" className={isShared ? "dice-scope--active" : ""} onClick={() => setScope("campaign")} disabled={!canShare}><Users size={14} /> Campanha</button>
        </div>
        <p>{isShared ? "Todos os membros desta campanha podem consultar as rolagens compartilhadas." : campaignId ? "Somente você e o mestre desta campanha podem consultar este histórico pessoal." : "Este histórico é privado e visível apenas para você."}</p>
      </div>}

      {embedded && <div className="dice-scope-control dice-embedded-scope" role="group" aria-label="Visibilidade do histórico"><button type="button" className={!isShared ? "dice-scope--active" : ""} onClick={() => setScope("personal")}><UserRound size={14}/> Pessoal</button><button type="button" className={isShared ? "dice-scope--active" : ""} onClick={() => setScope("campaign")}><Users size={14}/> Campanha</button></div>}
      <div className="dice-layout">
        <div className="dice-stage panel">
          <div className="dice-stage-top"><span className="stage-label">MESA DE ROLAGEM</span><Dices size={19} /></div>
          <div className="dice-display" aria-live="polite" aria-atomic="true">
            <div className={`dice-shape ${result ? "dice-shape--rolled" : ""}`}><Dice5 size={48} strokeWidth={1.15} /><span>{result ? result.total : "?"}</span></div>
            <p>{result ? `${result.formula} = ${result.total}` : "Aguardando sua rolagem"}</p>
          </div>
          <div className="dice-options" role="group" aria-label="Selecionar tipo de dado">
            {diceOptions.map((option) => <button className={`dice-option ${sides === option ? "dice-option--active" : ""}`} type="button" key={option} onClick={() => { setSides(option); if (option !== 20) setMode("normal"); }} aria-pressed={sides === option}>d{option}</button>)}
          </div>
          <div className="dice-input-grid">
            <label><span>Quantidade</span><input type="number" min="1" max="20" value={quantity} disabled={mode !== "normal"} onChange={(event) => setQuantity(Math.min(20, Math.max(1, Number(event.target.value) || 1)))} /></label>
            <label><span>Modificador</span><input type="number" min="-1000" max="1000" value={modifier} onChange={(event) => setModifier(Math.min(1000, Math.max(-1000, Number(event.target.value) || 0)))} /></label>
          </div>
          <label className="dice-mode-field"><span>Modo de rolagem</span><select value={mode} onChange={(event) => setMode(event.target.value)} disabled={sides !== 20 || quantity !== 1}><option value="normal">Normal</option><option value="advantage">Vantagem · maior resultado</option><option value="disadvantage">Desvantagem · menor resultado</option></select></label>
          <div className="dice-formula-preview">{mode === "normal" ? quantity : 1}d{sides}{mode === "advantage" ? " (vantagem)" : mode === "disadvantage" ? " (desvantagem)" : ""}{modifier >= 0 ? "+" : ""}{modifier}</div>
          <button className="button button-primary dice-roll-button" type="button" onClick={handleRoll} disabled={readOnly || rolling || (isShared && !canUseCampaignHistory)}><Dice1 size={19} />{rolling ? "Rolando..." : "Rolar dados"}</button>
          {readOnly && <p className="form-hint">Observadores podem consultar o histórico, mas não podem realizar rolagens.</p>}{error && <p className="form-error" role="alert">{error}</p>}
          {result && <div className="dice-result-breakdown"><span>Dados: {result.rolls.map((die) => `${die.value}${die.kept ? " ✓" : ""}`).join(" · ")}</span><strong>Total: {result.total}</strong></div>}
        </div>

        <aside className="panel dice-history">
          <div className="panel-heading"><div><p className="eyebrow">{isShared ? "REGISTRO DO GRUPO" : "SUAS ÚLTIMAS JOGADAS"}</p><h2>{isShared ? "Histórico da campanha" : "Histórico pessoal"}</h2></div><button className="icon-button" type="button" onClick={clearHistory} disabled={!history.some((entry) => entry.user_id === user?.id)} aria-label="Limpar minhas rolagens" title="Limpar minhas rolagens"><RotateCcw size={16} /></button></div>
          {loading ? <div className="history-empty"><Dices size={24} /><p>Carregando histórico...</p></div> : history.length ? (
            <ul className="roll-history roll-history-detailed">
              {history.map((entry) => <li key={entry.id}><div className="history-entry-main"><span className="history-die">{entry.formula}</span><strong>{entry.total}</strong></div><div className="history-entry-meta"><span>@{entry.profiles?.username ?? (entry.user_id === user?.id ? profile?.username : "aventureiro")}</span><time dateTime={entry.created_at}>{formatDate(entry.created_at)}</time></div><span className="history-roll-values">{(entry.rolls ?? []).map((die) => `${die.value}${die.kept === false ? "" : " ✓"}`).join(" · ")}</span></li>)}
            </ul>
          ) : <div className="history-empty"><Dices size={24} /><p>{isShared ? "Ainda não há rolagens compartilhadas." : "Suas rolagens pessoais aparecerão aqui."}</p></div>}
        </aside>
      </div>
    </section>
  );
}
