#!/usr/bin/env bash
# Script de désinstallation automatique de a11y-audit (Linux / macOS)
# Usage : ./uninstall.sh [--yes]
set -euo pipefail

APP_NAME="a11y-audit"
INSTALL_DIR="$HOME/.local/share/$APP_NAME"
BIN_DIR="$HOME/.local/bin"
SKIP_CONFIRM=false

for arg in "$@"; do
  case "$arg" in
    --yes|-y) SKIP_CONFIRM=true ;;
  esac
done

echo ""
echo "🗑️  Désinstallation de $APP_NAME"
echo "─────────────────────────────────────"

if [ ! -d "$INSTALL_DIR" ] && [ ! -f "$BIN_DIR/$APP_NAME" ]; then
  echo "ℹ️  $APP_NAME ne semble pas installé (rien à faire)."
  exit 0
fi

echo "Sera supprimé :"
[ -d "$INSTALL_DIR" ] && echo "  - $INSTALL_DIR"
[ -f "$BIN_DIR/$APP_NAME" ] && echo "  - $BIN_DIR/$APP_NAME"
[ -f "$BIN_DIR/$APP_NAME-gui" ] && echo "  - $BIN_DIR/$APP_NAME-gui"
[ -f "$HOME/.local/share/applications/$APP_NAME-gui.desktop" ] && echo "  - $HOME/.local/share/applications/$APP_NAME-gui.desktop"
echo ""
echo "NE sera PAS supprimé (vos données) :"
echo "  - $HOME/a11y-audit-rapports"
echo ""

if [ "$SKIP_CONFIRM" = false ]; then
  read -r -p "Confirmer la suppression ? [o/N] " confirm
  case "$confirm" in
    o|O|y|Y|oui|Oui) ;;
    *) echo "Annulé."; exit 0 ;;
  esac
fi

rm -rf "$INSTALL_DIR"
rm -f "$BIN_DIR/$APP_NAME"
rm -f "$BIN_DIR/$APP_NAME-gui"
rm -f "$HOME/.local/share/applications/$APP_NAME-gui.desktop"

echo ""
echo "✅ $APP_NAME a été désinstallé."
