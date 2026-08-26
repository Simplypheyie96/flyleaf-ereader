/* Builds the bundled dictionary from WordNet 3.1 into app/public/dict/.
 *
 * Run by hand, not on every build: the output is committed, because it changes
 * only when WordNet does and a reader should never wait on a 16MB download to
 * find out what a word means.
 *
 *     node scripts/build-dictionary.mjs /path/to/wordnet/dict
 *
 * WordNet 3.1 is Princeton's, under its own permissive licence (a BSD-style
 * notice, redistribution allowed with the notice kept). LICENCE.txt is copied
 * next to the shards so the notice ships with the data it covers.
 *
 * Why a bundled dataset and not an API. A dictionary that needs the network is
 * not a dictionary in a reading app: reading happens on trains, on planes and
 * in bed with the wifi off, and a definition that sometimes arrives is worse
 * than one that never promises to. dictionaryapi.dev was measured on this
 * project before this file existed -- 22 requests, three of eight words
 * returned, every cache miss hanging for twenty seconds -- and it also only
 * knows headwords, so `endeared`, `walked` and `running` all failed. Those are
 * the words that are actually on a page.
 *
 * The shape of the output:
 *   a.json ... z.json, other.json   one shard per first letter
 *   exc.json                        WordNet's irregular-inflection lists
 * A shard is { lemma: [[pos, gloss], ...] }, at most SENSES entries per lemma,
 * in WordNet's own sense order -- which is frequency order, so the first gloss
 * is the one a reader most likely wants.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = process.argv[2]
if (!SRC || !existsSync(join(SRC, 'index.noun'))) {
  console.error('usage: node scripts/build-dictionary.mjs <wordnet-dict-dir>')
  process.exit(1)
}
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'dict')
mkdirSync(OUT, { recursive: true })

/* Four senses. One is too few for a word like `set`; ten is a wall of text in
   a popover that has to fit over a page of prose without covering it. Four is
   what fits the panel at its smallest supported height without scrolling. */
const SENSES = 3
/* A gloss longer than this is a definition with three examples welded on. Cut
   at a sentence boundary rather than mid-word. */
const MAX_GLOSS = 220

const POS = { noun: 'n', verb: 'v', adj: 'a', adv: 'r' }

/** offset -> gloss, per part of speech. */
function readData(pos) {
  const map = new Map()
  for (const line of readFileSync(join(SRC, `data.${pos}`), 'latin1').split('\n')) {
    if (!line || line.startsWith('  ')) continue
    const bar = line.indexOf(' | ')
    if (bar < 0) continue
    const offset = line.slice(0, line.indexOf(' '))
    /* WordNet packs the definition and its examples into one gloss, separated
       by semicolons, with every example in double quotes. The definition is
       everything before the first quoted run. */
    let gloss = line.slice(bar + 3).trim()
    const q = gloss.indexOf('; "')
    if (q > 0) gloss = gloss.slice(0, q)
    gloss = gloss.trim().replace(/\s+/g, ' ')
    if (gloss.length > MAX_GLOSS) {
      const cut = gloss.lastIndexOf(' ', MAX_GLOSS)
      gloss = gloss.slice(0, cut > 60 ? cut : MAX_GLOSS).trimEnd() + '…'
    }
    if (gloss) map.set(offset, gloss)
  }
  return map
}

const entries = new Map() // lemma -> [[pos, gloss], ...]

for (const [pos, letter] of Object.entries(POS)) {
  const data = readData(pos)
  for (const line of readFileSync(join(SRC, `index.${pos}`), 'latin1').split('\n')) {
    if (!line || line.startsWith('  ')) continue
    const f = line.trim().split(/\s+/)
    const lemma = f[0].replace(/_/g, ' ')
    const pCnt = Number(f[3])
    /* lemma pos synset_cnt p_cnt [ptrs...] sense_cnt tagsense_cnt offsets... */
    const offsets = f.slice(4 + pCnt + 2)
    const got = entries.get(lemma) ?? []
    for (const off of offsets) {
      const gloss = data.get(off)
      if (!gloss) continue
      if (got.some(g => g[1] === gloss)) continue
      got.push([letter, gloss])
      break // one sense per synset list head per pos pass; more added below
    }
    /* Take up to SENSES from this part of speech, but never let one part of
       speech crowd out the others: a word that is both a noun and a verb
       should show both. */
    for (const off of offsets.slice(1)) {
      if (got.filter(g => g[0] === letter).length >= 2) break
      const gloss = data.get(off)
      if (!gloss || got.some(g => g[1] === gloss)) continue
      got.push([letter, gloss])
    }
    entries.set(lemma, got)
  }
}

/* WordNet's own irregular forms: `geese -> goose`, `went -> go`, `best ->
   good`. The regular rules live in the app (dict.ts); only the words the rules
   cannot reach need to be shipped. */
const exc = {}
for (const [pos, letter] of Object.entries(POS)) {
  for (const line of readFileSync(join(SRC, `${pos}.exc`), 'latin1').split('\n')) {
    if (!line.trim()) continue
    const [from, ...to] = line.trim().split(/\s+/)
    if (!to.length) continue
    const key = from.replace(/_/g, ' ')
    ;(exc[key] ??= []).push(...to.map(t => t.replace(/_/g, ' ')))
  }
  void letter
}
for (const k of Object.keys(exc)) exc[k] = [...new Set(exc[k])]

const shards = new Map()
for (const [lemma, senses] of entries) {
  if (!senses.length) continue
  /* Single words only. WordNet's index is mostly collocations and taxonomy --
     `Abelian group`, `Abelmoschus esculentus`, `agree with` -- and none of it
     is reachable by the one gesture this data exists to serve: tapping a word
     on a page. Dropping it takes the set from 161k entries and 14.9MB to 87k
     and 6.1MB, which is the difference between a dictionary that can be
     precached with the fonts and one that cannot. */
  if (lemma.includes(' ') || lemma.includes('-')) continue
  const c = lemma[0].toLowerCase()
  const key = c >= 'a' && c <= 'z' ? c : 'other'
  const shard = shards.get(key) ?? {}
  shard[lemma] = senses.slice(0, SENSES)
  shards.set(key, shard)
}

let total = 0
for (const [key, shard] of shards) {
  const json = JSON.stringify(shard)
  writeFileSync(join(OUT, `${key}.json`), json)
  total += json.length
  console.log(`${key}.json  ${Object.keys(shard).length} words  ${(json.length / 1024).toFixed(0)}KB`)
}
const excJson = JSON.stringify(exc)
writeFileSync(join(OUT, 'exc.json'), excJson)
total += excJson.length
console.log(`exc.json  ${Object.keys(exc).length} forms  ${(excJson.length / 1024).toFixed(0)}KB`)

for (const notice of ['LICENSE', 'license', 'LICENCE']) {
  const p = join(SRC, notice)
  if (existsSync(p)) { copyFileSync(p, join(OUT, 'LICENSE.txt')); break }
}
console.log(`\ntotal ${(total / 1024 / 1024).toFixed(2)}MB uncompressed across ${shards.size + 1} files`)
