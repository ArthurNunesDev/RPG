import {
  ArrowUpRight,
  BookOpen,
  Compass,
  Dice5,
  Plus,
  Shield,
  Sparkles,
  Swords,
  Users,
  UserRound,
} from "lucide-react";
import { Link } from "react-router-dom";
import { isSupabaseConfigured } from "../lib/supabase.js";

const quickLinks = [
  {
    to: "/campaigns",
    icon: Swords,
    title: "Criar campanha",
    description: "Dê vida a um novo mundo e reúna seu grupo.",
    tone: "gold",
  },
  {
    to: "/characters",
    icon: UserRound,
    title: "Criar personagem",
    description: "Prepare seu próximo herói ou vilão.",
    tone: "violet",
  },
  {
    to: "/tabletop",
    icon: Compass,
    title: "Abrir mesa virtual",
    description: "Prepare o cenário para a próxima sessão.",
    tone: "blue",
  },
  {
    to: "/dice",
    icon: Dice5,
    title: "Rolar os dados",
    description: "Teste sua sorte antes da aventura.",
    tone: "green",
  },
];

export default function DashboardPage() {
  return (
    <div className="dashboard-page">
      <section className="welcome-row">
        <div>
          <p className="eyebrow"><Sparkles size={14} /> CENTRAL DE AVENTURAS</p>
          <h1>Bem-vindo ao <span>REALMS</span></h1>
          <p className="page-lead">
            Um lugar para criar mundos, reunir seus amigos e contar histórias que merecem ser lembradas.
          </p>
        </div>
        <div className="welcome-emblem" aria-hidden="true">
          <div className="emblem-ring emblem-ring--outer" />
          <div className="emblem-ring emblem-ring--inner" />
          <Swords size={52} strokeWidth={1.15} />
          <span className="emblem-star">✦</span>
        </div>
      </section>

      <section className="hero-panel">
        <div className="hero-texture" aria-hidden="true" />
        <div className="hero-content">
          <span className="hero-kicker"><span /> SEU PRÓXIMO CAPÍTULO</span>
          <h2>As maiores aventuras<br />começam com uma escolha.</h2>
          <p>Crie sua primeira campanha e transforme uma ideia em um mundo compartilhado.</p>
          <Link className="button button-primary" to="/campaigns">
            <Plus size={17} /> Explorar campanhas <ArrowUpRight size={16} />
          </Link>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="hero-sun" />
          <div className="hero-mountain hero-mountain--back" />
          <div className="hero-mountain hero-mountain--front" />
          <div className="hero-castle"><Shield size={74} strokeWidth={0.8} /></div>
        </div>
        <div className="hero-index">01 <span>/</span> 04</div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">COMECE POR AQUI</p>
            <h2>Atalhos de aventura</h2>
          </div>
          <span className="section-note">Tudo começa com uma boa história.</span>
        </div>
        <div className="quick-grid">
          {quickLinks.map(({ to, icon: Icon, title, description, tone }) => (
            <Link className="quick-card" to={to} key={to}>
              <div className={`quick-icon quick-icon--${tone}`}>
                <Icon size={21} strokeWidth={1.8} />
              </div>
              <div className="quick-card-copy">
                <h3>{title}</h3>
                <p>{description}</p>
              </div>
              <ArrowUpRight className="quick-arrow" size={17} />
            </Link>
          ))}
        </div>
      </section>

      <section className="bottom-grid">
        <div className="panel panel-empty">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">SUA JORNADA</p>
              <h2>Campanhas recentes</h2>
            </div>
            <Link to="/campaigns" className="text-link">Ver campanhas <ArrowUpRight size={14} /></Link>
          </div>
          <div className="empty-state">
            <div className="empty-icon"><BookOpen size={23} /></div>
            <h3>Sua primeira história ainda está por vir</h3>
            <p>Quando você criar ou entrar em uma campanha, ela aparecerá aqui.</p>
            <Link to="/campaigns" className="button button-secondary">Conhecer campanhas</Link>
          </div>
        </div>

        <aside className="panel setup-panel">
          <div className="setup-icon"><Users size={21} /></div>
          <p className="eyebrow">PREPARANDO O REINO</p>
          <h2>Seu espaço de jogo está tomando forma.</h2>
          <p className="setup-copy">
            O REALMS está sendo preparado para funcionar com diferentes sistemas de RPG, sem limitar a criatividade do seu grupo.
          </p>
          <div className="setup-status">
            <span className={isSupabaseConfigured ? "status-indicator status-indicator--ready" : "status-indicator"} />
            <span>{isSupabaseConfigured ? "Configuração do Supabase detectada" : "Aguardando configuração do Supabase"}</span>
          </div>
        </aside>
      </section>
    </div>
  );
}
