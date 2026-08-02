# a11y-audit

Outil automatisé d'audit d'accessibilité web (WCAG 2.0 / 2.1 / 2.2, niveaux A / AA / AAA), qui teste **une page en version desktop et mobile**, calcule un **score global sur 100** et liste des **axes d'amélioration priorisés** par sévérité.

Utilisable en ligne de commande (`a11y-audit`) ou via une **interface graphique locale** (`a11y-audit-gui`, ou l'icône « a11y-audit » du menu des applications) — voir [Interface graphique](#interface-graphique-recommandé-pour-les-non-développeurs).

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
- Un **score par axe**, basé sur les 4 principes WCAG (POUR) : Perceptible, Utilisable, Compréhensible, Robuste, + deux axes dédiés **Mobile** et **IA & Agents**. Le rapport HTML inclut une légende expliquant chaque axe et la façon dont le score est calculé (pénalités cumulées, pas un pourcentage d'éléments conformes).
- Chaque problème est classé par **sévérité** (Critique / Élevée / Modérée / Mineure), avec description en français, nombre d'éléments concernés et lien vers la documentation du correctif.
- Pour la plupart des problèmes, un bouton **« Voir où ça se trouve dans le code »** déplie le détail : sélecteur CSS, extrait de code source, et explication du point précis qui échoue — jusqu'à 5 éléments par problème. Les vérifications globales de page (langue, titre, repères de navigation absents...) n'ont pas de localisation précise puisqu'elles ne portent pas sur un élément particulier.

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
1. Vérifient que Node.js 18+ est installé (l'installent automatiquement sur Ubuntu/Debian si absent)
2. Copient le projet vers un dossier dédié (`~/.local/share/a11y-audit` sur Linux/macOS, `%LOCALAPPDATA%\a11y-audit` sur Windows)
3. Installent les dépendances npm
4. Téléchargent le navigateur Chromium headless
5. Créent une **commande globale `a11y-audit`** (CLI) et **`a11y-audit-gui`** (interface graphique), utilisables depuis n'importe quel dossier
6. Sur Linux, ajoutent une **icône « a11y-audit » dans le menu des applications** (double-clic, sans terminal — pratique si vous n'êtes pas à l'aise en ligne de commande)

Une fois installé :
```bash
a11y-audit https://votre-site.fr
a11y-audit https://votre-site.fr --level AAA --out ./audits
```

📁 **Vos rapports et parcours enregistrés sont conservés dans `~/a11y-audit-rapports`**, un dossier séparé du dossier d'installation — il n'est donc **pas** supprimé par `uninstall.sh`.

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

## Interface graphique (recommandé pour les non-développeurs)

Une alternative à la ligne de commande, pratique si vous n'êtes pas à l'aise avec le terminal : un serveur local avec une page web simple, sans dépendance supplémentaire.

```bash
a11y-audit-gui
# ou, sans installation préalable :
node server.js
```

Ça ouvre automatiquement `http://localhost:4173` dans votre navigateur, avec deux blocs :

1. **Enregistrer un parcours** *(optionnel)* — donnez une URL et un viewport, un vrai navigateur s'ouvre pour cliquer dans le site (voir [Enregistrer un parcours en cliquant](#enregistrer-un-parcours-en-cliquant-alternative-à-lécriture-manuelle) ci-dessous) ; le résultat est injecté automatiquement dans le formulaire d'audit une fois terminé. Un bouton **Annuler** permet de débloquer manuellement si besoin.
2. **Lancer un audit** — URLs (une par ligne), niveau WCAG (avec une explication de chaque niveau affichée sous le sélecteur), cibles desktop/mobile, et fichier de parcours (auto-rempli ou importé). Le rapport généré s'ouvre directement dans un nouvel onglet, sans souci d'accès fichier (les navigateurs installés en *snap*, comme Firefox par défaut sur Ubuntu récent, bloquent l'ouverture directe de fichiers HTML locaux situés sous un dossier caché — ce n'est pas un problème ici puisque le rapport est servi en HTTP).

Si l'interface est relancée (icône ou commande) alors qu'elle tourne déjà, l'instance précédente est automatiquement arrêtée et redémarrée avec le code actuellement sur le disque — pas besoin de la fermer manuellement au préalable.

## Utilisation

```bash
node index.js https://votre-site.fr
```

**Plusieurs URLs en une seule commande** (accueil, formulaire de contact, tunnel d'achat...) — chaque URL garde son propre rapport, et une page de synthèse les relie entre elles :

```bash
node index.js https://mon-site.fr https://mon-site.fr/contact https://mon-site.fr/panier
# ou depuis un fichier, une URL par ligne (les lignes commençant par # sont ignorées)
node index.js --urls-file mes-urls.txt
```

À la fin de l'exécution, le rapport se **ouvre automatiquement dans le navigateur par défaut** : le rapport unique s'il n'y a qu'une URL, ou la page de synthèse (`index.html`) si plusieurs URLs ont été testées — celle-ci liste chaque site avec son score et un lien vers son rapport détaillé. Une **barre de progression** s'affiche pendant l'analyse (un audit prend du temps : chargement de la page, axe-core, vérifications clavier, checks mobile...).

Options :

| Option                       | Description                                                  | Défaut       |
|------------------------------|---------------------------------------------------------------|--------------|
| `--level <A\|AA\|AAA>`        | Niveau de conformité WCAG ciblé                               | `AA`         |
| `--only <desktop\|mobile>`    | Ne tester qu'un seul type d'appareil                          | les deux     |
| `--out <dossier>`             | Dossier de sortie des rapports                                | `./rapports` |
| `--urls-file <fichier>`       | Liste d'URLs à auditer, une par ligne                         | —            |
| `--parcours <fichier>`        | Scénario d'interaction par URL (voir ci-dessous)              | —            |
| `--no-open`                   | N'ouvre pas automatiquement le rapport à la fin               | désactivé    |
| `--json-only`                 | N'affiche que le JSON sur stdout (utile en CI)                | désactivé    |

Exemples :

```bash
# Audit complet niveau AA (recommandé pour la conformité légale, ex. RGAA/EAA en Europe)
node index.js https://mon-site.fr

# Audit exigeant niveau AAA
node index.js https://mon-site.fr --level AAA

# Mobile uniquement, sortie dans un dossier dédié
node index.js https://mon-site.fr --only mobile --out ./audits/juillet

# Plusieurs pages clés d'un même site, sans ouverture automatique
node index.js https://mon-site.fr https://mon-site.fr/contact --no-open

# Intégration CI/CD (sortie JSON exploitable par script)
node index.js https://mon-site.fr --json-only > resultat.json
```

Chaque URL analysée génère :
- un **rapport HTML** autonome (ouvrable dans n'importe quel navigateur, aucune dépendance externe) avec score, barres par axe et tableau détaillé des problèmes ;
- un **rapport JSON** structuré, exploitable pour du reporting automatisé, un tableau de bord ou une intégration CI/CD (ex. faire échouer un pipeline si le score < seuil).

Lorsque plusieurs URLs sont testées, les rapports sont rangés dans un dossier `audit-<horodatage>/sites/<url>/`, accompagnés d'un `index.html` de synthèse à la racine.

## Mode "parcours" (scénarios d'interaction)

Certains contenus n'apparaissent qu'après une interaction (menu déroulant, modale, onglet...) et ne sont jamais vus par un scan de la page telle qu'elle se charge. Le mode parcours rejoue une suite d'actions sur la page **desktop**, capture un **aperçu visuel (screenshot)** après chaque étape, et relance axe-core aux étapes marquées `"audit": true` pour analyser le contenu réellement affiché à ce moment-là.

Créez un fichier JSON (ex. `parcours.json`) qui associe chaque URL à sa liste d'étapes :

```json
{
  "https://mon-site.fr": [
    { "type": "click", "selector": "#menu-burger", "label": "Ouvrir le menu principal", "audit": true },
    { "type": "wait", "ms": 300 },
    { "type": "click", "selector": ".contact-modal-trigger", "label": "Ouvrir la modale de contact", "audit": true },
    { "type": "press", "key": "Escape" }
  ]
}
```

Puis lancez :

```bash
node index.js https://mon-site.fr --parcours parcours.json
```

Étapes disponibles :

| Type              | Champs                          | Effet                                      |
|-------------------|----------------------------------|---------------------------------------------|
| `click`           | `selector`, `timeout?`           | Clique sur l'élément                        |
| `fill`            | `selector`, `value`, `timeout?`  | Remplit un champ de formulaire              |
| `press`           | `key`                            | Appuie sur une touche clavier (ex. `Escape`) |
| `hover`           | `selector`, `timeout?`           | Survole un élément                          |
| `wait`            | `ms`                             | Attend une durée fixe                       |
| `waitForSelector` | `selector`, `timeout?`           | Attend qu'un élément apparaisse             |
| `goto`            | `url`                            | Navigue vers une autre URL                  |

Chaque étape accepte aussi `label` (texte affiché dans le rapport et la barre de progression) et `audit: true` (relance axe-core dans l'état affiché). Le rapport HTML affiche ensuite une section **"Aperçu du parcours"** : une "pellicule" de captures d'écran, une par étape, avec le résultat du mini-audit quand il a été demandé.

### Enregistrer un parcours en cliquant (alternative à l'écriture manuelle)

Plutôt que d'écrire le JSON à la main, `--record` ouvre un vrai navigateur (visible) sur l'URL choisie, dans le viewport souhaité :

```bash
node index.js --record https://mon-site.fr --record-viewport mobile --record-out parcours.json
```

Cliquez ensuite directement dans la page : un menu apparaît pour choisir l'action (clic, remplissage de champ, survol, attente d'un élément), demande un libellé et si l'étape doit relancer axe-core (`audit: true`). L'action est ensuite réellement rejouée pour que vous puissiez continuer à naviguer normalement (ouvrir un menu, valider un formulaire...). Un bandeau en haut de la page permet de terminer et sauvegarder :

| Option                  | Description                                          | Défaut          |
|--------------------------|-------------------------------------------------------|-----------------|
| `--record <url>`         | Lance l'enregistrement sur cette URL                  | —               |
| `--record-viewport <v>`  | `desktop` \| `tablette` \| `mobile`                    | `desktop`       |
| `--record-out <fichier>` | Fichier `--parcours` où sauvegarder (fusionné si existant) | `./parcours.json` |

Le fichier généré est **directement réutilisable** avec `--parcours` comme montré plus haut. C'est volontairement basé sur des boîtes de dialogue simples (`prompt`/`confirm`) plutôt qu'une interface plus élaborée — cohérent avec l'esprit "base simple" de l'outil ; à améliorer plus tard si besoin (édition des étapes, réordonnancement...).

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
├── index.js                # CLI (multi-URL, barre de progression, ouverture auto)
├── server.js                # Serveur de l'interface graphique (http://localhost:4173)
├── public/                  # Frontend de l'interface graphique
│   ├── index.html
│   ├── app.js
│   └── style.css
├── lib/
│   ├── config.js            # Niveaux WCAG, poids de scoring, mapping des axes
│   ├── scan.js               # Orchestration Playwright + axe-core (desktop/mobile)
│   ├── customChecks.js       # Vérifs génériques (lang, titres, alt, labels, clavier...)
│   ├── advancedChecks.js     # Heuristiques avancées (faux boutons, focus après nav, zoom 200%, reduced-motion)
│   ├── mobileChecks.js       # Vérifs mobile (viewport meta, reflow, cibles tactiles)
│   ├── aiAgentChecks.js      # Axe "IA & Agents" (intitulés vagues, icônes sans nom, doublons)
│   ├── parcours.js           # Mode parcours : interactions scriptées + captures d'écran
│   ├── recorder.js           # Enregistrement de parcours en cliquant (--record)
│   ├── progress.js           # Barre de progression CLI (sans dépendance)
│   ├── opener.js             # Ouverture cross-plateforme du rapport dans le navigateur
│   ├── scorer.js             # Calcul du score global et par axe, détail des localisations
│   └── report.js             # Génération des rapports HTML + JSON + synthèse multi-URL
└── package.json
```

## Limites connues

- Ne remplace pas un test utilisateur réel avec des technologies d'assistance (lecteurs d'écran type NVDA/JAWS/VoiceOver).
- Le parcours ne s'exécute que sur le viewport desktop, pour limiter le temps d'analyse.
- Les heuristiques `[Heuristique avancée]` et l'axe "IA & Agents" sont expérimentaux et peuvent produire de rares faux positifs — à vérifier manuellement en cas de doute.
