#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { runAudit } = require('./lib/scan');
const { aggregateScores } = require('./lib/scorer');
const { writeReports, writeIndexReport, slugifyUrl } = require('./lib/report');
const { ProgressBar } = require('./lib/progress');
const { openInBrowser } = require('./lib/opener');
const { recordParcours, VIEWPORT_PRESETS } = require('./lib/recorder');

function printUsage() {
  console.log(`
Usage: node index.js <url> [<url2> ...] [options]

Options:
  --level <A|AA|AAA>      Niveau de conformité WCAG ciblé (défaut: AA)
  --only <desktop|mobile> Ne tester qu'un seul type d'appareil (défaut: les deux)
  --out <dossier>         Dossier de sortie des rapports (défaut: ./rapports)
  --urls-file <fichier>   Liste d'URLs à auditer, une par ligne (# = commentaire)
  --parcours <fichier>    Fichier JSON décrivant un scénario d'interaction par URL
  --record <url>          Enregistre un parcours en cliquant dans un vrai navigateur
  --record-viewport <v>   Viewport pour l'enregistrement : desktop|tablette|mobile (défaut: desktop)
  --record-out <fichier>  Fichier --parcours dans lequel sauvegarder (défaut: ./parcours.json)
  --no-open               N'ouvre pas automatiquement le rapport à la fin
  --json-only             N'affiche que le résultat en JSON sur stdout (pas de fichiers)
  -h, --help              Affiche cette aide

Exemples:
  node index.js https://example.com
  node index.js https://example.com https://example.com/contact --level AAA
  node index.js --urls-file mes-urls.txt --out ./audits
  node index.js https://example.com --parcours parcours.json
  node index.js --record https://example.com --record-viewport mobile

Format du fichier --parcours (JSON) :
  {
    "https://example.com": [
      { "type": "click", "selector": "#menu-burger", "label": "Ouvrir le menu", "audit": true },
      { "type": "wait", "ms": 300 },
      { "type": "click", "selector": ".contact-modal-trigger", "label": "Ouvrir la modale contact", "audit": true }
    ]
  }
  Types d'étape disponibles : click, fill, press, hover, wait, waitForSelector, goto.
  "audit: true" relance axe-core dans l'état affiché à cette étape.
`);
}

function parseArgs(argv) {
  const args = {
    urls: [],
    level: 'AA',
    targets: ['desktop', 'mobile'],
    out: './rapports',
    jsonOnly: false,
    urlsFile: null,
    parcoursFile: null,
    noOpen: false,
    recordUrl: null,
    recordViewport: 'desktop',
    recordOut: './parcours.json',
  };
  const rest = [...argv];
  while (rest.length) {
    const token = rest.shift();
    if (token === '-h' || token === '--help') { args.help = true; continue; }
    if (token === '--level') { args.level = (rest.shift() || 'AA').toUpperCase(); continue; }
    if (token === '--only') {
      const v = rest.shift();
      args.targets = v === 'mobile' ? ['mobile'] : v === 'desktop' ? ['desktop'] : ['desktop', 'mobile'];
      continue;
    }
    if (token === '--out') { args.out = rest.shift() || './rapports'; continue; }
    if (token === '--urls-file') { args.urlsFile = rest.shift(); continue; }
    if (token === '--parcours') { args.parcoursFile = rest.shift(); continue; }
    if (token === '--record') { args.recordUrl = rest.shift(); continue; }
    if (token === '--record-viewport') { args.recordViewport = rest.shift() || 'desktop'; continue; }
    if (token === '--record-out') { args.recordOut = rest.shift() || './parcours.json'; continue; }
    if (token === '--no-open') { args.noOpen = true; continue; }
    if (token === '--json-only') { args.jsonOnly = true; continue; }
    if (!token.startsWith('--')) { args.urls.push(token); continue; }
  }

  if (args.urlsFile) {
    const content = fs.readFileSync(args.urlsFile, 'utf8');
    const fileUrls = content
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    args.urls.push(...fileUrls);
  }

  return args;
}

function loadParcoursMap(parcoursFile) {
  if (!parcoursFile) return {};
  const raw = fs.readFileSync(parcoursFile, 'utf8');
  return JSON.parse(raw);
}

function makeProgressHandler(bar) {
  return (evt) => {
    switch (evt.phase) {
      case 'viewport-done':
        bar.tick(`${evt.viewport === 'mobile' ? '📱 Mobile' : '🖥️  Desktop'} — ${evt.url}`);
        break;
      case 'reduced-motion':
        bar.tick(`Vérification "mouvement réduit" — ${evt.url}`);
        break;
      case 'parcours-step':
        bar.tick(`Parcours (${evt.index}/${evt.total}) : ${evt.label} — ${evt.url}`);
        break;
      default:
        break;
    }
  };
}

function printSiteSummary(site) {
  console.log('═'.repeat(60));
  console.log(`  ${site.url}`);
  console.log(`  SCORE GLOBAL : ${site.scored.globalScore} / 100`);
  for (const [axis, score] of Object.entries(site.scored.axisScores)) {
    console.log(`  ${axis.padEnd(16)} ${score}/100`);
  }
  console.log(`  ${site.scored.issues.length} problème(s) détecté(s).`);
  console.log(`  📄 ${path.resolve(site.htmlPath)}`);
  console.log('');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  if (args.recordUrl) {
    if (!/^https?:\/\//i.test(args.recordUrl)) {
      console.error(`Erreur : l'URL "${args.recordUrl}" doit commencer par http:// ou https://`);
      process.exit(1);
    }
    if (!Object.keys(VIEWPORT_PRESETS).includes(args.recordViewport)) {
      console.error(`Erreur : --record-viewport doit être l'un de : ${Object.keys(VIEWPORT_PRESETS).join(', ')}`);
      process.exit(1);
    }
    await recordParcours(args.recordUrl, {
      viewportName: args.recordViewport,
      outFile: args.recordOut,
    });
    return;
  }

  if (args.urls.length === 0) {
    printUsage();
    process.exit(1);
  }

  for (const url of args.urls) {
    if (!/^https?:\/\//i.test(url)) {
      console.error(`Erreur : l'URL "${url}" doit commencer par http:// ou https://`);
      process.exit(1);
    }
  }

  let parcoursMap;
  try {
    parcoursMap = loadParcoursMap(args.parcoursFile);
  } catch (err) {
    console.error(`Erreur de lecture du fichier --parcours : ${err.message}`);
    process.exit(1);
  }

  // --- Mode JSON pur (CI/scripting) : pas de fichiers, pas de barre de progression ---
  if (args.jsonOnly) {
    const outputs = [];
    for (const url of args.urls) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const auditResult = await runAudit(url, {
          targets: args.targets,
          wcagLevel: args.level,
          parcoursSteps: parcoursMap[url],
        });
        outputs.push(aggregateScores(auditResult));
      } catch (err) {
        outputs.push({ url, error: err.message });
      }
    }
    console.log(JSON.stringify(args.urls.length === 1 ? outputs[0] : outputs, null, 2));
    return;
  }

  console.log(`\n🔍 Audit d'accessibilité — ${args.urls.length} URL(s) | niveau WCAG ${args.level} | cibles : ${args.targets.join(', ')}\n`);

  const totalTicks = args.urls.reduce((sum, url) => {
    let ticks = args.targets.length + 1; // 1 tick par viewport scanné + 1 pour le test "mouvement réduit"
    const steps = parcoursMap[url];
    if (steps && steps.length) ticks += steps.length;
    return sum + ticks;
  }, 0);
  const bar = new ProgressBar(totalTicks);
  const onProgress = makeProgressHandler(bar);

  const isBatch = args.urls.length > 1;
  const batchDir = isBatch ? path.join(args.out, `audit-${Date.now()}`) : args.out;

  const siteReports = [];
  for (const url of args.urls) {
    let auditResult;
    try {
      // eslint-disable-next-line no-await-in-loop
      auditResult = await runAudit(url, {
        targets: args.targets,
        wcagLevel: args.level,
        parcoursSteps: parcoursMap[url],
        onProgress,
      });
    } catch (err) {
      bar.log(`❌ Échec de l'audit pour ${url} : ${err.message}`);
      continue;
    }

    const scored = aggregateScores(auditResult);
    const desktopResult = auditResult.results.find((r) => r.viewport === 'desktop');
    if (desktopResult && desktopResult.parcours) {
      scored.parcours = desktopResult.parcours;
    }

    const siteDir = isBatch ? path.join(batchDir, 'sites', slugifyUrl(url)) : batchDir;
    const { htmlPath, jsonPath } = writeReports(scored, siteDir);
    siteReports.push({ url, scored, htmlPath, jsonPath });
  }

  bar.finish('Analyse terminée');
  console.log('');

  if (siteReports.length === 0) {
    console.error('Aucun rapport n\'a pu être généré.');
    process.exit(1);
  }

  for (const site of siteReports) printSiteSummary(site);

  let reportToOpen;
  if (isBatch) {
    reportToOpen = writeIndexReport(siteReports, batchDir);
    console.log(`  📚 Synthèse multi-URL : ${path.resolve(reportToOpen)}`);
  } else {
    reportToOpen = siteReports[0].htmlPath;
  }
  console.log('');

  if (!args.noOpen) {
    console.log('  🌐 Ouverture du rapport dans le navigateur...\n');
    openInBrowser(path.resolve(reportToOpen));
  }
}

main();
