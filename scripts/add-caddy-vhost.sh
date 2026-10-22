#!/usr/bin/env bash
# Menambahkan vhost wh.delova.id ke Caddy yang SUDAH berjalan di Docker (mis. stack ecommerce), dengan pengaman:
#   backup Caddyfile -> tambah blok (append, tidak mengubah isi lama) -> validasi -> reload -> otomatis rollback bila gagal.
# Pakai:  ./scripts/add-caddy-vhost.sh [nama-container-caddy] [domain] [upstream]
#   default: container terdeteksi otomatis (image caddy yang memakai port 443), domain wh.delova.id, upstream dlv-warehouse:3000
# Opsional: ASSUME_YES=1 (tanpa pertanyaan)
set -euo pipefail
CADDY="${1:-}"
DOMAIN="${2:-${APP_DOMAIN:-wh.delova.id}}"
UPSTREAM="${3:-dlv-warehouse:3000}"
say()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!  %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mX  %s\033[0m\n' "$*" >&2; exit 1; }
ask()  { [ "${ASSUME_YES:-0}" = 1 ] && return 0; read -r -p "$1 [y/N] " a; [[ "$a" =~ ^[yY]$ ]]; }

say "1/5 Mencari container Caddy"
if [ -z "$CADDY" ]; then
  mapfile -t found < <(docker ps --format '{{.Names}}|{{.Image}}|{{.Ports}}' | awk -F'|' '$2 ~ /caddy/ && $3 ~ /:443->/ {print $1}')
  [ "${#found[@]}" -eq 1 ] || die "Container Caddy tidak terdeteksi tunggal (${#found[@]} ditemukan). Sebutkan manual: $0 NAMA_CONTAINER"
  CADDY="${found[0]}"
fi
echo "Container: $CADDY"

say "2/5 Mencari file Caddyfile"
CF_IN="$(docker inspect -f '{{range .Mounts}}{{.Destination}}{{"\n"}}{{end}}' "$CADDY" | grep -E 'Caddyfile$' | head -1 || true)"
[ -n "$CF_IN" ] || die "Caddyfile di container $CADDY tidak berasal dari file di server (mungkin ada di dalam image/volume). Jangan diubah otomatis; kirim hasil: docker inspect $CADDY --format '{{json .Mounts}}'"
CF_HOST="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "'"$CF_IN"'"}}{{.Source}}{{end}}{{end}}' "$CADDY")"
[ -f "$CF_HOST" ] || die "Sumber Caddyfile bukan file biasa: $CF_HOST"
echo "Di server   : $CF_HOST"
echo "Di container: $CF_IN"
if grep -qE "^\s*$DOMAIN\s*(,|\{)" "$CF_HOST"; then
  echo "Blok untuk $DOMAIN sudah ada di Caddyfile. Tidak ada yang diubah."; exit 0
fi

BLOCK="
# --- Delova Gudang (ditambahkan oleh scripts/add-caddy-vhost.sh) ---
$DOMAIN {
	encode zstd gzip
	reverse_proxy $UPSTREAM
	header Strict-Transport-Security \"max-age=31536000\"
	request_body {
		max_size 5MB
	}
}
"
say "3/5 Blok yang akan DITAMBAHKAN di akhir file (isi lama tidak diubah)"
printf '%s\n' "$BLOCK"
getent ahostsv4 "$DOMAIN" >/dev/null 2>&1 || warn "DNS $DOMAIN belum terdeteksi. Sertifikat HTTPS baru terbit setelah record A 'wh' mengarah ke server ini (situs lain tidak terpengaruh)."
ask "Tambahkan ke $CF_HOST dan reload Caddy?" || die "Dibatalkan. Tidak ada yang diubah."

BK="$CF_HOST.bak-$(date +%Y%m%d-%H%M%S)"
cp -p "$CF_HOST" "$BK"
echo "Backup: $BK"
# Append IN-PLACE (bukan mv/sed -i) agar bind-mount file ke container tetap menunjuk file yang sama
printf '%s\n' "$BLOCK" >> "$CF_HOST"

say "4/5 Validasi konfigurasi"
rollback() { cat "$BK" > "$CF_HOST"; warn "Dikembalikan ke backup: $BK"; }
if ! docker exec "$CADDY" caddy validate --config "$CF_IN" --adapter caddyfile; then
  rollback; die "Validasi gagal. Caddyfile sudah dikembalikan; situs ecommerce tidak tersentuh."
fi

say "5/5 Reload Caddy (tanpa downtime)"
if ! docker exec "$CADDY" caddy reload --config "$CF_IN" --adapter caddyfile; then
  rollback; docker exec "$CADDY" caddy reload --config "$CF_IN" --adapter caddyfile || true
  die "Reload gagal; dikembalikan ke konfigurasi lama."
fi
say "SELESAI"
echo "Cek:  curl -I https://$DOMAIN/api/health      (sertifikat bisa butuh ±1 menit)"
echo "Log:  docker logs --tail 30 $CADDY"
echo "Batalkan: cat $BK > $CF_HOST && docker exec $CADDY caddy reload --config $CF_IN --adapter caddyfile"
