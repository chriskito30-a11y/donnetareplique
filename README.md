# Atelier de répliques

PWA originale de répétition théâtrale, sans compte, Firebase, API ni base distante. Les textes, réglages, repères et enregistrements restent dans **IndexedDB sur cet appareil**. Les imports TXT, PDF textuel et DOCX, la sauvegarde ZIP et les lectures audio sont traités dans le navigateur. Aucun code ou média de l'application Android étudiée n'est utilisé.

La répétition affiche **toutes les répliques en liste sur PC et mobile**. Les retours à la ligne d'une même réplique importée sont réunis jusqu'au prochain personnage, à vérifier dans l'aperçu. Les parenthèses et le texte italique reconnu dans les DOCX ou certains PDF sont des didascalies : ils restent visibles, et la lecture vocale les ignore par défaut. Le réglage « Lire les didascalies » permet de les inclure.

Le modèle Piper français intégré propose **125 locuteurs** attribuables aux personnages, même si le navigateur n'expose qu'une seule voix système. Il ajoute environ 100 Mo aux fichiers à charger et au cache hors ligne. Voir [THIRD_PARTY.md](THIRD_PARTY.md) pour la provenance et les licences. Whisper n'est pas inclus : il sert à transcrire, pas à créer des voix.

## Ouvrir sur ce PC

Après compilation, double-cliquez sur [`OUVRIR_WEBAPP.cmd`](OUVRIR_WEBAPP.cmd) dans ce dossier. Une fenêtre de commande sert l'application uniquement sur `127.0.0.1` et ouvre le navigateur à `http://127.0.0.1:4173/`. Gardez cette fenêtre ouverte pendant l'utilisation ; la fermer arrête le serveur local. Cette ouverture ne transmet aucun texte ni son à Internet.

L'ouverture directe de `webapp/index.html` ou de `webapp/dist/index.html` avec `file://` ne lance pas la PWA : les modules JavaScript, le service worker, IndexedDB selon le navigateur et le microphone demandent une origine locale sûre. La page affiche désormais cette explication au lieu de rester vide.

## Recompiler ou développer

Prérequis : Node.js 22 et npm. Depuis ce dossier :

```powershell
npm ci --ignore-scripts
npm run build
npm run preview
```

Ouvrir l'adresse `http://127.0.0.1:4173/` indiquée par Vite. `npm ci` sert uniquement à récupérer les dépendances de construction épinglées dans `package-lock.json` ; les scripts d'installation des paquets sont désactivés. Le dossier `dist/` produit par la compilation contient toute l'application statique, y compris PDF.js et Mammoth. Le lanceur Windows utilise Node.js directement pour servir ce dossier, sans Vite ni connexion réseau. Pour développer : `npm run dev`.

Une PWA ne fonctionne pas directement depuis `file://` : le service worker et le microphone demandent une **origine sûre** (`localhost` ou HTTPS). Sur iPhone/Android, servir `dist/` en HTTPS depuis une machine locale du réseau, puis ajouter la page à l'écran d'accueil. Après une première ouverture complète et l'activation du cache, la PWA peut être rouverte sans réseau tant que le navigateur conserve ses données. Le serveur ne traite aucun projet ; il ne sert que les fichiers statiques pour la première installation ou une mise à jour. Aucun hébergement ni service externe n'est nécessaire à l'usage.

## Utilisation

1. Créer un projet ou importer/coller un texte. Vérifier les personnages et répliques proposés ; les PDF scannés sans couche texte ne sont pas lus.
2. Préparer les scènes, personnages, répliques et, si souhaité, enregistrer ou importer une prise audio pour une réplique.
3. Choisir son rôle et répéter : lecture des autres personnages, attente manuelle ou temporisée, indices, texte caché, initiales, masquage progressif, navigation, plage et boucle.
4. Exporter régulièrement chaque projet en ZIP avec ses enregistrements depuis **Réglages et données**. La restauration crée un nouveau projet. Un export TXT est également proposé.

La synthèse vocale utilise exclusivement les voix que le navigateur marque `localService=true`. Leur présence dépend de l'appareil ; l'application peut toujours lire des enregistrements ou avancer visuellement en silence. Aucune voix n'est téléchargée par la PWA. La prise micro dépend de l'autorisation et des codecs du navigateur ; l'import audio local sert de repli.

## Vérification effectuée

`npm run build` a réussi. Avec `npm run preview` actif, `npm test` lance les trois parcours `tests/e2e.mjs`, `tests/imports.mjs` et `tests/recording.mjs` avec Chrome local installé dans `C:\Program Files\Google\Chrome\Application\chrome.exe`. Ils ont validé persistance et réouverture hors ligne, export/restauration, import TXT/PDF/DOCX, enregistrement et relecture après fermeture. Ils n'ont pas encore été exécutés sur iPhone ou Android réel. Le test micro utilise une source audio simulée de Chrome. Les tests ne contactent aucun domaine extérieur.

Les PDF à colonnes, les DOCX complexes, le stockage évincé par le navigateur, les voix locales disponibles et l'audio en arrière-plan doivent être vérifiés sur les appareils visés. La transcription vocale et l'OCR ne sont pas inclus. Le rapport technique est dans [`../ANALYSE_SCRIPT_REHEARSER.md`](../ANALYSE_SCRIPT_REHEARSER.md) et le plan dans [`../PLAN_WEBAPP_AUTONOME.md`](../PLAN_WEBAPP_AUTONOME.md).
