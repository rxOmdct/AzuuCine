/**
 * Images TMDB à la bonne taille : TMDB sert chaque image en plusieurs largeurs
 * (…/t/p/w780/xxx.jpg, …/w1280/…, …/original/…). On choisit selon l'écran au lieu
 * d'étirer une petite image (bannières floues sur ordinateur).
 */
const TMDB_SIZED = /^(https:\/\/image\.tmdb\.org\/t\/p\/)(w\d{2,4}|original)(\/[A-Za-z0-9_-]{1,100}\.(?:jpg|jpeg|png|webp))$/i

/** Même image TMDB dans une autre largeur (autres images : inchangées). */
export function tmdbSized(url: string | undefined, size: 'w300' | 'w780' | 'w1280' | 'original'): string | undefined {
  const m = url && TMDB_SIZED.exec(url)
  return m ? `${m[1]}${size}${m[3]}` : url
}

/** srcset d'une grande image de fond : le navigateur prend la plus petite qui reste nette. */
export function backdropSrcSet(url: string | undefined): string | undefined {
  if (!url || !TMDB_SIZED.test(url)) return undefined
  return `${tmdbSized(url, 'w780')} 780w, ${tmdbSized(url, 'w1280')} 1280w, ${tmdbSized(url, 'original')} 1920w`
}
