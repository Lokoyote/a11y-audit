'use strict';

const { IMPACT_WEIGHTS, CATEGORY_TO_PRINCIPLE, PRINCIPLES } = require('./config');

/**
 * Mapping pragmatique des vérifications custom vers les 4 principes WCAG.
 * Utilisé uniquement pour regrouper les résultats en axes lisibles dans le
 * rapport ; il ne s'agit pas d'une classification normative officielle.
 */
const CUSTOM_CHECK_PRINCIPLE = {
  lang: 'Compréhensible',
  title: 'Utilisable',
  headings: 'Perceptible',
  images: 'Perceptible',
  formLabels: 'Compréhensible',
  landmarks: 'Utilisable',
  skipLink: 'Utilisable',
  keyboard: 'Utilisable',
  // Contrôles avancés (heuristiques, absents des outils officiels)
  fakeInteractive: 'Utilisable',
  textResize200: 'Perceptible',
  textSpacing: 'Perceptible',
  focusAfterNav: 'Utilisable',
  reducedMotion: 'Utilisable',
};

const CUSTOM_CHECK_PENALTY = {
  lang: 4,
  title: 3,
  headings: 5,
  images: 6,
  formLabels: 6,
  landmarks: 4,
  skipLink: 2,
  keyboard: 8,
  fakeInteractive: 6,
  textResize200: 5,
  textSpacing: 4,
  focusAfterNav: 5,
  reducedMotion: 5,
};

/** Sous-contrôles IA/Agents, tous rattachés à l'axe dédié "IA & Agents". */
const AI_CHECK_PENALTY = {
  vagueNames: 4,
  functionalIcons: 6,
  duplicateNames: 3,
};

const MOBILE_CHECK_PENALTY = {
  viewportMeta: 10,
  horizontalOverflow: 8,
  touchTargets: 8,
};

function principleForViolation(violation) {
  const catTag = (violation.tags || []).find((t) => CATEGORY_TO_PRINCIPLE[t]);
  return catTag ? CATEGORY_TO_PRINCIPLE[catTag] : 'Robuste';
}

/** Pénalité pour une violation axe-core, avec rendements décroissants sur le nombre de noeuds touchés. */
function violationPenalty(violation) {
  const weight = IMPACT_WEIGHTS[violation.impact] || IMPACT_WEIGHTS.moderate;
  const nodesCount = (violation.nodes || []).length || 1;
  const multiplier = Math.min(1 + 0.4 * (nodesCount - 1), 4); // plafonné à x4
  return weight * multiplier;
}

/**
 * Calcule le score détaillé pour un résultat de scan (un viewport donné).
 */
function scoreViewportResult(result) {
  const axisPenalties = Object.fromEntries(PRINCIPLES.map((p) => [p, 0]));
  const issues = [];

  if (result.navigationError) {
    return {
      viewport: result.viewport,
      score: 0,
      axisScores: Object.fromEntries(PRINCIPLES.map((p) => [p, 0])),
      issues: [
        {
          principle: 'Robuste',
          severity: 'critical',
          source: 'navigation',
          id: 'navigation-error',
          description: `Impossible de charger la page : ${result.navigationError}`,
          helpUrl: null,
          nodesAffected: 0,
        },
      ],
      error: result.navigationError,
    };
  }

  // 1. Violations axe-core
  for (const violation of result.axe.violations) {
    const principle = principleForViolation(violation);
    const penalty = violationPenalty(violation);
    axisPenalties[principle] = (axisPenalties[principle] || 0) + penalty;
    issues.push({
      principle,
      severity: violation.impact || 'moderate',
      source: 'axe-core',
      id: violation.id,
      description: violation.help,
      helpUrl: violation.helpUrl,
      nodesAffected: (violation.nodes || []).length,
      // axe-core fournit déjà, par élément touché, le sélecteur CSS (target)
      // et un extrait de code (html) — jusqu'ici jeté, seul le compte était
      // gardé. On en garde un échantillon (5 max) pour montrer OÙ et QUOI.
      locations: (violation.nodes || []).slice(0, 5).map((n) => ({
        selector: Array.isArray(n.target) ? n.target.join(' ') : String(n.target || ''),
        html: n.html && n.html.length > 200 ? `${n.html.slice(0, 200)}…` : n.html,
        failureSummary: n.failureSummary || null,
      })),
    });
  }

  // 2. Checks custom génériques
  if (result.custom) {
    for (const [key, principle] of Object.entries(CUSTOM_CHECK_PRINCIPLE)) {
      const check = result.custom[key];
      if (check && check.ok === false) {
        const penalty = CUSTOM_CHECK_PENALTY[key] || 3;
        axisPenalties[principle] += penalty;
        issues.push({
          principle,
          severity: penalty >= 6 ? 'serious' : 'moderate',
          source: 'custom-check',
          id: key,
          description: describeCustomCheck(key, check),
          helpUrl: null,
          nodesAffected: null,
          locations: (check.samples || []).map((s) => ({ selector: s.selector, html: s.html, failureSummary: null })),
        });
      }
    }
  }

  // 3. Checks orientés IA / agents de navigation (axe dédié)
  if (result.custom && result.custom.aiAgent) {
    const ai = result.custom.aiAgent;
    const aiChecks = {
      vagueNames: ai.vagueNames,
      functionalIcons: ai.functionalIcons,
      duplicateNames: ai.duplicateNames,
    };
    for (const [key, check] of Object.entries(aiChecks)) {
      if (check && check.ok === false) {
        const penalty = AI_CHECK_PENALTY[key] || 3;
        axisPenalties['IA & Agents'] += penalty;
        issues.push({
          principle: 'IA & Agents',
          severity: penalty >= 6 ? 'serious' : 'moderate',
          source: 'ai-agent-check',
          id: key,
          description: describeAiCheck(key, check),
          helpUrl: null,
          nodesAffected: check.flaggedCount ?? check.ambiguousCount ?? null,
        });
      }
    }
    // llms.txt est informatif uniquement : jamais de pénalité, juste une note.
    if (ai.llmsTxt && !ai.llmsTxt.present) {
      issues.push({
        principle: 'IA & Agents',
        severity: 'minor',
        source: 'ai-agent-check',
        id: 'llmsTxt',
        description: "Aucun fichier /llms.txt détecté (standard émergent, informatif — n'affecte pas le score).",
        helpUrl: 'https://llmstxt.org/',
        nodesAffected: null,
        informational: true,
      });
    }
  }

  // 4. Checks spécifiques mobile
  if (result.mobileExtra) {
    for (const [key, penaltyBase] of Object.entries(MOBILE_CHECK_PENALTY)) {
      const check = result.mobileExtra[key];
      if (check && check.ok === false) {
        axisPenalties['Mobile'] += penaltyBase;
        issues.push({
          principle: 'Mobile',
          severity: penaltyBase >= 9 ? 'serious' : 'moderate',
          source: 'mobile-check',
          id: key,
          description: describeMobileCheck(key, check),
          helpUrl: null,
          nodesAffected: check.tooSmall != null ? check.tooSmall : null,
        });
      }
    }
  }

  const axisScores = {};
  for (const p of PRINCIPLES) {
    axisScores[p] = Math.max(0, Math.round(100 - axisPenalties[p]));
  }

  // Score global du viewport = moyenne des axes pertinents pour ce viewport
  const relevantAxes = result.viewport === 'mobile'
    ? PRINCIPLES
    : PRINCIPLES.filter((p) => p !== 'Mobile');
  const score = Math.max(
    0,
    Math.round(relevantAxes.reduce((sum, p) => sum + axisScores[p], 0) / relevantAxes.length)
  );

  return { viewport: result.viewport, score, axisScores, issues };
}

function describeCustomCheck(key, check) {
  switch (key) {
    case 'lang': return "L'attribut lang de la balise <html> est manquant ou vide : les lecteurs d'écran ne peuvent pas déterminer la langue du contenu.";
    case 'title': return 'Le titre de la page est manquant ou trop court pour identifier clairement le contenu.';
    case 'headings': return `Structure de titres incohérente (h1 trouvés: ${check.h1Count}, sauts de niveau: ${check.skippedLevels}).`;
    case 'images': return `${check.missingAlt} image(s) sur ${check.total} n'ont pas d'attribut alt.`;
    case 'formLabels': return `${check.unlabeled} champ(s) de formulaire sur ${check.total} n'ont pas de label associé.`;
    case 'landmarks': return "Repères de navigation ARIA/HTML5 manquants (main et/ou nav absents), ce qui gêne la navigation au clavier ou au lecteur d'écran.";
    case 'skipLink': return "Aucun lien d'évitement (skip link) détecté en début de page.";
    case 'keyboard': return `Navigation clavier défaillante (focus atteint: ${check.uniqueFocusableReached}, indicateur de focus invisible: ${check.focusVisibleFailures} fois, piège clavier détecté: ${check.possibleKeyboardTrap}).`;
    case 'fakeInteractive': return `${check.total} élément(s) non sémantique(s) (div/span...) se comportent comme des boutons sans être accessibles au clavier ni annoncés comme interactifs. [Heuristique avancée, hors outils officiels]`;
    case 'textResize200': return `Le texte agrandi à 200% provoque ${check.addedOverflowPx}px de débordement horizontal supplémentaire. [Heuristique avancée, WCAG 1.4.4]`;
    case 'textSpacing': return `L'espacement du texte personnalisé (WCAG 1.4.12) tronque ${check.clippedTextContainers} zone(s) de contenu. [Heuristique avancée]`;
    case 'focusAfterNav': return check.tested ? `Après un clic sur un lien interne, le focus clavier retombe silencieusement sur <body> sans repositionnement. [Heuristique avancée, typique des SPA]` : 'Test non concluant.';
    case 'reducedMotion': return check.tested ? `${check.stillAnimating} élément(s) continuent de s'animer alors que la préférence "mouvement réduit" est activée. [Heuristique avancée, WCAG 2.3.3]` : 'Test non concluant.';
    default: return 'Vérification échouée.';
  }
}

function describeAiCheck(key, check) {
  switch (key) {
    case 'vagueNames':
      return `${check.flaggedCount} lien(s)/bouton(s) portent un intitulé générique ("cliquez ici", "en savoir plus"...) qui ne permet de comprendre ni la destination ni l'action, même décrit par une IA de secours.`;
    case 'functionalIcons':
      return `${check.flaggedCount} icône(s) cliquable(s) (bouton/lien) n'ont aucun nom accessible : une IA peut décrire leur apparence mais pas l'action qu'elles déclenchent.`;
    case 'duplicateNames':
      return `${check.ambiguousCount} intitulé(s) sont utilisés pour plusieurs destinations/actions différentes, rendant leur distinction impossible pour un lecteur d'écran ou un agent naviguant par nom.`;
    default:
      return 'Vérification IA/agents échouée.';
  }
}

function describeMobileCheck(key, check) {
  switch (key) {
    case 'viewportMeta':
      if (!check.present) return "Balise <meta name=\"viewport\"> absente : le rendu mobile n'est pas garanti.";
      return 'Le zoom utilisateur est bloqué par la balise viewport (user-scalable=no ou maximum-scale trop faible), ce qui exclut les utilisateurs malvoyants.';
    case 'horizontalOverflow':
      return `Débordement horizontal détecté (${check.overflowPx}px) : le contenu ne s'adapte pas à la largeur de l'écran mobile.`;
    case 'touchTargets':
      return `${check.tooSmall} cible(s) tactile(s) sur ${check.total} sont plus petites que ${check.minRequiredPx}x${check.minRequiredPx}px.`;
    default:
      return 'Vérification mobile échouée.';
  }
}

/**
 * Agrège les scores de tous les viewports scannés en un score global.
 */
function aggregateScores(auditResult) {
  const perViewport = auditResult.results.map(scoreViewportResult);
  const globalScore = Math.round(
    perViewport.reduce((sum, r) => sum + r.score, 0) / perViewport.length
  );

  // Fusion des axes: on prend, pour chaque principe, la moyenne des viewports
  // où l'axe est pertinent.
  const axisScores = {};
  for (const principle of PRINCIPLES) {
    const relevant = perViewport.filter((r) => r.axisScores && principle in r.axisScores &&
      !(principle === 'Mobile' && r.viewport !== 'mobile'));
    if (relevant.length === 0) continue;
    axisScores[principle] = Math.round(
      relevant.reduce((sum, r) => sum + r.axisScores[principle], 0) / relevant.length
    );
  }

  const allIssues = perViewport.flatMap((r) => r.issues.map((i) => ({ ...i, viewport: r.viewport })));
  const sortedIssues = [...allIssues].sort((a, b) => {
    const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
    return (order[a.severity] ?? 4) - (order[b.severity] ?? 4);
  });

  return {
    url: auditResult.url,
    wcagLevel: auditResult.wcagLevel,
    scannedAt: auditResult.scannedAt,
    globalScore,
    perViewport,
    axisScores,
    issues: sortedIssues,
  };
}

module.exports = { aggregateScores, scoreViewportResult };
