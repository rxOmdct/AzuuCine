import { t } from './i18n'
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { CustomList, MediaInput, MediaItem, Settings, TopCategory } from './types'
import { ALL_TOP_CATEGORIES } from './lib/constants'
import { applyTheme, DEFAULT_ACCENT } from './lib/theme'
import { normalizeItem, normalizeLists, normalizeSettings } from './lib/backup'
import { CLOUD_TMDB, isPlausibleTmdbKey } from './lib/catalogApi'
import { createSync, type SyncEngine, type SyncStatus } from './lib/cloud/sync'
import { deleteDatabase, readOtherDatabase } from './lib/db'
import { cloudFetch } from './lib/cloud/api'
import { signOut } from './lib/cloud/auth'
import { dbNameFor, scopedKey } from './lib/scope'
import { isPlainObject, LIMITS, readStorage } from './lib/security'
import { mediaDB, requestPersistentStorage } from './lib/db'
import { todayISO, uid } from './lib/utils'
import { seasonPosition } from './lib/franchise'

// Clés propres à l'espace actif (compte connecté, ou appareil sans compte)
const settingsKey = () => scopedKey('settings')
const listsKey = () => scopedKey('lists')

function loadLists(): CustomList[] {
  return normalizeLists(readStorage(listsKey(), [])) ?? []
}

function persistLists(lists: CustomList[]) {
  try {
    localStorage.setItem(listsKey(), JSON.stringify(lists))
  } catch {
    /* ignore */
  }
}
const DEFAULT_SETTINGS: Settings = { ratingScale: '5', topCategories: ALL_TOP_CATEGORIES, accentColor: DEFAULT_ACCENT }

/** Relit les réglages en ne gardant que des valeurs valides (le localStorage peut avoir été modifié). */
function loadSettings(): Settings {
  const raw = readStorage(settingsKey(), {})
  const clean = normalizeSettings(raw) ?? {}
  const key = isPlainObject(raw) && typeof raw.tmdbKey === 'string' && isPlausibleTmdbKey(raw.tmdbKey) ? raw.tmdbKey.trim() : undefined
  return { ...DEFAULT_SETTINGS, ...clean, tmdbKey: key }
}

interface MediaStore {
  items: MediaItem[]
  loading: boolean
  error?: string
  settings: Settings
  updateSettings: (patch: Partial<Settings>) => void
  add: (input: MediaInput) => Promise<MediaItem>
  update: (id: string, patch: Partial<MediaInput>) => Promise<void>
  remove: (id: string) => Promise<void>
  incrementEpisode: (id: string, delta?: number) => Promise<void>
  importItems: (items: MediaItem[], mode: 'merge' | 'replace') => Promise<void>
  /** Remplace le Top 5 d'une catégorie par ces fiches, dans l'ordre (max 5). */
  setTopList: (category: TopCategory, orderedIds: string[]) => Promise<void>
  clearAll: () => Promise<void>
  /** Met à jour plusieurs fiches d'un coup (sans changer leur date de modification). */
  patchMany: (patches: { id: string; patch: Partial<MediaInput> }[]) => Promise<void>

  // Listes perso
  lists: CustomList[]
  createList: (name: string) => CustomList
  renameList: (id: string, name: string) => void
  deleteList: (id: string) => Promise<void>
  toggleInList: (itemId: string, listId: string) => Promise<void>
  mergeLists: (incoming: CustomList[], mode: 'merge' | 'replace') => void

  /** Compte connecté (absent en mode 100 % local) */
  account?: AccountApi
}

export interface AccountApi {
  email: string
  sync: SyncStatus
  syncNow: () => Promise<void>
  /** Déconnexion. Renvoie « pending » s'il reste des modifications non envoyées (sauf si force). */
  logout: (force?: boolean) => Promise<'pending' | 'done'>
  deleteAccount: () => Promise<void>
  /** Données créées sur cet appareil avant les comptes (mode local) */
  deviceData: { items: number; lists: number } | null
  importDeviceData: () => Promise<number>
  dismissDeviceData: () => void
}

/** Efface de l'appareil tout ce qui appartient à un compte (base, réglages, synchro, caches). */
async function wipeAccountFromDevice(userId: string) {
  await deleteDatabase(dbNameFor(userId))
  for (const name of ['settings', 'lists', 'sync', 'device-import']) {
    try {
      localStorage.removeItem(scopedKey(name, userId))
    } catch {
      /* ignore */
    }
  }
  for (const k of ['azuucine:airing', 'azuucine:releases', 'azuucine:public-checked']) {
    try {
      localStorage.removeItem(k)
    } catch {
      /* ignore */
    }
  }
}

const MediaContext = createContext<MediaStore | null>(null)

const byUpdatedDesc = (a: MediaItem, b: MediaItem) => b.updatedAt.localeCompare(a.updatedAt)

/**
 * Service de données : l'état React est la copie de travail,
 * IndexedDB est la source persistante (chaque écriture y est répercutée).
 */
export function MediaProvider({ children, cloudUser }: { children: ReactNode; cloudUser?: { id: string; email: string } }) {
  const [items, setItems] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [lists, setListsState] = useState<CustomList[]>(loadLists)

  const syncRef = useRef<SyncEngine | null>(null)
  const listsRef = useRef(lists)
  listsRef.current = lists
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  const setLists = useCallback((updater: (prev: CustomList[]) => CustomList[], silent = false) => {
    setListsState((prev) => {
      const next = updater(prev)
      persistLists(next)
      if (!silent && syncRef.current) {
        // Listes ajoutées, renommées ou supprimées → à envoyer
        const before = new Map(prev.map((l) => [l.id, JSON.stringify(l)]))
        const after = new Map(next.map((l) => [l.id, JSON.stringify(l)]))
        for (const [id, v] of after) if (before.get(id) !== v) syncRef.current.markList(id)
        for (const id of before.keys()) if (!after.has(id)) syncRef.current.markList(id)
      }
      return next
    })
  }, [])

  const reloadItems = useCallback(async () => {
    const all = await mediaDB.getAll()
    setItems(all.map(normalizeItem).filter((i): i is MediaItem => i !== null).sort(byUpdatedDesc))
  }, [])

  useEffect(() => {
    mediaDB
      .getAll()
      .then((all) => setItems(all.map(normalizeItem).filter((i): i is MediaItem => i !== null).sort(byUpdatedDesc)))
      .catch((e) => setError(t('store.dbError', { error: String(e?.message ?? e) })))
      .finally(() => setLoading(false))
    void requestPersistentStorage()
  }, [])

  // ─── Compte : synchronisation avec le serveur ───
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ state: 'idle', pending: 0 })
  const [deviceData, setDeviceData] = useState<{ items: number; lists: number } | null>(null)

  useEffect(() => {
    if (!cloudUser) return
    const engine = createSync(cloudUser.id, {
      getLists: () => listsRef.current,
      applyLists: (next) => setLists(() => next, true),
      getSettings: () => {
        const { ratingScale, topCategories, accentColor } = settingsRef.current
        return { ratingScale, topCategories, accentColor }
      },
      applySettings: (patch) => updateSettingsRef.current(patch, true),
      itemsChanged: () => void reloadItems(),
    })
    syncRef.current = engine
    const off = engine.subscribe(setSyncStatus)
    setSyncStatus(engine.status())
    engine.start()

    // Données créées sur cet appareil avant les comptes : proposer de les rapatrier
    let alive = true
    if (localStorage.getItem(scopedKey('device-import', cloudUser.id)) !== 'done') {
      readOtherDatabase(dbNameFor(null))
        .then((old) => {
          const oldLists = normalizeLists(readStorage(scopedKey('lists', null), [])) ?? []
          if (alive && (old.length || oldLists.length)) setDeviceData({ items: old.length, lists: oldLists.length })
        })
        .catch(() => {})
    }
    return () => {
      alive = false
      off()
      engine.stop()
      syncRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudUser?.id])

  // Thème de couleur appliqué avant l'affichage (pas de flash de rouge)
  useLayoutEffect(() => applyTheme(settings.accentColor), [settings.accentColor])

  const updateSettings = useCallback((patch: Partial<Settings>, silent = false) => {
    if (!silent && syncRef.current && ('ratingScale' in patch || 'topCategories' in patch || 'accentColor' in patch)) syncRef.current.markSettings()
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      try {
        localStorage.setItem(settingsKey(), JSON.stringify(cloudUser ? { ...next, tmdbKey: undefined } : next))
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  const updateSettingsRef = useRef(updateSettings)
  updateSettingsRef.current = updateSettings

  /** Toute écriture passe par la même validation que l'import (dernière ligne de défense). */
  const save = useCallback(async (raw: MediaItem) => {
    const item = normalizeItem(raw)
    if (!item) throw new Error(t('store.invalidItem'))
    await mediaDB.put(item)
    setItems((prev) => [item, ...prev.filter((i) => i.id !== item.id)].sort(byUpdatedDesc))
  }, [])

  const add = useCallback(
    async (input: MediaInput) => {
      const now = new Date().toISOString()
      const item: MediaItem = { ...input, id: uid(), createdAt: now, updatedAt: now }
      await save(item)
      return item
    },
    [save],
  )

  const update = useCallback(
    async (id: string, patch: Partial<MediaInput>) => {
      const current = items.find((i) => i.id === id)
      if (!current) return
      await save({ ...current, ...patch, updatedAt: new Date().toISOString() })
    },
    [items, save],
  )

  const remove = useCallback(async (id: string) => {
    await mediaDB.remove(id)
    setItems((prev) => prev.filter((i) => i.id !== id))
  }, [])

  const incrementEpisode = useCallback(
    async (id: string, delta = 1) => {
      const item = items.find((i) => i.id === id)
      if (!item) return
      let next = Math.max(0, item.episodesWatched + delta)
      if (item.episodesTotal) next = Math.min(next, item.episodesTotal)
      if (next === item.episodesWatched) return
      const patch: Partial<MediaInput> = { episodesWatched: next }
      // Série en plusieurs saisons : la saison suit les épisodes vus
      const pos = seasonPosition({ episodesWatched: next, seasons: item.seasons })
      if (pos && pos.season !== item.season) patch.season = pos.season
      if (delta > 0 && (item.status === 'a_voir' || item.status === 'pause')) {
        patch.status = 'en_cours'
        if (!item.startDate) patch.startDate = todayISO()
      }
      if (item.episodesTotal && next === item.episodesTotal && delta > 0) {
        patch.status = 'termine'
        if (!item.endDate) patch.endDate = todayISO()
      }
      await update(id, patch)
    },
    [items, update],
  )

  const importItems = useCallback(async (incoming: MediaItem[], mode: 'merge' | 'replace') => {
    if (mode === 'replace') await mediaDB.clear()
    await mediaDB.putMany(incoming)
    const all = await mediaDB.getAll()
    setItems(all.sort(byUpdatedDesc))
  }, [])

  const setTopList = useCallback(
    async (category: TopCategory, orderedIds: string[]) => {
      const ids = orderedIds.slice(0, 5)
      const now = new Date().toISOString()
      const changed: MediaItem[] = []
      for (const item of items) {
        const rank = ids.indexOf(item.id) + 1
        const wasHere = item.top?.category === category
        if (rank > 0) {
          if (!wasHere || item.top?.rank !== rank) changed.push({ ...item, top: { category, rank }, updatedAt: now })
        } else if (wasHere) {
          changed.push({ ...item, top: undefined, updatedAt: now })
        }
      }
      if (!changed.length) return
      await mediaDB.putMany(changed)
      const byId = new Map(changed.map((c) => [c.id, c]))
      setItems((prev) => prev.map((i) => byId.get(i.id) ?? i))
    },
    [items],
  )

  const clearAll = useCallback(async () => {
    await mediaDB.clear()
    setItems([])
  }, [])

  const patchMany = useCallback(
    async (patches: { id: string; patch: Partial<MediaInput> }[]) => {
      const byId = new Map(items.map((i) => [i.id, i]))
      const changed = patches.flatMap(({ id, patch }) => {
        const cur = byId.get(id)
        const next = cur ? normalizeItem({ ...cur, ...patch }) : null
        return next ? [next] : []
      })
      if (!changed.length) return
      await mediaDB.putMany(changed)
      const map = new Map(changed.map((c) => [c.id, c]))
      setItems((prev) => prev.map((i) => map.get(i.id) ?? i))
    },
    [items],
  )

  const createList = useCallback(
    (name: string) => {
      const list: CustomList = { id: uid(), name: name.trim().slice(0, LIMITS.shortText) || t('lists.newList'), createdAt: new Date().toISOString() }
      setLists((prev) => [...prev, list])
      return list
    },
    [setLists],
  )

  const renameList = useCallback(
    (id: string, name: string) => setLists((prev) => prev.map((l) => (l.id === id ? { ...l, name: name.trim().slice(0, LIMITS.shortText) || l.name } : l))),
    [setLists],
  )

  const deleteList = useCallback(
    async (id: string) => {
      setLists((prev) => prev.filter((l) => l.id !== id))
      const changed = items.filter((i) => i.listIds?.includes(id)).map((i) => ({ ...i, listIds: i.listIds!.filter((x) => x !== id) }))
      if (changed.length) {
        await mediaDB.putMany(changed)
        const map = new Map(changed.map((c) => [c.id, c]))
        setItems((prev) => prev.map((i) => map.get(i.id) ?? i))
      }
    },
    [items, setLists],
  )

  const toggleInList = useCallback(
    async (itemId: string, listId: string) => {
      const item = items.find((i) => i.id === itemId)
      if (!item) return
      const has = item.listIds?.includes(listId)
      const listIds = has ? item.listIds!.filter((x) => x !== listId) : [...(item.listIds ?? []), listId]
      const next = { ...item, listIds }
      await mediaDB.put(next)
      setItems((prev) => prev.map((i) => (i.id === itemId ? next : i)))
    },
    [items],
  )

  const mergeLists = useCallback(
    (incoming: CustomList[], mode: 'merge' | 'replace') =>
      setLists((prev) => {
        if (mode === 'replace') return incoming
        const ids = new Set(prev.map((l) => l.id))
        return [...prev, ...incoming.filter((l) => !ids.has(l.id))]
      }),
    [setLists],
  )

  const account = useMemo<AccountApi | undefined>(() => {
    if (!cloudUser) return undefined
    const userId = cloudUser.id
    return {
      email: cloudUser.email,
      sync: syncStatus,
      syncNow: () => syncRef.current?.syncNow() ?? Promise.resolve(),
      async logout(force = false) {
        const engine = syncRef.current
        if (engine && navigator.onLine) await engine.syncNow()
        if (!force && engine && engine.status().pending > 0) return 'pending'
        engine?.stop()
        await wipeAccountFromDevice(userId)
        await signOut()
        return 'done'
      },
      async deleteAccount() {
        const res = await cloudFetch('/functions/v1/delete-account', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirm: 'SUPPRIMER' }),
        })
        if (!res.ok) throw new Error(res.status === 429 ? t('account.err.deleteRate') : t('account.err.delete'))
        syncRef.current?.stop()
        await wipeAccountFromDevice(userId)
        await signOut()
      },
      deviceData,
      async importDeviceData() {
        const old = (await readOtherDatabase(dbNameFor(null))).map(normalizeItem).filter((i): i is MediaItem => i !== null)
        const current = new Map((await mediaDB.getAll()).map((i) => [i.id, i]))
        const incoming = old.filter((i) => !current.has(i.id) || current.get(i.id)!.updatedAt < i.updatedAt)
        await mediaDB.putMany(incoming)
        const oldLists = normalizeLists(readStorage(scopedKey('lists', null), [])) ?? []
        if (oldLists.length) setLists((prev) => [...prev, ...oldLists.filter((l) => !prev.some((p) => p.id === l.id))])
        const oldSettings = normalizeSettings(readStorage(scopedKey('settings', null), {}))
        if (oldSettings && Object.keys(oldSettings).length) updateSettings(oldSettings)
        await reloadItems()
        // Les données sont maintenant dans le compte : on retire la copie « sans compte » de l'appareil
        await deleteDatabase(dbNameFor(null))
        for (const name of ['settings', 'lists']) localStorage.removeItem(scopedKey(name, null))
        localStorage.setItem(scopedKey('device-import', userId), 'done')
        setDeviceData(null)
        return incoming.length
      },
      dismissDeviceData() {
        localStorage.setItem(scopedKey('device-import', userId), 'done')
        setDeviceData(null)
      },
    }
  }, [cloudUser, syncStatus, deviceData, reloadItems, setLists, updateSettings])

  // Avec un compte, TMDB passe par le serveur (la clé n'est jamais sur l'appareil)
  const exposedSettings = useMemo<Settings>(() => (cloudUser ? { ...settings, tmdbKey: CLOUD_TMDB } : settings), [settings, cloudUser])

  const value = useMemo<MediaStore>(
    () => ({
      items, loading, error, settings: exposedSettings, updateSettings, add, update, remove, incrementEpisode, importItems, setTopList, clearAll,
      patchMany, lists, createList, renameList, deleteList, toggleInList, mergeLists, account,
    }),
    [
      items, loading, error, exposedSettings, updateSettings, add, update, remove, incrementEpisode, importItems, setTopList, clearAll,
      patchMany, lists, createList, renameList, deleteList, toggleInList, mergeLists, account,
    ],
  )

  return <MediaContext.Provider value={value}>{children}</MediaContext.Provider>
}

export function useMedia(): MediaStore {
  const ctx = useContext(MediaContext)
  if (!ctx) throw new Error('useMedia doit être utilisé dans <MediaProvider>')
  return ctx
}
