'use strict';

const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');

/**
 * Préréglages de viewport pour l'enregistrement. "mobile" réutilise le
 * device Playwright "iPhone 13" (user-agent, touch, device scale factor
 * inclus) pour un rendu réaliste ; "tablette" est un préréglage simplifié.
 */
const VIEWPORT_PRESETS = {
  desktop: { viewport: { width: 1280, height: 800 }, isMobile: false, deviceScaleFactor: 1 },
  tablette: {
    viewport: { width: 768, height: 1024 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  },
  mobile: { ...devices['iPhone 13'] },
};

/**
 * Fonction injectée telle quelle dans la page (via context.addInitScript).
 * Elle doit être autonome : aucune référence à une variable externe au
 * moment de l'exécution, à l'exception de window.__a11yRecordStep et
 * window.__a11yFinishRecording, exposées côté Node avant l'injection.
 */
function injectOverlay() {
  if (window.__a11yRecorderInjected) return;
  window.__a11yRecorderInjected = true;

  function mount() {
    try {
      buildOverlay();
    } catch (err) {
      // Sans ce catch, une erreur ici (ex: CSS.escape absent, CSP qui bloque
      // le style inline, etc.) échoue silencieusement et l'utilisateur ne
      // voit ni bandeau ni menu, sans aucun message.
      // eslint-disable-next-line no-console
      console.error('[a11y-audit] échec injection overlay :', err);
    }
  }

  // Certains thèmes/plugins WordPress font encore un document.write() après
  // le chargement initial, ce qui réinitialise le <html> et supprime tout ce
  // qui y a été ajouté avant (dont notre bandeau). On (re)tente donc le
  // montage à plusieurs moments du cycle de vie de la page.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
  window.addEventListener('load', () => {
    if (!document.getElementById('a11y-rec-finish')) mount();
  });

  function buildOverlay() {
  const STEP_TYPES = [
    { type: 'click', label: '🖱️ Cliquer' },
    { type: 'fill', label: '⌨️ Remplir un champ' },
    { type: 'hover', label: '👆 Survoler' },
    { type: 'waitForSelector', label: '⏳ Attendre cet élément' },
  ];

  function buildSelector(el) {
    if (!el || el === document.body) return 'body';
    if (el.id) return `#${CSS.escape(el.id)}`;
    const testId = el.getAttribute('data-testid');
    if (testId) return `[data-testid="${CSS.escape(testId)}"]`;

    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body) {
      let selector = node.tagName.toLowerCase();
      const uniqueClass = Array.from(node.classList).find(
        (c) => document.querySelectorAll(`.${CSS.escape(c)}`).length === 1,
      );
      if (uniqueClass) {
        parts.unshift(`${selector}.${CSS.escape(uniqueClass)}`);
        break;
      }
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (siblings.length > 1) selector += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      }
      parts.unshift(selector);
      node = parent;
    }
    return parts.join(' > ');
  }

  // --- Bandeau supérieur ---
  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;'
    + 'background:#1d2b3a;color:#fff;font:13px/1.4 system-ui,sans-serif;padding:8px 12px;'
    + 'display:flex;gap:12px;align-items:center;box-shadow:0 2px 6px rgba(0,0,0,.3)';
  const bannerTitle = document.createElement('strong');
  bannerTitle.textContent = '🎬 Enregistreur de parcours — a11y-audit';

  const bannerCount = document.createElement('span');
  bannerCount.id = 'a11y-rec-count';
  bannerCount.textContent = '0 étape(s)';

  const bannerSpacer = document.createElement('span');
  bannerSpacer.style.flex = '1';

  const finishBtn = document.createElement('button');
  finishBtn.id = 'a11y-rec-finish';
  finishBtn.style.cssText = 'background:#2e7d32;color:#fff;border:0;'
    + 'padding:6px 12px;border-radius:4px;cursor:pointer;font-size:13px';
  finishBtn.textContent = '🏁 Terminer et enregistrer';
  finishBtn.addEventListener('click', () => {
    window.__a11yFinishRecording();
  });

  banner.appendChild(bannerTitle);
  banner.appendChild(bannerCount);
  banner.appendChild(bannerSpacer);
  banner.appendChild(finishBtn);
  document.documentElement.appendChild(banner);
  if (document.body) document.body.style.marginTop = '40px';

  // --- Menu contextuel affiché après un clic ---
  const menu = document.createElement('div');
  menu.style.cssText = 'position:fixed;z-index:2147483647;background:#fff;border:1px solid #ccc;'
    + 'border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.25);font:13px system-ui,sans-serif;'
    + 'display:none;overflow:hidden;min-width:220px';
  document.documentElement.appendChild(menu);

  let stepCount = 0;

  function confirmStep(type, el, selector) {
    const label = window.prompt('Nom de cette étape (affiché dans le rapport) :', `${type} ${selector}`)
      || `${type} ${selector}`;
    const wantAudit = window.confirm(
      'Relancer axe-core après cette étape ? (utile si du contenu apparaît suite à l\'action)',
    );

    const step = { type, selector, label, audit: wantAudit };
    if (type === 'fill') {
      step.value = window.prompt('Valeur à saisir dans le champ :', '') || '';
    }

    stepCount += 1;
    document.getElementById('a11y-rec-count').textContent = `${stepCount} étape(s)`;
    window.__a11yRecordStep(step);

    // Rejoue réellement l'action pour permettre de continuer à naviguer
    // normalement (ex : cliquer un menu doit vraiment l'ouvrir).
    window.__a11yReplaying = true;
    try {
      if (type === 'click') el.click();
      if (type === 'hover') el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      if (type === 'fill' && 'value' in el) {
        el.value = step.value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } finally {
      window.__a11yReplaying = false;
    }
  }

  function openMenu(x, y, el, selector) {
    while (menu.firstChild) menu.removeChild(menu.firstChild);
    menu.style.left = `${Math.min(x, window.innerWidth - 240)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - 220)}px`;
    menu.style.display = 'block';

    const title = document.createElement('div');
    title.style.cssText = 'padding:6px 10px;background:#f0f0f0;font-weight:bold;'
      + 'max-width:280px;word-break:break-all';
    title.textContent = selector;
    menu.appendChild(title);

    STEP_TYPES.forEach(({ type, label }) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.style.cssText = 'display:block;width:100%;text-align:left;padding:8px 12px;'
        + 'border:0;background:#fff;cursor:pointer;font-size:13px';
      btn.addEventListener('mouseenter', () => { btn.style.background = '#eef4ff'; });
      btn.addEventListener('mouseleave', () => { btn.style.background = '#fff'; });
      btn.addEventListener('click', () => {
        menu.style.display = 'none';
        confirmStep(type, el, selector);
      });
      menu.appendChild(btn);
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Annuler';
    cancelBtn.style.cssText = 'display:block;width:100%;text-align:left;padding:8px 12px;'
      + 'border:0;background:#fff;color:#999;cursor:pointer;border-top:1px solid #eee;font-size:13px';
    cancelBtn.addEventListener('click', () => { menu.style.display = 'none'; });
    menu.appendChild(cancelBtn);
  }

  document.addEventListener('click', (evt) => {
    if (window.__a11yReplaying) return;
    if (banner.contains(evt.target) || menu.contains(evt.target)) return;
    evt.preventDefault();
    evt.stopPropagation();
    const el = evt.target;
    openMenu(evt.clientX, evt.clientY, el, buildSelector(el));
  }, true);

  document.addEventListener('click', (evt) => {
    if (menu.style.display === 'block' && !menu.contains(evt.target)) menu.style.display = 'none';
  });
  } // fin buildOverlay
}

/**
 * Lance un navigateur visible sur `url`, dans le viewport choisi, et laisse
 * l'utilisateur cliquer dans la page pour construire un parcours pas à pas.
 * Chaque clic ouvre un petit menu (clic / remplir / survoler / attendre)
 * puis rejoue réellement l'action pour permettre de continuer à naviguer.
 * Le résultat est fusionné dans le fichier `outFile` au format attendu par
 * `--parcours` (une entrée par URL).
 *
 * @param {string} url
 * @param {{viewportName?: 'desktop'|'tablette'|'mobile', outFile?: string}} options
 * @returns {Promise<{steps: Array<object>, outPath: string}>}
 */
async function recordParcours(url, { viewportName = 'desktop', outFile = 'parcours.json' } = {}) {
  const preset = VIEWPORT_PRESETS[viewportName] || VIEWPORT_PRESETS.desktop;
  const steps = [];

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ ...preset });

  await context.exposeFunction('__a11yRecordStep', (step) => {
    steps.push(step);
    console.log(`  ➕ Étape enregistrée : [${step.type}] ${step.label}`);
  });

  let resolveFinish;
  const finishPromise = new Promise((resolve) => { resolveFinish = resolve; });
  await context.exposeFunction('__a11yFinishRecording', () => resolveFinish());

  await context.addInitScript(injectOverlay);

  const page = await context.newPage();
  page.on('pageerror', (err) => console.error('❌ Erreur JS sur la page :', err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('❌ Console page :', msg.text());
  });

  console.log(`\n🎬 Enregistrement d'un parcours sur ${url} (viewport : ${viewportName})`);
  console.log('   Cliquez sur les éléments à tester, choisissez une action dans le menu.');
  console.log('   Cliquez sur "🏁 Terminer et enregistrer" en haut de la page une fois terminé.\n');

  await page.goto(url, { waitUntil: 'domcontentloaded' });

  // Sécurité : si la fenêtre est fermée manuellement, on ne bloque pas
  // indéfiniment. 'disconnected' est l'événement canonique (le process
  // navigateur se termine), mais selon l'environnement de bureau il peut
  // ne pas se déclencher immédiatement — on ajoute donc aussi les
  // fermetures de page/contexte comme filets de sécurité redondants.
  let finished = false;
  const finishOnce = () => {
    if (finished) return;
    finished = true;
    resolveFinish();
  };
  browser.on('disconnected', finishOnce);
  context.on('close', finishOnce);
  page.on('close', finishOnce);

  await finishPromise;
  await browser.close().catch(() => {});

  const outPath = path.resolve(outFile);
  let existing = {};
  if (fs.existsSync(outPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    } catch (err) {
      console.warn(`⚠️  ${outFile} illisible, il sera écrasé (${err.message})`);
    }
  }
  existing[url] = steps;
  fs.writeFileSync(outPath, JSON.stringify(existing, null, 2), 'utf8');

  console.log(`\n✅ ${steps.length} étape(s) enregistrée(s) → ${outPath}`);
  console.log(`   Relancez l'audit avec : node index.js ${url} --parcours ${outFile}\n`);

  return { steps, outPath };
}

module.exports = { recordParcours, VIEWPORT_PRESETS };
