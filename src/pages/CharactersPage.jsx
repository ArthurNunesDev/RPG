import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  Eye,
  Pencil,
  Plus,
  Search,
  Shield,
  Skull,
  Swords,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { supabase } from "../lib/supabase.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import "../styles/characters.css";

const emptyForm = {
  name: "",
  concept: "",
  campaignId: "",
  gameSystemId: "",
  characterType: "player",
  npcRole: "neutral",
  status: "active",
};

const npcRoleLabels = { ally: "Aliado", enemy: "Inimigo", neutral: "Neutro" };
const statusLabels = { active: "Ativo", retired: "Aposentado", deceased: "Morto" };

export default function CharactersPage() {
  const { user } = useAuth();
  const [characters, setCharacters] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [systems, setSystems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadData = useCallback(async () => {
    if (!supabase || !user?.id) {
      setLoading(false);
      setError("Não foi possível conectar aos personagens.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const [characterResult, campaignResult, systemResult] = await Promise.all([
        supabase
          .from("characters")
          .select("id, owner_id, campaign_id, game_system_id, name, concept, character_type, npc_role, status, created_at, updated_at, game_systems(name), campaigns(title)")
          .order("updated_at", { ascending: false }),
        supabase
          .from("campaigns")
          .select("id, title, game_system_id, campaign_members(user_id, role)")
          .order("updated_at", { ascending: false }),
        supabase
          .from("game_systems")
          .select("id, name, is_official, created_by")
          .order("is_official", { ascending: false })
          .order("name", { ascending: true }),
      ]);

      if (characterResult.error) throw characterResult.error;
      if (campaignResult.error) throw campaignResult.error;
      if (systemResult.error) throw systemResult.error;

      setCharacters(characterResult.data ?? []);
      setCampaigns((campaignResult.data ?? []).map((campaign) => {
        const membership = campaign.campaign_members?.find((member) => member.user_id === user.id);
        return { ...campaign, role: membership?.role ?? (campaign.owner_id === user.id ? "gm" : null) };
      }).filter((campaign) => campaign.role));
      setSystems(systemResult.data ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar os personagens.");
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { loadData(); }, [loadData]);

  const selectedCampaign = campaigns.find((campaign) => campaign.id === form.campaignId) ?? null;
  const availableSystems = useMemo(() => {
    if (selectedCampaign) return systems.filter((system) => system.id === selectedCampaign.game_system_id);
    return systems.filter((system) => system.is_official || system.created_by === user?.id);
  }, [selectedCampaign, systems, user?.id]);

  const visibleCharacters = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
    return characters.filter((character) => {
      const matchesFilter = filter === "all"
        || (filter === "players" && character.character_type === "player")
        || (filter === "npcs" && character.character_type === "npc")
        || (filter === "my" && character.owner_id === user?.id);
      const matchesQuery = !normalizedQuery
        || character.name.toLocaleLowerCase("pt-BR").includes(normalizedQuery)
        || character.concept.toLocaleLowerCase("pt-BR").includes(normalizedQuery)
        || (character.campaigns?.title ?? "").toLocaleLowerCase("pt-BR").includes(normalizedQuery);
      return matchesFilter && matchesQuery;
    });
  }, [characters, filter, query, user?.id]);

  function openCreateForm() {
    setEditingId("");
    setForm({ ...emptyForm, gameSystemId: systems.find((system) => system.is_official)?.id ?? "" });
    setError("");
    setNotice("");
    setFormOpen(true);
  }

  function openEditForm(character) {
    setEditingId(character.id);
    setForm({
      name: character.name,
      concept: character.concept,
      campaignId: character.campaign_id ?? "",
      gameSystemId: character.game_system_id,
      characterType: character.character_type,
      npcRole: character.npc_role ?? "neutral",
      status: character.status,
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

  function changeCampaign(campaignId) {
    const campaign = campaigns.find((item) => item.id === campaignId);
    setForm((current) => ({
      ...current,
      campaignId,
      gameSystemId: campaign?.game_system_id ?? "",
      characterType: current.characterType === "npc" && campaign?.role !== "gm" ? "player" : current.characterType,
    }));
  }

  async function handleSave(event) {
    event.preventDefault();
    if (!supabase || !user?.id) return;

    const name = form.name.trim();
    const concept = form.concept.trim();
    const campaign = campaigns.find((item) => item.id === form.campaignId) ?? null;
    const isNpc = form.characterType === "npc";

    if (name.length < 1 || name.length > 80) {
      setError("O nome precisa ter entre 1 e 80 caracteres.");
      return;
    }
    if (concept.length > 1000) {
      setError("A descrição deve ter no máximo 1.000 caracteres.");
      return;
    }
    if (isNpc && (!campaign || campaign.role !== "gm")) {
      setError("NPCs só podem ser criados pelo mestre dentro de uma campanha que ele administra.");
      return;
    }
    if (!form.gameSystemId || !availableSystems.some((system) => system.id === form.gameSystemId)) {
      setError("Selecione um sistema disponível para esse personagem.");
      return;
    }
    if (campaign && campaign.game_system_id !== form.gameSystemId) {
      setError("O personagem precisa usar o mesmo sistema da campanha.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const payload = {
        name,
        concept,
        campaign_id: form.campaignId || null,
        game_system_id: form.gameSystemId,
        character_type: form.characterType,
        npc_role: isNpc ? form.npcRole : null,
        status: form.status,
      };

      const request = editingId
        ? supabase.from("characters").update(payload).eq("id", editingId)
        : supabase.from("characters").insert({ ...payload, owner_id: user.id });

      const { data, error: saveError } = await request.select("id").single();
      if (saveError) throw saveError;
      if (!data?.id) throw new Error("O personagem não foi salvo. Verifique suas permissões.");

      setFormOpen(false);
      setEditingId("");
      setForm(emptyForm);
      setNotice(editingId ? "Personagem atualizado." : isNpc ? "NPC adicionado à campanha." : "Personagem criado.");
      await loadData();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não foi possível salvar o personagem.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(character) {
    const canManage = character.owner_id === user?.id
      || (character.character_type === "npc" && campaigns.some((campaign) => campaign.id === character.campaign_id && campaign.role === "gm"));
    if (!supabase || !canManage) return;
    if (!window.confirm(`Excluir "${character.name}"? Essa ação não poderá ser desfeita.`)) return;

    setDeletingId(character.id);
    setError("");
    setNotice("");
    try {
      const { data, error: deleteError } = await supabase
        .from("characters")
        .delete()
        .eq("id", character.id)
        .select("id");
      if (deleteError) throw deleteError;
      if (!data?.length) throw new Error("Personagem não encontrado ou sem permissão para excluir.");
      setCharacters((current) => current.filter((item) => item.id !== character.id));
      setNotice("Personagem excluído.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Não foi possível excluir o personagem.");
    } finally {
      setDeletingId("");
    }
  }

  const npcCount = characters.filter((character) => character.character_type === "npc").length;
  const playerCount = characters.filter((character) => character.character_type === "player").length;
  const canCreateNpc = campaigns.some((campaign) => campaign.role === "gm");

  return (
    <section className="characters-page">
      <div className="characters-heading">
        <div className="characters-heading-icon"><Swords size={26} strokeWidth={1.6} /></div>
        <div><p className="eyebrow">HERÓIS E CRIATURAS</p><h1>Personagens</h1><p className="page-lead">Organize suas fichas e os NPCs que dão vida às campanhas.</p></div>
        <button className="button button-primary characters-create-button" type="button" onClick={openCreateForm} disabled={!systems.length}><Plus size={17} /> Criar personagem</button>
      </div>

      <div className="characters-stats">
        <div className="character-stat panel"><UserRound size={17} /><strong>{playerCount}</strong><span>Personagens</span></div>
        <div className="character-stat panel"><Shield size={17} /><strong>{npcCount}</strong><span>NPCs</span></div>
        <div className="character-stat panel"><Users size={17} /><strong>{campaigns.length}</strong><span>Campanhas</span></div>
      </div>

      {notice && <p className="characters-notice" role="status"><CheckCircle2 size={15} />{notice}</p>}
      {error && !formOpen && <p className="characters-error" role="alert">{error}</p>}

      {formOpen && (
        <form className="character-form panel" onSubmit={handleSave}>
          <div className="character-form-heading">
            <div><p className="eyebrow">{editingId ? "EDITAR REGISTRO" : "NOVO REGISTRO"}</p><h2>{editingId ? "Editar personagem" : "Criar personagem"}</h2></div>
            <button className="icon-button" type="button" onClick={closeForm} disabled={saving} aria-label="Fechar formulário"><X size={17} /></button>
          </div>
          <div className="character-type-options">
            <button type="button" className={form.characterType === "player" ? "character-type-option active" : "character-type-option"} onClick={() => setForm((current) => ({ ...current, characterType: "player", npcRole: "neutral" }))}><UserRound size={16} /> Personagem</button>
            <button type="button" className={form.characterType === "npc" ? "character-type-option active" : "character-type-option"} onClick={() => setForm((current) => ({ ...current, characterType: "npc" }))} disabled={!canCreateNpc}><Shield size={16} /> NPC do mestre</button>
          </div>
          {form.characterType === "npc" && (
            <label className="character-field">
              <span>Função do NPC</span>
              <select value={form.npcRole} onChange={(event) => setForm((current) => ({ ...current, npcRole: event.target.value }))}>
                <option value="ally">Aliado</option><option value="enemy">Inimigo</option><option value="neutral">Neutro</option>
              </select>
            </label>
          )}
          <label className="character-field"><span>Nome</span><input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} maxLength={80} required placeholder={form.characterType === "npc" ? "Ex.: Guarda da Cidade" : "Ex.: Aventureiro"} /></label>
          <label className="character-field"><span>Conceito / descrição <small>(opcional)</small></span><textarea value={form.concept} onChange={(event) => setForm((current) => ({ ...current, concept: event.target.value }))} maxLength={1000} rows={3} placeholder="História, aparência, personalidade ou observações." /></label>
          <label className="character-field">
            <span>Campanha <small>(opcional para personagens)</small></span>
            <select value={form.campaignId} onChange={(event) => changeCampaign(event.target.value)} disabled={Boolean(editingId && form.characterType === "npc")}>
              <option value="">Sem campanha</option>
              {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id} disabled={form.characterType === "npc" ? campaign.role !== "gm" : campaign.role === "observer"}>{campaign.title}{campaign.role === "gm" ? " · Mestre" : campaign.role === "observer" ? " · Observador" : " · Jogador"}</option>)}
            </select>
          </label>
          {form.campaignId && <p className="character-system-hint">Sistema da campanha: {systems.find((system) => system.id === form.gameSystemId)?.name ?? "indisponível"}</p>}
          {!form.campaignId && (
            <label className="character-field"><span>Sistema de RPG</span><select value={form.gameSystemId} onChange={(event) => setForm((current) => ({ ...current, gameSystemId: event.target.value }))} required><option value="">Selecione um sistema</option>{availableSystems.map((system) => <option key={system.id} value={system.id}>{system.name}</option>)}</select></label>
          )}
          {editingId && <label className="character-field"><span>Status</span><select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}><option value="active">Ativo</option><option value="retired">Aposentado</option><option value="deceased">Morto</option></select></label>}
          {error && <p className="characters-error" role="alert">{error}</p>}
          <div className="character-form-actions"><button className="button button-secondary" type="button" onClick={closeForm} disabled={saving}>Cancelar</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? "Salvando..." : editingId ? "Salvar alterações" : "Criar personagem"}</button></div>
        </form>
      )}

      <div className="characters-toolbar">
        <div className="characters-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar personagens..." aria-label="Buscar personagens" />{query && <button type="button" onClick={() => setQuery("")} aria-label="Limpar busca"><X size={15} /></button>}</div>
        <div className="characters-filters" aria-label="Filtrar personagens">
          <button type="button" className={filter === "all" ? "character-filter active" : "character-filter"} onClick={() => setFilter("all")}>Todos <span>{characters.length}</span></button>
          <button type="button" className={filter === "players" ? "character-filter active" : "character-filter"} onClick={() => setFilter("players")}>Personagens <span>{playerCount}</span></button>
          <button type="button" className={filter === "npcs" ? "character-filter active" : "character-filter"} onClick={() => setFilter("npcs")}>NPCs <span>{npcCount}</span></button>
          <button type="button" className={filter === "my" ? "character-filter active" : "character-filter"} onClick={() => setFilter("my")}>Meus <span>{characters.filter((character) => character.owner_id === user?.id).length}</span></button>
        </div>
      </div>

      {loading ? <div className="characters-empty panel"><span>✦</span><p>Carregando personagens...</p></div>
        : visibleCharacters.length ? <div className="character-grid">{visibleCharacters.map((character) => {
          const isNpc = character.character_type === "npc";
          const canEdit = character.owner_id === user?.id || (isNpc && campaigns.some((campaign) => campaign.id === character.campaign_id && campaign.role === "gm"));
          return <article className="character-card panel" key={character.id}>
            <div className={isNpc ? "character-card-art npc" : "character-card-art"}><div className="character-card-symbol">{isNpc ? character.npc_role === "enemy" ? <Skull size={25} /> : character.npc_role === "ally" ? <Shield size={25} /> : <Eye size={25} /> : <UserRound size={25} />}</div><span className={isNpc ? "character-kind npc" : "character-kind"}>{isNpc ? `NPC · ${npcRoleLabels[character.npc_role]}` : "Personagem"}</span></div>
            <div className="character-card-body"><div className="character-card-meta"><span>{character.game_systems?.name ?? "Sistema"}</span><span>{statusLabels[character.status] ?? character.status}</span></div><h2>{character.name}</h2><p>{character.concept || "Nenhuma descrição cadastrada."}</p><div className="character-card-campaign"><BookOpen size={13} />{character.campaigns?.title ?? "Sem campanha"}</div>
              {canEdit && <div className="character-card-actions"><button className="button button-secondary" type="button" onClick={() => openEditForm(character)}><Pencil size={14} /> Editar</button><button className="icon-button" type="button" onClick={() => handleDelete(character)} disabled={deletingId === character.id} aria-label={`Excluir ${character.name}`}><Trash2 size={15} /></button></div>}
            </div>
          </article>;
        })}</div>
        : <div className="characters-empty panel"><div className="characters-empty-icon"><Swords size={25} /></div><h2>{query ? "Nenhum resultado" : filter === "npcs" ? "Nenhum NPC cadastrado" : "Nenhum personagem ainda"}</h2><p>{query ? "Tente outro termo." : "Crie seu primeiro personagem ou adicione NPCs às campanhas que você mestra."}</p><button className="button button-primary" type="button" onClick={openCreateForm} disabled={!systems.length}><Plus size={16} /> Criar personagem</button></div>}
    </section>
  );
}
