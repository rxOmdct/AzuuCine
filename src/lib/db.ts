import type { MediaItem } from '../types'
import { dbNameFor, getScope } from './scope'

/**
 * Mini-wrapper IndexedDB sans dépendance.
 * Une base par compte (ou « azuucine » sans compte) : deux comptes sur le même appareil ne se mélangent jamais.
 */
const DB_VERSION = 1
const STORE = 'media'

let dbPromise: Promise<IDBDatabase> | null = null
let dbName = ''

function open(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('type', 'type')
        store.createIndex('status', 'status')
        store.createIndex('updatedAt', 'updatedAt')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function openDB(): Promise<IDBDatabase> {
  const name = dbNameFor(getScope())
  if (!dbPromise || dbName !== name) {
    closeDB()
    dbName = name
    dbPromise = open(name).catch((e) => {
      dbPromise = null
      throw e
    })
  }
  return dbPromise
}

/** Ferme la base ouverte (changement de compte, suppression). */
export function closeDB() {
  const p = dbPromise
  dbPromise = null
  dbName = ''
  p?.then((db) => db.close()).catch(() => {})
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void, db?: IDBDatabase): Promise<T> {
  const database = db ?? (await openDB())
  return new Promise<T>((resolve, reject) => {
    const tx = database.transaction(STORE, mode)
    const req = fn(tx.objectStore(STORE))
    tx.oncomplete = () => resolve(req ? req.result : (undefined as T))
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

// ─── Notification des modifications (pour la synchronisation) ───
export interface MediaChange {
  put: MediaItem[]
  removed: string[]
}
const listeners = new Set<(c: MediaChange) => void>()
export function onMediaChange(fn: (c: MediaChange) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const notify = (c: MediaChange, silent?: boolean) => {
  if (!silent) for (const fn of listeners) fn(c)
}

interface Opts {
  /** Écriture venant de la synchro : ne pas la renvoyer au serveur */
  silent?: boolean
}

export const mediaDB = {
  getAll: () => run<MediaItem[]>('readonly', (s) => s.getAll() as IDBRequest<MediaItem[]>),
  get: (id: string) => run<MediaItem | undefined>('readonly', (s) => s.get(id) as IDBRequest<MediaItem | undefined>),
  put: async (item: MediaItem, opts: Opts = {}) => {
    await run('readwrite', (s) => void s.put(item))
    notify({ put: [item], removed: [] }, opts.silent)
  },
  putMany: async (items: MediaItem[], opts: Opts = {}) => {
    if (!items.length) return
    await run('readwrite', (s) => {
      for (const item of items) s.put(item)
    })
    notify({ put: items, removed: [] }, opts.silent)
  },
  remove: async (id: string, opts: Opts = {}) => {
    await run('readwrite', (s) => void s.delete(id))
    notify({ put: [], removed: [id] }, opts.silent)
  },
  removeMany: async (ids: string[], opts: Opts = {}) => {
    if (!ids.length) return
    await run('readwrite', (s) => {
      for (const id of ids) s.delete(id)
    })
    notify({ put: [], removed: ids }, opts.silent)
  },
  clear: async (opts: Opts = {}) => {
    const ids = await run<IDBValidKey[]>('readonly', (s) => s.getAllKeys())
    await run('readwrite', (s) => void s.clear())
    notify({ put: [], removed: ids.map(String) }, opts.silent)
  },
}

/** Lit toutes les fiches d'une autre base (ex. les données « sans compte » de cet appareil). */
export async function readOtherDatabase(name: string): Promise<MediaItem[]> {
  const exists = (await indexedDB.databases?.())?.some((d) => d.name === name)
  if (exists === false) return []
  const db = await open(name)
  try {
    return await run<MediaItem[]>('readonly', (s) => s.getAll() as IDBRequest<MediaItem[]>, db)
  } finally {
    db.close()
  }
}

/** Supprime complètement une base de l'appareil. */
export function deleteDatabase(name: string): Promise<void> {
  if (name === dbName) closeDB()
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name)
    req.onsuccess = req.onerror = req.onblocked = () => resolve()
  })
}

/** Demande au navigateur de ne pas effacer les données automatiquement (utile sur iOS). */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true
    if (navigator.storage?.persist) return await navigator.storage.persist()
  } catch {
    /* non supporté */
  }
  return false
}
