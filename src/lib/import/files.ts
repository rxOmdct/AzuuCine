/**
 * Lecture des fichiers d'export (sans dépendance) :
 *  - mini-lecteur ZIP (entrées « stockées » ou « deflate », décompressées par le navigateur) ;
 *  - décompression gzip (.xml.gz de MyAnimeList) ;
 *  - lecteur CSV (guillemets, retours à la ligne dans les champs, BOM).
 * Tout est borné : un fichier piégé (zip bomb, CSV géant) est refusé au lieu de bloquer l'appli.
 */

/** Taille maximale décompressée, toutes entrées confondues. */
const MAX_UNPACKED = 80 * 1024 * 1024
/** Nombre maximal de lignes lues dans un CSV. */
const MAX_ROWS = 200_000

export class ImportFileError extends Error {}

export interface TextFile {
  /** Chemin dans l'archive (ou nom du fichier), en minuscules, avec « / » */
  path: string
  text: string
}

/** Décompresse avec le DecompressionStream du navigateur, en s'arrêtant au-delà de `max` octets. */
async function inflate(data: Uint8Array, format: 'deflate-raw' | 'gzip', max: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new ImportFileError('unsupported')
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream(format))
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      void reader.cancel().catch(() => {})
      throw new ImportFileError('tooBig')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let pos = 0
  for (const c of chunks) {
    out.set(c, pos)
    pos += c.byteLength
  }
  return out
}

const decoder = () => new TextDecoder('utf-8')

export const isZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04
export const isGzip = (b: Uint8Array) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b

/**
 * Extrait les fichiers texte d'une archive ZIP dont le nom passe le filtre.
 * Lit le répertoire central (fiable même quand les tailles locales sont différées).
 */
export async function unzipText(bytes: Uint8Array, keep: (path: string) => boolean): Promise<TextFile[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // Fin du répertoire central : signature 0x06054b50, dans les 64 Ko de la fin
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new ImportFileError('badZip')
  const count = view.getUint16(eocd + 10, true)
  let p = view.getUint32(eocd + 16, true)
  const out: TextFile[] = []
  let unpacked = 0
  for (let n = 0; n < count && n < 5000; n++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) throw new ImportFileError('badZip')
    const method = view.getUint16(p + 10, true)
    const flags = view.getUint16(p + 8, true)
    const compSize = view.getUint32(p + 20, true)
    const size = view.getUint32(p + 24, true)
    const nameLen = view.getUint16(p + 28, true)
    const extraLen = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    const local = view.getUint32(p + 42, true)
    const rawName = bytes.subarray(p + 46, p + 46 + nameLen)
    const name = (flags & 0x800 ? decoder().decode(rawName) : String.fromCharCode(...rawName)).replace(/\\/g, '/').toLowerCase()
    p += 46 + nameLen + extraLen + commentLen

    if (name.endsWith('/') || !keep(name)) continue
    if (flags & 0x1) throw new ImportFileError('encrypted')
    if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) throw new ImportFileError('badZip')
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    const data = bytes.subarray(start, start + compSize)
    if (data.length < compSize) throw new ImportFileError('badZip')
    const budget = MAX_UNPACKED - unpacked
    let content: Uint8Array
    if (method === 0) content = data
    else if (method === 8) content = await inflate(data, 'deflate-raw', Math.min(budget, Math.max(size, 1) + 1024))
    else throw new ImportFileError('badZip')
    unpacked += content.byteLength
    if (unpacked > MAX_UNPACKED) throw new ImportFileError('tooBig')
    out.push({ path: name, text: decoder().decode(content) })
  }
  return out
}

export async function gunzipText(bytes: Uint8Array): Promise<string> {
  return decoder().decode(await inflate(bytes, 'gzip', MAX_UNPACKED))
}

/** Normalise un nom de colonne : « Watched Date » → « watched_date ». */
export const columnKey = (s: string) =>
  s
    .replace(/^﻿/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')

export type CsvRow = Record<string, string>

/** Lit un CSV (virgule, point-virgule ou tabulation) en lignes indexées par nom de colonne normalisé. */
export function parseCsv(input: string): { columns: string[]; rows: CsvRow[] } {
  const text = input.replace(/^﻿/, '')
  const nl = text.indexOf('\n')
  const firstLine = nl < 0 ? text : text.slice(0, nl)
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length] as const)
  const sep = counts.sort((a, b) => b[1] - a[1])[0][0]

  const records: string[][] = []
  let field = ''
  let row: string[] = []
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"' && field === '') quoted = true
    else if (c === sep) {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.length > 1 || row[0] !== '') records.push(row)
      row = []
      if (records.length > MAX_ROWS) break
    } else field += c
  }
  if (field !== '' || row.length) {
    row.push(field)
    if (row.length > 1 || row[0] !== '') records.push(row)
  }
  const header = records.shift() ?? []
  const columns = header.map(columnKey)
  const rows = records.map((r) => {
    const o: CsvRow = Object.create(null)
    columns.forEach((k, j) => {
      if (k && !(k in o)) o[k] = (r[j] ?? '').trim()
    })
    return o
  })
  return { columns, rows }
}

/** Première valeur non vide parmi plusieurs noms de colonne possibles. */
export function pick(row: CsvRow, names: string[]): string | undefined {
  for (const n of names) {
    const v = row[n]
    if (v != null && v !== '') return v
  }
  return undefined
}

/** Lit un fichier choisi par l'utilisateur (zip, gz ou texte) en liste de fichiers texte. */
export async function readImportFile(file: File, keep: (path: string) => boolean, maxBytes: number): Promise<TextFile[]> {
  if (file.size > maxBytes) throw new ImportFileError('tooBig')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const name = file.name.toLowerCase()
  if (isZip(bytes)) return unzipText(bytes, keep)
  if (isGzip(bytes)) return [{ path: name.replace(/\.gz$/, ''), text: await gunzipText(bytes) }]
  return [{ path: name, text: decoder().decode(bytes) }]
}
