import {
  ArrowLeft,
  BookOpen,
  Compass,
  Library,
  Swords,
  UserRound,
  Users,
  Wrench,
} from "lucide-react";
import { Link } from "react-router-dom";

const icons = {
  campaigns: Swords,
  characters: UserRound,
  tabletop: Compass,
  library: Library,
  friends: Users,
  settings: Wrench,
};

export default function PlaceholderPage({ eyebrow, title, description, icon = "library" }) {
  const Icon = icons[icon] ?? BookOpen;

  return (
    <section className="module-page">
      <Link to="/" className="back-link"><ArrowLeft size={15} /> Voltar ao início</Link>
      <div className="module-heading">
        <div className="module-icon"><Icon size={25} strokeWidth={1.6} /></div>
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="page-lead">{description}</p>
        </div>
      </div>
      <div className="module-placeholder panel">
        <div className="placeholder-orbit" aria-hidden="true">
          <div className="orbit orbit--one" />
          <div className="orbit orbit--two" />
          <Icon size={34} strokeWidth={1.2} />
        </div>
        <span className="coming-soon">EM DESENVOLVIMENTO</span>
        <h2>Este capítulo está sendo escrito.</h2>
        <p>Esta área já faz parte da estrutura do REALMS e receberá suas funcionalidades nas próximas etapas.</p>
        <Link to="/" className="button button-secondary">Voltar ao painel</Link>
      </div>
    </section>
  );
}
