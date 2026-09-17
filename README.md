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

## Regras de negócio

- Tickets de tornozeleira **Infinity**: só o técnico `julio` (ou `admin`) pode assumir.
  O usuário `julio` precisa existir e estar ativo (crie pelo painel admin).