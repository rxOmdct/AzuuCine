import { t } from '../../i18n'
import type { CustomList, MediaItem, Settings } from '../../types'
import { normalizeItem, normalizeLists, normalizeSettings } from '../backup'
import { mediaDB, onMediaChange } from '../db'
import { blobToPosterDataURL } from '../image'
import { isPlainObject, isSafeId, safeIso } from '../security'
import { scopedKey } from '../scope'
import { cloudFetch } from './api'

/**
 * Synchronisation hors-ligne ↔ compte :
 *  - toutes les modifications sont d'abord écrites sur l'appareil (l'app marche sans réseau),
 *  - elles sont notées dans une « boîte d'envoi » puis envoyées dès que possible,
 *  - on récupère ensuite ce qui a changé ailleurs (autre téléphone, ordinateur…).
 * En cas de conflit, la modification la plus récente gagne (vérifié aussi par la base).
 */

export type SyncedSettings = Pick<Settings, 'ratingScale' | 'topCategories' | 'accentColor'>

export interface SyncHooks {
  getLists: () => CustomList[]
  applyLists: (lists: CustomList[]) => void
  getSettings: () => SyncedSettings
  applySettings: (s: Partial<SyncedSettings>) => void
  itemsChanged: () => void
}

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'offline' | 'error'
  lastSyncAt?: string
  pending: number
  error?: string
}

interface SyncMeta {
  itemsCursor?: string
  listsCursor?: string
  settingsAt?: string
  lastSyncAt?: string
  /** clé (« i:<id> », « l:<id> », « s ») → horodatage de la modification locale */
  outbox: Record<string, string>
}

const PAGE = 500
const MAX_ROW_BYTES = 380_000
const MAX_BATCH_BYTES = 1_500_000
const OVERLAP_MS = 60_000

const jsonHeaders = { 'Content-Type': 'application/json' }

export interface SyncEngine {
  start: () => void
  stop: () => void
  syncNow: () => Promise<void>
  markList: (id: string) => void
  markSettings: () => void
  status: () => SyncStatus
  subscribe: (fn: (s: SyncStatus) => void) => () => void
}

export function createSync(userId: string, hooks: SyncHooks): SyncEngine {
  const META_KEY = scopedKey('sync', userId)

  const loadMeta = (): SyncMeta => {
    try {
      const raw = JSON.parse(localStorage.getItem(META_KEY) ?? '{}') as unknown
      if (!isPlainObject(raw)) return { outbox: {} }
      const outbox: Record<string, string> = {}
      if (isPlainObject(raw.outbox)) {
        for (const [k, v] of Object.entries(raw.outbox)) {
          if ((k === 's' || /^[il]:[A-Za-z0-9_-]{1,64}$/.test(k)) && safeIso(v)) outbox[k] = v as string
        }
      }
      return {
        itemsCursor: safeIso(raw.itemsCursor),
        listsCursor: safeIso(raw.listsCursor),
        settingsAt: safeIso(raw.settingsAt),
        lastSyncAt: safeIso(raw.lastSyncAt),
        outbox,
      }
    } catch {
      return { outbox: {} }
    }
  }

  let meta = loadMeta()
  const saveMeta = () => {
    try {
      localStorage.setItem(META_KEY, JSON.stringify(meta))
    } catch {
      /* ignore */
    }
  }

  let status: SyncStatus = { state: 'idle', lastSyncAt: meta.lastSyncAt, pending: Object.keys(meta.outbox).length }
  const listeners = new Set<(s: SyncStatus) => void>()
  const setStatus = (patch: Partial<SyncStatus>) => {
    status = { ...status, ...patch, pending: Object.keys(meta.outbox).length }
    for (const fn of listeners) fn(status)
  }

  const mark = (key: string) => {
    meta.outbox[key] = new Date().toISOString()
    saveMeta()
    setStatus({})
    schedule()
  }

  // ─── Envoi ───

  /** Réduit une fiche trop lourde (affiche importée en très haute qualité) avant envoi. */
  async function fitForUpload(item: MediaItem): Promise<MediaItem> {
    if (JSON.stringify(item).length <= MAX_ROW_BYTES) return item
    if (item.poster?.startsWith('data:image')) {
      try {
        const blob = await (await fetch(item.poster)).blob()
        const smaller = { ...item, poster: await blobToPosterDataURL(blob, 360, 0.75) }
        if (JSON.stringify(smaller).length <= MAX_ROW_BYTES) return smaller
      } catch {
        /* image illisible */
      }
    }
    const { poster: _poster, ...rest } = item
    const stripped = rest as MediaItem
    return JSON.stringify(stripped).length <= MAX_ROW_BYTES ? stripped : { ...stripped, notes: stripped.notes?.slice(0, 5000), overview: undefined }
  }

  async function upsert(table: 'items' | 'lists', rows: { id: string; data: unknown; deleted: boolean; updated_at: string }[]) {
    // Envoi par paquets de taille raisonnable
    let batch: typeof rows = []
    let size = 0
    const flush = async () => {
      if (!batch.length) return
      const res = await cloudFetch(`/rest/v1/${table}?on_conflict=user_id,id`, {
        method: 'POST',
        headers: { ...jsonHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(batch.map((r) => ({ ...r, user_id: userId }))),
      })
      if (!res.ok) throw new Error(t('sync.err.push', { status: res.status }))
      batch = []
      size = 0
    }
    for (const r of rows) {
      const bytes = JSON.stringify(r).length
      if (size + bytes > MAX_BATCH_BYTES || batch.length >= 200) await flush()
      batch.push(r)
      size += bytes
    }
    await flush()
  }

  async function push() {
    const snapshot = { ...meta.outbox }
    const keys = Object.keys(snapshot)
    if (!keys.length) return

    const itemIds = keys.filter((k) => k.startsWith('i:')).map((k) => k.slice(2))
    if (itemIds.length) {
      const rows = []
      for (const id of itemIds) {
        const item = await mediaDB.get(id)
        if (item) {
          const data = await fitForUpload(item)
          rows.push({ id, data, deleted: false, updated_at: item.updatedAt })
        } else {
          rows.push({ id, data: null, deleted: true, updated_at: snapshot[`i:${id}`] })
        }
      }
      await upsert('items', rows)
    }

    const listIds = keys.filter((k) => k.startsWith('l:')).map((k) => k.slice(2))
    if (listIds.length) {
      const current = new Map(hooks.getLists().map((l) => [l.id, l]))
      await upsert(
        'lists',
        listIds.map((id) => {
          const l = current.get(id)
          return { id, data: l ?? null, deleted: !l, updated_at: snapshot[`l:${id}`] }
        }),
      )
    }

    if (snapshot.s) {
      const res = await cloudFetch('/rest/v1/settings?on_conflict=user_id', {
        method: 'POST',
        headers: { ...jsonHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ user_id: userId, data: hooks.getSettings(), updated_at: snapshot.s }),
      })
      if (!res.ok) throw new Error(t('sync.err.push', { status: res.status }))
      meta.settingsAt = snapshot.s
    }

    // On ne retire que ce qui n'a pas été re-modifié pendant l'envoi
    for (const k of keys) if (meta.outbox[k] === snapshot[k]) delete meta.outbox[k]
    saveMeta()
  }

  // ─── Réception ───

  type Row = { id: string; data: unknown; deleted: boolean; updated_at: string; server_updated_at: string }

  async function fetchChanges(table: 'items' | 'lists', cursor?: string): Promise<{ rows: Row[]; cursor?: string }> {
    const rows: Row[] = []
    let after = cursor ? new Date(new Date(cursor).getTime() - OVERLAP_MS).toISOString() : undefined
    let last = cursor
    for (let page = 0; page < 200; page++) {
      const q = new URLSearchParams({ select: 'id,data,deleted,updated_at,server_updated_at', order: 'server_updated_at.asc,id.asc', limit: String(PAGE) })
      if (after) q.set('server_updated_at', `gt.${after}`)
      const res = await cloudFetch(`/rest/v1/${table}?${q}`)
      if (!res.ok) throw new Error(t('sync.err.pull', { status: res.status }))
      const list = (await res.json()) as unknown
      if (!Array.isArray(list)) throw new Error(t('auth.err.response'))
      for (const r of list) {
        if (!isPlainObject(r) || !isSafeId(r.id) || !safeIso(r.updated_at) || !safeIso(r.server_updated_at)) continue
        rows.push(r as unknown as Row)
        last = r.server_updated_at as string
      }
      if (list.length < PAGE) break
      after = last
    }
    return { rows, cursor: last }
  }

  async function pullItems() {
    const { rows, cursor } = await fetchChanges('items', meta.itemsCursor)
    const toPut: MediaItem[] = []
    const toRemove: string[] = []
    for (const r of rows) {
      if (meta.outbox[`i:${r.id}`]) continue // modification locale en attente : elle passera en priorité
      const local = await mediaDB.get(r.id)
      if (r.deleted) {
        if (local) toRemove.push(r.id)
        continue
      }
      const item = normalizeItem(r.data)
      if (!item || item.id !== r.id) continue
      if (local && local.updatedAt > item.updatedAt) continue
      // Même version : on garde l'affiche locale si le serveur ne l'a pas (fiche allégée à l'envoi)
      if (local && local.updatedAt === item.updatedAt && !item.poster && local.poster) item.poster = local.poster
      if (local && JSON.stringify(local) === JSON.stringify(item)) continue
      toPut.push(item)
    }
    await mediaDB.putMany(toPut, { silent: true })
    await mediaDB.removeMany(toRemove, { silent: true })
    meta.itemsCursor = safeIso(cursor)
    saveMeta()
    if (toPut.length || toRemove.length) hooks.itemsChanged()
  }

  async function pullLists() {
    const { rows, cursor } = await fetchChanges('lists', meta.listsCursor)
    if (rows.length) {
      const map = new Map(hooks.getLists().map((l) => [l.id, l]))
      let changed = false
      for (const r of rows) {
        if (meta.outbox[`l:${r.id}`]) continue
        if (r.deleted) {
          changed = map.delete(r.id) || changed
          continue
        }
        const [l] = normalizeLists([r.data]) ?? []
        if (l && l.id === r.id && JSON.stringify(map.get(l.id)) !== JSON.stringify(l)) {
          map.set(l.id, l)
          changed = true
        }
      }
      if (changed) hooks.applyLists([...map.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
    }
    meta.listsCursor = safeIso(cursor)
    saveMeta()
  }

  async function pullSettings() {
    if (meta.outbox.s) return
    const res = await cloudFetch('/rest/v1/settings?select=data,updated_at&limit=1')
    if (!res.ok) throw new Error(t('sync.err.pull', { status: res.status }))
    const [row] = (await res.json()) as { data?: unknown; updated_at?: string }[]
    const at = safeIso(row?.updated_at)
    if (!row || !at || (meta.settingsAt && at <= meta.settingsAt)) return
    const s = normalizeSettings(row.data)
    if (s) hooks.applySettings(s)
    meta.settingsAt = at
    saveMeta()
  }

  // ─── Orchestration ───

  let running: Promise<void> | null = null
  let again = false
  let stopped = true
  let timer: ReturnType<typeof setTimeout> | undefined
  let interval: ReturnType<typeof setInterval> | undefined

  async function cycle() {
    if (!navigator.onLine) {
      setStatus({ state: 'offline' })
      return
    }
    setStatus({ state: 'syncing', error: undefined })
    try {
      // Un envoi refusé (fiche trop lourde, quota…) ne doit pas empêcher de recevoir les autres appareils
      let pushError: unknown
      try {
        await push()
      } catch (e) {
        pushError = e
      }
      // Déconnexion pendant la synchro : on n'écrit plus rien dans la base de cet utilisateur
      if (stopped) return
      await pullItems()
      if (stopped) return
      await pullLists()
      if (stopped) return
      await pullSettings()
      if (pushError) throw pushError
      meta.lastSyncAt = new Date().toISOString()
      saveMeta()
      setStatus({ state: 'idle', lastSyncAt: meta.lastSyncAt })
    } catch (e) {
      if (!stopped) setStatus({ state: navigator.onLine ? 'error' : 'offline', error: (e as Error).message })
    }
  }

  function syncNow(): Promise<void> {
    if (stopped) return Promise.resolve()
    if (running) {
      again = true
      return running
    }
    running = (async () => {
      do {
        again = false
        await cycle()
      } while (again && !stopped)
    })().finally(() => {
      running = null
    })
    return running
  }

  function schedule(delay = 1500) {
    if (stopped) return
    clearTimeout(timer)
    timer = setTimeout(() => void syncNow(), delay)
  }

  const onOnline = () => schedule(300)
  const onOffline = () => setStatus({ state: 'offline' })
  const onVisible = () => document.visibilityState === 'visible' && schedule(300)
  let unsubscribeDB: (() => void) | undefined

  return {
    start() {
      if (!stopped) return
      stopped = false
      unsubscribeDB = onMediaChange((c) => {
        const now = new Date().toISOString()
        for (const i of c.put) meta.outbox[`i:${i.id}`] = now
        for (const id of c.removed) meta.outbox[`i:${id}`] = now
        saveMeta()
        setStatus({})
        schedule()
      })
      window.addEventListener('online', onOnline)
      window.addEventListener('offline', onOffline)
      document.addEventListener('visibilitychange', onVisible)
      interval = setInterval(() => document.visibilityState === 'visible' && void syncNow(), 60_000)
      void syncNow()
    },
    stop() {
      stopped = true
      clearTimeout(timer)
      clearInterval(interval)
      unsubscribeDB?.()
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVisible)
    },
    syncNow,
    markList: (id) => mark(`l:${id}`),
    markSettings: () => mark('s'),
    status: () => status,
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}
