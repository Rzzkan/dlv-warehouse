#!/usr/bin/env bash
# Deploy sekali jalan di VPS (Ubuntu + Docker). Jalankan dari folder repo:
#   ./scripts/setup-vps.sh [domain]            VPS KHUSUS (Caddy + HTTPS otomatis, memakai port 80/443)
#   ./scripts/setup-vps.sh --shared [domain]   VPS BERBAGI: sudah ada web server/ecommerce di port 80/443.
#                                              Aplikasi hanya di 127.0.0.1:APP_PORT; Anda tambahkan 1 vhost di web server yang ada.
# Tanpa --shared, skrip otomatis menolak bila port 80/443 sudah dipakai (agar situs lain tidak terganggu).
# Aman dijalankan ulang: .env yang sudah ada tidak ditimpa.
# Variabel opsional: ADMIN_PASSWORD=...  APP_PORT=3100  ASSUME_YES=1 (tanpa pertanyaan)
set -euo pipefail
cd "$(dirname "$0")/.."

SHARED=0
args=()
for a in "$@"; do case "$a" in --shared) SHARED=1;; *) args+=("$a");; esac; done
DOMAIN="${args[0]:-${APP_DOMAIN:-wh.delova.id}}"
APP_PORT="${APP_PORT:-3100}"
if [ "$SHARED" = 1 ]; then COMPOSE_FILE_NAME=docker-compose.shared.yml; else COMPOSE_FILE_NAME=docker-compose.prod.yml; fi
export COMPOSE_FILE="$COMPOSE_FILE_NAME"
COMPOSE=(docker compose)

say()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!  %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mX  %s\033[0m\n' "$*" >&2; exit 1; }
ask()  { [ "${ASSUME_YES:-0}" = 1 ] && return 0; read -r -p "$1 [y/N] " a; [[ "$a" =~ ^[yY]$ ]]; }
port_used() { ss -ltn 2>/dev/null | awk -v p=":$1\$" '$4 ~ p {f=1} END{exit !f}'; }

say "1/6 Memeriksa Docker & port"
command -v docker >/dev/null || die "Docker belum terpasang."
docker compose version >/dev/null 2>&1 || die "Plugin Docker Compose tidak ditemukan."
docker info >/dev/null 2>&1 || die "Tidak bisa mengakses Docker. Jalankan sebagai user di grup 'docker' (atau pakai sudo)."
[ -f "$COMPOSE_FILE_NAME" ] || die "Jalankan skrip ini dari dalam folder repo dlv-warehouse."
if [ "$SHARED" = 0 ]; then
  if port_used 80 || port_used 443; then
    warn "Port 80/443 di server ini SUDAH dipakai (kemungkinan ecommerce/web server lain)."
    warn "Mode standar akan bentrok. Pakai mode berbagi:  ./scripts/setup-vps.sh --shared $DOMAIN"
    warn "Lihat siapa yang memakainya:  sudo ss -ltnp | grep -E ':(80|443) '"
    die "Dibatalkan (tidak ada yang diubah)."
  fi
else
  if ! docker ps --format '{{.Names}}' | grep -q "^$(basename "$PWD")-app-1\$" && port_used "$APP_PORT"; then
    die "Port $APP_PORT sudah dipakai proses lain. Pilih port lain:  APP_PORT=3110 ./scripts/setup-vps.sh --shared $DOMAIN"
  fi
fi

say "2/6 Menyiapkan .env"
generated=""
if [ -f .env ]; then
  echo ".env sudah ada: dipakai apa adanya."
  grep -q '^COMPOSE_FILE=' .env || echo "COMPOSE_FILE=$COMPOSE_FILE_NAME" >> .env
  if [ "$SHARED" = 1 ]; then APP_PORT="$(grep -E '^APP_PORT=' .env | head -1 | cut -d= -f2- || true)"; APP_PORT="${APP_PORT:-3100}"; fi
else
  admin_pw="${ADMIN_PASSWORD:-}"
  if [ -z "$admin_pw" ]; then
    read -r -s -p "Password admin awal (min 8 karakter; kosongkan = dibuatkan acak): " admin_pw; echo
    if [ -z "$admin_pw" ]; then admin_pw="$(openssl rand -hex 8)"; generated=1; fi
  fi
  [ "${#admin_pw}" -ge 8 ] || die "Password admin minimal 8 karakter."
  case "$admin_pw" in *[\$\"\'\`\ \#\\]*) die "Password admin tidak boleh berisi spasi atau karakter \$ \" ' \` # \\ (merusak file .env).";; esac
  umask 077
  cat > .env <<ENV
COMPOSE_FILE=$COMPOSE_FILE_NAME
APP_DOMAIN=$DOMAIN
APP_PORT=$APP_PORT
DB_ROOT_PASSWORD=$(openssl rand -hex 24)
DB_USER=delova
DB_PASSWORD=$(openssl rand -hex 24)
DB_NAME=delova_warehouse
ADMIN_USERNAME=admin
ADMIN_PASSWORD=$admin_pw
TZ_OFFSET_MINUTES=420
SESSION_DAYS=14
ENV
  chmod 600 .env
  echo ".env dibuat (izin 600) dengan password database acak."
fi

say "3/6 Memeriksa DNS $DOMAIN"
pub_ip="$(curl -fsS --max-time 6 https://api.ipify.org 2>/dev/null || true)"
dom_ip="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}' || true)"
echo "IP server ini : ${pub_ip:-tidak diketahui}"
echo "IP $DOMAIN : ${dom_ip:-belum ada}"
if [ -z "$dom_ip" ] || { [ -n "$pub_ip" ] && [ "$dom_ip" != "$pub_ip" ]; }; then
  warn "DNS belum mengarah ke server ini. Tanpa itu sertifikat HTTPS gagal dibuat."
  warn "(Bila memakai proxy Cloudflare, IP berbeda itu wajar.)"
  ask "Tetap lanjut?" || die "Dibatalkan. Atur record A '$DOMAIN' -> ${pub_ip:-IP VPS}, tunggu beberapa menit, lalu jalankan ulang."
fi

say "4/6 Build & menjalankan container (1-3 menit pertama kali)"
"${COMPOSE[@]}" up -d --build

say "5/6 Menunggu aplikasi siap"
cid="$("${COMPOSE[@]}" ps -q app)"
st=none
for _ in $(seq 1 60); do
  st="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || echo none)"
  [ "$st" = healthy ] && break
  sleep 3
done
if [ "$st" != healthy ]; then
  "${COMPOSE[@]}" logs --tail 40 app || true
  die "Aplikasi belum sehat (status: $st). Lihat log di atas."
fi
echo "Aplikasi sehat."
if [ "$SHARED" = 1 ]; then
  curl -fsS --max-time 5 "http://127.0.0.1:$APP_PORT/api/health" >/dev/null 2>&1 && echo "Terjangkau di http://127.0.0.1:$APP_PORT (khusus server ini)." || warn "Port $APP_PORT belum menjawab."
else
  echo "Menunggu HTTPS https://$DOMAIN (sertifikat bisa butuh sampai 2 menit)..."
  ok=""
  for _ in $(seq 1 40); do
    if curl -fsS --max-time 5 "https://$DOMAIN/api/health" >/dev/null 2>&1; then ok=1; break; fi
    sleep 3
  done
  if [ -z "$ok" ]; then
    warn "HTTPS belum bisa diakses. Biasanya DNS belum aktif / port 80+443 tertutup. Log Caddy:"
    "${COMPOSE[@]}" logs --tail 15 caddy || true
    warn "Setelah DNS benar: docker compose restart caddy"
  fi
fi

say "6/6 Backup harian"
if ! crontab -l 2>/dev/null | grep -qF "scripts/backup.sh"; then
  if ask "Pasang backup otomatis tiap 01:30 (simpan 14 hari di ./backups)?"; then
    (crontab -l 2>/dev/null; echo "30 1 * * * $PWD/scripts/backup.sh >> $HOME/delova-backup.log 2>&1") | crontab -
    echo "Cron backup terpasang."
  fi
else
  echo "Cron backup sudah ada."
fi

say "SELESAI"
if [ "$SHARED" = 1 ]; then
  echo "Aplikasi hidup di 127.0.0.1:$APP_PORT. LANGKAH TERAKHIR (manual): tambahkan 1 vhost di web server yang sudah ada,"
  echo "yang meneruskan https://$DOMAIN -> http://127.0.0.1:$APP_PORT  (contoh: deploy/nginx-shared.conf, deploy/Caddyfile.shared, atau CloudPanel -> Reverse Proxy)."
  echo "Cek setelah itu:  curl -I https://$DOMAIN/api/health"
else
  echo "Alamat   : https://$DOMAIN"
fi
echo "Login    : admin"
if [ -n "$generated" ]; then echo "Password : $admin_pw   <-- CATAT SEKARANG, tidak ditampilkan lagi"; else echo "Password : sesuai yang Anda isi (ADMIN_PASSWORD di .env)"; fi
echo "Langkah berikut: login -> ganti password admin -> buat akun staf -> isi Jenis Kain."
echo "Status   : docker compose ps        Log: docker compose logs -f app"
