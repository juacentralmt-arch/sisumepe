# SISUMEPE Juazeiro — Gestão de atendimento e manutenção de tornozeleiras eletrônicas

## Rodar local

```powershell
npm install
node server.js
```

Acesse `http://localhost:3000` (painel) e `http://localhost:3000/tv` (painel TV).
Sem `SUPABASE_URL` + `SUPABASE_KEY` no ambiente, usa `db.json` local. Veja `.env.example`.

Usuários iniciais: `recepcao` / `joanderson` / `adailton` / `admin` (sufixo `123`).

## Deploy (Render + Supabase, grátis)

Guia completo em `deploy/README-RENDER.md`. Resumo:

1. Supabase: rode `deploy/supabase-schema.sql` no SQL Editor, crie o bucket `anexos`.
2. GitHub: `git push` para `main`.
3. Render: Web Service Node (`npm install` / `node server.js`) com as envs do `render.yaml`.
4. Opcional: migre os dados via **Usuários → Baixar backup** (PC) → **Restaurar backup** (nuvem).

## Segurança embutida

- **Chat e chamadas privados**: mensagens diretas e sinalização WebRTC (SSE) chegam somente ao autor e ao destinatário — nunca a toda a equipe.
- **`db.json` à prova de crash**: gravação atômica (arquivo temporário + rename) — um desligamento abrupto nunca corrompe o banco local.
- **Painel TV sem sobrenome**: `/api/tv` exibe apenas primeiro nome + inicial (ex. `Daniel R.`), reduzindo exposição de dados pessoais em tela pública (LGPD).
- **Graceful shutdown**: em redeploys (SIGTERM), o servidor responde o que está em voo antes de sair.
- **Heartbeat SSE** a cada 25s, evitando cortes de conexão por proxies ociosos.
- **Rotas `/api/*` desconhecidas** retornam 404 JSON (não caem na SPA).
- Multer ≥ 2 (corrige advisory de DoS em uploads multipart).

## Regras de negócio

- Tickets de tornozeleira **Infinity**: só o técnico `julio` (ou `admin`) pode assumir.
  O usuário `julio` precisa existir e estar ativo (crie pelo painel admin).
- Perfil **psico** (ex.: `psicologo`): aba Psicossocial com prontuário (triagem + evoluções SOAP),
  atendimentos/frequência, grupos reflexivos, encaminhamentos com contra-referência e documentos
  (declaração, relatório de frequência, relatório técnico, ofício de encaminhamento).
  Prontuário e rotas `/api/psi` restritos ao perfil psico (nem técnico nem admin acessam). Requer `deploy/migration-psi.sql` no Supabase.