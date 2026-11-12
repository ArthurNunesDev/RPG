# REALMS

Plataforma multiplayer para criar campanhas e jogar diferentes sistemas de RPG com amigos.

## Stack

- React 19 + Vite
- JavaScript (ES modules)
- Supabase: PostgreSQL, Auth, Realtime e Storage
- React Router
- Lucide React

## Requisitos

- Node.js compatível com Vite 8
- Node.js 20.19+ (ou 22.12+)
- npm
- Projeto Supabase exclusivo para o REALMS

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

## Supabase

Projeto dedicado: `REALMS`  
Região: `sa-east-1`  
Project ref: `ktklhzngmtmgexzpofms`  
URL: https://ktklhzngmtmgexzpofms.supabase.co

A migration inicial já foi aplicada e verificada no projeto dedicado. As seis tabelas principais estão criadas com RLS habilitado, e as três tabelas de colaboração estão publicadas no Realtime.

O schema inicial cria:

- Perfis vinculados ao Supabase Auth.
- Sistemas de RPG com schema de ficha e regras em JSONB.
- Campanhas e participantes com papéis de mestre/jogador.
- Personagens com fichas flexíveis.
- Mensagens de campanha.
- Políticas RLS e publicação Realtime para os dados compartilhados.

A chave publishable pode ser usada no frontend. Nunca coloque `service_role`, senhas ou segredos em variáveis `VITE_*`.

## Estado do projeto

O repositório contém a fundação visual e técnica inicial. Autenticação de interface, CRUD de campanhas/personagens, convites, mesa virtual e ferramentas do mestre serão implementados em etapas próprias.
