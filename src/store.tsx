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
import { isPlainObject, LIMITS, readStorage, storageGet, storageSet } from './lib/security'
import { mediaDB, requestPersistentStorage } from './lib/db'
import { episodesPatch } from './lib/progress'
import { uid } from './lib/utils'
import { episodeCap } from './lib/franchise'
import { airedCount } from './lib/airing'
import { logEpisodes } from './lib/challenges'

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
const DEFAULT_SETTINGS: Settings = { ratingScale: '5', topCategories: ALL_TOP_CATEGORIES, accentColor: DEFAULT_ACCENT, themeMode: 'auto' }

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
  /** Modification groupée par l'utilisateur (la date de modification avance, comme update). */
  updateMany: (patches: { id: string; patch: Partial<MediaInput> }[]) => Promise<void>
  /** Suppression groupée. */
  removeMany: (ids: string[]) => Promise<void>
  /**
   * « Annuler » : remet ces fiches exactement comme elles étaient (dates, épisodes, listes…),
   * avec une date de modification plus récente que la suppression / le changement, pour que
   * la synchro (la plus récente gagne) recrée bien la fiche côté serveur.
   */
  restore: (snapshots: MediaItem[]) => Promise<void>

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
  const [items, setItemsState] = useState<MediaItem[]>([])
  // Copie toujours à jour (deux « +1 » rapides ne doivent pas partir de la même version)
  const itemsRef = useRef(items)
  const setItems = useCallback((next: MediaItem[] | ((prev: MediaItem[]) => MediaItem[])) => {
    itemsRef.current = typeof next === 'function' ? next(itemsRef.current) : next
    setItemsState(itemsRef.current)
  }, [])
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
        const { ratingScale, topCategories, accentColor, themeMode, notifPrefs, challenges } = settingsRef.current
        return { ratingScale, topCategories, accentColor, themeMode, notifPrefs, challenges }
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
    if (storageGet(scopedKey('device-import', cloudUser.id)) !== 'done') {
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
  useLayoutEffect(() => applyTheme(settings.accentColor, settings.themeMode), [settings.accentColor, settings.themeMode])
  // En mode « auto », suit le clair/sombre du navigateur en direct
  useEffect(() => {
    if (settings.themeMode !== 'auto' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = () => applyTheme(settingsRef.current.accentColor, 'auto')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [settings.themeMode])

  const updateSettings = useCallback((patch: Partial<Settings>, silent = false) => {
    if (!silent && syncRef.current && ('ratingScale' in patch || 'topCategories' in patch || 'accentColor' in patch || 'themeMode' in patch || 'notifPrefs' in patch || 'challenges' in patch)) syncRef.current.markSettings()
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
      const current = itemsRef.current.find((i) => i.id === id)
      if (!current) return
      const next = { ...current, ...patch, updatedAt: new Date().toISOString() }
      // Défis : on retient le jour où des épisodes sont cochés (ou décochés)
      const delta = (patch.episodesWatched ?? current.episodesWatched) - current.episodesWatched
      if (delta) next.episodeLog = logEpisodes(current.episodeLog, delta)
      await save(next)
    },
    [save],
  )

  // Dernière suppression locale de chaque fiche (une restauration doit être strictement plus récente)
  const removedAtRef = useRef(new Map<string, number>())

  const remove = useCallback(async (id: string) => {
    await mediaDB.remove(id)
    removedAtRef.current.set(id, Date.now())
    setItems((prev) => prev.filter((i) => i.id !== id))
  }, [])

  const removeMany = useCallback(async (ids: string[]) => {
    if (!ids.length) return
    await mediaDB.removeMany(ids)
    const now = Date.now()
    for (const id of ids) removedAtRef.current.set(id, now)
    const gone = new Set(ids)
    setItems((prev) => prev.filter((i) => !gone.has(i.id)))
  }, [])

  const updateMany = useCallback(
    async (patches: { id: string; patch: Partial<MediaInput> }[]) => {
      const now = new Date().toISOString()
      const byId = new Map(itemsRef.current.map((i) => [i.id, i]))
      const changed = patches.flatMap(({ id, patch }) => {
        const cur = byId.get(id)
        const next = cur ? normalizeItem({ ...cur, ...patch, updatedAt: now }) : null
        return next ? [next] : []
      })
      if (!changed.length) return
      await mediaDB.putMany(changed)
      const map = new Map(changed.map((c) => [c.id, c]))
      setItems((prev) => prev.map((i) => map.get(i.id) ?? i).sort(byUpdatedDesc))
    },
    [setItems],
  )

  const restore = useCallback(
    async (snapshots: MediaItem[]) => {
      // Horodatage plus récent que la suppression (ou la modification) qu'on annule : la synchro
      // envoie alors une version qui gagne sur la « pierre tombale » déjà partie au serveur.
      const current = new Map(itemsRef.current.map((i) => [i.id, i.updatedAt]))
      let latest = Date.now()
      for (const snap of snapshots) {
        latest = Math.max(latest, (removedAtRef.current.get(snap.id) ?? 0) + 1, (Date.parse(current.get(snap.id) ?? '') || 0) + 1)
      }
      const at = new Date(latest).toISOString()
      const restored = snapshots.map((s) => normalizeItem({ ...s, updatedAt: at })).filter((i): i is MediaItem => i !== null)
      if (!restored.length) return
      await mediaDB.putMany(restored)
      for (const r of restored) removedAtRef.current.delete(r.id)
      const map = new Map(restored.map((r) => [r.id, r]))
      setItems((prev) => [...restored, ...prev.filter((i) => !map.has(i.id))].sort(byUpdatedDesc))
    },
    [setItems],
  )

  const incrementEpisode = useCallback(
    async (id: string, delta = 1) => {
      const item = itemsRef.current.find((i) => i.id === id)
      if (!item) return
      let next = Math.max(0, item.episodesWatched + delta)
      const cap = episodeCap(item)
      if (cap) next = Math.min(next, cap)
      // On ne peut pas cocher un épisode qui n'est pas encore sorti
      const aired = airedCount(item)
      if (delta > 0 && aired != null) next = Math.min(next, Math.max(aired, item.episodesWatched))
      if (next === item.episodesWatched) return
      // Statut, saison et dates (début au premier épisode, fin au dernier) suivent
      const patch = episodesPatch(item, next)
      await update(id, patch)
    },
    [update],
  )

  const importItems = useCallback(async (incoming: MediaItem[], mode: 'merge' | 'replace') => {
    if (mode === 'replace') {
      await mediaDB.clear()
      // Remplacement voulu : les fiches importées deviennent la version la plus récente
      // (sinon le serveur garderait ses versions plus récentes et les appareils divergeraient)
      const now = new Date().toISOString()
      await mediaDB.putMany(incoming.map((i) => ({ ...i, updatedAt: now })))
    } else {
      // Fusion : une sauvegarde plus ancienne n'écrase pas une fiche modifiée depuis
      const current = new Map((await mediaDB.getAll()).map((i) => [i.id, i]))
      await mediaDB.putMany(incoming.filter((i) => !current.has(i.id) || current.get(i.id)!.updatedAt < i.updatedAt))
    }
    const all = await mediaDB.getAll()
    setItems(all.sort(byUpdatedDesc))
  }, [])

  const setTopList = useCallback(
    async (category: TopCategory, orderedIds: string[]) => {
      const ids = orderedIds.slice(0, 5)
      const now = new Date().toISOString()
      const changed: MediaItem[] = []
      for (const item of itemsRef.current) {
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
    [setItems],
  )

  const clearAll = useCallback(async () => {
    await mediaDB.clear()
    setItems([])
  }, [])

  const patchMany = useCallback(
    async (patches: { id: string; patch: Partial<MediaInput> }[]) => {
      const byId = new Map(itemsRef.current.map((i) => [i.id, i]))
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
    [setItems],
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
      const now = new Date().toISOString()
      const changed = itemsRef.current.filter((i) => i.listIds?.includes(id)).map((i) => ({ ...i, listIds: i.listIds!.filter((x) => x !== id), updatedAt: now }))
      if (changed.length) {
        await mediaDB.putMany(changed)
        const map = new Map(changed.map((c) => [c.id, c]))
        setItems((prev) => prev.map((i) => map.get(i.id) ?? i))
      }
    },
    [setItems, setLists],
  )

  const toggleInList = useCallback(
    async (itemId: string, listId: string) => {
      const item = itemsRef.current.find((i) => i.id === itemId)
      if (!item) return
      const has = item.listIds?.includes(listId)
      const listIds = has ? item.listIds!.filter((x) => x !== listId) : [...(item.listIds ?? []), listId]
      await update(itemId, { listIds })
    },
    [update],
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
        for (const name of ['settings', 'lists']) storageSet(scopedKey(name, null), null)
        storageSet(scopedKey('device-import', userId), 'done')
        setDeviceData(null)
        return incoming.length
      },
      dismissDeviceData() {
        storageSet(scopedKey('device-import', userId), 'done')
        setDeviceData(null)
      },
    }
  }, [cloudUser, syncStatus, deviceData, reloadItems, setLists, updateSettings])

  // Avec un compte, TMDB passe par le serveur (la clé n'est jamais sur l'appareil)
  const exposedSettings = useMemo<Settings>(() => (cloudUser ? { ...settings, tmdbKey: CLOUD_TMDB } : settings), [settings, cloudUser])

  const value = useMemo<MediaStore>(
    () => ({
      items, loading, error, settings: exposedSettings, updateSettings, add, update, remove, incrementEpisode, importItems, setTopList, clearAll,
      patchMany, updateMany, removeMany, restore, lists, createList, renameList, deleteList, toggleInList, mergeLists, account,
    }),
    [
      items, loading, error, exposedSettings, updateSettings, add, update, remove, incrementEpisode, importItems, setTopList, clearAll,
      patchMany, updateMany, removeMany, restore, lists, createList, renameList, deleteList, toggleInList, mergeLists, account,
    ],
  )

  return <MediaContext.Provider value={value}>{children}</MediaContext.Provider>
}

export function useMedia(): MediaStore {
  const ctx = useContext(MediaContext)
  if (!ctx) throw new Error('useMedia doit être utilisé dans <MediaProvider>')
  return ctx
}
