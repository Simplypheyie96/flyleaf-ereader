/* The dictionary.

   A tap on a word should say what the word means. That is one gesture and no
   waiting, which rules out both of the answers this app used to give: a
   concordance tells you where else the word appears in this book, which is a
   different question, and Wiktionary is a network round trip to a page of
   etymology and inflection tables that a reader who paused mid-sentence did
   not ask for. It also rules out a definitions API. dictionaryapi.dev was
   measured: three of eight words came back at all, every cache miss hung for
   twenty seconds, and it indexes headwords only, so `endeared`, `walked` and
   `running` all returned nothing. And it needs a network, which this app's
   guardrails forbid outright.

   So the dictionary ships with the app. WordNet 3.1, Princeton, permissive
   BSD-style licence, reduced by `scripts/build-dictionary.mjs` to at most
   three senses a word and two per part of speech, single-word lemmas only:
   87k entries, 7.8MB raw and 2.5MB over the wire, sharded by first letter so
   a reader downloads the letters they actually tap.

   The shards are precached with the fonts, so the first tap after an install
   works on a plane. */

export type Sense = { pos: string; gloss: string }
export type Entry = { word: string; senses: Sense[] }

const POS_NAME: Record<string, string> = {
    n: 'noun', v: 'verb', a: 'adjective', r: 'adverb',
}

type Shard = Record<string, [string, string][]>

const shards = new Map<string, Promise<Shard>>()
let exceptions: Promise<Record<string, string[]>> | null = null

function load<T>(name: string, fallback: T): Promise<T> {
    return fetch(`${import.meta.env.BASE_URL}dict/${name}.json`)
        .then(r => (r.ok ? r.json() : fallback))
        .catch(() => fallback)
}

function shardFor(lemma: string): Promise<Shard> {
    const c = lemma[0]
    const key = c >= 'a' && c <= 'z' ? c : 'other'
    let p = shards.get(key)
    if (!p) { p = load<Shard>(key, {}); shards.set(key, p) }
    return p
}

/** Everything a reader can leave around a word: quotes, the possessive, an
    em dash that the text layer glued on, a footnote marker. Curly apostrophes
    are folded to straight ones first so `don’t` and `don't` are one word. */
export function normalise(raw: string): string {
    return raw
        .replace(/[‘’ʼ]/g, "'")
        .toLowerCase()
        .replace(/^[^a-z']+/, '')
        .replace(/[^a-z']+$/, '')
        .replace(/'s$/, '')
        .trim()
}

/* Morphy's detachment rules, the same suffix table WordNet's own lookup uses.
   Order matters: the longest suffix that matches is tried first, because
   `ches` -> `ch` must win over `s` -> `` on `beaches`. */
const RULES: [string, string][] = [
    ['ches', 'ch'], ['shes', 'sh'], ['sses', 'ss'], ['xes', 'x'], ['zes', 'z'],
    ['ies', 'y'], ['ves', 'f'], ['men', 'man'],
    ['ing', ''], ['ing', 'e'],
    ['est', ''], ['est', 'e'],
    ['ed', ''], ['ed', 'e'],
    ['er', ''], ['er', 'e'],
    ['es', ''], ['es', 'e'],
    ['s', ''],
]

function candidates(word: string): string[] {
    const out = [word]
    for (const [from, to] of RULES) {
        if (word.length > from.length + 1 && word.endsWith(from)) {
            const stem = word.slice(0, -from.length) + to
            out.push(stem)
            /* `running` -> `runn` -> `run`. English doubles a final consonant
               before -ing/-ed/-er/-est, and the doubled form is never the
               lemma, so undoing it is safe wherever the rule fired at all. */
            const n = stem.length
            if (n > 2 && stem[n - 1] === stem[n - 2] && !'aeiou'.includes(stem[n - 1])) {
                out.push(stem.slice(0, -1))
            }
        }
    }
    return out
}

const cache = new Map<string, Entry | null>()

/** The word, or the nearest lemma the word inflects from, or nothing. Never
    throws and never rejects: a dictionary that fails is a dictionary that
    says it has no entry, because there is nothing a reader can do about a
    missing shard mid-sentence. */
export async function lookUp(raw: string): Promise<Entry | null> {
    const word = normalise(raw)
    if (!word || word.length > 40 || /\s/.test(word)) return null
    if (cache.has(word)) return cache.get(word) ?? null

    const found = await resolve(word)
    cache.set(word, found)
    return found
}

async function resolve(word: string): Promise<Entry | null> {
    /* The irregulars first, but only as one more candidate rather than as a
       short circuit: `saw` is both the past of `see` and a tool, and a reader
       who taps it should be shown the tool as well. */
    if (!exceptions) exceptions = load<Record<string, string[]>>('exc', {})
    const irregular = (await exceptions)[word] ?? []
    const tries = [...new Set([...candidates(word), ...irregular])]

    for (const lemma of tries) {
        const shard = await shardFor(lemma)
        const rows = shard[lemma]
        if (!rows?.length) continue
        return {
            word: lemma,
            senses: rows.map(([pos, gloss]) => ({ pos: POS_NAME[pos] ?? pos, gloss })),
        }
    }
    return null
}
