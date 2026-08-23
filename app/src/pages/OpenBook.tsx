import { useCallback, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PICKER_ACCEPT, importFile, type ImportResult } from '../import'
import { useQueuedFiles } from '../openQueue'
import { BackIcon, OpenIcon } from '../components/icons'
import { bytes } from '../lib'

/* Import. The picker, the queue that drops and OS launches feed, and the honest
   messages for the two files this app will not open.

   Nothing here parses anything: `src/import` does the work, and it is the same
   function for a picked file, a dropped one and a double-clicked one. What this
   screen owns is what the reader is told. */

type Row = { key: string; result: ImportResult; name: string }

/* A file dialog needs types, not a comma-separated string, when it goes through
   the File System Access API — and the description is what the dialog's filter
   dropdown says. Worth the extra path on desktop Chrome: the input element's
   accept list shows up there as "Custom Files". */
type PickerOptions = {
  multiple?: boolean
  types?: { description: string; accept: Record<string, string[]> }[]
}
type Picker = (options: PickerOptions) => Promise<{ getFile(): Promise<File> }[]>

export function OpenBook() {
  const navigate = useNavigate()
  const input = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  const run = useCallback(
    async (files: File[]) => {
      const done: Row[] = []
      for (const file of files) {
        setBusy(file.name)
        /* Sequential. Four archives decompressing at once on a phone is four
           times the memory for the same total wait — and the reader is watching
           one line of text either way. */
        const result = await importFile(file)
        done.push({ key: `${file.name}-${file.size}-${done.length}`, result, name: file.name })
      }
      setBusy(null)
      setRows((previous) => [...done, ...previous])

      /* One book, and it worked: go to it. A results list with a single green
         line on it is a receipt for something the reader can already see
         happened. Two or more, or anything refused, and the list is the point.

         A duplicate counts. The row for one says "opening the one you have",
         and it used to be excluded here, so the sentence was a promise the
         code did not keep -- a reader who picked a file they already had was
         left on the picker being told they were being taken somewhere. Either
         the words or the behaviour had to change, and the behaviour was the
         one that was wrong: somebody who opens a file wants to read the book,
         and whether it arrived just now or last week is not their question. */
      const [only] = done
      if (done.length === 1 && only.result.ok) {
        navigate(`/book/${only.result.book.id}`, { replace: true })
      }
    },
    [navigate],
  )

  /* Drops and OS launches arrive here. Both already put their files in the
     queue and navigated to this screen, so there is nothing to do but import
     them. */
  useQueuedFiles((files) => { void run(files) })

  const pick = async () => {
    const picker = (window as unknown as { showOpenFilePicker?: Picker }).showOpenFilePicker
    if (!picker) {
      input.current?.click()
      return
    }
    try {
      const handles = await picker({
        multiple: true,
        /* One group, derived from ACCEPT — see src/import. And the all-files
           option is left on (it is the default): a filter that cannot be
           switched off is a filter that can hide a book, which is the bug this
           whole path was rewritten for. */
        types: [{ description: 'Books', accept: PICKER_ACCEPT }],
      })
      await run(await Promise.all(handles.map((handle) => handle.getFile())))
    } catch {
      /* The reader pressed Cancel. That is an answer, not an error. */
    }
  }

  return (
    <main className="page">
      <div className="page-inner page-inner--detail">
        {/* The same back affordance as the book sheet, not a bare link in the
            header's right slot. That one inherited no colour at all, so it
            rendered in the UA's default blue — 1.94:1 on the dark ground. */}
        <Link className="back" to="/library"><BackIcon />Library</Link>

        <header className="app-head">
          <h1>Open a book</h1>
        </header>

        <section className="drop">
          <OpenIcon />
          <p className="ui-p drop-lead">
            Pick a file, or drag one anywhere into this window. It is read on this
            device and stays here — nothing is uploaded.
          </p>
          <button className="btn" type="button" onClick={() => void pick()} disabled={busy !== null}>
            {busy ? 'Reading…' : 'Choose a file'}
          </button>
          <input
            ref={input}
            type="file"
            multiple
            /* NO accept list, deliberately, and this is the one line on this
               screen that has to stay wrong-looking.

               It carried every extension in ACCEPT. On iOS that is not a hint,
               it is a whitelist: Safari resolves each entry to a Uniform Type
               Identifier and hands the set to the Files picker, which then
               greys out everything that does not conform. `.epub`, `.txt`,
               `.pdf`, `.html` and `.md` all resolve to real system types and
               stayed selectable. `.mobi`, `.prc`, `.azw`, `.azw3`, `.kf8`,
               `.fb2` and `.fbz` are registered by nothing on a stock iPhone,
               so they resolved to nothing, and four formats this app parses
               correctly and has fixtures for could not be picked at all. The
               shelf advertised them; the picker refused to let them through.

               A filter is a nicety. Sniffing is the authority — it always was,
               it reads the bytes, and it names precisely what a non-book is
               (`src/import/sniff.ts`). So the nicety goes, on every platform
               rather than behind a user-agent test: the picker shows every
               file, and a file that is not a book gets a sentence saying what
               it is instead of being silently unreachable. Desktop Chrome and
               Edge still get a real Books filter through
               `showOpenFilePicker` above, where extension matching is not a
               UTI lookup and demonstrably works.

               Do not add an accept list back here without an iPhone and a
               `.mobi` file. */
            className="sr-only"
            /* Not a tab stop, and not in the accessibility tree either. It is
               1x1 and invisible; the button above is what operates it, and a
               keyboard user landing on it lands on nothing they can see. A
               screen reader announcing it would announce a second, nameless
               "file upload" beside a button that already says what it does. */
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? [])
              /* Cleared so that picking the same file twice in a row fires a
                 change event the second time. */
              event.target.value = ''
              void run(files)
            }}
          />
          {busy && <p className="mono-meta drop-busy">{busy}</p>}
        </section>

        {rows.length > 0 && (
          <ul className="results">
            {rows.map(({ key, result, name }) => (
              <li key={key} className={result.ok ? 'result' : 'result result--no'}>
                {result.ok ? (
                  <>
                    <span className="result-title">{result.book.title}</span>
                    <span className="ui-p ui-p--soft">
                      {result.duplicate
                        ? 'Already in your library — opening the one you have.'
                        : `Added · ${bytes(result.book.fileSize)}`}
                    </span>
                    <Link className="btn btn--ghost btn--sm" to={`/book/${result.book.id}`}>Open</Link>
                  </>
                ) : (
                  <>
                    <span className="result-title">{name}</span>
                    <span className="ui-p ui-p--soft">
                      {result.reason === 'drm'
                        ? 'This file is DRM-protected, so its text is encrypted and no reader can open it without the shop’s key. Flyleaf eReader does not support DRM and never will. A DRM-free copy of the same book will open.'
                        : `Flyleaf eReader does not read ${result.what}. Reflowable books and PDFs only — EPUB, MOBI, AZW3, FB2, TXT, Markdown, HTML, PDF.`}
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}
