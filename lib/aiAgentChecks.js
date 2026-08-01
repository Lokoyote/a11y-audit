'use strict';

/**
 * Pourquoi un axe dédié "IA & Agents" ?
 *
 * Les utilisateurs malvoyants s'appuient de plus en plus sur des IA en
 * complément (ou remplacement partiel) des lecteurs d'écran classiques :
 * Microsoft Seeing AI, Be My Eyes ("Be My AI"), la description d'image par
 * IA intégrée à NVDA ou à Chrome/Edge, ou encore des agents de navigation
 * IA qui agissent pour le compte de l'utilisateur.
 *
 * Ces outils sont un FILET DE SECOURS, pas une solution : ils devinent le
 * contenu visuel d'un élément quand rien n'est fourni, mais ne peuvent pas
 * deviner sa FONCTION (ex: une icône "corbeille" peut être décrite comme
 * "une poubelle" sans que l'IA sache qu'elle supprime définitivement un
 * compte). Un lien "cliquez ici" reste ambigu même décrit par une IA : la
 * destination n'est pas une information visuelle, elle est simplement
 * absente du code.
 *
 * Ces vérifications ciblent donc les cas où NI un lecteur d'écran NI une
 * IA de secours ne peuvent compenser un manque d'information dans le code.
 * Ce sont des heuristiques expérimentales, absentes des outils officiels.
 */

const VAGUE_TEXTS = [
  'cliquez ici', 'cliquer ici', 'ici', 'en savoir plus', 'lire la suite',
  'plus d\'infos', 'plus d\'informations', 'voir plus', 'suite', 'details',
  'détails', 'click here', 'read more', 'learn more', 'more', 'here', 'link',
  'button', 'ok', 'go', 'continuer',
];

function accessibleNameFor(el) {
  const ariaLabel = el.getAttribute && el.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();
  const text = (el.textContent || '').trim();
  if (text) return text;
  const title = el.getAttribute && el.getAttribute('title');
  if (title && title.trim()) return title.trim();
  return '';
}

/**
 * Liens/boutons dont le nom accessible est générique et ne porte aucune
 * information sur la destination ou l'action, hors de tout contexte visuel
 * (couleur, position, élément voisin) — exactement la situation d'un
 * lecteur d'écran en "mode liste de liens" ou d'un agent IA qui énumère
 * les actions possibles sans les voir à l'écran.
 */
async function checkVagueAccessibleNames(page, vagueList) {
  return page.evaluate((vague) => {
    function accessibleNameFor(el) {
      const ariaLabel = el.getAttribute('aria-label');
      if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();
      const text = (el.textContent || '').trim();
      if (text) return text;
      const title = el.getAttribute('title');
      if (title && title.trim()) return title.trim();
      return '';
    }
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

    const elements = Array.from(document.querySelectorAll('a[href], button, [role="button"], [role="link"]'));
    const vagueSet = new Set(vague);
    const flagged = [];
    for (const el of elements) {
      const name = accessibleNameFor(el).toLowerCase().trim();
      if (name && vagueSet.has(name)) {
        flagged.push({
          selector: cssPath(el),
          html: el.outerHTML.length > 200 ? `${el.outerHTML.slice(0, 200)}…` : el.outerHTML,
          failureSummary: el.getAttribute('href') ? `Destination réelle : ${el.getAttribute('href')}` : null,
        });
      }
    }
    return {
      total: elements.length,
      flaggedCount: flagged.length,
      samples: flagged.slice(0, 6),
      ok: flagged.length === 0,
    };
  }, vagueList);
}

/**
 * Icônes/images fonctionnelles (dans un lien ou un bouton, donc porteuses
 * d'une action) sans aucun nom accessible. C'est le cas critique pour les
 * IA de description : elles peuvent décrire l'apparence ("une flèche"),
 * jamais l'effet du clic ("valider la commande" vs "annuler").
 */
async function checkFunctionalIconsWithoutName(page) {
  return page.evaluate(() => {
    function accessibleNameFor(el) {
      const ariaLabel = el.getAttribute('aria-label');
      if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();
      const text = (el.textContent || '').trim();
      if (text) return text;
      return '';
    }
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

    const controls = Array.from(document.querySelectorAll('a, button, [role="button"], [role="link"]'));
    let flagged = 0;
    const samples = [];
    for (const el of controls) {
      const name = accessibleNameFor(el);
      if (name) continue; // déjà nommé au niveau du contrôle, ok
      const hasOnlyIconContent =
        el.querySelector('svg, img, i[class*="icon"], span[class*="icon"]') &&
        !el.textContent.replace(/\s/g, '');
      if (hasOnlyIconContent) {
        flagged++;
        if (samples.length < 5) {
          samples.push({
            selector: cssPath(el),
            html: el.outerHTML.length > 200 ? `${el.outerHTML.slice(0, 200)}…` : el.outerHTML,
            failureSummary: 'Aucun aria-label ni texte : une IA peut décrire l\'icône, jamais l\'action déclenchée',
          });
        }
      }
    }
    return { flaggedCount: flagged, samples, ok: flagged === 0 };
  });
}

/**
 * Plusieurs contrôles distincts (menant à des destinations/actions
 * différentes) partageant exactement le même nom accessible. Un lecteur
 * d'écran ou un agent IA qui navigue "par nom" ne peut alors plus les
 * distinguer, même si le contexte visuel les différencie clairement.
 */
async function checkDuplicateAccessibleNames(page) {
  return page.evaluate(() => {
    function accessibleNameFor(el) {
      const ariaLabel = el.getAttribute('aria-label');
      if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();
      const text = (el.textContent || '').trim();
      if (text) return text;
      return '';
    }
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

    const elements = Array.from(document.querySelectorAll('a[href], button'));
    const byName = new Map();
    for (const el of elements) {
      const name = accessibleNameFor(el).toLowerCase();
      if (!name || name.length < 3) continue;
      const target = el.tagName.toLowerCase() === 'a' ? el.getAttribute('href') : 'button:' + name;
      if (!byName.has(name)) byName.set(name, []);
      const entry = byName.get(name);
      if (!entry.some((e) => e.target === target)) entry.push({ target, el });
    }

    const ambiguous = [];
    const samples = [];
    for (const [name, entries] of byName.entries()) {
      if (entries.length > 1) {
        ambiguous.push({ name, distinctTargets: entries.length });
        if (samples.length < 5) {
          samples.push({
            selector: entries.map((e) => cssPath(e.el)).join('  ⇄  '),
            html: `Intitulé « ${name} » utilisé pour ${entries.length} destinations différentes`,
            failureSummary: entries.map((e) => e.target).slice(0, 4).join(' · '),
          });
        }
      }
    }

    return {
      ambiguousCount: ambiguous.length,
      samples,
      ok: ambiguous.length === 0,
    };
  });
}

/**
 * Vérification informative (non pénalisante) : présence d'un fichier
 * /llms.txt, un standard émergent (à la manière de robots.txt) qui permet
 * de fournir aux agents IA un contexte structuré sur le site. Ce n'est pas
 * un critère d'accessibilité au sens WCAG, mais un signal de préparation
 * à la navigation par agent IA — inclus ici à titre exploratoire.
 */
async function checkLlmsTxt(page, baseUrl) {
  try {
    const origin = new URL(baseUrl).origin;
    const response = await page.request.get(origin + '/llms.txt', { timeout: 5000 });
    return { present: response.ok(), status: response.status() };
  } catch (err) {
    return { present: false, error: err.message };
  }
}

async function runAiAgentChecks(page, url) {
  const [vagueNames, functionalIcons, duplicateNames, llmsTxt] = await Promise.all([
    checkVagueAccessibleNames(page, VAGUE_TEXTS),
    checkFunctionalIconsWithoutName(page),
    checkDuplicateAccessibleNames(page),
    checkLlmsTxt(page, url),
  ]);

  return { vagueNames, functionalIcons, duplicateNames, llmsTxt };
}

module.exports = { runAiAgentChecks };
