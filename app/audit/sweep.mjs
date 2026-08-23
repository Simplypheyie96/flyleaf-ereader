/* sweep.mjs — run the drivers and read every one of them.
 *
 * This exists because of a lie a one-liner told. The sweep used to be
 *
 *   for d in ...; do node audit/$d.mjs | grep -oE "FINDINGS: [0-9]+" | tail -1; done
 *
 * and it printed a clean column of "FINDINGS: 0" for ten drivers and *nothing*
 * for four others — routes, states, sheet and reader, which end with a JSON
 * object carrying a `findings` array and never print that line. A blank cell
 * read as clean. It meant unmeasured. Worse, the `|| echo NO-OUTPUT` guard
 * could never fire: `grep | tail` exits through tail, which always succeeds.
 *
 * So the rule here is that a driver has exactly three outcomes and silence is
 * not one of them: a count, a list of findings, or UNREADABLE. UNREADABLE is a
 * failure of the sweep, reported as loudly as a finding, because a driver whose
 * result cannot be read has told us nothing at all.
 *
 * Sequential on purpose. Several drivers measure per-frame cost under a CPU
 * throttle, and a second Chromium on the same machine would change the number
 * they are there to take.
 *
 *   node audit/sweep.mjs                 # the gate: chrome, reader, formats, a11y
 *   node audit/sweep.mjs reader controls # only these
 *   node audit/sweep.mjs --all           # every driver, phone and formats included
 *
 * Full stdout for every driver is kept, and the path is printed, because
 * "findings: 3" is a summons to read the run, not a result.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/* The default set is the gate plus the surfaces, in the order a reader meets
   them. phone.mjs and formats.mjs are out of the default only because they are
   minutes rather than seconds each; --all puts them back. */
const GATE = [
    'routes', 'states', 'sheet', 'stats',
    'reader', 'controls', 'marks', 'text',
    'a11y', 'panels', 'measure', 'ghost',
    'appdata', 'covers',
]
const SLOW = ['formats', 'mobi', 'pdf', 'backup', 'install', 'tip', 'origin', 'phone']
const REST = ['tints', 'darkstock', 'swatches', 'ramp', 'faces', 'settings', 'sync', 'turn']

const argv = process.argv.slice(2)
const names = argv.includes('--all')
    ? [...GATE, ...SLOW, ...REST]
    : argv.filter(a => !a.startsWith('-')).length ? argv.filter(a => !a.startsWith('-')) : GATE

const OUT = await mkdtemp(join(tmpdir(), 'flyleaf-sweep-'))

/* Both output shapes, and a named failure when it is neither. A driver that
   prints a count AND a findings array must agree with itself; disagreement is
   its own finding, because one of the two is stale. */
function read(text) {
    const counts = [...text.matchAll(/FINDINGS:\s*(\d+)/g)]
    const count = counts.length ? Number(counts[counts.length - 1][1]) : null

    let listed = null
    const a = text.indexOf('{'), b = text.lastIndexOf('}')
    if (a >= 0 && b > a) {
        try {
            const o = JSON.parse(text.slice(a, b + 1))
            if (Array.isArray(o?.findings)) listed = o.findings
        } catch { /* not JSON, or JSON with prose around it — the count path covers those */ }
    }

    if (count === null && listed === null) return { ok: false, why: 'printed neither a FINDINGS count nor a JSON findings array' }
    if (count !== null && listed !== null && count !== listed.length) {
        return { ok: false, why: `says FINDINGS: ${count} but its array holds ${listed.length} — one of the two is stale` }
    }
    return { ok: true, n: count ?? listed.length, items: listed ?? [] }
}

const rows = []
for (const name of names) {
    process.stdout.write(`${name.padEnd(10)} `)
    const t0 = Date.now()
    const text = await new Promise((res) => {
        const p = spawn(process.execPath, [join(HERE, `${name}.mjs`)], { cwd: join(HERE, '..'), env: process.env })
        let buf = ''
        p.stdout.on('data', d => { buf += d })
        p.stderr.on('data', d => { buf += d })
        p.on('close', code => res(buf + `\n[exit ${code}]`))
        p.on('error', e => res(`[could not start: ${e.message}]`))
    })
    const secs = ((Date.now() - t0) / 1000).toFixed(0)
    const log = join(OUT, `${name}.txt`)
    await writeFile(log, text)

    const r = read(text)
    if (!r.ok) {
        rows.push({ name, unreadable: r.why, log })
        console.log(`UNREADABLE  ${secs}s  — ${r.why}`)
        continue
    }
    rows.push({ name, n: r.n, items: r.items, log })
    console.log(`${r.n === 0 ? 'clean' : `${r.n} FINDING${r.n > 1 ? 'S' : ''}`}       ${secs}s`)
    for (const f of r.items) console.log(`    - ${typeof f === 'string' ? f : JSON.stringify(f)}`)
}

const dirty = rows.filter(r => r.n > 0)
const blind = rows.filter(r => r.unreadable)

console.log(`\n${rows.length} drivers, ${rows.length - dirty.length - blind.length} clean, ${dirty.length} with findings, ${blind.length} unreadable`)
console.log(`full output: ${OUT}`)
if (blind.length) console.log(`\nunreadable — the sweep learned nothing from these:\n` + blind.map(r => `  ${r.name}: ${r.unreadable}`).join('\n'))
if (dirty.length) console.log(`\nread these:\n` + dirty.map(r => `  ${r.log}`).join('\n'))

process.exitCode = dirty.length || blind.length ? 1 : 0
