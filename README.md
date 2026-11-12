# REALMS

Plataforma multiplayer para criar campanhas e jogar diferentes sistemas de RPG com amigos.

<https://arthurnunesdev.github.io/RPG/>

## Publicação

O REALMS é publicado pelo **GitHub Pages**, usando GitHub Actions. Cada push na branch `main` executa o build do Vite e publica o conteúdo de `dist/`.

- **Site:** https://arthurnunesdev.github.io/RPG/
- **Repositório:** https://github.com/ArthurNunesDev/RPG
- **Hospedagem:** GitHub Pages
- **Deploy:** GitHub Actions (workflow em `.github/workflows/deploy-pages.yml`)

O workflow gera também um `404.html` a partir do build para manter as rotas do React Router acessíveis ao atualizar ou abrir links diretamente.

## Stack

- React 19 + Vite 8
- JavaScript (ES modules)
- Supabase: PostgreSQL, Auth, Realtime e Storage
- React Router
- Lucide React

## Executar localmente

1. Instale as dependências:

   ```bash
   npm install
   ```

2. Copie `.env.example` para `.env.local` e configure:

   ```env
   VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```

3. Inicie o servidor:

   ```bash
   npm run dev
   ```

4. Gere a versão de produção:

   ```bash
   npm run build
   ```

## Configuração do Supabase

Projeto dedicado: `REALMS`  
Região: `sa-east-1`  
Project ref: `ktklhzngmtmgexzpofms`  
URL: https://ktklhzngmtmgexzpofms.supabase.co

No painel do Supabase, em **Authentication → URL Configuration**, configure:

- **Site URL:** `https://arthurnunesdev.github.io/RPG/`
- **Redirect URLs:** `https://arthurnunesdev.github.io/RPG/**`

As migrations iniciais e de papéis foram aplicadas e verificadas no projeto dedicado. As seis tabelas principais estão com RLS habilitado, e as três tabelas de colaboração estão publicadas no Realtime.

O schema inclui:

- Perfis vinculados ao Supabase Auth, com preferência de experiência (mestre, jogador ou observador).
- Sistemas de RPG com schema de ficha e regras em JSONB.
- Campanhas e participantes com papéis de mestre, jogador ou observador.
- Personagens com fichas flexíveis.
- Mensagens de campanha.
- Políticas RLS e publicação Realtime para dados compartilhados.

A chave publishable pode ser usada no frontend. Nunca coloque `service_role`, senhas ou segredos em variáveis `VITE_*`.

## Estado do projeto

Autenticação, recuperação de senha e seleção de experiência estão implementadas. CRUD de campanhas/personagens, convites, mesa virtual em tempo real e ferramentas operacionais do mestre ainda serão desenvolvidos em etapas próprias.
