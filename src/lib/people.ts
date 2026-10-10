import { t } from '../i18n'
import { ANILIST, ANILIST_FIELDS, aniToResult, tmdbFetch, tmdbToResult, TMDB_IMG, type AniMedia, type SearchResult, type TmdbItem } from './catalogApi'
import { cleanText, isSafeTmdbPath, safePosterUrl } from './security'

/**
 * Acteurs, réalisateurs, doubleurs… : recherche et filmographie.
 * Identifiants : « tmdbp:123 » (TMDB, films et séries) ou « anilistp:123 » (AniList, animes : doubleurs et staff).
 */

export interface PersonHit {
  id: string
  name: string
  photo?: string
  /** Métier principal, déjà traduit (« Acteur·rice », « Réalisation »…) */
  department?: string
  /** Quelques titres connus, pour reconnaître la personne */
  knownFor: string[]
}

/** Rubrique d'un crédit (filtre de la page personne). */
export type CreditGroup = 'acting' | 'voice' | 'directing' | 'writing' | 'production' | 'other'
export const CREDIT_GROUPS: CreditGroup[] = ['acting', 'voice', 'directing', 'writing', 'production', 'other']

export interface PersonCredit {
  result: SearchResult
  group: CreditGroup
  /** Personnage joué, ou poste (« Réalisateur », « Scénario »…) */
  role?: string
  year?: number
  popularity: number
}

export interface PersonDetails {
  id: string
  name: string
  photo?: string
  bio?: string
  birthday?: string
  deathday?: string
  place?: string
  department?: string
  /** Rubrique à montrer d'abord (le métier principal) */
  mainGroup: CreditGroup
  credits: PersonCredit[]
}

export const isPersonId = (id: unknown): id is string => typeof id === 'string' && /^(tmdbp|anilistp):\d{1,10}$/.test(id)

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined)

function departmentGroup(dep?: string | null): CreditGroup {
  switch (dep) {
    case 'Acting':
      return 'acting'
    case 'Directing':
      return 'directing'
    case 'Writing':
      return 'writing'
    case 'Production':
      return 'production'
    default:
      return 'other'
  }
}

export const groupLabel = (g: CreditGroup) => t(`person.group.${g}`)

// ─────────────────────────── Recherche ───────────────────────────

interface TmdbPersonHit {
  id?: number
  name?: string
  profile_path?: string | null
  known_for_department?: string
  known_for?: TmdbItem[]
  popularity?: number
}

async function searchTmdbPeople(query: string, key: string): Promise<PersonHit[]> {
  const data = await tmdbFetch<{ results?: TmdbPersonHit[] }>('/search/person', key, { query: query.slice(0, 100), include_adult: 'false' })
  return (Array.isArray(data.results) ? data.results : [])
    .slice(0, 12)
    .map((p): PersonHit | null => {
      const name = cleanText(p.name, 80)
      if (!name || !Number.isInteger(p.id)) return null
      return {
        id: `tmdbp:${p.id}`,
        name,
        photo: isSafeTmdbPath(p.profile_path) ? `${TMDB_IMG}/w185${p.profile_path}` : undefined,
        department: groupLabel(departmentGroup(p.known_for_department)),
        knownFor: (Array.isArray(p.known_for) ? p.known_for : [])
          .map((k) => cleanText(k.title ?? k.name, 60))
          .filter((x): x is string => !!x)
          .slice(0, 3),
      }
    })
    .filter((p): p is PersonHit => p !== null)
}

async function aniQuery<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(ANILIST, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
    referrerPolicy: 'no-referrer',
    credentials: 'omit',
  })
  if (res.status === 429) throw new Error(t('err.anilistRate'))
  if (!res.ok) throw new Error(t('err.anilistStatus', { status: res.status }))
  return ((await res.json()) as { data?: T }).data ?? ({} as T)
}

interface AniStaffHit {
  id?: number
  name?: { full?: string | null } | null
  image?: { medium?: string | null } | null
  primaryOccupations?: string[] | null
  characterMedia?: { nodes?: { title?: { english?: string | null; romaji?: string | null } }[] } | null
  staffMedia?: { nodes?: { title?: { english?: string | null; romaji?: string | null } }[] } | null
}

async function searchAniPeople(query: string): Promise<PersonHit[]> {
  const data = await aniQuery<{ Page?: { staff?: AniStaffHit[] } }>(
    `query ($s: String) { Page(perPage: 6) { staff(search: $s, sort: [SEARCH_MATCH, FAVOURITES_DESC]) {
      id name { full } image { medium } primaryOccupations
      characterMedia(perPage: 3, sort: POPULARITY_DESC) { nodes { title { english romaji } } }
      staffMedia(perPage: 3, sort: POPULARITY_DESC, type: ANIME) { nodes { title { english romaji } } }
    } } }`,
    { s: query.slice(0, 100) },
  )
  return (Array.isArray(data.Page?.staff) ? data.Page!.staff! : [])
    .map((p): PersonHit | null => {
      const name = cleanText(p.name?.full, 80)
      if (!name || !Number.isInteger(p.id)) return null
      const occ = (p.primaryOccupations ?? []).join(' ')
      const media = [...(p.characterMedia?.nodes ?? []), ...(p.staffMedia?.nodes ?? [])]
      return {
        id: `anilistp:${p.id}`,
        name,
        photo: safePosterUrl(p.image?.medium),
        department: /voice/i.test(occ) ? groupLabel('voice') : /director/i.test(occ) ? groupLabel('directing') : t('person.animeStaff'),
        knownFor: [...new Set(media.map((m) => cleanText(m.title?.english || m.title?.romaji, 60)).filter((x): x is string => !!x))].slice(0, 3),
      }
    })
    .filter((p): p is PersonHit => p !== null)
}

const foldName = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/** Acteurs, réalisateurs (TMDB) et doubleurs / staff d'animes (AniList), sans doublon de nom. */
export async function searchPeople(query: string, tmdbKey?: string): Promise<PersonHit[]> {
  const [tm, an] = await Promise.allSettled([tmdbKey ? searchTmdbPeople(query, tmdbKey) : Promise.resolve([]), searchAniPeople(query)])
  if (tm.status === 'rejected' && an.status === 'rejected') throw tm.reason
  const tmdb = tm.status === 'fulfilled' ? tm.value : []
  const seen = new Set(tmdb.map((p) => foldName(p.name)))
  const ani = (an.status === 'fulfilled' ? an.value : []).filter((p) => !seen.has(foldName(p.name)))
  return [...tmdb, ...ani]
}

// ─────────────────────────── Page d'une personne ───────────────────────────

interface TmdbCredit extends TmdbItem {
  character?: string
  job?: string
  department?: string
  episode_count?: number
}

interface TmdbPerson {
  name?: string
  biography?: string
  birthday?: string | null
  deathday?: string | null
  place_of_birth?: string | null
  profile_path?: string | null
  known_for_department?: string
  combined_credits?: { cast?: TmdbCredit[]; crew?: TmdbCredit[] }
}

// Postes TMDB (en anglais) les plus courants, traduits
const JOBS: Record<string, string> = {
  Director: 'person.job.director',
  Screenplay: 'person.job.screenplay',
  Writer: 'person.job.writer',
  Story: 'person.job.story',
  Novel: 'person.job.novel',
  Creator: 'person.job.creator',
  Producer: 'person.job.producer',
  'Executive Producer': 'person.job.execProducer',
  'Original Music Composer': 'person.job.composer',
  'Director of Photography': 'person.job.dop',
  Editor: 'person.job.editor',
}
const jobLabel = (job?: string) => (job && JOBS[job] ? t(JOBS[job] as Parameters<typeof t>[0]) : job)

// Talk-shows, journaux, cérémonies : pas des « rôles »
const NOT_A_ROLE = /^(self|himself|herself|themselves|host|narrator \(voice\)|lui-même|elle-même)\b/i
const TALK_GENRES = new Set([10767, 10763])

async function tmdbPerson(id: string, key: string): Promise<PersonDetails> {
  const pid = id.split(':')[1]
  const d = await tmdbFetch<TmdbPerson>(`/person/${pid}`, key, { append_to_response: 'combined_credits' })
  let bio = cleanText(d.biography, 4000)
  // Pas de biographie dans la langue de l'app : on prend l'anglaise
  if (!bio) bio = cleanText((await tmdbFetch<TmdbPerson>(`/person/${pid}`, key, { language: 'en-US' }).catch(() => ({}) as TmdbPerson)).biography, 4000)

  const credits = new Map<string, PersonCredit>()
  const add = (c: TmdbCredit, group: CreditGroup, role?: string) => {
    const kind = c.media_type === 'movie' || c.media_type === 'tv' ? c.media_type : undefined
    if (!kind) return
    if ((c.genre_ids ?? []).some((g) => TALK_GENRES.has(g))) return
    const result = tmdbToResult(c, kind)
    if (!result) return
    const k = `${group}|${result.externalId}`
    const prev = credits.get(k)
    const r = cleanText(role, 80)
    if (prev) {
      // Plusieurs postes sur le même titre (ex. réalisateur + scénariste d'une série) : on les réunit
      if (r && prev.role !== r && !(prev.role ?? '').includes(r)) prev.role = prev.role ? `${prev.role}, ${r}` : r
      return
    }
    credits.set(k, { result, group, role: r, year: result.year, popularity: num(c.popularity) + num(c.vote_count) / 1000 })
  }
  for (const c of d.combined_credits?.cast ?? []) {
    if (c.character && NOT_A_ROLE.test(c.character.trim())) continue
    // Apparitions d'un épisode dans une série : peu utiles
    if (c.media_type === 'tv' && (c.episode_count ?? 0) <= 1 && !c.character) continue
    add(c, /\(voice\)/i.test(c.character ?? '') ? 'voice' : 'acting', c.character?.replace(/\s*\(voice\)\s*/i, '').trim() || undefined)
  }
  for (const c of d.combined_credits?.crew ?? []) add(c, departmentGroup(c.department), jobLabel(c.job))

  const list = [...credits.values()]
  const mainGroup = departmentGroup(d.known_for_department)
  return {
    id,
    name: cleanText(d.name, 80) ?? '?',
    photo: isSafeTmdbPath(d.profile_path) ? `${TMDB_IMG}/h632${d.profile_path}` : undefined,
    bio,
    birthday: day(d.birthday),
    deathday: day(d.deathday),
    place: cleanText(d.place_of_birth, 120),
    department: groupLabel(mainGroup),
    mainGroup: list.some((c) => c.group === mainGroup) ? mainGroup : (list[0]?.group ?? 'acting'),
    credits: list,
  }
}

interface AniStaff {
  name?: { full?: string | null; native?: string | null } | null
  image?: { large?: string | null } | null
  description?: string | null
  dateOfBirth?: { year?: number | null; month?: number | null; day?: number | null } | null
  dateOfDeath?: { year?: number | null; month?: number | null; day?: number | null } | null
  homeTown?: string | null
  primaryOccupations?: string[] | null
  characterMedia?: { edges?: { characterRole?: string; characters?: { name?: { full?: string | null } }[]; node?: (AniMedia & { popularity?: number | null }) | null }[] } | null
  staffMedia?: { edges?: { staffRole?: string; node?: (AniMedia & { popularity?: number | null }) | null }[] } | null
}

const aniDate = (d?: { year?: number | null; month?: number | null; day?: number | null } | null) =>
  d?.year && d.month && d.day ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}` : undefined

/** Poste AniList → rubrique. */
function aniStaffGroup(role: string): CreditGroup {
  if (/director|storyboard/i.test(role)) return 'directing'
  if (/script|screenplay|series composition|original (creator|story)|story/i.test(role)) return 'writing'
  if (/producer|production/i.test(role)) return 'production'
  return 'other'
}

function cleanAniBio(text?: string | null): string | undefined {
  if (!text) return undefined
  const plain = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/~!|!~/g, '') // balises « spoiler » d'AniList
    .replace(/__(.+?)__/g, '$1')
    .replace(/\[(.+?)\]\((?:https?:)?\/\/[^)]+\)/g, '$1') // liens Markdown → texte
    .replace(/\n{3,}/g, '\n\n')
  return cleanText(plain, 4000)
}

async function aniPerson(id: string): Promise<PersonDetails> {
  const sid = Number(id.split(':')[1])
  const data = await aniQuery<{ Staff?: AniStaff }>(
    `query ($id: Int) { Staff(id: $id) {
      name { full native } image { large } description(asHtml: false)
      dateOfBirth { year month day } dateOfDeath { year month day } homeTown primaryOccupations
      characterMedia(perPage: 50, sort: POPULARITY_DESC) { edges { characterRole characters { name { full } } node { ${ANILIST_FIELDS} popularity type isAdult } } }
      staffMedia(perPage: 50, sort: POPULARITY_DESC, type: ANIME) { edges { staffRole node { ${ANILIST_FIELDS} popularity isAdult } } }
    } }`,
    { id: sid },
  )
  const s = data.Staff
  if (!s) throw new Error(t('person.notFound'))
  const credits = new Map<string, PersonCredit>()
  const add = (node: (AniMedia & { popularity?: number | null; type?: string; isAdult?: boolean }) | null | undefined, group: CreditGroup, role?: string) => {
    if (!node || node.isAdult || (node.type && node.type !== 'ANIME')) return
    const result = aniToResult(node)
    if (!result) return
    const k = `${group}|${result.externalId}`
    const prev = credits.get(k)
    const r = cleanText(role, 80)
    if (prev) {
      if (r && !(prev.role ?? '').includes(r)) prev.role = prev.role ? `${prev.role}, ${r}` : r
      return
    }
    credits.set(k, { result, group, role: r, year: result.year, popularity: num(node.popularity) })
  }
  for (const e of s.characterMedia?.edges ?? []) add(e.node, 'voice', e.characters?.map((c) => c.name?.full).filter(Boolean).join(', '))
  for (const e of s.staffMedia?.edges ?? []) add(e.node, aniStaffGroup(e.staffRole ?? ''), e.staffRole?.replace(/\s*\(.*\)$/, ''))
  const list = [...credits.values()]
  const occ = (s.primaryOccupations ?? []).join(' ')
  const mainGroup: CreditGroup = /voice/i.test(occ) || list.every((c) => c.group === 'voice') ? 'voice' : /director/i.test(occ) ? 'directing' : (list[0]?.group ?? 'voice')
  return {
    id,
    name: cleanText(s.name?.full, 80) ?? cleanText(s.name?.native, 80) ?? '?',
    photo: safePosterUrl(s.image?.large),
    bio: cleanAniBio(s.description),
    birthday: aniDate(s.dateOfBirth),
    deathday: aniDate(s.dateOfDeath),
    place: cleanText(s.homeTown, 120),
    department: mainGroup === 'voice' ? groupLabel('voice') : groupLabel(mainGroup),
    mainGroup: list.some((c) => c.group === mainGroup) ? mainGroup : (list[0]?.group ?? 'voice'),
    credits: list,
  }
}

const personCache = new Map<string, Promise<PersonDetails>>()

/** Fiche d'une personne et sa filmographie (gardée en mémoire le temps de la session). */
export function getPerson(id: string, tmdbKey?: string): Promise<PersonDetails> {
  if (!isPersonId(id)) return Promise.reject(new Error(t('person.notFound')))
  if (id.startsWith('tmdbp:') && !tmdbKey?.trim()) return Promise.reject(new Error(t('search.animeOnly')))
  const cached = personCache.get(id)
  if (cached) return cached
  const p = id.startsWith('tmdbp:') ? tmdbPerson(id, tmdbKey!) : aniPerson(id)
  personCache.set(id, p)
  p.catch(() => personCache.delete(id))
  return p
}

