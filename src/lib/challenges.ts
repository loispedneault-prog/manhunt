// Tasks to perform once a player reaches a challenge point. Kept short: they're read in the dark, mid-chase.
export const CHALLENGE_TEXTS = [
  'Prends un selfie avec la décoration d’Halloween la plus effrayante du coin.',
  'Fais 15 jumping jacks sur place sans t’arrêter.',
  'Crie « IL ARRIVE ! » le plus fort possible.',
  'Reste immobile 30 secondes, les yeux fermés.',
  'Trouve une citrouille et prends-la en photo.',
  'Fais 10 pompes. Maintenant.',
  'Envoie un vocal de ton plus beau rire de méchant dans le walkie.',
  'Prends une photo d’une boîte aux lettres en faisant une grimace.',
  'Fais le tour complet d’un poteau électrique 3 fois en courant.',
  'Chante le refrain d’une chanson d’horreur (ou n’importe laquelle).',
  'Prends une photo de ton ombre la plus inquiétante.',
  'Trouve un objet rouge et garde-le jusqu’à la fin de la partie.',
  'Fais 20 squats en comptant à voix haute.',
  'Compte jusqu’à 60 caché derrière un arbre sans bouger.',
  'Imite un zombie pendant 20 secondes.',
  'Trouve une lumière de porche allumée et prends-la en photo.',
  'Fais une planche de 30 secondes.',
  'Prends un selfie avec un panneau d’arrêt.',
  'Marche à reculons sur 20 pas.',
  'Écris ton initiale avec un bâton par terre et prends-la en photo.',
  'Trouve une feuille d’érable parfaite et garde-la.',
  'Fais 3 sprints de 10 mètres aller-retour.',
  'Prends une photo d’une fenêtre éteinte. Rien ne bouge… vraiment ?',
  'Murmure « je te vois » dans le walkie.',
]

export function pickTexts(n: number, avoid: string[] = []): string[] {
  const pool = CHALLENGE_TEXTS.filter(t => !avoid.includes(t))
  const out: string[] = []
  const src = pool.length >= n ? [...pool] : [...CHALLENGE_TEXTS]
  while (out.length < n && src.length) out.push(src.splice(Math.floor(Math.random() * src.length), 1)[0])
  while (out.length < n) out.push(CHALLENGE_TEXTS[Math.floor(Math.random() * CHALLENGE_TEXTS.length)])
  return out
}
