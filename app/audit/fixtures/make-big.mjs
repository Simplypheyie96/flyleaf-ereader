/* Builds audit/fixtures/big.epub — the 4MB EPUB that CLAUDE.md names as the
   throttled-phone test file ("Test on a real phone, throttled, with a 4MB
   EPUB"). Two drivers want it: formats.mjs, to prove a large conforming EPUB
   opens at all, and phone.mjs, to time a cold open against a warm one.

   It exists as a script rather than as a checked-in binary because 4.2MB of
   generated zip in git is 4.2MB that can never be diffed, reviewed or
   explained. Everything here is derived from the seed book that already ships
   in public/seed, so the fixture is reproducible and the repo stays readable.

   How it gets big: every chapter is duplicated COPIES times as
   chapter-N-pK.xhtml, and each copy is added to the manifest and appended to
   the spine. That is deliberately the shape of a long book — many spine items
   of ordinary size — and not one enormous file, because the paginator's cost
   is per section and a single 4MB chapter would measure something else
   entirely. The copies are absent from toc.ncx on purpose: a spine longer than
   the TOC is legal, common, and worth having under test.

   Run: node audit/fixtures/make-big.mjs
   ───────────────────────────────────────────────────────────── */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync, statSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const SEED = join(HERE, '..', '..', 'public', 'seed', 'pride-and-prejudice.epub')
const OUT = join(HERE, 'big.epub')
const COPIES = Number(process.env.COPIES || 10)
const FLOOR = 4_000_000

if (!existsSync(SEED)) {
    console.error('missing seed: ' + SEED)
    process.exit(1)
}

const work = mkdtempSync(join(tmpdir(), 'flyleaf-big-'))
try {
    execFileSync('unzip', ['-q', SEED, '-d', work])

    const textDir = join(work, 'epub', 'text')
    const chapters = readdirSync(textDir).filter(n => /^chapter-\d+\.xhtml$/.test(n)).sort()
    if (!chapters.length) throw new Error('no chapter-N.xhtml in the seed')

    /* The copies. Read once, written COPIES times — the body is untouched, so
       every copy is a valid section on its own and the only thing that grew is
       how many of them there are. */
    const made = []
    for (const name of chapters) {
        const body = readFileSync(join(textDir, name))
        const stem = name.replace(/\.xhtml$/, '')
        for (let k = 2; k <= COPIES + 1; k++) {
            const copy = `${stem}-p${k}.xhtml`
            writeFileSync(join(textDir, copy), body)
            made.push(copy)
        }
    }

    /* The OPF. Both halves have to grow together: a manifest item without an
       itemref is a file the reader never reaches, and an itemref without a
       manifest item is an invalid package. */
    const opfPath = join(work, 'epub', 'content.opf')
    let opf = readFileSync(opfPath, 'utf8')

    const items = made.map(f => `\t\t<item href="text/${f}" id="${f}" media-type="application/xhtml+xml"/>`).join('\n')
    const refs = made.map(f => `\t\t<itemref idref="${f}"/>`).join('\n')

    const manifestEnd = '\t</manifest>'
    const spineEnd = '\t</spine>'
    if (!opf.includes(manifestEnd) || !opf.includes(spineEnd)) throw new Error('unexpected OPF shape')
    opf = opf.replace(manifestEnd, items + '\n' + manifestEnd)
    opf = opf.replace(spineEnd, refs + '\n' + spineEnd)

    /* A different title, so the shelf can tell the fixture from the seed book
       it was grown from at a glance. The identifier is left alone: whether two
       files with one identifier are treated as the same book is the importer's
       decision to make, and quietly editing it here would hide that. */
    opf = opf.replace(/(<dc:title[^>]*>)([^<]*)(<\/dc:title>)/, (_m, a, t, b) => a + t + ': The Long Edition' + b)
    writeFileSync(opfPath, opf)

    /* Zipped in two passes, which is not a style choice: OCF requires
       `mimetype` to be the first entry and stored uncompressed, so it goes in
       with -0 on its own before everything else is deflated on top. */
    if (existsSync(OUT)) unlinkSync(OUT)
    execFileSync('zip', ['-q', '-X', '-0', OUT, 'mimetype'], { cwd: work })
    execFileSync('zip', ['-q', '-X', '-r', '-9', '-D', OUT, '.', '-x', 'mimetype'], { cwd: work })

    const size = statSync(OUT).size
    console.log(`big.epub: ${(size / 1e6).toFixed(2)}MB, ${chapters.length} chapters x ${COPIES} copies = ${made.length} extra sections`)
    if (size < FLOOR) {
        console.error(`too small — CLAUDE.md asks for a 4MB EPUB and this is ${(size / 1e6).toFixed(2)}MB. Re-run with COPIES=${COPIES + 2}.`)
        process.exit(1)
    }
} finally {
    rmSync(work, { recursive: true, force: true })
}
