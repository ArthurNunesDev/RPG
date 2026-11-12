import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Crown,
  Eye,
  Pencil,
  Plus,
  Search,
  Swords,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import "../styles/campaigns.css";

const emptyForm = { title: "", description: "", gameSystemId: "", status: "active" };

const statusLabels = {
  active: "Em andamento",
  paused: "Pausada",
  archived: "Arquivada",
};

const roleLabels = {
  gm: "Mestre",
  player: "Jogador",
  observer: "Observador",
};

function formatDate(value) {
  if (!value) return "Data indisponível";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Data indisponível";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(date);
}

export default function CampaignsPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState([]);
  const [systems, setSystems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [joinPin, setJoinPin] = useState("");
  const [joining, setJoining] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const canCreateCampaign = profile?.preferred_role === "gm";

  const loadCampaigns = useCallback(async () => {
    if (!supabase || !user?.id) {
      setLoading(false);
      setError("Não foi possível conectar às campanhas.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const [campaignResult, systemResult] = await Promise.all([
        supabase
          .from("campaigns")
          .select("id, owner_id, game_system_id, title, description, status, created_at, updated_at, game_systems(name, is_official), campaign_members(user_id, role)")
          .order("updated_at", { ascending: false }),
        supabase
          .from("game_systems")
          .select("id, name, is_official, created_by")
          .order("is_official", { ascending: false })
          .order("name", { ascending: true }),
      ]);

      if (campaignResult.error) throw campaignResult.error;
      if (systemResult.error) throw systemResult.error;

      setCampaigns(campaignResult.data ?? []);
      setSystems((systemResult.data ?? []).filter(
        (system) => system.is_official || system.created_by === user.id,
      ));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar suas campanhas.");
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadCampaigns();
  }, [loadCampaigns]);

  const visibleCampaigns = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");

    return campaigns.filter((campaign) => {
      const ownCampaign = campaign.owner_id === user?.id;
      const matchesFilter = filter === "all"
        || (filter === "hosting" && ownCampaign)
        || (filter === "participating" && !ownCampaign);
      const systemName = campaign.game_systems?.name ?? "";
      const matchesQuery = !normalizedQuery
        || campaign.title.toLocaleLowerCase("pt-BR").includes(normalizedQuery)
        || systemName.toLocaleLowerCase("pt-BR").includes(normalizedQuery)
        || campaign.description.toLocaleLowerCase("pt-BR").includes(normalizedQuery);

      return matchesFilter && matchesQuery;
    });
  }, [campaigns, filter, query, user?.id]);

  function openCreateForm() {
    if (!canCreateCampaign) return;
    setEditingId("");
    setForm({ ...emptyForm, gameSystemId: systems[0]?.id ?? "" });
    setError("");
    setNotice("");
    setFormOpen(true);
  }

  function openEditForm(campaign) {
    setEditingId(campaign.id);
    setForm({
      title: campaign.title,
      description: campaign.description,
      gameSystemId: campaign.game_system_id,
      status: campaign.status,
    });
    setError("");
    setNotice("");
    setFormOpen(true);
  }

  function closeForm() {
    if (saving) return;
    setFormOpen(false);
    setEditingId("");
    setForm(emptyForm);
  }

  async function handleSave(event) {
    event.preventDefault();
    if (!supabase || !user?.id) return;
    if (!editingId && !canCreateCampaign) {
      setError("Somente usuários no modo mestre podem criar campanhas.");
      return;
    }

    const title = form.title.trim();
    const description = form.description.trim();

    if (title.length < 3 || title.length > 100) {
      setError("O nome da campanha precisa ter entre 3 e 100 caracteres.");
      return;
    }
    if (description.length > 2000) {
      setError("A descrição deve ter no máximo 2.000 caracteres.");
      return;
    }
    if (!editingId && !systems.some((system) => system.id === form.gameSystemId)) {
      setError("Selecione um sistema de RPG disponível para sua conta.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const payload = editingId
        ? { title, description, status: form.status }
        : {
            title,
            description,
            game_system_id: form.gameSystemId,
            owner_id: user.id,
          };

      const request = editingId
        ? supabase.from("campaigns").update(payload).eq("id", editingId).eq("owner_id", user.id)
        : supabase.from("campaigns").insert(payload);

      const { data, error: saveError } = await request
        .select("id")
        .single();

      if (saveError) throw saveError;
      if (!data?.id) throw new Error("A campanha não foi salva. Verifique suas permissões.");

      setFormOpen(false);
      setEditingId("");
      setForm(emptyForm);
      setNotice(editingId ? "Campanha atualizada." : "Campanha criada. Crie uma sessão dentro dela para gerar o PIN.");
      await loadCampaigns();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não foi possível salvar a campanha.");
    } finally {
      setSaving(false);
    }
  }


  async function handleJoinWithPin(event) {
    event.preventDefault();
    if (!supabase || joining) return;
    const normalizedPin = joinPin.replace(/[^a-z0-9]/gi, "").toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(normalizedPin)) { setError("Informe o PIN de 8 caracteres."); return; }
    setJoining(true); setError(""); setNotice("");
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("realm-sessions", { body: { action: "join", pin: normalizedPin } });
      if (invokeError) throw invokeError;
      if (data?.error) throw new Error(data.error);
      if (!data?.session?.campaignId) throw new Error("A campanha da sessão não foi retornada.");
      setJoinPin("");
      await loadCampaigns();
      navigate(`/campaigns/${data.session.campaignId}`);
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : "Não foi possível entrar com esse PIN.");
    } finally { setJoining(false); }
  }

  async function handleDelete(campaign) {
    if (!supabase || !user?.id || campaign.owner_id !== user.id) return;
    const confirmed = window.confirm(
      `Excluir "${campaign.title}"? As mensagens e os vínculos de participantes serão removidos. Personagens vinculados serão mantidos fora da campanha.`,
    );
    if (!confirmed) return;

    setDeletingId(campaign.id);
    setError("");
    setNotice("");

    try {
      const { data, error: deleteError } = await supabase
        .from("campaigns")
        .delete()
        .eq("id", campaign.id)
        .eq("owner_id", user.id)
        .select("id");

      if (deleteError) throw deleteError;
      if (!data?.length) throw new Error("A campanha não foi encontrada ou você não tem permissão para excluí-la.");

      setCampaigns((current) => current.filter((item) => item.id !== campaign.id));
      setNotice("Campanha excluída.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Não foi possível excluir a campanha.");
    } finally {
      setDeletingId("");
    }
  }

  const hostedCount = campaigns.filter((campaign) => campaign.owner_id === user?.id).length;
  const participatingCount = campaigns.length - hostedCount;

  return (
    <section className="campaigns-page">
      <div className="campaigns-heading">
        <div className="campaigns-heading-icon"><Swords size={26} strokeWidth={1.6} /></div>
        <div>
          <p className="eyebrow">SUAS AVENTURAS</p>
          <h1>Campanhas</h1>
          <p className="page-lead">{canCreateCampaign ? "Crie uma aventura ou acompanhe as campanhas das quais você participa." : "Acompanhe suas campanhas e entre em novas aventuras com o PIN compartilhado pelo mestre."}</p>
        </div>
        {canCreateCampaign && <button className="button button-primary campaigns-create-button" type="button" onClick={openCreateForm} disabled={!systems.length}>
          <Plus size={17} /> Nova campanha
        </button>}
      </div>

      <form className="campaign-pin-entry panel" onSubmit={handleJoinWithPin}><div><p className="eyebrow">ENTRAR EM UMA AVENTURA</p><strong>Já tem um PIN?</strong><span>Informe o código compartilhado pelo mestre.</span></div><input aria-label="PIN da sessão" autoComplete="off" maxLength={8} placeholder="EX: A7K9P2Q4" value={joinPin} onChange={(event) => setJoinPin(event.target.value.replace(/[^a-z0-9]/gi, "").toUpperCase())} /><button className="button button-primary" type="submit" disabled={joining || joinPin.length !== 8}>{joining ? "Conectando..." : "Entrar na campanha"}</button></form>\n\n      <div className="campaigns-stats">
        <div className="campaign-stat panel"><span className="campaign-stat-icon"><BookOpen size={17} /></span><div><strong>{campaigns.length}</strong><span>Campanhas</span></div></div>
        <div className="campaign-stat panel"><span className="campaign-stat-icon campaign-stat-icon--gold"><Crown size={17} /></span><div><strong>{hostedCount}</strong><span>Como mestre</span></div></div>
        <div className="campaign-stat panel"><span className="campaign-stat-icon campaign-stat-icon--blue"><Users size={17} /></span><div><strong>{participatingCount}</strong><span>Participando</span></div></div>
      </div>

      {notice && <p className="campaigns-notice" role="status"><CheckCircle2 size={15} />{notice}</p>}
      {error && !formOpen && <p className="campaigns-error" role="alert">{error}</p>}

      {canCreateCampaign && !systems.length && !loading && (
        <div className="campaigns-no-systems panel">
          <BookOpen size={22} />
          <div><h2>Escolha um sistema primeiro</h2><p>Para criar uma campanha, você precisa ter um sistema oficial ou personalizado disponível.</p></div>
          <Link to="/library" className="button button-secondary">Abrir biblioteca <ArrowUpRight size={15} /></Link>
        </div>
      )}

      {formOpen && (
        <form className="campaign-form panel" onSubmit={handleSave}>
          <div className="campaign-form-heading">
            <div><p className="eyebrow">{editingId ? "GERENCIAR CAMPANHA" : "NOVA AVENTURA"}</p><h2>{editingId ? "Editar campanha" : "Criar campanha"}</h2></div>
            <button className="icon-button" type="button" onClick={closeForm} aria-label="Fechar formulário" disabled={saving}><X size={17} /></button>
          </div>
          <label className="campaign-field">
            <span>Nome da campanha</span>
            <input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} minLength={3} maxLength={100} required placeholder="Ex.: As Crônicas de Arton" />
          </label>
          {!editingId && (
            <label className="campaign-field">
              <span>Sistema de RPG</span>
              <select value={form.gameSystemId} onChange={(event) => setForm((current) => ({ ...current, gameSystemId: event.target.value }))} required>
                <option value="" disabled>Selecione um sistema</option>
                {systems.map((system) => <option value={system.id} key={system.id}>{system.name}{system.is_official ? " · Oficial" : " · Personalizado"}</option>)}
              </select>
            </label>
          )}
          <label className="campaign-field">
            <span>Descrição <small>(opcional)</small></span>
            <textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} rows={3} maxLength={2000} placeholder="Conte um pouco sobre o cenário e a proposta da aventura." />
          </label>
          {editingId && (
            <label className="campaign-field">
              <span>Status</span>
              <select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
                <option value="active">Em andamento</option>
                <option value="paused">Pausada</option>
                <option value="archived">Arquivada</option>
              </select>
            </label>
          )}
          {error && <p className="campaigns-error" role="alert">{error}</p>}
          <div className="campaign-form-actions">
            <button className="button button-secondary" type="button" onClick={closeForm} disabled={saving}>Cancelar</button>
            <button className="button button-primary" type="submit" disabled={saving || (!editingId && !systems.length)}>{saving ? "Salvando..." : editingId ? "Salvar alterações" : "Criar campanha"}</button>
          </div>
        </form>
      )}

      <div className="campaigns-toolbar">
        <div className="campaigns-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar campanhas..." aria-label="Buscar campanhas" />{query && <button type="button" onClick={() => setQuery("")} aria-label="Limpar busca"><X size={15} /></button>}</div>
        <div className="campaigns-filters" aria-label="Filtrar campanhas">
          <button type="button" className={filter === "all" ? "campaign-filter campaign-filter--active" : "campaign-filter"} onClick={() => setFilter("all")}>Todas <span>{campaigns.length}</span></button>
          <button type="button" className={filter === "hosting" ? "campaign-filter campaign-filter--active" : "campaign-filter"} onClick={() => setFilter("hosting")}>Sou mestre <span>{hostedCount}</span></button>
          <button type="button" className={filter === "participating" ? "campaign-filter campaign-filter--active" : "campaign-filter"} onClick={() => setFilter("participating")}>Participo <span>{participatingCount}</span></button>
        </div>
      </div>

      {loading ? (
        <div className="campaigns-empty panel"><span>✦</span><p>Carregando campanhas...</p></div>
      ) : visibleCampaigns.length ? (
        <div className="campaign-grid">
          {visibleCampaigns.map((campaign) => {
            const ownCampaign = campaign.owner_id === user?.id;
            const membership = campaign.campaign_members?.find((member) => member.user_id === user?.id);
            const role = ownCampaign ? "gm" : membership?.role ?? "player";
            const memberCount = campaign.campaign_members?.length ?? 0;

            return (
              <article className="campaign-card panel" key={campaign.id}>
                <div className="campaign-card-art"><div className="campaign-card-sigil"><Swords size={31} strokeWidth={1.2} /></div><span className={`campaign-status campaign-status--${campaign.status}`}>{statusLabels[campaign.status] ?? campaign.status}</span></div>
                <div className="campaign-card-body">
                  <div className="campaign-card-meta"><span>{campaign.game_systems?.name ?? "Sistema indisponível"}</span><span className="campaign-role"><Crown size={12} />{roleLabels[role] ?? "Participante"}</span></div>
                  <h2>{campaign.title}</h2>
                  <p>{campaign.description || "Esta campanha ainda não possui uma descrição."}</p>
                  <div className="campaign-card-footer">
                    <span><Users size={13} />{memberCount} {memberCount === 1 ? "participante" : "participantes"}</span>
                    <span><CalendarDays size={13} />{formatDate(campaign.updated_at)}</span>
                  </div>
                  <div className="campaign-card-actions">
                    <Link className="button button-primary" to={`/campaigns/${campaign.id}`}>Abrir campanha <ArrowUpRight size={14} /></Link>
                    {ownCampaign && <button className="button button-secondary" type="button" onClick={() => openEditForm(campaign)}><Pencil size={14} /> Editar</button>}
                    {ownCampaign && <button className="icon-button campaign-delete-button" type="button" onClick={() => handleDelete(campaign)} disabled={deletingId === campaign.id} aria-label={`Excluir campanha ${campaign.title}`} title="Excluir"><Trash2 size={15} /></button>}
                  </div>
                  {!ownCampaign && role === "observer" && <div className="campaign-observer-note"><Eye size={13} /> Acesso de observador</div>}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="campaigns-empty panel">
          <div className="campaigns-empty-icon"><Swords size={25} /></div>
          <h2>{query ? "Nenhuma campanha encontrada" : filter === "hosting" ? "Você ainda não mestra campanhas" : filter === "participating" ? "Você ainda não participa de campanhas" : "Sua primeira aventura começa aqui"}</h2>
          <p>{query ? "Tente buscar por outro nome ou sistema." : canCreateCampaign ? "Crie uma campanha para reunir seu grupo e começar uma nova história." : "Quando um mestre compartilhar um PIN, use o campo acima para entrar na campanha."}</p>
          {!query && filter !== "participating" && canCreateCampaign && <button className="button button-primary" type="button" onClick={openCreateForm} disabled={!systems.length}><Plus size={16} /> Criar campanha</button>}
        </div>
      )}
    </section>
  );
}
