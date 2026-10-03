#!/usr/bin/env node
// Convertit dist/_headers (format Netlify, généré par vite.config.ts) en snippets nginx.
// Usage : node deploy/headers-to-nginx.mjs dist/_headers <dossier-de-sortie>
// Sortie : security-headers.conf (bloc "/*") et locations.conf (un "location =" par autre chemin).
// Les en-têtes ne sont écrits qu'à un seul endroit (vite.config.ts) : rien à dupliquer à la main.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const [, , input, outDir] = process.argv
if (!input || !outDir) {
  console.error('usage: headers-to-nginx.mjs <_headers> <outDir>')
  process.exit(2)
}

const blocks = new Map() // chemin -> [[nom, valeur], ...]
let current = null
for (const raw of readFileSync(input, 'utf8').split('\n')) {
  const line = raw.replace(/\s+$/, '')
  if (!line || line.startsWith('#')) continue
  if (!/^\s/.test(line)) {
    current = line.trim()
    if (!/^\/[A-Za-z0-9._\/*-]*$/.test(current)) fail(`chemin invalide : ${current}`)
    blocks.set(current, [])
    continue
  }
  if (current === null) fail(`en-tête sans chemin : ${line}`)
  const i = line.indexOf(':')
  const name = line.slice(0, i).trim()
  const value = line.slice(i + 1).trim()
  if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(name) || !value) fail(`en-tête invalide : ${line}`)
  if (/[$"\\]/.test(value)) fail(`caractère interdit dans ${name}`)
  blocks.get(current).push([name, value])
}

function fail(msg) {
  console.error(`headers-to-nginx: ${msg}`)
  process.exit(1)
}

const add = (h) => h.map(([n, v]) => `add_header ${n} "${v}" always;`)
const global = blocks.get('/*')
if (!global || !global.some(([n]) => n.toLowerCase() === 'content-security-policy')) {
  fail('bloc "/*" absent ou sans Content-Security-Policy : refus de publier sans CSP')
}

mkdirSync(outDir, { recursive: true })
writeFileSync(`${outDir}/security-headers.conf`, add(global).join('\n') + '\n')

const locations = []
for (const [path, h] of blocks) {
  if (path === '/*') continue
  if (path.includes('*')) fail(`motif non géré : ${path}`)
  locations.push(
    `location = ${path} {`,
    '    include /srv/azuucine/current/nginx/security-headers.conf;',
    ...add(h).map((l) => `    ${l}`),
    '}',
  )
}
writeFileSync(`${outDir}/locations.conf`, locations.join('\n') + '\n')
console.log(`ok : ${global.length} en-têtes globaux, ${locations.filter((l) => l.startsWith('location')).length} chemin(s) spécifique(s)`)
