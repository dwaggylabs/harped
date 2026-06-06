#!/bin/bash
# ============================================================================
# HARPED — build a single self-contained index.html for iPad / hosting.
#
# Inlines style.css + game.js + Huw's recording (as a compressed AAC data URI)
# into ONE index.html, built from template.html. This is what makes the game
# run on an iPad: a single file with no external resources, so it works the
# moment Safari (or a host) loads it — no file:// cross-file blocking.
#
# Edit the game in style.css / game.js / template.html, then run ./build.sh
# to regenerate index.html. The originals are never touched.
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")"

WAV="huw-faure-impromptu.wav"
TEMPLATE="template.html"
CSS="style.css"
JS="game.js"
OUT="index.html"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

for f in "$WAV" "$TEMPLATE" "$CSS" "$JS"; do
  [ -f "$f" ] || { echo "ERROR: missing $f" >&2; exit 1; }
done

echo "1/3  Compressing audio (AAC ~96 kbps)…"
# Resample to 44.1 kHz so AAC CBR is accepted, then encode. Original wav untouched.
afconvert "$WAV" -o "$TMP/r.wav" -d LEI16@44100 -f WAVE
afconvert "$TMP/r.wav" -o "$TMP/huw.m4a" -f m4af -d aac -b 96000
base64 < "$TMP/huw.m4a" | tr -d '\n' > "$TMP/audio.b64"
echo "     audio: $(wc -c < "$TMP/huw.m4a" | tr -d ' ') bytes -> $(wc -c < "$TMP/audio.b64" | tr -d ' ') base64 chars"

echo "2/3  Inlining CSS + JS + audio into $OUT…"
export TEMPLATE CSS JS OUT TMP
perl -0777 -e '
  sub slurp { local $/; open(my $fh, "<", $_[0]) or die "open $_[0]: $!"; my $d = <$fh>; close $fh; return $d; }
  my $html  = slurp($ENV{TEMPLATE});
  my $css   = slurp($ENV{CSS});
  my $js    = slurp($ENV{JS});
  my $b64   = slurp("$ENV{TMP}/audio.b64"); $b64 =~ s/\s+//g;
  my $uri   = "data:audio/mp4;base64,$b64";

  $html =~ s{<link rel="stylesheet" href="style\.css"\s*/>}{<style>\n$css\n  </style>} or die "stylesheet link not found";
  $html =~ s{<script src="game\.js"></script>}{<script>\n$js\n  </script>} or die "script tag not found";
  $html =~ s{src="huw-faure-impromptu\.wav"}{src="$uri"} or die "audio src not found";

  open(my $out, ">", $ENV{OUT}) or die; print $out $html; close $out;
'

echo "3/3  Done."
echo "     $OUT: $(wc -c < "$OUT" | tr -d ' ') bytes (self-contained, no external files needed)"
# Sanity: there should be no leftover external references in the bundle.
if grep -Eq 'href="style\.css"|src="game\.js"|src="huw-faure-impromptu\.wav"' "$OUT"; then
  echo "WARNING: an external reference survived inlining — check $OUT" >&2
  exit 1
fi
echo "     verified: no external style/script/audio references remain."
