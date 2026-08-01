'use strict';

const { chromium, devices } = require('playwright');
const { AxeBuilder } = require('@axe-core/playwright');
const { runCustomChecks } = require('./customChecks');
const { runMobileChecks } = require('./mobileChecks');
const { runAdvancedChecks, checkReducedMotionRespect } = require('./advancedChecks');
const { runAiAgentChecks } = require('./aiAgentChecks');
const { runParcours } = require('./parcours');
const { AXE_TAGS } = require('./config');

const VIEWPORT_CONFIGS = {
  desktop: {
    label: 'Desktop (1920x1080)',
    contextOptions: { viewport: { width: 1920, height: 1080 } },
  },
  mobile: {
    label: 'Mobile (iPhone 13, tactile)',
    contextOptions: { ...devices['iPhone 13'] },
  },
};

/**
 * Exécute un audit complet pour une URL, sur un type de viewport donné.
 */
async function scanViewport(browser, url, viewportType, wcagLevel, opts = {}) {
  const { onProgress, parcoursSteps } = opts;
  const config = VIEWPORT_CONFIGS[viewportType];
  const context = await browser.newContext(config.contextOptions);
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e.message || e)));

  let httpStatus = null;
  let navigationError = null;
  try {
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    httpStatus = response ? response.status() : null;
  } catch (err) {
    navigationError = err.message;
  }

  let axeResults = { violations: [], passes: [], incomplete: [] };
  let custom = null;
  let mobileExtra = null;
  let parcours = null;

  if (!navigationError) {
    axeResults = await new AxeBuilder({ page })
      .withTags(AXE_TAGS[wcagLevel] || AXE_TAGS.AA)
      .analyze();

    custom = await runCustomChecks(page);
    if (viewportType === 'mobile') {
      mobileExtra = await runMobileChecks(page);
    }

    // Mode "parcours" : rejoue une suite d'interactions (clic menu, ouverture
    // modale...) en capturant un aperçu visuel + un mini-audit à chaque étape
    // marquée `audit: true`. Uniquement sur desktop pour limiter le coût, et
    // exécuté avant les vérifications avancées ci-dessous (qui supposent être
    // les dernières à interagir avec la page).
    if (viewportType === 'desktop' && parcoursSteps && parcoursSteps.length) {
      parcours = await runParcours(page, parcoursSteps, { wcagLevel, url, onProgress });
      if (page.url() !== url) {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
      }
    }

    // Vérifications avancées (heuristiques non couvertes par les outils
    // officiels) et vérifications orientées IA/agents de navigation.
    // ATTENTION : runAdvancedChecks navigue réellement la page en fin de
    // parcours (test focusAfterNav) : tout ce qui suit doit en tenir compte.
    const aiAgent = await runAiAgentChecks(page, url);
    const advanced = await runAdvancedChecks(page, url);
    custom = { ...custom, ...advanced, aiAgent };
  }

  await context.close();

  return {
    viewport: viewportType,
    viewportLabel: config.label,
    url,
    httpStatus,
    navigationError,
    consoleErrors,
    axe: {
      violations: axeResults.violations,
      passesCount: axeResults.passes ? axeResults.passes.length : 0,
      incompleteCount: axeResults.incomplete ? axeResults.incomplete.length : 0,
    },
    custom,
    mobileExtra,
    parcours,
  };
}

/**
 * Lance un audit complet pour une URL sur les viewports demandés.
 * @param {string} url
 * @param {{targets: string[], wcagLevel: 'A'|'AA'|'AAA'}} options
 */
async function runAudit(url, options = {}) {
  const targets = options.targets || ['desktop', 'mobile'];
  const wcagLevel = options.wcagLevel || 'AA';
  const onProgress = options.onProgress || (() => {});
  const parcoursSteps = options.parcoursSteps || null;

  const browser = await chromium.launch();
  const results = [];
  try {
    for (const target of targets) {
      onProgress({ phase: 'viewport-start', url, viewport: target });
      // eslint-disable-next-line no-await-in-loop
      const result = await scanViewport(browser, url, target, wcagLevel, {
        onProgress,
        // Le parcours ne s'applique qu'au viewport desktop (cf. scanViewport).
        parcoursSteps: target === 'desktop' ? parcoursSteps : null,
      });
      results.push(result);
      onProgress({ phase: 'viewport-done', url, viewport: target });
    }

    // Vérification prefers-reduced-motion : nécessite son propre contexte
    // navigateur, exécutée une seule fois puis reportée sur chaque viewport
    // (le comportement d'animation ne dépend pas de la taille d'écran).
    const reducedMotion = await checkReducedMotionRespect(browser, url);
    onProgress({ phase: 'reduced-motion', url });
    for (const result of results) {
      if (result.custom) result.custom.reducedMotion = reducedMotion;
    }
  } finally {
    await browser.close();
  }

  return { url, wcagLevel, scannedAt: new Date().toISOString(), results };
}

module.exports = { runAudit, VIEWPORT_CONFIGS };
