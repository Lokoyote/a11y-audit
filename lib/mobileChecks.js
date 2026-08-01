'use strict';

const { MIN_TOUCH_TARGET_PX } = require('./config');

/**
 * Vérifications spécifiques à l'expérience mobile / tactile.
 * (WCAG 1.4.4 Redimensionnement, 1.4.10 Reflow, 2.5.5 Taille de la cible,
 *  2.5.8 Taille de la cible minimum)
 */
async function runMobileChecks(page) {
  return page.evaluate((minTouchTarget) => {
    const result = {};

    // 1. Balise meta viewport (empêche le zoom = piège pour malvoyants)
    const viewportMeta = document.querySelector('meta[name="viewport"]');
    const content = viewportMeta ? viewportMeta.getAttribute('content') || '' : '';
    const blocksZoom = /user-scalable\s*=\s*no/i.test(content) || /maximum-scale\s*=\s*(0|1)(\.0)?\b/.test(content);
    result.viewportMeta = {
      present: !!viewportMeta,
      content,
      blocksZoom,
      ok: !!viewportMeta && !blocksZoom,
    };

    // 2. Débordement horizontal / non-reflow (contenu plus large que l'écran)
    const scrollWidth = document.documentElement.scrollWidth;
    const clientWidth = document.documentElement.clientWidth;
    result.horizontalOverflow = {
      scrollWidth,
      clientWidth,
      overflowPx: Math.max(0, scrollWidth - clientWidth),
      ok: scrollWidth - clientWidth <= 5, // tolérance de 5px
    };

    // 3. Taille des cibles tactiles
    const interactiveSelector = 'a, button, input, select, textarea, [role="button"], [role="link"], [onclick]';
    const elements = Array.from(document.querySelectorAll(interactiveSelector)).filter((el) => {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });

    let tooSmall = 0;
    const examples = [];
    for (const el of elements) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue; // élément non rendu
      if (rect.width < minTouchTarget || rect.height < minTouchTarget) {
        tooSmall++;
        if (examples.length < 5) {
          examples.push({
            tag: el.tagName.toLowerCase(),
            text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          });
        }
      }
    }

    result.touchTargets = {
      total: elements.length,
      tooSmall,
      minRequiredPx: minTouchTarget,
      examples,
      ok: elements.length === 0 || tooSmall / elements.length < 0.1, // tolérance 10%
    };

    return result;
  }, MIN_TOUCH_TARGET_PX);
}

module.exports = { runMobileChecks };
