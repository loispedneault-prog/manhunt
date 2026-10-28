# MAN HUNT

Web app de chasse à l'homme pour jouer entre amis dans le quartier (iPhone et Android, rien à installer).

- Carte en direct, zone de jeu dessinée, prison, pings périodiques, suivi en direct hors zone
- Pouvoirs (révélation, révélation secrète, brouillage), défis sur la carte, walkie-talkie, SOS
- Backend : Supabase (base de données, temps réel, stockage). Toutes les règles sont arbitrées côté serveur.

## Développement

```bash
npm install
npm run dev
```

Ajoute `?sim` à l'URL pour placer ta position en touchant la carte, et `?p=2` (3, 4…) pour simuler plusieurs joueurs dans le même navigateur.

Mettre en ligne une nouvelle version : `npm run deploy` (publie `dist/` sur la branche `gh-pages`).
