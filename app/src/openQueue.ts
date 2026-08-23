import { useEffect } from 'react'

/* Files waiting to be imported, from wherever they came.

   Three things hand the app a file: the picker, a drag-and-drop anywhere in the
   window, and the OS — a double-clicked .epub, via the manifest's
   `file_handlers` and `window.launchQueue`. All three put the file here and
   navigate to /open, which imports it. One queue, one importer, one set of
   messages when something is wrong with the file.

   The launch consumer has to be registered during startup, not when /open
   mounts: the browser calls it once, early, and a consumer set after that call
   never hears about the file the reader opened the app with. So this is
   initialised from main.tsx and the screen subscribes to it. */

type Handle = { getFile(): Promise<File> }
type LaunchParams = { files: Handle[] }
type LaunchQueue = { setConsumer(consume: (params: LaunchParams) => void): void }

let waiting: File[] = []
const listeners = new Set<(files: File[]) => void>()

/** Put files in the queue and tell whoever is listening. */
export function queueFiles(files: File[]): void {
  if (files.length === 0) return
  waiting = [...waiting, ...files]
  for (const listen of listeners) listen(waiting)
}

/** Take everything in the queue, emptying it. Taking rather than reading, on
    purpose: a file imported once must not be imported again when the screen
    re-mounts on a back-navigation. */
export function takeQueuedFiles(): File[] {
  const out = waiting
  waiting = []
  return out
}

/** Register the OS launch consumer. Called once, at startup. */
export function initOpenQueue(): void {
  const queue = (window as unknown as { launchQueue?: LaunchQueue }).launchQueue
  if (!queue) return
  queue.setConsumer((params) => {
    void Promise.all(params.files.map((handle) => handle.getFile()))
      .then(queueFiles)
      /* A handle the browser can no longer resolve — the file moved between the
         double-click and the launch. There is nothing to import and nothing
         useful to say about a file whose name we never learned. */
      .catch(() => undefined)
  })
}

/** Hand queued files to a screen, now and as they arrive. */
export function useQueuedFiles(take: (files: File[]) => void): void {
  useEffect(() => {
    const pending = takeQueuedFiles()
    if (pending.length) take(pending)
    const listen = () => take(takeQueuedFiles())
    listeners.add(listen)
    return () => { listeners.delete(listen) }
    /* `take` is a fresh closure every render and re-subscribing on each one
       would be pointless churn; the callback the screen passes only ever calls
       into stable functions. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
