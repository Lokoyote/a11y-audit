#!/usr/bin/env bash
# Script d'installation automatique de a11y-audit (Linux / macOS)
# Usage : ./install.sh
set -euo pipefail

APP_NAME="a11y-audit"
INSTALL_DIR="$HOME/.local/share/$APP_NAME"
BIN_DIR="$HOME/.local/bin"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "🔍 Installation de $APP_NAME"
echo "─────────────────────────────────────"

AUTO_YES=false
for arg in "$@"; do
  case "$arg" in
    --yes|-y) AUTO_YES=true ;;
  esac
done

# 1. Vérifier Node.js (>= 18 requis par Playwright), et l'installer
#    automatiquement si absent ou trop ancien (Ubuntu / Debian).
ensure_node() {
  if command -v node >/dev/null 2>&1; then
    local major
    major=$(node -v | sed 's/^v//' | cut -d. -f1)
    if [ "$major" -ge 18 ]; then
      echo "✅ Node.js $(node -v) détecté"
      return
    fi
    echo "⚠️  Node.js $(node -v) détecté, mais version < 18 : mise à jour nécessaire."
  else
    echo "⚠️  Node.js n'est pas installé."
  fi

  local os_id="" os_like=""
  if [ -f /etc/os-release ]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    os_id="${ID:-}"
    os_like="${ID_LIKE:-}"
  fi

  if [[ "$os_id" != "ubuntu" && "$os_id" != "debian" && "$os_like" != *debian* ]]; then
    echo "❌ Distribution non reconnue automatiquement pour l'installation de Node.js."
    echo "   Installez Node.js 18+ manuellement : https://nodejs.org"
    exit 1
  fi

  if [ "$AUTO_YES" = false ]; then
    read -r -p "Installer Node.js automatiquement via apt (sudo requis) ? [O/n] " confirm
    case "$confirm" in
      n|N|non|Non) echo "Installation annulée."; exit 1 ;;
    esac
  fi

  echo "📦 Installation de Node.js 20 LTS via NodeSource..."
  if command -v curl >/dev/null 2>&1 || sudo apt-get update -y && sudo apt-get install -y curl; then
    if curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - 2>/dev/null; then
      sudo apt-get install -y nodejs
    fi
  fi

  if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/^v//' | cut -d. -f1)" -lt 18 ]; then
    echo "⚠️  NodeSource indisponible ou insuffisant, tentative via les dépôts Ubuntu par défaut..."
    sudo apt-get update -y
    sudo apt-get install -y nodejs npm
  fi

  if ! command -v node >/dev/null 2>&1; then
    echo "❌ L'installation automatique de Node.js a échoué."
    echo "   Installez-le manuellement : https://nodejs.org puis relancez ./install.sh"
    exit 1
  fi

  local major2
  major2=$(node -v | sed 's/^v//' | cut -d. -f1)
  if [ "$major2" -lt 18 ]; then
    echo "❌ Version de Node.js encore insuffisante après installation ($(node -v))."
    echo "   Installez manuellement une version 18+ : https://nodejs.org"
    exit 1
  fi

  echo "✅ Node.js $(node -v) installé avec succès"
}

ensure_node

if ! command -v npm >/dev/null 2>&1; then
  echo "❌ npm est introuvable (devrait être installé avec Node.js)."
  exit 1
fi

# 2. Copier les fichiers du projet vers le dossier d'installation
echo "📁 Copie des fichiers vers $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
# On copie tout sauf les scripts d'installation eux-mêmes et un éventuel node_modules existant
rsync -a --exclude 'install.sh' --exclude 'uninstall.sh' --exclude 'install.ps1' \
  --exclude 'uninstall.ps1' --exclude 'node_modules' --exclude '.git' \
  "$SCRIPT_DIR"/ "$INSTALL_DIR"/ 2>/dev/null || {
    # Repli si rsync n'est pas disponible
    cp -r "$SCRIPT_DIR"/. "$INSTALL_DIR"/
    rm -rf "$INSTALL_DIR/install.sh" "$INSTALL_DIR/uninstall.sh" \
           "$INSTALL_DIR/install.ps1" "$INSTALL_DIR/uninstall.ps1" \
           "$INSTALL_DIR/node_modules"
  }

# 3. Installer les dépendances npm (production uniquement)
echo "📦 Installation des dépendances npm..."
cd "$INSTALL_DIR"
npm install --omit=dev --no-audit --no-fund

# 4. Télécharger le navigateur headless Chromium (nécessaire à Playwright)
echo "🌐 Téléchargement de Chromium (peut prendre quelques minutes, une seule fois)..."
if ! npx --yes playwright install chromium --with-deps 2>/dev/null; then
  echo "⚠️  Installation des dépendances système ignorée (droits insuffisants ?)."
  echo "   Tentative sans --with-deps..."
  npx --yes playwright install chromium
fi

# 5. Créer les commandes globales (CLI + interface graphique)
mkdir -p "$BIN_DIR"

# On fige le chemin ABSOLU de node trouvé ci-dessus (ensure_node) : les
# lanceurs d'applications GNOME (icône du menu, double-clic) démarrent avec
# un PATH minimal qui ne connaît pas forcément un node installé via nvm ou
# un chemin non standard. Sans ça, le clic sur l'icône échoue en silence
# (pas de terminal pour voir l'erreur "node: command not found").
NODE_BIN="$(command -v node)"

cat > "$BIN_DIR/$APP_NAME" << WRAPPER
#!/usr/bin/env bash
exec "$NODE_BIN" "$INSTALL_DIR/index.js" "\$@"
WRAPPER
chmod +x "$BIN_DIR/$APP_NAME"

cat > "$BIN_DIR/$APP_NAME-gui" << WRAPPER
#!/usr/bin/env bash
# Lancé depuis l'icône du menu (sans terminal) : on journalise tout pour
# pouvoir diagnostiquer un échec silencieux, et on prévient visuellement
# (notification) si le serveur ne répond toujours pas après quelques secondes.
LOG_DIR="\$HOME/a11y-audit-rapports"
mkdir -p "\$LOG_DIR"
LOG_FILE="\$LOG_DIR/gui.log"

echo "--- \$(date) ---" >> "\$LOG_FILE"
"$NODE_BIN" "$INSTALL_DIR/server.js" >> "\$LOG_FILE" 2>&1 &
SERVER_PID=\$!

sleep 5
if kill -0 "\$SERVER_PID" 2>/dev/null; then
  exit 0
fi

wait "\$SERVER_PID" 2>/dev/null
EXIT_CODE=\$?
if [ "\$EXIT_CODE" -ne 0 ]; then
  command -v notify-send >/dev/null 2>&1 && notify-send "a11y-audit" "Échec du démarrage — voir \$LOG_FILE" --icon=dialog-error
fi
WRAPPER
chmod +x "$BIN_DIR/$APP_NAME-gui"

# 6. Icône dans le menu des applications (double-clic, sans terminal) —
#    pratique pour les personnes qui ne sont pas à l'aise en ligne de commande.
DESKTOP_DIR="$HOME/.local/share/applications"
mkdir -p "$DESKTOP_DIR"
cat > "$DESKTOP_DIR/$APP_NAME-gui.desktop" << DESKTOP
[Desktop Entry]
Type=Application
Name=a11y-audit
Comment=Audit d'accessibilité web (WCAG) — interface graphique
Exec=$BIN_DIR/$APP_NAME-gui
Icon=accessibility
Terminal=false
Categories=Development;Utility;
DESKTOP
chmod +x "$DESKTOP_DIR/$APP_NAME-gui.desktop"
# Rafraîchit le cache des applications si l'outil est disponible (sinon
# l'icône apparaîtra quand même, parfois après une déconnexion/reconnexion).
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true

echo ""
echo "✅ Installation terminée !"
echo ""

# 6. Vérifier que le dossier bin est dans le PATH
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    echo "⚠️  $BIN_DIR n'est pas dans votre PATH."
    echo "   Ajoutez cette ligne à votre ~/.bashrc, ~/.zshrc ou équivalent, puis rouvrez votre terminal :"
    echo ""
    echo "   export PATH=\"\$HOME/.local/bin:\$PATH\""
    echo ""
    ;;
esac

echo "Utilisation :"
echo "  $APP_NAME https://votre-site.fr"
echo "  $APP_NAME https://votre-site.fr --level AAA --out ./audits"
echo ""
echo "Interface graphique (recommandé si vous n'êtes pas à l'aise avec le terminal) :"
echo "  Cherchez « a11y-audit » dans le menu des applications, ou lancez : $APP_NAME-gui"
echo "  Vos rapports et parcours enregistrés sont conservés dans ~/a11y-audit-rapports"
echo "  (ce dossier n'est PAS supprimé par uninstall.sh)."
echo ""
echo "Pour désinstaller : ./uninstall.sh"
