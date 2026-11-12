# REALMS

Plataforma multiplayer para criar campanhas e jogar diferentes sistemas de RPG com amigos.

<https://arthurnunesdev.github.io/RPG/>

## Publicação

O REALMS é publicado pelo **GitHub Pages**, usando GitHub Actions. Cada push na branch `main` executa o build do Vite e publica o conteúdo de `dist/`.

- **Site:** https://arthurnunesdev.github.io/RPG/
- **Repositório:** https://github.com/ArthurNunesDev/RPG
- **Hospedagem:** GitHub Pages
- **Deploy:** GitHub Actions (`.github/workflows/deploy-pages.yml`)

O workflow gera também um `404.html` a partir do build para manter as rotas do React Router acessíveis ao atualizar ou abrir links diretamente.

## Stack

- React 19 + Vite 8
- JavaScript (ES modules)
- Supabase: PostgreSQL, Auth, Realtime e Edge Functions
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

A Edge Function `realm-sessions` está implantada com verificação JWT habilitada. Ela valida o usuário autenticado, gera PINs de sessão e controla entrada, consulta, saída e encerramento das sessões. A chave `service_role` permanece exclusivamente no ambiente gerenciado pelo Supabase.

Nunca coloque `service_role`, senhas ou segredos em variáveis `VITE_*`.

## Funcionalidades implementadas

- Cadastro, login, recuperação e atualização de senha pelo Supabase Auth.
- Preferência de experiência: mestre, jogador ou observador.
- Biblioteca com sistemas oficiais e sistemas personalizados.
- CRUD de campanhas, com sistema de RPG vinculado.
- Personagens de jogadores e NPCs do mestre, classificados como aliados, inimigos ou neutros.
- Sessões de campanha com PIN de 8 caracteres, entrada de participantes e retomada de sessão ativa.
- Papéis de mestre, jogador e observador aplicados por campanha.
- Chat em tempo real da sessão, com observadores em modo somente leitura.
- Políticas RLS para proteger dados e ações por usuário, campanha e sessão.
- Favicon próprio com a identidade visual do REALMS.

## Estrutura de dados

O schema inclui:

- Perfis vinculados ao Supabase Auth.
- Sistemas de RPG com schema de ficha e regras em JSONB.
- Campanhas e participantes com papéis de mestre, jogador ou observador.
- Personagens de jogadores e NPCs controlados pelo mestre.
- Sessões persistentes associadas às campanhas, com PIN privado.
- Mensagens isoladas por sessão.

As tabelas privadas de sessão não são acessíveis diretamente pelo cliente. A Edge Function realiza as operações privilegiadas após validar o JWT. As mensagens usam RLS e Realtime para permitir colaboração dentro da sessão.
