'use strict';

const { AxeBuilder } = require('@axe-core/playwright');
const { AXE_TAGS } = require('./config');

/**
 * Exécute une étape de parcours sur la page.
 * Types supportés :
 *  - click            { selector, timeout? }
 *  - fill             { selector, value, timeout? }
 *  - press             { key }                          (ex: "Escape", "Tab", "Enter")
 *  - hover            { selector, timeout? }
 *  - wait             { ms }
 *  - waitForSelector  { selector, timeout? }
 *  - goto             { url }
 */
async function runStep(page, step) {
  const timeout = step.timeout || 5000;
  switch (step.type) {
    case 'click':
      await page.click(step.selector, { timeout });
      break;
    case 'fill':
      await page.fill(step.selector, step.value || '', { timeout });
      break;
    case 'press':
      await page.keyboard.press(step.key);
      break;
    case 'hover':
      await page.hover(step.selector, { timeout });
      break;
    case 'wait':
      await page.waitForTimeout(step.ms || 500);
      break;
    case 'waitForSelector':
      await page.waitForSelector(step.selector, { timeout });
      break;
    case 'goto':
      await page.goto(step.url, { waitUntil: 'networkidle', timeout: 30000 });
      break;
    default:
      throw new Error(`Étape de parcours inconnue : "${step.type}"`);
  }
}

/** Capture une "photo" de l'état courant : screenshot + éventuellement un mini-audit axe-core. */
async function captureMoment(page, { label, runAxe, wcagLevel, error }) {
  const shot = await page.screenshot({ type: 'jpeg', quality: 55 }).catch(() => null);

  let axeSummary = null;
  let violations = [];
  if (runAxe && !error) {
    try {
      const results = await new AxeBuilder({ page })
        .withTags(AXE_TAGS[wcagLevel] || AXE_TAGS.AA)
        .analyze();
      axeSummary = {
        violations: results.violations.length,
        critical: results.violations.filter((v) => v.impact === 'critical').length,
        serious: results.violations.filter((v) => v.impact === 'serious').length,
      };
      // On garde le détail (id, description, sévérité...) : jusqu'ici seuls
      // ces compteurs étaient conservés et le rapport affichait "5
      // violation(s) — dont 2 critique(s)..." sans jamais dire lesquelles.
      violations = results.violations.map((v) => ({
        id: v.id,
        description: v.help,
        severity: v.impact || 'moderate',
        helpUrl: v.helpUrl,
        nodesAffected: (v.nodes || []).length,
      }));
    } catch (err) {
      axeSummary = { error: err.message };
    }
  }

  return {
    label: label || 'Étape',
    screenshotBase64: shot ? shot.toString('base64') : null,
    error: error || null,
    axeSummary,
    violations,
  };
}

/**
 * Rejoue une suite d'étapes sur une page déjà ouverte, en capturant un
 * "aperçu du site" (screenshot) après chaque étape. Les étapes marquées
 * `audit: true` déclenchent une ré-analyse axe-core dans l'état affiché
 * (ex : après ouverture d'un menu ou d'une modale, du contenu apparaît
 * dynamiquement et n'est jamais vu par le scan initial de la page).
 *
 * @param {import('playwright').Page} page
 * @param {Array<object>} steps
 * @param {{wcagLevel: string, url: string, onProgress?: Function}} options
 * @returns {Promise<Array<object>>} la liste des "moments" du parcours
 */
async function runParcours(page, steps, { wcagLevel, url, onProgress } = {}) {
  const moments = [];

  moments.push(await captureMoment(page, { label: 'État initial' }));

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    const label = step.label || `${step.type} ${step.selector || step.url || ''}`.trim();

    if (onProgress) {
      onProgress({ phase: 'parcours-step', url, label, index: i + 1, total: steps.length });
    }

    let error = null;
    try {
      await runStep(page, step);
    } catch (err) {
      error = err.message;
    }

    moments.push(await captureMoment(page, {
      label,
      runAxe: step.audit === true,
      wcagLevel,
      error,
    }));
  }

  return moments;
}

module.exports = { runParcours };
