# Mascotte Calcito

Déposer ici les images officielles PNG/WebP lorsqu’elles seront fournies.
Renseigner ensuite `mascotImages` dans `src/components/CalcitoMascot.jsx`, avec des chemins utilisant `import.meta.env.BASE_URL` (ex. `${import.meta.env.BASE_URL}images/mascot/nom-fourni.webp`).
Les variantes prévues sont `welcome`, `analysis`, `compare`, `empty` et `error`.
Aucune image fictive n’est demandée au serveur ; un pictogramme provisoire est affiché tant qu’aucun visuel n’est défini, et en cas d’échec de chargement.
