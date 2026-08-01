'use strict';

async function pollJob(id, { onLog, onDone, onError, intervalMs = 900 }) {
  let lastLogLength = 0;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const res = await fetch(`/api/jobs/${id}`);
    // eslint-disable-next-line no-await-in-loop
    const data = await res.json();
    if (!res.ok) {
      onError(data.error || `Erreur ${res.status}`);
      return;
    }
    if (data.log.length > lastLogLength) {
      onLog(data.log.slice(lastLogLength));
      lastLogLength = data.log.length;
    }
    if (data.status === 'done') {
      onDone(data.result);
      return;
    }
    if (data.status === 'error') {
      onError(data.error || 'Échec inconnu.');
      return;
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

function appendLog(el, lines) {
  el.hidden = false;
  el.textContent += (el.textContent ? '\n' : '') + lines.join('\n');
  el.scrollTop = el.scrollHeight;
}

// --- Explication du niveau WCAG sélectionné ---
const LEVEL_EXPLANATIONS = {
  A: 'Niveau minimal : lève les obstacles bloquants (images sans texte alternatif, pages sans titre, contenu inaccessible au clavier...). Insuffisant à lui seul pour la plupart des obligations légales.',
  AA: 'Niveau standard, exigé par la réglementation (RGAA en France, WCAG 2.1 AA dans l\'UE) : contrastes de couleur, redimensionnement du texte, navigation cohérente. C\'est le niveau recommandé pour la plupart des sites.',
  AAA: 'Niveau le plus exigeant : contrastes renforcés, langage simplifié, alternatives étendues. Rarement atteignable sur un site entier ; réservé à des contenus ciblés (services publics essentiels, contenus pour publics très spécifiques).',
};

function updateLevelHint() {
  const level = document.getElementById('audit-level').value;
  document.getElementById('level-hint').textContent = LEVEL_EXPLANATIONS[level] || '';
}
document.getElementById('audit-level').addEventListener('change', updateLevelHint);
updateLevelHint();

// --- Enregistrement de parcours ---
const recordBtn = document.getElementById('record-start');
const recordCancelBtn = document.getElementById('record-cancel');
const recordLog = document.getElementById('record-log');

function resetRecordUi() {
  recordBtn.disabled = false;
  recordBtn.textContent = '🎬 Démarrer l\'enregistrement';
  recordCancelBtn.hidden = true;
}

recordCancelBtn.addEventListener('click', async () => {
  if (!recordCancelBtn.dataset.jobId) return;
  recordCancelBtn.disabled = true;
  try {
    await fetch(`/api/jobs/${recordCancelBtn.dataset.jobId}/cancel`, { method: 'POST' });
  } catch (err) {
    // le polling en cours affichera l'erreur de toute façon
  }
  recordCancelBtn.disabled = false;
});

recordBtn.addEventListener('click', async () => {
  const url = document.getElementById('record-url').value.trim();
  const viewport = document.getElementById('record-viewport').value;
  if (!url) {
    // eslint-disable-next-line no-alert
    alert('Indique une URL à enregistrer.');
    return;
  }

  recordLog.textContent = '';
  recordLog.hidden = false;
  recordBtn.disabled = true;
  recordBtn.textContent = '⏳ Enregistrement en cours…';
  recordCancelBtn.hidden = false;

  try {
    const res = await fetch('/api/record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, viewport }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
    recordCancelBtn.dataset.jobId = data.id;

    await pollJob(data.id, {
      onLog: (lines) => appendLog(recordLog, lines),
      onDone: (result) => {
        appendLog(recordLog, ['✅ Parcours enregistré, injecté ci-dessous dans le formulaire d\'audit.']);
        document.getElementById('parcours-json').value = result.parcoursJson;
        document.getElementById('parcours-details').open = true;
        resetRecordUi();
      },
      onError: (msg) => {
        appendLog(recordLog, [`❌ ${msg}`]);
        resetRecordUi();
      },
    });
  } catch (err) {
    appendLog(recordLog, [`❌ ${err.message}`]);
    resetRecordUi();
  }
});

// --- Import d'un fichier parcours.json existant ---
document.getElementById('parcours-file').addEventListener('change', async (evt) => {
  const file = evt.target.files[0];
  if (!file) return;
  const text = await file.text();
  document.getElementById('parcours-json').value = text;
  document.getElementById('parcours-details').open = true;
});

// --- Lancement de l'audit ---
const auditBtn = document.getElementById('audit-start');
const auditLog = document.getElementById('audit-log');
const auditResult = document.getElementById('audit-result');

auditBtn.addEventListener('click', async () => {
  const urls = document.getElementById('audit-urls').value.trim();
  const level = document.getElementById('audit-level').value;
  const targets = [];
  if (document.getElementById('target-desktop').checked) targets.push('desktop');
  if (document.getElementById('target-mobile').checked) targets.push('mobile');
  const parcoursJson = document.getElementById('parcours-json').value.trim();

  if (!urls) {
    // eslint-disable-next-line no-alert
    alert('Indique au moins une URL à auditer.');
    return;
  }
  if (!targets.length) {
    // eslint-disable-next-line no-alert
    alert('Sélectionne au moins une cible (desktop et/ou mobile).');
    return;
  }

  auditLog.textContent = '';
  auditLog.hidden = false;
  auditResult.hidden = true;
  auditBtn.disabled = true;
  auditBtn.textContent = '⏳ Audit en cours…';

  try {
    const res = await fetch('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls, level, targets, parcoursJson }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);

    await pollJob(data.id, {
      onLog: (lines) => appendLog(auditLog, lines),
      onDone: (result) => {
        auditBtn.disabled = false;
        auditBtn.textContent = '▶️ Lancer l\'audit';
        auditResult.hidden = false;
        const link = document.getElementById('audit-report-link');
        link.href = result.reportUrl;
      },
      onError: (msg) => {
        appendLog(auditLog, [`❌ ${msg}`]);
        auditBtn.disabled = false;
        auditBtn.textContent = '▶️ Lancer l\'audit';
      },
    });
  } catch (err) {
    appendLog(auditLog, [`❌ ${err.message}`]);
    auditBtn.disabled = false;
    auditBtn.textContent = '▶️ Lancer l\'audit';
  }
});
