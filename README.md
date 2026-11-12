# REALMS

Plataforma multiplayer para criar campanhas e jogar RPG com amigos.

**[Acessar o Site](https://arthurnunesdev.github.io/RPG/)**

## Sobre

- Campanhas com sistemas de RPG oficiais e personalizados.
- Sessões com PIN gerado pelo mestre e entrada por código.
- Perfis de mestre, jogador e observador.
- Personagens, aliados e inimigos.
- Mapas, trilhas sonoras e rolagem de dados dentro da campanha.
- Amigos e status de presença em tempo real.

## Tecnologias

React 19 · Vite 8 · JavaScript · Supabase · React Router · Lucide

## Executar localmente

```bash
npm install
```

Crie o arquivo `.env.local` com as credenciais públicas do projeto Supabase:

```env
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Inicie o ambiente:

```bash
npm run dev
```

Para gerar a versão de produção:

```bash
npm run build
```

## Publicação

O site é hospedado no **GitHub Pages**. Commits na branch `main` acionam automaticamente o workflow de build e publicação do GitHub Actions.

Nunca exponha chaves secretas ou a chave `service_role` no código do frontend.
