#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash scripts/bootstrap-vps.sh"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  apt-get update
  apt-get install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  chmod 600 .env
  echo "Created .env. Fill all REPLACE/YOUR values, then run this script again."
  exit 1
fi

if grep -Eq 'REPLACE|YOUR_BSC|wallet\.example\.com' .env; then
  echo "Refusing to deploy: .env still contains placeholder values."
  echo "Required: DOMAIN, APP_URL, ACME_EMAIL, DB/Redis passwords, AUTH_SECRET,"
  echo "MASTER_MNEMONIC, HOT_WALLET_PRIVATE_KEY, BSC_RPC_URL, ADMIN_PASSWORD."
  exit 1
fi

chmod 600 .env
docker compose config >/dev/null
docker compose build --pull
docker compose up -d postgres redis
docker compose up --abort-on-container-exit --exit-code-from migrate migrate
docker compose up -d web deposit-worker withdrawal-worker sweeper caddy

echo
echo "Deployment started."
echo "Check: docker compose ps"
echo "Logs:  docker compose logs -f web deposit-worker withdrawal-worker sweeper caddy"
echo "Health: curl -fsS https://YOUR_DOMAIN/api/health"
echo
echo "Before real funds:"
echo "1. DNS points to this VPS and ports 80/443 are open."
echo "2. Hot wallet has BNB for gas and enough USDT for withdrawals."
echo "3. Back up MASTER_MNEMONIC offline; never commit .env."
echo "4. Test with only 1-2 USDT."
