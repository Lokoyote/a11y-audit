'use strict';

/**
 * Tags axe-core à inclure selon le niveau de conformité WCAG visé.
 * axe-core couvre WCAG 2.0 / 2.1 / 2.2 (A, AA, AAA) + bonnes pratiques.
 */
const AXE_TAGS = {
  A: ['wcag2a', 'wcag21a', 'wcag22a'],
  AA: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'],
  AAA: [
    'wcag2a', 'wcag2aa', 'wcag2aaa',
    'wcag21a', 'wcag21aa',
    'wcag22a', 'wcag22aa',
  ],
};

/**
 * Pénalité de score appliquée par violation détectée, selon la sévérité
 * (impact) rapportée par axe-core. Valeurs volontairement conservatrices :
 * un audit ne doit pas s'effondrer à 0 au premier problème mineur.
 */
const IMPACT_WEIGHTS = {
  critical: 8,
  serious: 5,
  moderate: 2.5,
  minor: 1,
};

/**
 * Mapping (approximatif mais standard dans l'industrie) des catégories
 * internes d'axe-core vers les 4 principes WCAG : Perceptible, Utilisable,
 * Compréhensible, Robuste (POUR).
 */
const CATEGORY_TO_PRINCIPLE = {
  'cat.color': 'Perceptible',
  'cat.text-alternatives': 'Perceptible',
  'cat.sensory-and-visual-cues': 'Perceptible',
  'cat.time-and-media': 'Perceptible',
  'cat.tables': 'Perceptible',
  'cat.structure': 'Perceptible',
  'cat.keyboard': 'Utilisable',
  'cat.timing': 'Utilisable',
  'cat.semantics': 'Compréhensible',
  'cat.forms': 'Compréhensible',
  'cat.language': 'Compréhensible',
  'cat.parsing': 'Robuste',
  'cat.aria': 'Robuste',
  'cat.name-role-value': 'Robuste',
};

const PRINCIPLES = ['Perceptible', 'Utilisable', 'Compréhensible', 'Robuste', 'Mobile', 'IA & Agents'];

/** Taille minimale recommandée (px CSS) pour une cible tactile (WCAG 2.5.5 / 2.5.8). */
const MIN_TOUCH_TARGET_PX = 44;

/** Nombre de tabulations simulées pour le test de navigation clavier. */
const KEYBOARD_TAB_STEPS = 25;

module.exports = {
  AXE_TAGS,
  IMPACT_WEIGHTS,
  CATEGORY_TO_PRINCIPLE,
  PRINCIPLES,
  MIN_TOUCH_TARGET_PX,
  KEYBOARD_TAB_STEPS,
};
