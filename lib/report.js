'use strict';

const fs = require('fs');
const path = require('path');

function scoreColor(score) {
  if (score >= 90) return '#1b8a4a';
  if (score >= 75) return '#5a9c1e';
  if (score >= 50) return '#d68a10';
  if (score >= 25) return '#d9601a';
  return '#c22f2f';
}

function severityLabel(sev) {
  return { critical: 'Critique', serious: 'Élevée', moderate: 'Modérée', minor: 'Mineure' }[sev] || sev;
}

function severityColor(sev) {
  return { critical: '#c22f2f', serious: '#d9601a', moderate: '#d68a10', minor: '#8a8a1e' }[sev] || '#888';
}

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function renderAxisBars(axisScores) {
  return Object.entries(axisScores).map(([axis, score]) => `
    <div class="axis-row">
      <div class="axis-label">${esc(axis)}</div>
      <div class="axis-bar-track">
        <div class="axis-bar-fill" style="width:${score}%; background:${scoreColor(score)}"></div>
      </div>
      <div class="axis-score" style="color:${scoreColor(score)}">${score}</div>
    </div>`).join('\n');
}

function renderParcoursViolations(violations) {
  if (!violations || !violations.length) return '';
  const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  const sorted = [...violations].sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));
  const rows = sorted.map((v) => `
      <li>
        <span class="pill" style="background:${severityColor(v.severity)}">${esc(severityLabel(v.severity))}</span>
        ${esc(v.description)}
        ${v.nodesAffected ? `<span class="muted">(${v.nodesAffected} élément(s))</span>` : ''}
        ${v.helpUrl ? ` — <a href="${esc(v.helpUrl)}" target="_blank" rel="noopener">détails</a>` : ''}
      </li>`).join('\n');
  return `<ul class="parcours-violations">${rows}</ul>`;
}

function renderParcoursSection(parcours) {
  if (!parcours || !parcours.length) return '';

  const cards = parcours.map((m, i) => `
    <div class="parcours-card">
      <div class="parcours-step-num">${i === 0 ? 'Départ' : `Étape ${i}`}</div>
      ${m.screenshotBase64
    ? `<img src="data:image/jpeg;base64,${m.screenshotBase64}" alt="Aperçu : ${esc(m.label)}" loading="lazy">`
    : '<div class="parcours-no-shot">Capture indisponible</div>'}
      <div class="parcours-label">${esc(m.label)}</div>
      ${m.error ? `<div class="parcours-error">⚠️ ${esc(m.error)}</div>` : ''}
      ${m.axeSummary && !m.axeSummary.error
    ? `<div class="parcours-axe">⚙️ ${m.axeSummary.violations} violation(s) — dont ${m.axeSummary.critical} critique(s), ${m.axeSummary.serious} élevée(s)</div>
       ${renderParcoursViolations(m.violations)}`
    : ''}
    </div>`).join('\n');

  return `
  <section>
    <h2>Aperçu du parcours</h2>
    <p class="muted" style="margin-bottom:14px;">
      Capture d'écran après chaque étape du scénario d'interaction (clic sur un menu, ouverture d'une modale...).
      Les étapes marquées ⚙️ ont été réanalysées avec axe-core dans leur état affiché à l'écran — utile pour du
      contenu qui n'existe qu'après une action et que le scan initial de la page ne voit jamais.
    </p>
    <div class="parcours-strip">${cards}</div>
  </section>`;
}

function renderIssueLocations(locations) {
  if (!locations || !locations.length) return '';
  const items = locations.map((loc) => `
        <li>
          ${loc.selector ? `<code class="loc-selector">${esc(loc.selector)}</code>` : ''}
          ${loc.html ? `<pre class="loc-code"><code>${esc(loc.html)}</code></pre>` : ''}
          ${loc.failureSummary ? `<div class="loc-why">${esc(loc.failureSummary)}</div>` : ''}
        </li>`).join('\n');
  return `
      <details class="issue-locations">
        <summary>Voir où ça se trouve dans le code (${locations.length})</summary>
        <ul>${items}</ul>
      </details>`;
}

function renderIssueRow(issue) {
  return `
    <tr>
      <td><span class="pill" style="background:${severityColor(issue.severity)}">${esc(severityLabel(issue.severity))}</span></td>
      <td>${esc(issue.viewport === 'mobile' ? '📱 Mobile' : '🖥️ Desktop')}</td>
      <td>${esc(issue.principle)}</td>
      <td>
        ${esc(issue.description)}
        ${issue.nodesAffected != null ? `<div class="muted">Éléments concernés : ${issue.nodesAffected}</div>` : ''}
        ${renderIssueLocations(issue.locations)}
        ${issue.helpUrl ? `<div class="muted"><a href="${esc(issue.helpUrl)}" target="_blank" rel="noopener">Documentation / correctif suggéré →</a></div>` : ''}
      </td>
    </tr>`;
}

function renderReportHtml(scored) {
  const genDate = new Date(scored.scannedAt).toLocaleString('fr-FR');
  const bySeverityCount = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const i of scored.issues) bySeverityCount[i.severity] = (bySeverityCount[i.severity] || 0) + 1;

  const viewportCards = scored.perViewport.map((vp) => `
    <div class="vp-card">
      <div class="vp-title">${vp.viewport === 'mobile' ? '📱 Mobile' : '🖥️ Desktop'}</div>
      <div class="vp-score" style="color:${scoreColor(vp.score)}">${vp.score}<span class="vp-score-max">/100</span></div>
    </div>`).join('\n');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Rapport d'accessibilité — ${esc(scored.url)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin:0; background:#f5f6f8; color:#1a1a1a; line-height:1.5; }
  .wrap { max-width: 980px; margin: 0 auto; padding: 32px 20px 80px; }
  header.top { background:#111827; color:#fff; padding: 28px 20px; }
  header.top .wrap { padding: 0; }
  h1 { font-size: 1.4rem; margin:0 0 4px; }
  .url { color:#9ca3af; word-break: break-all; font-size:0.95rem; }
  .meta { color:#9ca3af; font-size:0.85rem; margin-top:6px; }

  .global-score-block { display:flex; align-items:center; gap:28px; background:#fff; border-radius:12px; padding:24px; margin-top:-30px; box-shadow:0 2px 10px rgba(0,0,0,0.08); }
  .global-score { font-size:3.2rem; font-weight:700; line-height:1; }
  .global-score-max { font-size:1.2rem; color:#888; font-weight:400; }
  .global-score-label { color:#555; font-size:0.95rem; margin-top:4px; }
  .severity-counts { display:flex; gap:16px; margin-left:auto; flex-wrap:wrap; }
  .sev-count { text-align:center; font-size:0.8rem; color:#555; }
  .sev-count b { display:block; font-size:1.3rem; }

  .vp-cards { display:flex; gap:16px; margin-top:20px; }
  .vp-card { flex:1; background:#fff; border-radius:12px; padding:18px; text-align:center; box-shadow:0 2px 10px rgba(0,0,0,0.06); }
  .vp-title { font-size:0.95rem; color:#444; margin-bottom:6px; }
  .vp-score { font-size:2rem; font-weight:700; }
  .vp-score-max { font-size:1rem; color:#999; font-weight:400; }

  section { margin-top:32px; }
  h2 { font-size:1.1rem; border-bottom:2px solid #e5e7eb; padding-bottom:8px; }

  .axis-row { display:flex; align-items:center; gap:12px; margin:10px 0; }
  .axis-label { width:150px; font-size:0.9rem; color:#333; }
  .axis-bar-track { flex:1; background:#e5e7eb; border-radius:6px; height:14px; overflow:hidden; }
  .axis-bar-fill { height:100%; border-radius:6px; }
  .axis-score { width:36px; text-align:right; font-weight:700; font-size:0.9rem; }

  table { width:100%; border-collapse: collapse; background:#fff; border-radius:8px; overflow:hidden; }
  th, td { text-align:left; padding:10px 12px; border-bottom:1px solid #eee; font-size:0.88rem; vertical-align:top; }
  th { background:#f0f1f3; font-size:0.78rem; text-transform:uppercase; letter-spacing:0.03em; color:#555; }
  .pill { color:#fff; padding:3px 9px; border-radius:99px; font-size:0.75rem; white-space:nowrap; }
  .muted { color:#888; font-size:0.78rem; margin-top:3px; }
  .axis-legend { display:grid; grid-template-columns:140px 1fr; gap:4px 12px; font-size:0.82rem; margin:0 0 16px; }
  .axis-legend dt { font-weight:600; color:#333; }
  .axis-legend dd { margin:0 0 8px; color:#555; }
  .issue-locations summary { cursor:pointer; color:#2a5b8c; }
  .issue-locations ul { list-style:none; margin:8px 0 0; padding:0; }
  .issue-locations li { margin-bottom:10px; padding-bottom:10px; border-bottom:1px solid #eee; }
  .loc-selector { display:inline-block; background:#eef1f4; color:#333; padding:2px 6px; border-radius:4px; font-size:0.78rem; margin-bottom:4px; }
  .loc-code { background:#0f172a; color:#d7ffd9; padding:8px; border-radius:6px; font-size:0.74rem; overflow-x:auto; margin:4px 0; white-space:pre-wrap; word-break:break-word; }
  .loc-why { color:#666; font-size:0.76rem; font-style:italic; }
  a { color:#2563eb; }
  footer { text-align:center; color:#999; font-size:0.8rem; margin-top:40px; }

  .parcours-strip { display:flex; gap:14px; overflow-x:auto; padding:4px 4px 12px; }
  .parcours-card { flex:0 0 220px; background:#fff; border-radius:10px; padding:10px; box-shadow:0 2px 8px rgba(0,0,0,0.06); }
  .parcours-card img { width:100%; display:block; border-radius:6px; border:1px solid #eee; margin-bottom:6px; }
  .parcours-no-shot { width:100%; height:130px; background:#eee; border-radius:6px; display:flex; align-items:center; justify-content:center; color:#999; font-size:0.78rem; margin-bottom:6px; }
  .parcours-step-num { font-size:0.7rem; color:#999; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:4px; }
  .parcours-label { font-size:0.82rem; color:#222; font-weight:600; }
  .parcours-error { color:#c22f2f; font-size:0.76rem; margin-top:4px; }
  .parcours-axe { font-size:0.76rem; color:#444; margin-top:5px; background:#f0f1f3; border-radius:6px; padding:4px 6px; }
  .parcours-violations { list-style:none; margin:6px 0 0; padding:0; font-size:0.76rem; text-align:left; }
  .parcours-violations li { padding:4px 0; border-top:1px solid #eee; }
  .parcours-violations .pill { font-size:0.68rem; margin-right:4px; }
</style>
</head>
<body>
<header class="top">
  <div class="wrap">
    <h1>Rapport d'audit d'accessibilité</h1>
    <div class="url">${esc(scored.url)}</div>
    <div class="meta">Généré le ${esc(genDate)} · Niveau WCAG ciblé : ${esc(scored.wcagLevel)} · Moteur : axe-core + vérifications complémentaires (clavier, cibles tactiles, structure)</div>
  </div>
</header>

<div class="wrap">
  <div class="global-score-block">
    <div>
      <div class="global-score" style="color:${scoreColor(scored.globalScore)}">${scored.globalScore}<span class="global-score-max">/100</span></div>
      <div class="global-score-label">Score global d'accessibilité</div>
    </div>
    <div class="severity-counts">
      <div class="sev-count"><b style="color:${severityColor('critical')}">${bySeverityCount.critical}</b>Critiques</div>
      <div class="sev-count"><b style="color:${severityColor('serious')}">${bySeverityCount.serious}</b>Élevées</div>
      <div class="sev-count"><b style="color:${severityColor('moderate')}">${bySeverityCount.moderate}</b>Modérées</div>
      <div class="sev-count"><b style="color:${severityColor('minor')}">${bySeverityCount.minor}</b>Mineures</div>
    </div>
  </div>

  <div class="vp-cards">
    ${viewportCards}
  </div>

  <section>
    <h2>Score par axe (principes WCAG)</h2>
    <p class="muted" style="margin-bottom:10px;">
      Chaque axe regroupe les problèmes par grande famille. Le score d'un axe part de 100 et baisse à chaque
      problème détecté dans cette famille (plus la sévérité et le nombre d'éléments touchés sont élevés, plus la
      baisse est forte) — ce n'est pas un pourcentage d'éléments conformes.
    </p>
    <dl class="axis-legend">
      <dt>Perceptible</dt><dd>L'information et les composants d'interface doivent pouvoir être perçus, quel que soit le sens utilisé : textes alternatifs sur les images, contrastes de couleur, structure des titres, sous-titres...</dd>
      <dt>Utilisable</dt><dd>Les composants d'interface et la navigation doivent être utilisables par tous, notamment au clavier seul (sans souris) et sans piège de focus, avec assez de temps pour agir.</dd>
      <dt>Compréhensible</dt><dd>Le contenu et le fonctionnement de l'interface doivent être compréhensibles : langue déclarée, formulaires avec des labels clairs, comportement prévisible.</dd>
      <dt>Robuste</dt><dd>Le contenu doit être interprété de façon fiable par différents outils, y compris les technologies d'assistance (lecteurs d'écran) — code HTML/ARIA valide et cohérent.</dd>
      <dt>Mobile</dt><dd>Contrôles spécifiques à l'affichage et l'usage sur petit écran / tactile : zoom non bloqué, absence de débordement horizontal, taille des cibles tactiles.</dd>
      <dt>IA &amp; Agents</dt><dd>Heuristiques expérimentales (absentes des outils officiels comme axe-core, WAVE ou Lighthouse) qui ciblent les cas où ni un lecteur d'écran ni une IA de description de secours (Seeing AI, Be My AI...) ne peuvent compenser un manque d'information dans le code — ex. un intitulé de lien vague ou une icône cliquable sans nom accessible.</dd>
    </dl>
    ${renderAxisBars(scored.axisScores)}
    <p class="muted" style="margin-top:14px;">
      Les contrôles marqués <i>« heuristique avancée »</i> dans le tableau ci-dessous sortent des vérifications
      automatiques standards et méritent une vérification manuelle en cas de doute.
    </p>
  </section>

  ${renderParcoursSection(scored.parcours)}

  <section>
    <h2>Axes d'amélioration prioritaires</h2>
    <table>
      <thead><tr><th>Sévérité</th><th>Contexte</th><th>Axe</th><th>Détail &amp; correctif</th></tr></thead>
      <tbody>
        ${scored.issues.length ? scored.issues.map(renderIssueRow).join('\n') : '<tr><td colspan="4">Aucun problème détecté 🎉</td></tr>'}
      </tbody>
    </table>
  </section>

  <footer>
    Généré par a11y-audit — basé sur axe-core (règles WCAG 2.0/2.1/2.2) et des vérifications complémentaires maison.
    Un score élevé réduit le risque mais ne remplace pas un audit manuel avec des utilisateurs en situation de handicap.
  </footer>
</div>
</body>
</html>`;
}

function writeReports(scored, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  const base = 'rapport-accessibilite-' + Date.now();
  const htmlPath = path.join(outputDir, base + '.html');
  const jsonPath = path.join(outputDir, base + '.json');

  fs.writeFileSync(htmlPath, renderReportHtml(scored), 'utf8');
  fs.writeFileSync(jsonPath, JSON.stringify(scored, null, 2), 'utf8');

  return { htmlPath, jsonPath };
}

/** Transforme une URL en nom de dossier sûr pour le système de fichiers. */
function slugifyUrl(url) {
  const slug = url
    .replace(/^https?:\/\//i, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return slug || 'site';
}

function renderIndexHtml(entries) {
  const cards = entries.map((e) => `
    <a class="site-card" href="${esc(e.relativeHtmlPath)}">
      <div class="site-card-score" style="color:${scoreColor(e.scored.globalScore)}">${e.scored.globalScore}<span class="site-card-score-max">/100</span></div>
      <div class="site-card-body">
        <div class="site-card-url">${esc(e.url)}</div>
        <div class="muted">${e.scored.issues.length} problème(s) détecté(s) · niveau ${esc(e.scored.wcagLevel)}</div>
      </div>
      <div class="site-card-arrow">→</div>
    </a>`).join('\n');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Rapports d'accessibilité — synthèse</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin:0; background:#f5f6f8; color:#1a1a1a; line-height:1.5; }
  .wrap { max-width: 820px; margin: 0 auto; padding: 32px 20px 80px; }
  header.top { background:#111827; color:#fff; padding: 28px 20px; }
  header.top .wrap { padding: 0; }
  h1 { font-size: 1.4rem; margin:0 0 4px; }
  .meta { color:#9ca3af; font-size:0.85rem; margin-top:6px; }
  .site-list { display:flex; flex-direction:column; gap:12px; margin-top:24px; }
  .site-card { display:flex; align-items:center; gap:16px; background:#fff; border-radius:12px; padding:18px 20px; box-shadow:0 2px 10px rgba(0,0,0,0.06); text-decoration:none; color:inherit; }
  .site-card:hover { box-shadow:0 4px 14px rgba(0,0,0,0.1); }
  .site-card-score { font-size:1.8rem; font-weight:700; min-width:78px; }
  .site-card-score-max { font-size:0.9rem; color:#999; font-weight:400; }
  .site-card-body { flex:1; min-width:0; }
  .site-card-url { font-weight:600; word-break:break-all; }
  .muted { color:#888; font-size:0.82rem; margin-top:3px; }
  .site-card-arrow { color:#999; font-size:1.3rem; }
  footer { text-align:center; color:#999; font-size:0.8rem; margin-top:40px; }
</style>
</head>
<body>
<header class="top">
  <div class="wrap">
    <h1>Synthèse d'audit d'accessibilité</h1>
    <div class="meta">${entries.length} URL analysée(s) · Généré le ${esc(new Date().toLocaleString('fr-FR'))}</div>
  </div>
</header>
<div class="wrap">
  <div class="site-list">
    ${cards}
  </div>
  <footer>Cliquez sur une URL pour ouvrir son rapport détaillé.</footer>
</div>
</body>
</html>`;
}

/**
 * Génère une page de synthèse (index.html) qui liste chaque URL auditée
 * avec son score et un lien vers son rapport détaillé — sépare clairement
 * les résultats par URL lors d'un audit multi-sites.
 */
function writeIndexReport(entries, batchDir) {
  const withRelative = entries.map((e) => ({
    ...e,
    relativeHtmlPath: path.relative(batchDir, e.htmlPath).split(path.sep).join('/'),
  }));
  const indexPath = path.join(batchDir, 'index.html');
  fs.writeFileSync(indexPath, renderIndexHtml(withRelative), 'utf8');
  return indexPath;
}

module.exports = { renderReportHtml, writeReports, writeIndexReport, slugifyUrl };
