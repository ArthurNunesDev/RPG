import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  BookOpen,
  ChevronLeft,
  Compass,
  Dice5,
  LayoutDashboard,
  Library,
  Menu,
  MessageCircle,
  Moon,
  Settings,
  Shield,
  Sparkles,
  Swords,
  Users,
  UserRound,
  X,
} from "lucide-react";
import { isSupabaseConfigured } from "../lib/supabase.js";

const navigation = [
  {
    label: "Jogo",
    items: [
      { to: "/", label: "Visão geral", icon: LayoutDashboard, end: true },
      { to: "/campaigns", label: "Campanhas", icon: Swords },
      { to: "/characters", label: "Personagens", icon: UserRound },
      { to: "/tabletop", label: "Mesa virtual", icon: Compass },
      { to: "/dice", label: "Rolagem de dados", icon: Dice5 },
    ],
  },
  {
    label: "Explorar",
    items: [
      { to: "/library", label: "Biblioteca", icon: Library },
      { to: "/friends", label: "Amigos", icon: Users },
    ],
  },
];

const pageNames = {
  "/": "Visão geral",
  "/campaigns": "Campanhas",
  "/characters": "Personagens",
  "/tabletop": "Mesa virtual",
  "/dice": "Rolagem de dados",
  "/library": "Biblioteca",
  "/friends": "Amigos",
  "/settings": "Configurações",
};

export default function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const pageName = pageNames[location.pathname] ?? "REALMS";

  function closeMobileMenu() {
    setMobileOpen(false);
  }

  return (
    <div className="app-shell">
      {mobileOpen && (
        <button
          className="sidebar-backdrop"
          type="button"
          aria-label="Fechar menu"
          onClick={closeMobileMenu}
        />
      )}

      <aside className={`sidebar ${mobileOpen ? "sidebar--open" : ""}`}>
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <Swords size={22} strokeWidth={1.8} />
          </div>
          <div className="brand-copy">
            <span className="brand-name">REALMS</span>
            <span className="brand-caption">YOUR WORLD. YOUR STORY.</span>
          </div>
          <button
            className="icon-button sidebar-close"
            type="button"
            aria-label="Fechar navegação"
            onClick={closeMobileMenu}
          >
            <X size={18} />
          </button>
        </div>

        <div className="sidebar-scroll">
          {navigation.map((group) => (
            <nav className="nav-group" aria-label={group.label} key={group.label}>
              <p className="nav-heading">{group.label}</p>
              {group.items.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  onClick={closeMobileMenu}
                  className={({ isActive }) =>
                    `nav-link ${isActive ? "nav-link--active" : ""}`
                  }
                >
                  <Icon size={18} strokeWidth={1.8} />
                  <span>{label}</span>
                </NavLink>
              ))}
            </nav>
          ))}
        </div>

        <div className="sidebar-bottom">
          <div className="campaign-tip">
            <div className="tip-icon"><Sparkles size={17} /></div>
            <p className="tip-title">Toda lenda começa com uma história.</p>
            <p className="tip-copy">Reúna seu grupo e prepare a próxima aventura.</p>
          </div>
          <NavLink
            to="/settings"
            onClick={closeMobileMenu}
            className={({ isActive }) =>
              `nav-link nav-link--settings ${isActive ? "nav-link--active" : ""}`
            }
          >
            <Settings size={18} strokeWidth={1.8} />
            <span>Configurações</span>
          </NavLink>
          <div className="sidebar-footer">
            <span className="footer-dot" />
            <span>REALMS · VERSÃO INICIAL</span>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-menu-button"
              type="button"
              aria-label="Abrir navegação"
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={20} />
            </button>
            <div className="breadcrumb">
              <span>REALMS</span>
              <ChevronLeft className="breadcrumb-chevron" size={14} />
              <strong>{pageName}</strong>
            </div>
          </div>
          <div className="topbar-actions">
            <div
              className={`connection-pill ${isSupabaseConfigured ? "connection-pill--ready" : ""}`}
              title={
                isSupabaseConfigured
                  ? "Variáveis do Supabase configuradas; a conexão será validada ao autenticar."
                  : "Configure as variáveis do Supabase para habilitar os dados online."
              }
            >
              <span className="connection-dot" />
              {isSupabaseConfigured ? "Supabase configurado" : "Modo de configuração"}
            </div>
            <div className="topbar-divider" />
            <div className="user-avatar" aria-label="Perfil ainda não conectado">
              <UserRound size={17} />
            </div>
          </div>
        </header>

        <div className="page-content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
