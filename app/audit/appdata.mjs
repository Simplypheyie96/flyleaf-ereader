/* Whose file is it? — the one question that decides whether "remove my backup"
   is safe.

   THE HIDDEN DRIVE FOLDER IS SHARED. `appDataFolder` is scoped to the OAuth
   client, and this app deliberately shares its client with Flyleaf Press so the
   two need one consent screen between them (SPEC.md § 15.1). One client, one
   folder, two products' documents in it.

   Reading and writing were never the risk: every name is distinct and every
   access is an exact-name lookup. Deleting was. `dropAll` took EVERY file in
   the folder — the comment on it argued for exactly that — so this app's
   "remove the copy from my Drive" also deleted Press's `library.json`, silently,
   in one press. Press's own button does the mirror of it.

   This driver tests the predicate that fixes it, `ours` in record.ts, against a
   folder listing built to look like the real shared one: our four shapes, our
   pre-tag legacy files, our duplicates, Press's backup, and a file from an app
   that does not exist yet.

   It runs on the SOURCE rather than the browser because there is nothing to
   click: signing in to a real Drive is the one thing an audit run must not do,
   so the folder is synthetic and the predicate is real. */
import { build } from 'esbuild'
import { readFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = '/Users/simplypheyie/projects/Flyleaf Ebook reader/app'
const findings = []
const bad = (m) => findings.push(m)

/* record.ts reaches Dexie through ../db, which has no business being built for
   a pure-function test — so it is stubbed. drive.ts is import-free and is
   bundled for real, which is what makes the APP tag under test the same string
   the writer stamps on. */
const out = join(tmpdir(), `flyleaf-appdata-${process.pid}.mjs`)
await build({
  entryPoints: [join(ROOT, 'audit/fixtures/appdata-entry.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: out,
  logLevel: 'silent',
  /* A resolve plugin rather than esbuild's `alias`, which takes bare package
     names only and rejects a relative path outright. */
  plugins: [
    {
      name: 'stub-db',
      setup(b) {
        b.onResolve({ filter: /^\.\.\/db$/ }, () => ({
          path: join(ROOT, 'audit/fixtures/db-stub.ts'),
        }))
      },
    },
  ],
})
const { ours, APP, SHELF, MARKS, PLACE, bookFileName } = await import(`file://${out}`)
unlinkSync(out)

/* The tag the writer actually stamps, read out of drive.ts rather than retyped,
   so a rename there fails this instead of quietly passing it. */
if (APP !== 'ereader') bad(`APP is ${JSON.stringify(APP)}, expected 'ereader'`)

const FP = '9f2c1ab4d7e05386'

/* name, app tag, ours?, why */
const FOLDER = [
  /* ---- ours, tagged: the normal case after this fix ships ---- */
  [SHELF, APP, true, 'our shelf, tagged'],
  [MARKS, APP, true, 'our marks, tagged'],
  [PLACE, APP, true, 'our place, tagged'],
  [bookFileName(FP), APP, true, 'a backed-up book, tagged'],

  /* ---- ours, untagged: a backup made before the tag existed ---- */
  [SHELF, undefined, true, 'our shelf from an older build'],
  [MARKS, undefined, true, 'our marks from an older build'],
  [PLACE, undefined, true, 'our place from an older build'],
  [bookFileName(FP), undefined, true, 'a book from an older build'],

  /* ---- ours, and the reason the delete lists duplicates ---- */
  [PLACE, APP, true, 'a retried half-written upload, same name'],

  /* ---- ours, renamed in some later version: the tag is what saves this ---- */
  ['reading-position.json', APP, true, 'a document we renamed, still tagged'],

  /* ---- NOT ours: the whole point ---- */
  ['library.json', undefined, false, "Press's backup, untagged as it is today"],
  ['library.json', 'press', false, "Press's backup once Press tags too"],
  [SHELF, 'press', false, 'a name we use, but tagged as Press — tag wins'],
  ['journal.json', 'flyleaf', false, 'the Flyleaf journal, if it ever syncs here'],
  ['whatever.bin', 'somethingelse', false, 'an app that does not exist yet'],
  ['notes.txt', undefined, false, 'an untagged name neither of us knows'],
]

for (const [name, app, want, why] of FOLDER) {
  const got = ours({ name, app })
  if (got !== want) {
    bad(
      `${why}: ours({name:${JSON.stringify(name)}, app:${JSON.stringify(app)}}) ` +
        `returned ${got}, expected ${want}`,
    )
  } else {
    console.log(`  ${want ? 'delete' : 'KEEP  '}  ${String(name).padEnd(24)} ${why}`)
  }
}

/* The two facts that matter most, stated on their own so a regression in either
   is unmissable rather than one row in a table. */
if (ours({ name: 'library.json' })) bad("FATAL: this app would delete Press's backup")
if (!ours({ name: SHELF })) bad('this app would strand its own pre-tag backup')

/* And the delete has to see duplicates, which the deduped listing hid. A
   half-written retry is two files under one name; `listFolder` collapses them
   on purpose and `dropAll` must not use it. */
const drive = readFileSync(join(ROOT, 'src/sync/drive.ts'), 'utf8')
const dropAll = drive.slice(drive.indexOf('export async function dropAll'))
if (/listFolder\(/.test(dropAll.slice(0, 600))) {
  bad('dropAll is back on the deduped listing — a duplicate upload would be stranded')
}
if (!/appProperties: \{ device, app: APP \}/.test(drive)) {
  bad('write() no longer tags files with APP — every new file becomes unattributable')
}
const tags = drive.match(/appProperties: \{ device, app: APP \}/g) ?? []
if (tags.length !== 2) {
  bad(`write() tags ${tags.length} of its 2 metadata halves — create and update both need it`)
}

console.log(`\n=== FINDINGS: ${findings.length}`)
for (const f of findings) console.log('  · ' + f)
process.exitCode = findings.length ? 1 : 0
