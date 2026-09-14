# SISUMEPE Juazeiro — Hospedagem grátis (Render + Supabase, sem cartão)

Arquitetura: backend Node no **Render** (plano free) + banco Postgres e arquivos
no **Supabase** (plano free). O sistema detecta sozinho: com `SUPABASE_URL` e
`SUPABASE_KEY` usa a nuvem; sem elas, usa `db.json` local (modo atual do PC).

> Limites honestos do grátis: o Render “dorme” após ~15 min sem acesso e demora
> ~30–50s para acordar (ruim para a TV de manhã). O Supabase pausa o banco após
> 7 dias sem uso (acorda em ~10–30s). Com uso diário, quase não se percebe.
> Dica: crie um monitor gratuito no **UptimeRobot** pingando a URL a cada
> 5 min para o Render quase não dormir.

---

## PARTE 1 — Supabase (banco + arquivos), ~10 min

1. Crie a conta em **https://supabase.com** (e-mail ou GitHub, **sem cartão**)
   e clique em **New project**. Anote a senha do banco. Região: `South America (São Paulo)`.
2. Com o projeto aberto: **SQL Editor → New query**, cole **todo** o conteúdo de
   `deploy/supabase-schema.sql` e clique **Run** (cria tabelas, bucket e função).
3. Confira em **Storage** que existe o bucket público `anexos`.
4. Em **Project Settings → API**, copie:
   - `Project URL` → vira `SUPABASE_URL`
   - `service_role` **secret** → vira `SUPABASE_KEY` (nunca exponha no frontend!)

## PARTE 2 — Código no GitHub, ~10 min

O Render baixa o código do GitHub. No PC (com `git` instalado):

```powershell
cd "D:\Joanderson\Projetos IA\SISTEMA Atendimento"
git init; git add .; git commit -m "SISUMEPE"
# crie um repositório vazio no github.com e rode (troque SEU-USUARIO):
git remote add origin https://github.com/SEU-USUARIO/sisumepe.git
git branch -M main; git push -u origin main
```

## PARTE 3 — Render (backend), ~10 min

1. Conta em **https://render.com** (GitHub/Google, **sem cartão**) → **New → Web Service** → conecte o repositório `sisumepe`.
2. Configurações: **Runtime Node**, **Build** `npm install`, **Start** `node server.js`, plano **Free**.
3. Em **Environment**, adicione `SUPABASE_URL` e `SUPABASE_KEY` (valores da Parte 1).
4. **Deploy**. URL final: `https://sisumepe.onrender.com` (TV em `/tv`).

## PARTE 4 — Levar os dados atuais para a nuvem (opcional)

1. No sistema do PC (admin): **Usuários → Baixar backup** (salva o `.json`).
2. No sistema da nuvem (o `admin` padrão é `admin` / `admin123` — o banco novo
   começa vazio, sem seus usuários): **Usuários → Restaurar backup** com o arquivo.
3. Pronto: pessoas, tickets, chat, auditoria e **usuários/senhas** migrados.
   **Troque as senhas** em seguida.

## Manutenção

- Logs e restart: painel do Render (deploys automáticos a cada `git push`).
- Quota: 750h/mês no free (1 serviço 24h ≈ 744h — cabe no limite).
- Para sair do “cochilo”: UptimeRobot (grátis) pingando `https://sisumepe.onrender.com/api/health` a cada 5 minutos.
