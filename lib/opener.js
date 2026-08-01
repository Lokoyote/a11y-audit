'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Les navigateurs installés en snap (Firefox, Chromium — défaut sur Ubuntu
 * récent) sont confinés par AppArmor et ne peuvent PAS lire les chemins
 * situés sous un dossier caché de $HOME (tout ce qui commence par un point :
 * ~/.local, ~/.config, ~/.cache...). Comme cet outil écrit ses rapports
 * sous ~/.local/share/a11y-audit/ par défaut, ouvrir le fichier directement
 * échoue avec "L'accès au fichier a été refusé" côté navigateur, alors que
 * le fichier existe bel et bien et que node y a parfaitement accès.
 *
 * On contourne le problème en copiant le rapport (fichier HTML autonome,
 * sans dépendance externe) vers un dossier visible sous $HOME avant de
 * l'ouvrir.
 */
function isUnderHiddenHomeDir(filePath) {
  const home = os.homedir();
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(home + path.sep)) return false;
  const relative = resolved.slice(home.length + 1);
  return relative.split(path.sep).some((segment) => segment.startsWith('.'));
}

function copyToVisibleLocation(filePath) {
  const visibleDir = path.join(os.homedir(), 'a11y-audit-rapports');
  fs.mkdirSync(visibleDir, { recursive: true });
  const dest = path.join(visibleDir, `${Date.now()}-${path.basename(filePath)}`);
  fs.copyFileSync(filePath, dest);
  return dest;
}

/**
 * Ouvre un fichier local dans le navigateur/l'application par défaut,
 * sans dépendance externe (utilise les commandes natives de l'OS).
 */
function openInBrowser(filePath) {
  let pathToOpen = filePath;

  const isUrl = /^https?:\/\//i.test(filePath);

  if (!isUrl && process.platform === 'linux' && isUnderHiddenHomeDir(filePath)) {
    try {
      pathToOpen = copyToVisibleLocation(filePath);
      console.log(`  ℹ️  Rapport copié vers un emplacement accessible au navigateur : ${pathToOpen}`);
    } catch (err) {
      console.log(`  ⚠️  Impossible de copier le rapport vers un emplacement accessible (${err.message}).`);
    }
  }

  const platform = process.platform;
  let cmd;
  if (platform === 'darwin') {
    cmd = `open "${pathToOpen}"`;
  } else if (platform === 'win32') {
    cmd = `start "" "${pathToOpen}"`;
  } else {
    // Linux (GNOME/Ubuntu, etc.)
    cmd = `xdg-open "${pathToOpen}"`;
  }

  // spawn(..., { detached: true, stdio: 'ignore' }) + unref() : le processus
  // enfant (xdg-open, qui lui-même relaie vers le navigateur) devient
  // totalement indépendant du processus Node. C'est important ici car
  // server.js appelle parfois process.exit() juste après avoir demandé
  // l'ouverture du navigateur (ex: relancement de l'app alors qu'une
  // instance tourne déjà) — avec l'ancien exec() non détaché, ce exit()
  // pouvait couper xdg-open avant même qu'il ait lancé le navigateur.
  try {
    const child = spawn(cmd, { shell: true, detached: true, stdio: 'ignore' });
    child.on('error', (err) => {
      console.log(`  ⚠️  Impossible d'ouvrir automatiquement le navigateur (${err.message}).`);
      console.log(`     Ouvrez ce fichier manuellement : ${pathToOpen}`);
    });
    child.unref();
  } catch (err) {
    console.log(`  ⚠️  Impossible d'ouvrir automatiquement le navigateur (${err.message}).`);
    console.log(`     Ouvrez ce fichier manuellement : ${pathToOpen}`);
  }
}

module.exports = { openInBrowser };
