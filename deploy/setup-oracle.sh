#!/usr/bin/env bash
# =====================================================================
#  SISUMEPE Juazeiro — instalação automática no Oracle Cloud (Ubuntu)
#  Uso:  ./setup-oracle.sh [dominio-opcional]
#  Ex.:  ./setup-oracle.sh
#        ./setup-oracle.sh atendimento.suaunidade.com.br
#  Sem domínio, usa https://<IP>.nip.io (HTTPS grátis, sem comprar nada)
# =====================================================================
set -euo pipefail

APP_DIR="$HOME/sisumepe"
SITE_ARG="${1:-}"

echo "================ 1/5 — Sistema ================"
sudo apt-get update -y
sudo apt-get install -y curl git unzip ufw iptables-persistent

echo "================ 2/5 — Node.js 22 LTS ================"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node --version
npm --version

echo "================ 3/5 — App SISUMEPE ================"
mkdir -p "$APP_DIR"
cd "$APP_DIR"
if [ -f package.json ]; then
  npm install --omit=dev --no-audit --no-fund
else
  echo "AVISO: package.json não encontrado em $APP_DIR."
  echo "Envie os arquivos do sistema para cá e rode: cd $APP_DIR && npm install && ./setup-oracle.sh"
fi
sudo npm install -g pm2 >/dev/null 2>&1 || true

echo "================ 4/5 — PM2 (sistema sempre ligado) ================"
if [ -f server.js ]; then
  pm2 delete sisumepe 2>/dev/null || true
  PORT=3000 pm2 start server.js --name sisumepe
  pm2 save
  sudo env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$USER" --hp "$HOME" >/dev/null 2>&1 || true
  echo "PM2 configurado (reinicia sozinho se o PC virtual rebootar)."
else
  echo "Pulando PM2 (server.js ainda não enviado)."
fi

echo "================ 5/5 — Firewall + HTTPS (Caddy) ================"
sudo ufw allow 22,80,443/tcp >/dev/null 2>&1 || true
sudo iptables -I INPUT -m state --state NEW -p tcp --dport 80 -j ACCEPT 2>/dev/null || true
sudo iptables -I INPUT -m state --state NEW -p tcp --dport 443 -j ACCEPT 2>/dev/null || true
sudo netfilter-persistent save >/dev/null 2>&1 || true

if ! command -v caddy >/dev/null 2>&1; then
  sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -y && sudo apt-get install -y caddy
fi

PUBIP="$(curl -s --max-time 10 https://ifconfig.me || curl -s --max-time 10 https://api.ipify.org || true)"
if [ -n "$SITE_ARG" ]; then
  SITE="$SITE_ARG"
elif [ -n "$PUBIP" ]; then
  SITE="$(echo "$PUBIP" | tr '.' '-').nip.io"
else
  SITE="_"
fi
sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
{
  admin off
}
$SITE {
  reverse_proxy 127.0.0.1:3000
}
EOF
sudo systemctl enable caddy >/dev/null 2>&1 || true
sudo systemctl reload caddy || sudo systemctl restart caddy

echo ""
echo "======================================================"
if [ "$SITE" = "_" ]; then
  echo "Acesse localmente:  http://localhost:3000  (via SSH)"
else
  echo "PRONTO! Sistema:  https://$SITE"
  echo "        TV:       https://$SITE/tv"
fi
echo "Comandos úteis:  pm2 status | pm2 logs sisumepe | pm2 restart sisumepe"
echo "======================================================"
