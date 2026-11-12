import { ArrowUpRight, BookOpen, Compass, Dice5, Eye, Plus, Sparkles, Swords, UserRound, Crown, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { isSupabaseConfigured } from "../lib/supabase.js";
import { useAuth } from "../contexts/AuthContext.jsx";

const roleContent = {
  gm: {
    eyebrow: "CENTRAL DO MESTRE",
    title: "Prepare sua próxima aventura",
    lead: "Crie mundos, organize suas campanhas e conduza histórias que seus jogadores vão lembrar.",
    heroTitle: "Seu mundo. Suas regras.",
    heroCopy: "Monte uma campanha e prepare o cenário para reunir seu grupo.",
    primary: { to: "/campaigns", label: "Gerenciar campanhas", icon: Swords },
    links: [
      { to: "/campaigns", icon: Swords, title: "Criar campanha", description: "Dê vida a um novo mundo.", tone: "gold" },
      { to: "/tabletop", icon: Compass, title: "Preparar sessão", description: "Organize a mesa virtual.", tone: "blue" },
      { to: "/library", icon: BookOpen, title: "Biblioteca", description: "Consulte regras e conteúdos.", tone: "violet" },
      { to: "/dice", icon: Dice5, title: "Rolar dados", description: "Faça testes para a aventura.", tone: "green" },
    ],
  },
  player: {
    eyebrow: "SUA JORNADA",
    title: "Sua próxima aventura começa aqui",
    lead: "Cuide dos seus personagens, encontre campanhas e prepare-se para viver novas histórias.",
    heroTitle: "Sua história está prestes a começar.",
    heroCopy: "Acesse suas campanhas ou prepare seu próximo personagem.",
    primary: { to: "/characters", label: "Meus personagens", icon: UserRound },
    links: [
      { to: "/characters", icon: UserRound, title: "Meus personagens", description: "Cuide das suas fichas e inventário.", tone: "violet" },
      { to: "/campaigns", icon: Swords, title: "Minhas campanhas", description: "Acompanhe suas aventuras.", tone: "gold" },
      { to: "/tabletop", icon: Compass, title: "Entrar na mesa", description: "Participe da próxima sessão.", tone: "blue" },
      { to: "/dice", icon: Dice5, title: "Rolar dados", description: "Deixe a sorte decidir.", tone: "green" },
    ],
  },
  observer: {
    eyebrow: "MODO ESPECTADOR",
    title: "Acompanhe grandes histórias",
    lead: "Encontre sessões disponíveis e assista às aventuras sem interferir no andamento da campanha.",
    heroTitle: "Toda aventura merece uma plateia.",
    heroCopy: "Acompanhe sessões para as quais você recebeu acesso de observador.",
    primary: { to: "/tabletop", label: "Assistir sessões", icon: Eye },
    links: [
      { to: "/tabletop", icon: Eye, title: "Assistir sessões", description: "Acompanhe uma sessão autorizada.", tone: "violet" },
      { to: "/campaigns", icon: Swords, title: "Campanhas", description: "Veja as campanhas disponíveis para você.", tone: "gold" },
    ],
  },
};

export default function DashboardPage() {
  const { profile, user } = useAuth();
  const role = profile?.preferred_role ?? "player";
  const content = roleContent[role] ?? roleContent.player;
  const PrimaryIcon = content.primary.icon;

  return (
    <div className="dashboard-page">
      <section className="welcome-row">
        <div>
          <p className="eyebrow"><Sparkles size={14} /> {content.eyebrow}</p>
          <h1>{content.title}</h1>
          <p className="page-lead">{content.lead}</p>
        </div>
        <div className="welcome-emblem" aria-hidden="true">
          <div className="emblem-ring emblem-ring--outer" /><div className="emblem-ring emblem-ring--inner" />
          {role === "gm" ? <Crown size={48} strokeWidth={1.15} /> : role === "observer" ? <Eye size={48} strokeWidth={1.15} /> : <Swords size={52} strokeWidth={1.15} />}
          <span className="emblem-star">✦</span>
        </div>
      </section>

      <section className="hero-panel">
        <div className="hero-texture" aria-hidden="true" />
        <div className="hero-content">
          <span className="hero-kicker"><span /> SEU PRÓXIMO CAPÍTULO</span>
          <h2>{content.heroTitle}</h2>
          <p>{content.heroCopy}</p>
          <Link className="button button-primary" to={content.primary.to}><PrimaryIcon size={17} /> {content.primary.label} <ArrowUpRight size={16} /></Link>
        </div>
        <div className="hero-art" aria-hidden="true"><div className="hero-sun" /><div className="hero-mountain hero-mountain--back" /><div className="hero-mountain hero-mountain--front" /><div className="hero-castle"><Swords size={74} strokeWidth={0.8} /></div></div>
        <div className="hero-index">01 <span>/</span> 04</div>
      </section>

      <section className="section-block">
        <div className="section-heading"><div><p className="eyebrow">ACESSO RÁPIDO</p><h2>Seu espaço de aventura</h2></div><span className="section-note">Olá, {profile?.display_name || user?.email || "aventureiro"}.</span></div>
        <div className="quick-grid">
          {content.links.map(({ to, icon: Icon, title, description, tone }) => (
            <Link className="quick-card" to={to} key={to}>
              <div className={`quick-icon quick-icon--${tone}`}><Icon size={21} strokeWidth={1.8} /></div>
              <div className="quick-card-copy"><h3>{title}</h3><p>{description}</p></div>
              <ArrowUpRight className="quick-arrow" size={17} />
            </Link>
          ))}
        </div>
      </section>

      <section className="bottom-grid">
        <div className="panel panel-empty">
          <div className="panel-heading"><div><p className="eyebrow">{role === "observer" ? "SESSÕES" : "SUA JORNADA"}</p><h2>{role === "observer" ? "Sessões para assistir" : role === "gm" ? "Campanhas recentes" : "Campanhas em andamento"}</h2></div><Link to={role === "observer" ? "/tabletop" : "/campaigns"} className="text-link">Ver mais <ArrowUpRight size={14} /></Link></div>
          <div className="empty-state"><div className="empty-icon">{role === "observer" ? <Eye size={23} /> : <BookOpen size={23} />}</div><h3>{role === "observer" ? "Nenhuma sessão disponível ainda" : "Sua primeira história ainda está por vir"}</h3><p>{role === "observer" ? "Quando você receber acesso para assistir, as sessões aparecerão aqui." : "Quando você criar ou entrar em uma campanha, ela aparecerá aqui."}</p><Link to={role === "observer" ? "/tabletop" : "/campaigns"} className="button button-secondary">{role === "observer" ? "Explorar sessões" : "Ver campanhas"}</Link></div>
        </div>
        <aside className="panel setup-panel">
          <div className="setup-icon"><Users size={21} /></div><p className="eyebrow">SEU PERFIL</p><h2>{role === "gm" ? "O destino do mundo está em suas mãos." : role === "observer" ? "Assista. Descubra. Acompanhe." : "Sua próxima grande história espera por você."}</h2>
          <p className="setup-copy">{role === "gm" ? "As ferramentas de criação e controle de campanhas serão liberadas conforme os módulos forem implementados." : role === "observer" ? "Você verá apenas o conteúdo das sessões em que tiver autorização para assistir." : "Suas fichas e ações serão individuais em cada sessão, respeitando as regras da campanha."}</p>
          <div className="setup-status"><span className={isSupabaseConfigured ? "status-indicator status-indicator--ready" : "status-indicator"} /><span>{isSupabaseConfigured ? "Supabase configurado" : "Aguardando configuração do Supabase"}</span></div>
        </aside>
      </section>
    </div>
  );
}
