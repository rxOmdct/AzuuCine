/**
 * Mot de passe déjà apparu dans une fuite de données ? (base publique Have I Been Pwned)
 *
 * k-anonymat : seuls les 5 premiers caractères de l'empreinte SHA-1 du mot de passe sont envoyés ;
 * le service renvoie toutes les empreintes qui commencent pareil (avec du remplissage aléatoire)
 * et la comparaison se fait ici. Le mot de passe, et même son empreinte complète, ne quittent jamais l'appareil.
 *
 * Remplace l'option payante « Prevent use of leaked passwords » de Supabase.
 * En cas de panne réseau, on laisse passer (la longueur minimale reste vérifiée).
 */
export async function isPwnedPassword(password: string): Promise<boolean> {
  try {
    const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password))
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
    const prefix = hex.slice(0, 5)
    const suffix = hex.slice(5)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 5000)
    try {
      const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
        headers: { 'Add-Padding': 'true' },
        signal: ctrl.signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      })
      if (!res.ok) return false
      const text = await res.text()
      for (const line of text.split('\n')) {
        const [s, count] = line.trim().split(':')
        // Les lignes de remplissage ont un compteur à 0
        if (s === suffix && Number(count) > 0) return true
      }
      return false
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return false
  }
}
