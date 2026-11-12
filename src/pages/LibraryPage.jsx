import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  Library,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { supabase } from "../lib/supabase.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import "../styles/library.css";

const emptyForm = { name: "", description: "" };

function createSlug(name) {
  const normalized = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

  return `custom-${normalized || "system"}-${crypto.randomUUID().slice(0, 8)}`;
}

export default function LibraryPage() {
  const { user } = useAuth();
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

  const loadSystems = useCallback(async () => {
    if (!supabase || !user?.id) {
      setLoading(false);
      setError("Não foi possível conectar ao catálogo de sistemas.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const { data, error: queryError } = await supabase
        .from("game_systems")
        .select("id, slug, name, description, is_official, created_by, created_at")
        .order("is_official", { ascending: false })
        .order("name", { ascending: true });

      if (queryError) throw queryError;
      setSystems(data ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar os sistemas.");
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadSystems();
  }, [loadSystems]);

  const visibleSystems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");

    return systems.filter((system) => {
      const matchesFilter = filter === "all"
        || (filter === "official" && system.is_official)
        || (filter === "custom" && !system.is_official);
      const matchesQuery = !normalizedQuery
        || system.name.toLocaleLowerCase("pt-BR").includes(normalizedQuery)
        || system.description.toLocaleLowerCase("pt-BR").includes(normalizedQuery);

      return matchesFilter && matchesQuery;
    });
  }, [systems, query, filter]);

  function openCreateForm() {
    setEditingId("");
    setForm(emptyForm);
    setError("");
    setNotice("");
    setFormOpen(true);
  }

  function openEditForm(system) {
    setEditingId(system.id);
    setForm({ name: system.name, description: system.description });
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

    const name = form.name.trim();
    const description = form.description.trim();

    if (name.length < 2 || name.length > 80) {
      setError("O nome precisa ter entre 2 e 80 caracteres.");
      return;
    }
    if (description.length > 500) {
      setError("A descrição deve ter no máximo 500 caracteres.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const payload = { name, description };

      const request = editingId
        ? supabase.from("game_systems")
            .update(payload)
            .eq("id", editingId)
            .eq("created_by", user.id)
        : supabase.from("game_systems")
            .insert({
              ...payload,
              slug: createSlug(name),
              is_official: false,
              created_by: user.id,
            });

      const { data, error: saveError } = await request
        .select("id, slug, name, description, is_official, created_by, created_at")
        .single();

      if (saveError) throw saveError;
      if (!data) throw new Error("O sistema não foi salvo. Verifique suas permissões.");

      setSystems((current) => editingId
        ? current.map((system) => system.id === editingId ? data : system)
        : [...current, data].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")));
      setFormOpen(false);
      setEditingId("");
      setForm(emptyForm);
      setNotice(editingId ? "Sistema atualizado." : "Sistema personalizado criado.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não foi possível salvar o sistema.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(system) {
    if (!supabase || !user?.id || system.is_official) return;
    const confirmed = window.confirm(
      `Excluir o sistema "${system.name}"? Essa ação não poderá ser desfeita.`,
    );
    if (!confirmed) return;

    setDeletingId(system.id);
    setError("");
    setNotice("");

    try {
      const { data, error: deleteError } = await supabase
        .from("game_systems")
        .delete()
        .eq("id", system.id)
        .eq("created_by", user.id)
        .select("id");

      if (deleteError) throw deleteError;
      if (!data?.length) throw new Error("O sistema não foi encontrado ou você não tem permissão para excluí-lo.");

      setSystems((current) => current.filter((item) => item.id !== system.id));
      setNotice("Sistema personalizado excluído.");
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : "";
      setError(/foreign key|violates.*constraint/i.test(message)
        ? "Este sistema está vinculado a uma campanha ou personagem e não pode ser excluído."
        : message || "Não foi possível excluir o sistema.");
    } finally {
      setDeletingId("");
    }
  }

  const officialCount = systems.filter((system) => system.is_official).length;
  const customCount = systems.length - officialCount;

  return (
    <section className="library-page">
      <div className="library-heading">
        <div className="library-heading-icon"><Library size={25} strokeWidth={1.6} /></div>
        <div>
          <p className="eyebrow">BIBLIOTECA DO REALMS</p>
          <h1>Sistemas de RPG</h1>
          <p className="page-lead">Escolha um sistema oficial ou crie o seu para usar nas próprias campanhas.</p>
        </div>
        <button className="button button-primary library-create-button" type="button" onClick={openCreateForm}>
          <Plus size={17} /> Criar sistema
        </button>
      </div>

      <div className="library-info panel">
        <ShieldCheck size={18} />
        <p>Sistemas oficiais ficam disponíveis para todos. Seus sistemas personalizados são privados e ficam visíveis aos participantes das campanhas que os utilizarem.</p>
      </div>

      {notice && <p className="library-notice" role="status"><CheckCircle2 size={15} />{notice}</p>}
      {error && !formOpen && <p className="library-error" role="alert">{error}</p>}

      {formOpen && (
        <form className="library-form panel" onSubmit={handleSave}>
          <div className="library-form-heading">
            <div>
              <p className="eyebrow">{editingId ? "SISTEMA PERSONALIZADO" : "NOVO SISTEMA"}</p>
              <h2>{editingId ? "Editar sistema" : "Criar sistema"}</h2>
            </div>
            <button className="icon-button" type="button" onClick={closeForm} aria-label="Fechar formulário" disabled={saving}><X size={17} /></button>
          </div>
          <label className="library-field">
            <span>Nome do sistema</span>
            <input
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              maxLength={80}
              minLength={2}
              required
              placeholder="Ex.: Meu sistema de fantasia"
            />
          </label>
          <label className="library-field">
            <span>Descrição <small>(opcional)</small></span>
            <textarea
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              maxLength={500}
              rows={3}
              placeholder="Descreva o cenário, as regras ou a proposta do sistema."
            />
          </label>
          {error && <p className="library-error" role="alert">{error}</p>}
          <div className="library-form-actions">
            <button className="button button-secondary" type="button" onClick={closeForm} disabled={saving}>Cancelar</button>
            <button className="button button-primary" type="submit" disabled={saving}>
              {saving ? "Salvando..." : editingId ? "Salvar alterações" : "Criar sistema"}
            </button>
          </div>
        </form>
      )}

      <div className="library-toolbar">
        <div className="library-search">
          <Search size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar sistemas..." aria-label="Buscar sistemas" />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="Limpar busca"><X size={15} /></button>}
        </div>
        <div className="library-filters" aria-label="Filtrar sistemas">
          <button type="button" className={filter === "all" ? "library-filter library-filter--active" : "library-filter"} onClick={() => setFilter("all")}>Todos <span>{systems.length}</span></button>
          <button type="button" className={filter === "official" ? "library-filter library-filter--active" : "library-filter"} onClick={() => setFilter("official")}>Oficiais <span>{officialCount}</span></button>
          <button type="button" className={filter === "custom" ? "library-filter library-filter--active" : "library-filter"} onClick={() => setFilter("custom")}>Meus sistemas <span>{customCount}</span></button>
        </div>
      </div>

      {loading ? (
        <div className="library-empty panel"><span className="library-loading-mark">✦</span><p>Carregando sistemas...</p></div>
      ) : visibleSystems.length ? (
        <div className="system-grid">
          {visibleSystems.map((system) => {
            const isOwner = system.created_by === user?.id;
            return (
              <article className="system-card panel" key={system.id}>
                <div className="system-card-top">
                  <span className={system.is_official ? "system-badge system-badge--official" : "system-badge system-badge--custom"}>
                    {system.is_official ? <><ShieldCheck size={13} /> Oficial</> : <><UserRound size={13} /> Personalizado</>}
                  </span>
                  {isOwner && <div className="system-actions">
                    <button className="icon-button" type="button" onClick={() => openEditForm(system)} aria-label={`Editar ${system.name}`} title="Editar"><Pencil size={15} /></button>
                    <button className="icon-button system-delete-button" type="button" onClick={() => handleDelete(system)} disabled={deletingId === system.id} aria-label={`Excluir ${system.name}`} title="Excluir"><Trash2 size={15} /></button>
                  </div>}
                </div>
                <div className="system-card-icon"><BookOpen size={22} strokeWidth={1.5} /></div>
                <h2>{system.name}</h2>
                <p>{system.description || "Sistema sem descrição cadastrada."}</p>
                <div className="system-card-footer">
                  <span>{system.is_official ? "Catálogo REALMS" : isOwner ? "Criado por você" : "Compartilhado por campanha"}</span>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="library-empty panel">
          <div className="library-empty-icon"><BookOpen size={25} /></div>
          <h2>{query ? "Nenhum sistema encontrado" : filter === "custom" ? "Você ainda não criou sistemas" : "Nenhum sistema disponível"}</h2>
          <p>{query ? "Tente outro termo de busca." : filter === "custom" ? "Crie um sistema personalizado para organizar suas próprias regras e campanhas." : "Os sistemas aparecerão aqui quando estiverem disponíveis."}</p>
          {filter === "custom" && !query && <button className="button button-secondary" type="button" onClick={openCreateForm}><Plus size={16} /> Criar sistema</button>}
        </div>
      )}
    </section>
  );
}
