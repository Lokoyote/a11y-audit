# a11y-audit

Outil automatisé d'audit d'accessibilité web (WCAG 2.0 / 2.1 / 2.2, niveaux A / AA / AAA), qui teste **une page en version desktop et mobile**, calcule un **score global sur 100** et liste des **axes d'amélioration priorisés** par sévérité.

## Ce qu'il vérifie

- **Moteur axe-core** (référence du marché, utilisé par Google, Microsoft, Deque) : contraste, ARIA, structure sémantique, formulaires, tableaux, etc. — couvre la quasi-totalité des critères WCAG testables automatiquement.
- **Vérifications complémentaires maison** :
  - Langue de la page (`lang`), titre de page, structure des titres (h1-h6)
  - Texte alternatif des images, labels de formulaire, repères de navigation (landmarks), lien d'évitement
  - **Navigation clavier réelle** : simulation de tabulations, détection de piège clavier, visibilité de l'indicateur de focus
- **Vérifications spécifiques mobile** :
  - Présence et bon paramétrage de la balise `<meta name="viewport">` (zoom non bloqué)
  - Absence de débordement horizontal (reflow)
  - Taille des cibles tactiles (≥ 44×44px, WCAG 2.5.5 / 2.5.8)

## Contrôles avancés (au-delà des outils officiels)

En complément d'axe-core (qui reste volontairement prudent pour éviter les faux positifs), l'outil inclut des **heuristiques expérimentales** qui couvrent des angles morts réels, absents de tous les scanners automatiques classiques (WAVE, Lighthouse, axe-core) :

- **Faux boutons** : `<div>`/`<span>` cliquables visuellement (curseur pointer) mais invisibles au clavier et aux lecteurs d'écran
- **Focus perdu après navigation interne** (SPA React/Vue/Angular) : le focus clavier retombe silencieusement sans repositionnement
- **Zoom texte à 200%** (WCAG 1.4.4) et **espacement du texte personnalisé** (WCAG 1.4.12) : le contenu ne doit ni se tronquer ni se chevaucher
- **Respect de `prefers-reduced-motion`** (WCAG 2.3.3) : les animations doivent réellement s'arrêter pour les personnes sensibles aux troubles vestibulaires

Ces contrôles sont signalés `[Heuristique avancée]` dans le rapport et peuvent produire de rares faux positifs — à vérifier manuellement en cas de doute.

## Axe "IA & Agents" (expérimental)

De plus en plus d'utilisateurs malvoyants s'appuient sur des IA en complément des lecteurs d'écran (Microsoft Seeing AI, Be My Eyes / "Be My AI", description d'image par IA intégrée à NVDA ou Chrome/Edge), et des agents IA de navigation naviguent parfois pour leur compte. Ces IA sont un **filet de secours**, pas une solution : elles devinent le contenu visuel d'un élément, jamais sa fonction. Un axe dédié vérifie donc les cas où ni un lecteur d'écran ni une IA ne peuvent compenser un manque d'information dans le code :

- **Intitulés vagues** ("cliquez ici", "en savoir plus"...) qui ne renseignent ni la destination ni l'action
- **Icônes cliquables sans nom accessible** : une IA peut décrire l'apparence ("une flèche"), jamais l'effet du clic
- **Intitulés dupliqués** pour des destinations différentes, rendant impossible la distinction par nom
- **Présence d'un `/llms.txt`** (standard émergent, informatif uniquement, n'affecte pas le score)

## Score et axes

- Un **score global (0-100)** par device (desktop / mobile) et un score global combiné.
- Un **score par axe**, basé sur les 4 principes WCAG (POUR) : Perceptible, Utilisable, Compréhensible, Robuste, + un axe **Mobile** dédié.
- Chaque problème est classé par **sévérité** (Critique / Élevée / Modérée / Mineure), avec description en français, nombre d'éléments concernés et lien vers la documentation du correctif.

⚠️ **Important** : un score élevé réduit le risque mais ne garantit pas la conformité totale. Environ 30-40% des critères WCAG nécessitent une vérification humaine (pertinence des alternatives textuelles, ordre de lecture logique, clarté du langage...). Cet outil est un complément à un audit manuel, pas un substitut.

## Installation automatique (recommandé)

**Linux / macOS :**
```bash
chmod +x install.sh
./install.sh
```

**Windows (PowerShell) :**
```powershell
.\install.ps1
```

Ces scripts font tout automatiquement :
1. Vérifient que Node.js 18+ est installé
2. Copient le projet vers un dossier dédié (`~/.local/share/a11y-audit` sur Linux/macOS, `%LOCALAPPDATA%\a11y-audit` sur Windows)
3. Installent les dépendances npm
4. Téléchargent le navigateur Chromium headless
5. Créent une **commande globale `a11y-audit`** utilisable depuis n'importe quel dossier

Une fois installé :
```bash
a11y-audit https://votre-site.fr
a11y-audit https://votre-site.fr --level AAA --out ./audits
```

### Désinstallation automatique

```bash
./uninstall.sh          # avec confirmation
./uninstall.sh --yes    # sans confirmation (utile en script)
```

```powershell
.\uninstall.ps1
.\uninstall.ps1 -Yes
```

Ces scripts suppriment intégralement le dossier d'installation et la commande globale, sans rien laisser derrière eux.

## Installation manuelle (alternative)

```bash
npm install
npx playwright install chromium   # télécharge le navigateur headless (nécessaire une seule fois)
```

## Utilisation

```bash
node index.js https://votre-site.fr
```

Options :

| Option           | Description                                              | Défaut       |
|------------------|------------------------------------------------------------|--------------|
| `--level <A\|AA\|AAA>` | Niveau de conformité WCAG ciblé                       | `AA`         |
| `--only <desktop\|mobile>` | Ne tester qu'un seul type d'appareil               | les deux     |
| `--out <dossier>`     | Dossier de sortie des rapports                        | `./rapports` |
| `--json-only`          | N'affiche que le JSON sur stdout (utile en CI)        | désactivé    |

Exemples :

```bash
# Audit complet niveau AA (recommandé pour la conformité légale, ex. RGAA/EAA en Europe)
node index.js https://mon-site.fr

# Audit exigeant niveau AAA
node index.js https://mon-site.fr --level AAA

# Mobile uniquement, sortie dans un dossier dédié
node index.js https://mon-site.fr --only mobile --out ./audits/juillet

# Intégration CI/CD (sortie JSON exploitable par script)
node index.js https://mon-site.fr --json-only > resultat.json
```

Chaque exécution génère :
- un **rapport HTML** autonome (ouvrable dans n'importe quel navigateur, aucune dépendance externe) avec score, barres par axe et tableau détaillé des problèmes ;
- un **rapport JSON** structuré, exploitable pour du reporting automatisé, un tableau de bord ou une intégration CI/CD (ex. faire échouer un pipeline si le score < seuil).

## Intégration CI/CD (exemple)

```bash
node index.js https://mon-site.fr --json-only > resultat.json
SCORE=$(node -e "console.log(require('./resultat.json').globalScore)")
if [ "$SCORE" -lt 80 ]; then
  echo "Score d'accessibilité insuffisant : $SCORE/100"
  exit 1
fi
```

## Architecture du projet

```
a11y-audit/
├── index.js                # CLI
├── lib/
│   ├── config.js            # Niveaux WCAG, poids de scoring, mapping des axes
│   ├── scan.js               # Orchestration Playwright + axe-core (desktop/mobile)
│   ├── customChecks.js       # Vérifs génériques (lang, titres, alt, labels, clavier...)
│   ├── mobileChecks.js       # Vérifs mobile (viewport meta, reflow, cibles tactiles)
│   ├── scorer.js             # Calcul du score global et par axe
│   └── report.js             # Génération des rapports HTML + JSON
└── package.json
```

## Limites connues

- Ne remplace pas un test utilisateur réel avec des technologies d'assistance (lecteurs d'écran type NVDA/JAWS/VoiceOver).
- Les contenus générés dynamiquement après interaction (modales, menus déroulants...) ne sont testés que si le script navigue jusqu'à eux — une évolution possible est d'ajouter un mode "parcours" (clic sur un menu, ouverture d'une modale, etc.).
- Le test se limite à une seule page par exécution ; pour un site entier, lancez l'outil sur chaque URL clé (accueil, formulaire de contact, tunnel d'achat...) ou scriptez une boucle sur une liste d'URLs.
