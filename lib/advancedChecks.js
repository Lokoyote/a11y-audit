'use strict';

/**
 * Ce module regroupe des vérifications HEURISTIQUES qui ne font partie
 * d'aucune règle officielle axe-core/WAVE/Lighthouse, mais qui découlent
 * logiquement des critères WCAG. Elles peuvent produire de rares faux
 * positifs (d'où leur statut "avancé / à vérifier manuellement" dans le
 * rapport) mais couvrent des angles morts réels des scanners classiques.
 */

/**
 * Faux boutons : éléments non sémantiques (div/span/li) qui se comportent
 * visuellement ou fonctionnellement comme des boutons (curseur pointer,
 * gestionnaire onclick) sans être accessibles au clavier ni annoncés comme
 * interactifs par un lecteur d'écran.
 * Pourquoi c'est important : un utilisateur clavier ou lecteur d'écran ne
 * pourra tout simplement pas activer ces éléments, quel que soit l'outil
 * (IA incluse) — l'information "ceci est cliquable" n'existe nulle part
 * dans le code, donc rien ne peut la deviner de façon fiable.
 * Limite connue : `el.onclick` ne détecte que les gestionnaires inline ;
 * les listeners posés via addEventListener() ne sont pas visibles depuis le
 * DOM, donc ce contrôle sous-estime probablement le nombre réel de cas.
 */
async function checkFakeInteractiveElements(page) {
  return page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('div, span, li, td, p'));
    const suspects = [];
    for (const el of candidates) {
      const style = window.getComputedStyle(el);
      const hasInlineClickHandler = !!el.getAttribute('onclick');
      const looksClickable = style.cursor === 'pointer';
      if (!hasInlineClickHandler && !looksClickable) continue;

      const role = el.getAttribute('role');
      const tabindex = el.getAttribute('tabindex');
      const isFocusable = tabindex !== null && tabindex !== '-1';
      const hasInteractiveRole = ['button', 'link', 'menuitem', 'tab', 'checkbox', 'switch'].includes(role);

      if (!isFocusable || !hasInteractiveRole) {
        suspects.push({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || '').trim().slice(0, 40),
          hasInlineClickHandler,
          looksClickable,
          role: role || null,
        });
      }
    }
    return {
      total: suspects.length,
      examples: suspects.slice(0, 5),
      ok: suspects.length === 0,
    };
  });
}

/**
 * Focus après navigation interne (typique des SPA React/Vue/Angular) :
 * on clique un lien interne et on vérifie que le focus clavier n'est pas
 * silencieusement perdu (retombé sur <body> sans annonce ni repositionnement).
 * Pourquoi c'est important : sur un site classique, le navigateur replace
 * naturellement le focus en haut de la nouvelle page. En SPA, le DOM ne
 * recharge pas, donc rien ne le fait automatiquement — un utilisateur
 * clavier/lecteur d'écran ne sait plus où il se trouve après un clic.
 * Ce test navigue réellement la page : il doit être exécuté en dernier.
 */
async function checkFocusAfterInternalNavigation(page, baseUrl) {
  try {
    const linkHandle = await page.evaluateHandle((base) => {
      const links = Array.from(document.querySelectorAll('a[href]'));
      return (
        links.find((a) => {
          try {
            const url = new URL(a.getAttribute('href'), location.href);
            const baseOrigin = new URL(base).origin;
            return url.origin === baseOrigin && url.href !== location.href && a.offsetParent !== null;
          } catch {
            return false;
          }
        }) || null
      );
    }, baseUrl);

    const element = linkHandle.asElement();
    if (!element) {
      return { tested: false, reason: 'Aucun lien interne cliquable trouvé pour ce test', ok: null };
    }

    const beforeUrl = page.url();
    await element.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(900);
    const afterUrl = page.url();

    const focusInfo = await page.evaluate(() => {
      const el = document.activeElement;
      return { isBody: !el || el === document.body };
    });

    return {
      tested: true,
      navigationHappened: afterUrl !== beforeUrl,
      focusLostToBody: focusInfo.isBody,
      ok: !focusInfo.isBody,
    };
  } catch (err) {
    return { tested: false, reason: err.message, ok: null };
  }
}

/**
 * Zoom de texte à 200% (WCAG 1.4.4) : le texte doit rester lisible et
 * complet sans dépendre d'un défilement horizontal supplémentaire.
 * Espacement du texte (WCAG 1.4.12) : line-height 1.5, letter-spacing
 * 0.12em, word-spacing 0.16em ne doivent tronquer ni superposer aucun texte.
 * Pourquoi c'est important : de nombreux utilisateurs malvoyants
 * n'utilisent pas de lecteur d'écran mais agrandissent simplement le texte
 * ou activent un espacement personnalisé — un site qui casse dans ces cas
 * les exclut, sans qu'aucun scanner officiel ne le détecte par défaut.
 */
async function checkResizeAndTextSpacing(page) {
  const baseline = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));

  // --- Test 1 : zoom texte 200% ---
  await page.evaluate(() => {
    document.documentElement.style.setProperty('font-size', '200%');
  });
  await page.waitForTimeout(200);
  const afterZoom = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  await page.evaluate(() => document.documentElement.style.removeProperty('font-size'));
  await page.waitForTimeout(100);

  // --- Test 2 : espacement du texte ---
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.id = '__a11y_audit_spacing_test__';
    style.textContent = `
      * { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
      p { margin-bottom: 2em !important; }
    `;
    document.head.appendChild(style);
  });
  await page.waitForTimeout(200);
  const afterSpacing = await page.evaluate(() => {
    const clipped = Array.from(document.querySelectorAll('*')).filter((el) => {
      const s = window.getComputedStyle(el);
      const overflowsBox = el.scrollHeight > el.clientHeight + 5 || el.scrollWidth > el.clientWidth + 5;
      return (s.overflow === 'hidden' || s.overflowY === 'hidden') && overflowsBox && el.textContent.trim().length > 0;
    }).length;
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      clippedTextContainers: clipped,
    };
  });
  await page.evaluate(() => {
    const s = document.getElementById('__a11y_audit_spacing_test__');
    if (s) s.remove();
  });

  const baselineOverflow = Math.max(0, baseline.scrollWidth - baseline.clientWidth);
  const zoomOverflow = Math.max(0, afterZoom.scrollWidth - afterZoom.clientWidth);
  const spacingOverflow = Math.max(0, afterSpacing.scrollWidth - afterSpacing.clientWidth);

  return {
    textResize200: {
      addedOverflowPx: Math.max(0, zoomOverflow - baselineOverflow),
      ok: zoomOverflow - baselineOverflow <= 10,
    },
    textSpacing: {
      clippedTextContainers: afterSpacing.clippedTextContainers,
      addedOverflowPx: Math.max(0, spacingOverflow - baselineOverflow),
      ok: afterSpacing.clippedTextContainers === 0 && spacingOverflow - baselineOverflow <= 10,
    },
  };
}

/**
 * Respect de prefers-reduced-motion (WCAG 2.3.3). Nécessite un contexte de
 * navigateur créé avec reducedMotion:'reduce' (voir scan.js) ; on vérifie
 * ici, une fois la page chargée dans ce contexte, qu'il ne reste pas
 * d'animations CSS actives non désactivées par le site.
 * Pourquoi c'est important : pour les personnes souffrant de troubles
 * vestibulaires ou de l'attention, des animations non maîtrisées peuvent
 * provoquer nausées, migraines ou perte de concentration — un risque de
 * santé, pas seulement un confort.
 * Limite connue : les transitions déclenchées par une action volontaire de
 * l'utilisateur (ex: survol d'un bouton) ne sont pas problématiques en soi ;
 * ce contrôle signale leur présence à titre indicatif, à vérifier manuellement.
 */
async function checkReducedMotionRespect(browser, url) {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  let data;
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    data = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('*'));
      let stillAnimating = 0;
      const examples = [];
      for (const el of all) {
        const s = window.getComputedStyle(el);
        const animDuration = parseFloat(s.animationDuration) || 0;
        if (animDuration > 0 && s.animationName !== 'none' && s.animationPlayState !== 'paused') {
          stillAnimating++;
          if (examples.length < 5) {
            examples.push({ tag: el.tagName.toLowerCase(), animationName: s.animationName, duration: animDuration });
          }
        }
      }
      return { elementsChecked: all.length, stillAnimating, examples };
    });
  } catch (err) {
    data = { error: err.message };
  } finally {
    await context.close();
  }

  if (data.error) return { tested: false, reason: data.error, ok: null };
  return { tested: true, ...data, ok: data.stillAnimating === 0 };
}

/**
 * Regroupe les vérifications avancées applicables à un chargement de page
 * "normal" (hors reducedMotion, géré séparément car il nécessite son propre
 * contexte navigateur). ATTENTION : focusAfterNavigation navigue réellement
 * la page ; cette fonction doit être appelée en dernier dans le flux de scan.
 */
async function runAdvancedChecks(page, url) {
  const fakeInteractive = await checkFakeInteractiveElements(page);
  const resizeAndSpacing = await checkResizeAndTextSpacing(page);
  const focusAfterNav = await checkFocusAfterInternalNavigation(page, url);

  return {
    fakeInteractive,
    ...resizeAndSpacing,
    focusAfterNav,
  };
}

module.exports = {
  runAdvancedChecks,
  checkReducedMotionRespect,
};
