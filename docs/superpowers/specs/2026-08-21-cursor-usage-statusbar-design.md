# Cursor Usage Status Bar — Design

Date : 2026-08-21  
Statut : en revue  
Portée : une extension Cursor qui affiche le **pourcentage d’usage de l’abonnement** dans la barre de statut, à droite.

## Objectif

Voir d’un coup d’œil combien de l’abonnement Cursor est déjà consommé, sans ouvrir le dashboard et sans quitter l’éditeur.

Succès : après installation du `.vsix` dans Cursor (session déjà connectée), un texte du type `18%` apparaît à droite de la barre de statut et se met à jour toutes les minutes.

## Hors scope

- Tooltip, couleurs d’alerte, commandes, panneau, settings UI
- Publication Marketplace / Open VSX
- Token collé à la main
- Tests automatisés (demande explicite)

## Contraintes

- Cursor n’expose pas d’API d’usage officielle et stable. L’extension lit le token de session local et appelle des endpoints internes. Ils peuvent changer sans préavis.
- Le token n’est jamais stocké par l’extension : lu sur disque à chaque refresh, envoyé uniquement en HTTPS vers `https://api2.cursor.sh`.
- L’extension ne doit pas faire planter l’éditeur. Les erreurs se traduisent par `—` (ou le dernier pourcentage connu). Pas de popup.

## Architecture

Extension VS Code/Cursor en TypeScript, activation `onStartupFinished`.

Trois modules :

| Module | Rôle | Dépendances |
| --- | --- | --- |
| `auth` | Chemin de `state.vscdb` + lecture de `cursorAuth/accessToken` | `sql.js` (SQLite en lecture, sans binaire natif) |
| `usage` | Appels API + calcul du pourcentage entier 0–100 | `auth` (token), `https` |
| `statusBar` | Item de barre de statut + timer 60 s | `usage` |

Point d’entrée `extension.ts` : crée la barre, lance un refresh immédiat, pose le timer, dispose le tout au `deactivate`.

## Affichage

- Item `StatusBarAlignment.Right`. L’API VS Code ne permet pas de se coller exactement à la cloche Cursor ; l’item vit dans le groupe de droite de la barre de statut.
- Textes possibles :
  - chargement initial : `…`
  - succès : `{n}%` (entier, ex. `18%`)
  - indisponible : `—`
- Pas de tooltip, pas de commande au clic, pas de couleur d’alerte.

## Flux de données

Toutes les **60 secondes**, et une fois tout de suite au démarrage :

1. Lire le token dans `ItemTable` clé `cursorAuth/accessToken`.
   - Windows : `%APPDATA%\Cursor\User\globalStorage\state.vscdb`
   - macOS : `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb`
   - Linux : `~/.config/Cursor/User/globalStorage/state.vscdb`
2. `POST https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage`  
   Body `{}`. Headers : `Authorization: Bearer <token>`, `Content-Type: application/json`, `Connect-Protocol-Version: 1`. Timeout 10 s.
3. Extraire un pourcentage (voir ci-dessous). Si inexploitable : `GET https://api2.cursor.sh/auth/usage` (même Bearer). Prendre le bucket `gpt-4` s’il a `numRequests` et `maxRequestUsage` ; sinon le premier objet avec `used/limit` (ou `numRequests`/`maxRequestUsage`).
4. Afficher `round(percent)%`.

### Calcul du pourcentage

Ordre strict, on s’arrête au premier résultat valide :

1. `planUsage.totalPercentUsed` si c’est un nombre fini (c’est le % dashboard Cursor).
2. Sinon `round(used / limit * 100)` avec `limit > 0`, où :
   - `used` = `planUsage.includedSpend` si présent, sinon `limit - remaining` si les deux existent, sinon `planUsage.totalSpend`
   - `limit` = `planUsage.limit`
3. Sinon même formule sur un bucket de `/auth/usage`.
4. Sinon : pas de valeur.

Le résultat est borné à `[0, 100]`, puis arrondi à l’entier le plus proche.

## Erreurs

| Situation | Affichage |
| --- | --- |
| Pas de fichier DB, pas de token, 401/403 | `—` |
| Réseau / timeout / HTTP non-OK / JSON inattendu | dernier `%` connu ; sinon `—` |
| Limite absente ou `<= 0` | `—` |

Logs `console` génériques uniquement (jamais le token, jamais le chemin complet si évitable). Pas de `showInformationMessage` / `showErrorMessage`.

## Fichiers prévus

```
package.json
tsconfig.json
src/extension.ts
src/auth.ts
src/usage.ts
src/statusBar.ts
```

`package.json` : `engines.vscode` compatible Cursor, activation `onStartupFinished`, pas de contribution `commands` / `configuration`.

## Vérification (manuelle)

1. `npm install` puis compiler / packager le `.vsix`.
2. Dans Cursor : Extensions → Install from VSIX.
3. Relancer si besoin. La barre à droite montre `…` puis un pourcentage, ou `—` si non connecté.
4. Attendre ~1 minute : le chiffre peut changer (ou rester identique si l’API cache).
5. Se déconnecter de Cursor : au cycle suivant, `—`.

## Risques

Les endpoints et formes JSON sont non documentés. Un changement côté Cursor casse le parsing. Le correctif sera de réaligner `usage.ts` sur la nouvelle forme, pas d’ajouter une UI.
