/**
 * Espace de stockage de l'appareil : chaque compte a ses propres clés (réglages, listes, synchro)
 * et sa propre base IndexedDB. Sans compte (mode local), on garde les anciens noms.
 */
let scope: string | null = null

export const getScope = () => scope
export const setScope = (userId: string | null) => {
  scope = userId && /^[0-9a-f-]{36}$/i.test(userId) ? userId : null
}

/** Nom de clé localStorage pour l'espace actif : « azuucine:lists » ou « azuucine:<id>:lists ». */
export const scopedKey = (name: string, userId: string | null = scope) => (userId ? `azuucine:${userId}:${name}` : `azuucine:${name}`)

/** Nom de la base IndexedDB pour un espace. */
export const dbNameFor = (userId: string | null = scope) => (userId ? `azuucine-${userId}` : 'azuucine')
