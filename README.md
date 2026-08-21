# Cursor Usage

Extension Cursor qui affiche l’usage de l’abonnement **dans la barre de statut**, à droite.

![Logo](media/icon.png)

## Ce que tu vois

| Élément | Détail |
| --- | --- |
| Anneau + pourcentage | Usage **Cursor Models** (Grok, Composer, etc.) |
| Survol | Usage **Autres modèles** |
| Couleur | Normale sous 70 %, orange dès 70 %, rouge dès 90 % |
| `…` | Premier chargement |
| `—` | Pas connecté, token illisible, ou API indisponible |

Mise à jour toutes les **60 secondes**.

## Installer

1. Ouvre Cursor.
2. Palette : **Extensions: Install from VSIX…**
3. Choisis `cursor-usage-0.0.2.vsix` (à la racine de ce dossier, après un `npm run package`).
4. Recharge la fenêtre (`Developer: Reload Window`).

Tu dois être **connecté à Cursor** sur cette machine.

### Prérequis

- Cursor (fork VS Code ≥ 1.85)
- **Python 3** dans le `PATH` (`py -3` ou `python`) — nécessaire pour lire `state.vscdb` quand la base est trop grosse pour sql.js

## Développement

```bash
npm install
npm run compile
npm run package
```

Puis installer le `.vsix` généré.

- `npm run watch` — recompile en continu
- `npm run build:icons` — régénère la police d’anneaux (`media/usage-rings.woff`)
- F5 — lancer **Run Extension** (hôte de développement)

## Comment ça marche

1. Lecture du token de session Cursor dans `state.vscdb` (clé `cursorAuth/accessToken`), en lecture seule. Le token n’est **jamais** stocké par l’extension.
2. Appel HTTPS à `https://api2.cursor.sh` (`GetCurrentPeriodUsage`).
3. Affichage de `autoPercentUsed` (Cursor Models) ; le tooltip utilise `apiPercentUsed` (autres modèles).

Il n’existe **pas d’API d’usage officielle**. Les endpoints et le format JSON peuvent changer et casser l’extension.

## Licence

Usage personnel. Non affilié à Cursor.
