'use strict';

const { KEYBOARD_TAB_STEPS } = require('./config');

/**
 * Vérifications DOM statiques, exécutées dans le contexte de la page.
 */
async function runStaticChecks(page) {
  return page.evaluate(() => {
    const result = {};

    /** Décrit jusqu'à 5 éléments : un sélecteur lisible + un extrait de code source. */
    function cssPath(el) {
      if (!(el instanceof Element)) return '';
      const parts = [];
      let node = el;
      while (node && node.nodeType === 1 && parts.length < 4) {
        let part = node.tagName.toLowerCase();
        if (node.id) {
          part += `#${node.id}`;
          parts.unshift(part);
          break; // un id suffit à remonter, pas besoin d'aller plus haut
        }
        if (node.classList.length) {
          part += `.${Array.from(node.classList).slice(0, 2).join('.')}`;
        }
        const parent = node.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
          if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
        }
        parts.unshift(part);
        node = node.parentElement;
      }
      return parts.join(' > ');
    }

    function describeElements(els, max = 5) {
      return els.slice(0, max).map((el) => ({
        selector: cssPath(el),
        html: el.outerHTML.length > 200 ? `${el.outerHTML.slice(0, 200)}…` : el.outerHTML,
      }));
    }

    // 1. Langue de la page (WCAG 3.1.1)
    const htmlLang = document.documentElement.getAttribute('lang');
    result.lang = { value: htmlLang, ok: !!htmlLang && htmlLang.trim().length > 0 };

    // 2. Titre de page (WCAG 2.4.2)
    result.title = { value: document.title, ok: !!document.title && document.title.trim().length > 3 };

    // 3. Structure des titres (WCAG 1.3.1 / 2.4.6)
    const headingEls = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
    const headings = headingEls.map((h) => parseInt(h.tagName.substring(1), 10));
    const h1Count = headings.filter((l) => l === 1).length;
    let skippedLevels = 0;
    for (let i = 1; i < headings.length; i++) {
      if (headings[i] - headings[i - 1] > 1) skippedLevels++;
    }
    result.headings = {
      total: headings.length,
      h1Count,
      skippedLevels,
      ok: h1Count === 1 && skippedLevels === 0 && headings.length > 0,
      // La séquence complète des titres (avec leur texte) permet de voir
      // précisément OÙ un niveau est sauté ou où se trouve chaque h1.
      samples: headingEls.slice(0, 20).map((h, i) => ({
        selector: cssPath(h),
        html: `<${h.tagName.toLowerCase()}> ${(h.textContent || '').trim().slice(0, 80)}`,
        failureSummary: i > 0 && headings[i] - headings[i - 1] > 1
          ? `Saute de <h${headings[i - 1]}> à <h${headings[i]}> sans niveau intermédiaire`
          : null,
      })),
    };

    // 4. Texte alternatif des images (WCAG 1.1.1)
    const images = Array.from(document.querySelectorAll('img'));
    const decorative = images.filter(
      (img) => img.getAttribute('alt') === '' || img.getAttribute('role') === 'presentation'
    );
    const missingAltEls = images.filter(
      (img) => img.getAttribute('alt') === null && img.getAttribute('role') !== 'presentation'
    );
    result.images = {
      total: images.length,
      decorative: decorative.length,
      missingAlt: missingAltEls.length,
      ok: missingAltEls.length === 0,
      samples: describeElements(missingAltEls),
    };

    // 5. Labels de formulaire (WCAG 1.3.1 / 3.3.2 / 4.1.2)
    const fields = Array.from(document.querySelectorAll('input, select, textarea'))
      .filter((f) => f.type !== 'hidden' && f.type !== 'submit' && f.type !== 'button');
    const unlabeled = fields.filter((f) => {
      const id = f.getAttribute('id');
      const hasLabelFor = id && document.querySelector(`label[for="${CSS.escape(id)}"]`);
      const hasAriaLabel = f.getAttribute('aria-label') || f.getAttribute('aria-labelledby');
      const wrappedInLabel = f.closest('label');
      return !hasLabelFor && !hasAriaLabel && !wrappedInLabel;
    });
    result.formLabels = {
      total: fields.length,
      unlabeled: unlabeled.length,
      ok: unlabeled.length === 0,
      samples: describeElements(unlabeled),
    };

    // 6. Landmarks / repères de navigation (WCAG 1.3.1 / 2.4.1)
    const landmarks = {
      header: !!document.querySelector('header, [role="banner"]'),
      nav: !!document.querySelector('nav, [role="navigation"]'),
      main: !!document.querySelector('main, [role="main"]'),
      footer: !!document.querySelector('footer, [role="contentinfo"]'),
    };
    result.landmarks = {
      ...landmarks,
      ok: landmarks.main && landmarks.nav,
    };

    // 7. Lien d'évitement / skip-link (WCAG 2.4.1)
    const firstLink = document.querySelector('a[href^="#"]');
    result.skipLink = { present: !!firstLink };

    return result;
  });
}

/**
 * Test de navigation clavier : simule des tabulations réelles et vérifie
 * que le focus se déplace, reste visible, et ne se retrouve pas piégé.
 * (WCAG 2.1.1 Clavier, 2.1.2 Pas de piège, 2.4.7 Focus visible)
 */
async function runKeyboardCheck(page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const seen = new Set();
  let focusVisibleFailures = 0;
  let stuckCount = 0;
  let lastSignature = null;
  let repeats = 0;
  const focusVisibleSamples = [];
  const trapSamples = [];

  for (let i = 0; i < KEYBOARD_TAB_STEPS; i++) {
    await page.keyboard.press('Tab');
    // eslint-disable-next-line no-await-in-loop
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const signature = el.tagName + '|' + (el.id || '') + '|' + (el.className || '') + '|' + rect.top + '|' + rect.left;
      const hasVisibleFocusStyle =
        style.outlineStyle !== 'none' ||
        style.boxShadow !== 'none' ||
        el.matches(':focus-visible');
      // Sélecteur compact (évaluation isolée à chaque Tab : pas d'accès à
      // une fonction partagée définie dans un autre appel evaluate()).
      let selector = el.tagName.toLowerCase();
      if (el.id) selector += `#${el.id}`;
      else if (typeof el.className === 'string' && el.className.trim()) {
        selector += `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`;
      }
      const html = el.outerHTML.length > 200 ? `${el.outerHTML.slice(0, 200)}…` : el.outerHTML;
      return { signature, hasVisibleFocusStyle, selector, html };
    });

    if (!info) continue;
    if (info.signature === lastSignature) {
      repeats++;
      if (repeats > 2) {
        stuckCount++;
        if (trapSamples.length < 3) trapSamples.push({ selector: info.selector, html: info.html, failureSummary: 'Le focus reste bloqué sur cet élément après plusieurs Tab' });
      }
    } else {
      repeats = 0;
    }
    lastSignature = info.signature;
    seen.add(info.signature);
    if (!info.hasVisibleFocusStyle) {
      focusVisibleFailures++;
      if (focusVisibleSamples.length < 5) {
        focusVisibleSamples.push({ selector: info.selector, html: info.html, failureSummary: "Aucun indicateur visuel de focus (pas d'outline ni de box-shadow)" });
      }
    }
  }

  return {
    stepsRun: KEYBOARD_TAB_STEPS,
    uniqueFocusableReached: seen.size,
    focusVisibleFailures,
    possibleKeyboardTrap: stuckCount > 0,
    ok: seen.size > 0 && focusVisibleFailures === 0 && stuckCount === 0,
    // Priorité au piège clavier (bloquant) si présent, sinon les échecs de focus visible.
    samples: trapSamples.length ? trapSamples : focusVisibleSamples,
  };
}

async function runCustomChecks(page) {
  const [staticChecks, keyboard] = await Promise.all([
    runStaticChecks(page),
    runKeyboardCheck(page),
  ]);
  return { ...staticChecks, keyboard };
}

module.exports = { runCustomChecks };
