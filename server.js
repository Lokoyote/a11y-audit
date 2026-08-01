#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { runAudit } = require('./lib/scan');
const { aggregateScores } = require('./lib/scorer');
const { writeReports, writeIndexReport, slugifyUrl } = require('./lib/report');
const { VIEWPORT_PRESETS } = require('./lib/recorder');
const { openInBrowser } = require('./lib/opener');

const PORT = process.env.A11Y_GUI_PORT ? Number(process.env.A11Y_GUI_PORT) : 4173;
const PUBLIC_DIR = path.join(__dirname, 'public');
// Emplacement FIXE (pas relatif à __dirname) : quel que soit l'endroit d'où
// server.js est copié/lancé, tout le monde retrouve les mêmes rapports —
// et surtout, ce dossier n'est PAS sous ~/.local/share/a11y-audit, donc
// il survit à une désinstallation (uninstall.sh supprime tout ce dossier).
const DATA_DIR = path.join(require('os').homedir(), 'a11y-audit-rapports');
const REPORTS_DIR = path.join(DATA_DIR, 'rapports');
const PARCOURS_DIR = path.join(DATA_DIR, 'parcours');

fs.mkdirSync(REPORTS_DIR, { recursive: true });
fs.mkdirSync(PARCOURS_DIR, { recursive: true });

/** @type {Map<string, {id:string, type:string, status:string, log:string[], result:any, error:string|null, child?:import('child_process').ChildProcess}>} */
const jobs = new Map();

function newJob(type) {
  const id = crypto.randomBytes(6).toString('hex');
  const job = { id, type, status: 'running', log: [], result: null, error: null };
  jobs.set(id, job);
  return job;
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 8_000_000) req.destroy(new Error('Corps de requête trop volumineux.'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  let reqPath = decodeURIComponent(req.url.split('?')[0]);
  if (reqPath === '/') reqPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, reqPath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Interdit.');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Introuvable.');
      return;
    }
    const ext = path.extname(filePath);
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
    };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function serveReport(req, res, reqPath) {
  const rel = decodeURIComponent(reqPath.replace(/^\/reports\//, ''));
  const filePath = path.join(REPORTS_DIR, rel);
  if (!filePath.startsWith(REPORTS_DIR)) {
    res.writeHead(403);
    res.end('Interdit.');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Rapport introuvable.');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': ext === '.json' ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8' });
    res.end(data);
  });
}

async function handleStartAudit(req, res) {
  let body;
  try {
    body = JSON.parse((await readBody(req)) || '{}');
  } catch (err) {
    return sendJson(res, 400, { error: `JSON invalide : ${err.message}` });
  }

  const urls = String(body.urls || '')
    .split('\n')
    .map((u) => u.trim())
    .filter(Boolean);
  if (!urls.length) return sendJson(res, 400, { error: 'Indique au moins une URL.' });
  for (const url of urls) {
    if (!/^https?:\/\//i.test(url)) return sendJson(res, 400, { error: `URL invalide : ${url}` });
  }

  const level = ['A', 'AA', 'AAA'].includes(body.level) ? body.level : 'AA';
  const targets = Array.isArray(body.targets) && body.targets.length
    ? body.targets.filter((t) => t === 'desktop' || t === 'mobile')
    : ['desktop', 'mobile'];

  let parcoursMap = {};
  if (body.parcoursJson && body.parcoursJson.trim()) {
    try {
      parcoursMap = JSON.parse(body.parcoursJson);
    } catch (err) {
      return sendJson(res, 400, { error: `Fichier de parcours invalide : ${err.message}` });
    }
  }

  const job = newJob('audit');
  sendJson(res, 202, { id: job.id });

  (async () => {
    const isBatch = urls.length > 1;
    const batchDir = path.join(REPORTS_DIR, `audit-${Date.now()}`);
    const siteReports = [];

    for (const url of urls) {
      job.log.push(`🔍 Audit de ${url}…`);
      try {
        // eslint-disable-next-line no-await-in-loop
        const auditResult = await runAudit(url, {
          targets,
          wcagLevel: level,
          parcoursSteps: parcoursMap[url],
          onProgress: (evt) => {
            if (evt.phase === 'viewport-done') {
              job.log.push(`  ✔ ${evt.viewport === 'mobile' ? '📱 Mobile' : '🖥️  Desktop'} — ${evt.url}`);
            } else if (evt.phase === 'parcours-step') {
              job.log.push(`  ↳ Parcours (${evt.index}/${evt.total}) : ${evt.label}`);
            } else if (evt.phase === 'reduced-motion') {
              job.log.push('  ↳ Vérification « mouvement réduit »');
            }
          },
        });
        const scored = aggregateScores(auditResult);
        const desktopResult = auditResult.results.find((r) => r.viewport === 'desktop');
        if (desktopResult && desktopResult.parcours) scored.parcours = desktopResult.parcours;

        const siteDir = isBatch ? path.join(batchDir, 'sites', slugifyUrl(url)) : batchDir;
        const { htmlPath, jsonPath } = writeReports(scored, siteDir);
        siteReports.push({ url, scored, htmlPath, jsonPath });
        job.log.push(`  ✅ Score global : ${scored.globalScore}/100 (${scored.issues.length} problème(s))`);
      } catch (err) {
        job.log.push(`  ❌ Échec de l'audit pour ${url} : ${err.message}`);
      }
    }

    if (!siteReports.length) {
      job.status = 'error';
      job.error = 'Aucun rapport n\'a pu être généré.';
      return;
    }

    let reportPath;
    if (isBatch) {
      reportPath = writeIndexReport(siteReports, batchDir);
    } else {
      reportPath = siteReports[0].htmlPath;
    }
    const rel = path.relative(REPORTS_DIR, reportPath).split(path.sep).map(encodeURIComponent).join('/');

    job.status = 'done';
    job.result = { reportUrl: `/reports/${rel}` };
    job.log.push('🎉 Rapport prêt.');
  })().catch((err) => {
    job.status = 'error';
    job.error = err.message;
  });
}

async function handleStartRecord(req, res) {
  let body;
  try {
    body = JSON.parse((await readBody(req)) || '{}');
  } catch (err) {
    return sendJson(res, 400, { error: `JSON invalide : ${err.message}` });
  }

  const url = body.url;
  const viewport = Object.keys(VIEWPORT_PRESETS).includes(body.viewport) ? body.viewport : 'desktop';
  if (!/^https?:\/\//i.test(url || '')) return sendJson(res, 400, { error: 'URL invalide.' });

  const job = newJob('record');
  const outFile = path.join(PARCOURS_DIR, `parcours-${job.id}.json`);
  sendJson(res, 202, { id: job.id });

  job.log.push(`🎬 Ouverture d'un navigateur pour enregistrer un parcours sur ${url}…`);
  job.log.push('   Une fenêtre de navigateur va s\'ouvrir sur votre bureau : cliquez dedans pour construire le parcours,');
  job.log.push('   puis cliquez sur « 🏁 Terminer et enregistrer » en haut de la page.');

  const child = spawn(
    process.execPath,
    [path.join(__dirname, 'index.js'), '--record', url, '--record-viewport', viewport, '--record-out', outFile],
    { cwd: __dirname },
  );
  job.child = child;

  child.stdout.on('data', (d) => {
    d.toString().split('\n').filter(Boolean).forEach((line) => job.log.push(line));
  });
  child.stderr.on('data', (d) => {
    d.toString().split('\n').filter(Boolean).forEach((line) => job.log.push(line));
  });
  child.on('error', (err) => {
    job.status = 'error';
    job.error = err.message;
  });
  child.on('close', (code) => {
    if (job.status !== 'running') return; // déjà marqué en erreur via 'error'
    if (code === 0 && fs.existsSync(outFile)) {
      try {
        job.result = { parcoursJson: fs.readFileSync(outFile, 'utf8') };
        job.status = 'done';
      } catch (err) {
        job.status = 'error';
        job.error = err.message;
      }
    } else {
      job.status = 'error';
      job.error = `L'enregistrement s'est terminé de façon inattendue (code ${code}).`;
    }
  });
}

function handleJobStatus(req, res, id) {
  const job = jobs.get(id);
  if (!job) return sendJson(res, 404, { error: 'Job inconnu (le serveur a peut-être redémarré).' });
  sendJson(res, 200, { status: job.status, log: job.log, result: job.result, error: job.error });
}

function handleCancelJob(req, res, id) {
  const job = jobs.get(id);
  if (job && job.child && job.status === 'running') {
    job.child.kill();
    job.status = 'error';
    job.error = 'Annulé par l\'utilisateur.';
  }
  sendJson(res, 200, { ok: true });
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (req.method === 'POST' && url === '/api/audit') return handleStartAudit(req, res);
  if (req.method === 'POST' && url === '/api/record') return handleStartRecord(req, res);

  let m = url.match(/^\/api\/jobs\/([a-f0-9]+)$/);
  if (req.method === 'GET' && m) return handleJobStatus(req, res, m[1]);

  m = url.match(/^\/api\/jobs\/([a-f0-9]+)\/cancel$/);
  if (req.method === 'POST' && m) return handleCancelJob(req, res, m[1]);

  if (req.method === 'GET' && url.startsWith('/reports/')) return serveReport(req, res, url);

  return serveStatic(req, res);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    // Déjà lancé (ex: l'utilisateur a re-cliqué sur l'icône du menu) : pas
    // une erreur, on rouvre simplement un onglet sur l'instance existante.
    console.log(`\nℹ️  Déjà en cours d'exécution sur le port ${PORT} — ouverture d'un nouvel onglet.\n`);
    openInBrowser(`http://localhost:${PORT}`);
    setTimeout(() => process.exit(0), 300);
    return;
  }
  console.error('❌ Échec du démarrage du serveur :', err.message);
  process.exit(1);
});

server.listen(PORT, () => {
  const startUrl = `http://localhost:${PORT}`;
  console.log(`\n🖥️  Interface graphique a11y-audit : ${startUrl}\n`);
  openInBrowser(startUrl);
});
