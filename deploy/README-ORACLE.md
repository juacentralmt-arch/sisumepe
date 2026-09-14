# SISUMEPE Juazeiro — Hospedagem gratuita no Oracle Cloud (Always Free)

Guia para tirar o sistema do PC e deixar **ligado 24h na nuvem, de graça e para sempre**,
sem mudar nada no código (dados em `db.json` + `uploads/` continuam iguais).

> ⚠️ O que eu **não consigo fazer por você**: criar a conta Oracle (pede cartão
> para verificação — sem cobrança no plano gratuito) e clicar para criar a máquina.
> O resto eu te acompanho aqui, passo a passo.

---

## PARTE 1 — Criar a conta Oracle (uma vez só, ~15 min)

1. Acesse **https://www.oracle.com/cloud/free/** e clique em *Start for free*.
2. Preencha e-mail, nome e país. **Vai pedir cartão de crédito** (verificação;
   o plano Always Free não cobra nada).
3. Escolha a **Home Region**: `Brazil Southeast (São Paulo)` ou `Brazil Southeast (Vinhedo)`.
4. Confirme o e-mail e entre no console: **https://cloud.oracle.com**.

## PARTE 2 — Criar a máquina virtual gratuita

1. No console: **Compute → Instances → Create instance**.
2. Nome: `sisumepe`. Compartimento e domínio de disponibilidade: padrão
   (se der erro de capacidade, troque o *Availability Domain*).
3. **Image**: `Canonical Ubuntu` **24.04** (padrão).
4. **Shape** (tente nesta ordem):
   - `VM.Standard.A1.Flex` → **2 OCPUs / 12 GB RAM** (ARM, o melhor)
   - se der *“Out of host capacity”*: tente outro Availability Domain, ou
     caia para `VM.Standard.E2.1.Micro` (AMD, 1 GB — roda o sistema tranquilo).
5. **SSH**: escolha *Generate a key pair* e **baixe as duas chaves**
   (`.key` privada e `.key.pub`) — guarde numa pasta segura.
6. **Rede**: marque *Assign a public IPv4 address*. Depois, em
   **Virtual Cloud Networks → Security Lists → Default**, adicione regras de
   entrada (*Ingress*) liberando as portas **22, 80 e 443** para `0.0.0.0/0`.
7. **Create**. Anote o **IP público** da instância.

> 💡 Capacidade ARM costuma esgotar em São Paulo — insistir em outro horário
> ou AD diferente quase sempre resolve.

## PARTE 3 — Enviar o sistema do PC para a nuvem

No **PowerShell do seu PC** (pasta do projeto aberta), rode:

```powershell
$src = "D:\Joanderson\Projetos IA\SISTEMA Atendimento"
$tmp = "$env:TEMP\sisumepe-deploy"
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory $tmp | Out-Null
Copy-Item "$src\server.js", "$src\package.json", "$src\db.json" $tmp
Copy-Item "$src\public" "$tmp\public" -Recurse
Copy-Item "$src\uploads" "$tmp\uploads" -Recurse -ErrorAction SilentlyContinue
Copy-Item "$src\deploy\setup-oracle.sh" $tmp
tar -a -c -f "$env:TEMP\sisumepe.zip" -C $tmp *
scp -i "C:\caminho\da\sua-chave.key" "$env:TEMP\sisumepe.zip" ubuntu@SEU-IP:~/sisumepe.zip
```

> Troque `C:\caminho\da\sua-chave.key` e `SEU-IP`. Se o `ssh/scp` reclamar da
> chave no Windows: `ssh-keygen -y -f chave.key > chave-ssh` e use esse arquivo,
> ou converta a permissão com `icacls`.

## PARTE 4 — Instalar (dentro da máquina, via SSH)

```bash
ssh -i "C:\caminho\da\sua-chave.key" ubuntu@SEU-IP
mkdir -p ~/sisumepe && tar -x -f ~/sisumepe.zip -C ~/sisumepe
cd ~/sisumepe && chmod +x setup-oracle.sh && ./setup-oracle.sh
```

O script instala Node 22, dependências, PM2 (mantém ligado + volta sozinho
após reboot), abre o firewall e configura HTTPS automático. No final ele mostra:

- Sistema: `https://<IP-com-tracos>.nip.io`
- TV: `https://<IP-com-tracos>.nip.io/tv`

Entre com seus usuários normais (`admin`, `julio`, `daniel`…) — **vão junto no
`db.json` enviado**. Depois **troque as senhas** em Minha conta.

## PARTE 5 — Rotina e cuidados

| Tarefa | Como |
|---|---|
| Ver se está no ar | `pm2 status` / `pm2 logs sisumepe` |
| Reiniciar | `pm2 restart sisumepe` |
| Backup | botão **Baixar backup** na aba Usuários (admin) |
| Manter a conta ativa | Oracle pode recolher máquina 100% parada por semanas — o próprio uso diário resolve |
| Link fixo bonito | aponte um domínio próprio e rode `./setup-oracle.sh atendimento.suaunidade.com.br` |

## Problemas comuns

- **Site não abre**: confira a Security List (80/443) e `sudo iptables -L -n`.
- **HTTPS demora na 1ª vez**: o Caddy emite o certificado em ~1 min; aguarde e recarregue.
- **Out of host capacity**: outro AD, outro horário ou shape AMD Micro.
- **Som/voz na TV**: toque em “Ativar som e voz” uma vez no navegador da TV.
