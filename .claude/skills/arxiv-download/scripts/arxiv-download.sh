#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: arxiv-download.sh <arxiv-id-or-url> [--pdf|--source|--both] [--out DIR]

Defaults to saving into ./papers/<arxiv-id>/ and downloading both PDF and source.
EOF
}

mode="both"
outdir="./papers"
input=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pdf)
      mode="pdf"
      shift
      ;;
    --source|--texsource|--src)
      mode="source"
      shift
      ;;
    --both)
      mode="both"
      shift
      ;;
    --out)
      outdir="${2:-}"
      [[ -n "$outdir" ]] || { echo "Missing value for --out" >&2; exit 1; }
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [[ -z "$input" ]]; then
        input="$1"
      else
        echo "Unexpected argument: $1" >&2
        usage
        exit 1
      fi
      shift
      ;;
  esac
done

[[ -n "$input" ]] || { usage >&2; exit 1; }

id="$input"
if [[ "$input" =~ arxiv\.org/(abs|pdf)/([^/?#]+) ]]; then
  id="${BASH_REMATCH[2]}"
fi
shopt -s nocasematch
[[ "$id" =~ ^arxiv:(.+)$ ]] && id="${BASH_REMATCH[1]}"
shopt -u nocasematch
id="${id#https://}"
id="${id#http://}"
id="${id%%[?#]*}"
id="${id%.pdf}"

safe_id="${id//\//_}"
paper_dir="$outdir/$safe_id"
mkdir -p "$paper_dir"

pdf_url="https://arxiv.org/pdf/${id}.pdf"
src_url1="https://arxiv.org/e-print/${id}"
src_url2="https://arxiv.org/src/${id}"

if [[ "$mode" == "pdf" || "$mode" == "both" ]]; then
  pdf_out="$paper_dir/paper.pdf"
  echo "Downloading PDF: $pdf_url"
  curl -fL "$pdf_url" -o "$pdf_out"
  echo "Saved: $pdf_out"
fi

if [[ "$mode" == "source" || "$mode" == "both" ]]; then
  src_out="$paper_dir/source.tar.gz"
  src_dir="$paper_dir/source"
  echo "Downloading source: $id"
  tmpfile="$(mktemp)"
  trap 'rm -f "$tmpfile"' EXIT
  if curl -fL "$src_url1" -o "$tmpfile"; then
    mv "$tmpfile" "$src_out"
  else
    curl -fL "$src_url2" -o "$tmpfile"
    mv "$tmpfile" "$src_out"
  fi
  trap - EXIT
  rm -f "$tmpfile"

  rm -rf "$src_dir"
  mkdir -p "$src_dir"
  tar -xzf "$src_out" -C "$src_dir"
  echo "Saved: $src_out"
  echo "Extracted to: $src_dir"
  rm -f "$src_out"

  if find "$src_dir" -type f -name '*.pdf' | grep -q .; then
    echo "Converting PDF figures to PNG..."
    node "$(dirname "$0")/source-pdfs-to-png.mjs" "$src_dir"
  fi
fi
