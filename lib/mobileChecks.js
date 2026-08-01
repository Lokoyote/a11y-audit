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
    function cssPath(el) {
      const parts = [];
      let node = el;
      while (node && node.nodeType === 1 && parts.length < 4) {
        let part = node.tagName.toLowerCase();
        if (node.id) { part += `#${node.id}`; parts.unshift(part); break; }
        if (node.classList.length) part += `.${Array.from(node.classList).slice(0, 2).join('.')}`;
        parts.unshift(part);
        node = node.parentElement;
      }
      return parts.join(' > ');
    }

    const interactiveSelector = 'a, button, input, select, textarea, [role="button"], [role="link"], [onclick]';
    const elements = Array.from(document.querySelectorAll(interactiveSelector)).filter((el) => {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });

    let tooSmall = 0;
    const samples = [];
    for (const el of elements) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue; // élément non rendu
      if (rect.width < minTouchTarget || rect.height < minTouchTarget) {
        tooSmall++;
        if (samples.length < 5) {
          samples.push({
            selector: cssPath(el),
            html: el.outerHTML.length > 200 ? `${el.outerHTML.slice(0, 200)}…` : el.outerHTML,
            failureSummary: `${Math.round(rect.width)}×${Math.round(rect.height)}px (minimum recommandé : ${minTouchTarget}×${minTouchTarget}px)`,
          });
        }
      }
    }

    result.touchTargets = {
      total: elements.length,
      tooSmall,
      minRequiredPx: minTouchTarget,
      samples,
      ok: elements.length === 0 || tooSmall / elements.length < 0.1, // tolérance 10%
    };

    return result;
  }, MIN_TOUCH_TARGET_PX);
}

module.exports = { runMobileChecks };
