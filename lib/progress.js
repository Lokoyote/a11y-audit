'use strict';

const readline = require('readline');

/**
 * Barre de progression simple pour terminal, sans dépendance externe.
 * Se dégrade proprement en environnement non interactif (CI, sortie
 * redirigée vers un fichier) en affichant une ligne par étape au lieu
 * de réécrire la même ligne.
 */
class ProgressBar {
  constructor(total, { width = 30 } = {}) {
    this.total = Math.max(total, 1);
    this.current = 0;
    this.width = width;
    this.startedAt = Date.now();
    this.enabled = Boolean(process.stdout.isTTY);
    this.lastLabel = '';
  }

  _line(label) {
    const ratio = Math.min(this.current / this.total, 1);
    const filled = Math.round(this.width * ratio);
    const bar = '█'.repeat(filled) + '░'.repeat(this.width - filled);
    const pct = String(Math.round(ratio * 100)).padStart(3, ' ');
    const cols = process.stdout.columns || 100;
    const raw = `  [${bar}] ${pct}%  ${label || ''}`;
    return raw.length > cols - 1 ? raw.slice(0, cols - 1) : raw;
  }

  render(label) {
    if (label !== undefined) this.lastLabel = label;
    const line = this._line(this.lastLabel);
    if (this.enabled) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(line);
    } else {
      console.log(line.trim());
    }
  }

  tick(label) {
    this.current = Math.min(this.current + 1, this.total);
    this.render(label);
  }

  /** Affiche un message ponctuel (erreur, info) sans casser l'affichage de la barre. */
  log(message) {
    if (this.enabled) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
    }
    console.log(message);
    if (this.enabled) this.render();
  }

  finish(label) {
    this.current = this.total;
    this.render(label || 'Terminé');
    if (this.enabled) process.stdout.write('\n');
  }
}

module.exports = { ProgressBar };
