/* The reader's own Drive, used as the shelf between their devices.

   Everything here talks to ONE hidden folder — `appDataFolder` — which Google
   gives every app that asks for the `drive.appdata` scope. It does not appear
   in the Drive listing, no other app can read it, and we cannot see a single
   file outside it. From this side there is no storage bill and no ceiling,
   because none of it is ours. It is not free to the READER, though: an
   appdata folder counts against their own Drive quota, which is why the book
   files are opt-in and the record is not.

   NOT ONE FILE, AND THAT IS THE DIFFERENCE FROM PRESS. Flyleaf Press writes
   its whole library up as a single `library.json`, because a review changes
   when somebody writes one. A book's record changes when somebody turns a
   page — every few seconds, all evening. One undifferentiated file would mean
   re-uploading the titles, the authors, the descriptions and every highlight
   in the library each time a page turned; at a fifteen-second settle that is
   tens of megabytes an hour of somebody's mobile data to record that they are
   on page 74.

   So the record is split by how often each part moves, and each part is a
   separate Drive file with its own modified time:

     shelf.json   titles, authors, dates, collections, tombstones — changes
                  when a book is added, finished or deleted
     marks.json   highlights, notes, bookmarks — changes when somebody marks
     place.json   positions and reading days — changes on every page turn, and
                  is the smallest of the three by an order of magnitude

   `book-<fingerprint>` files carry the book bytes themselves, one per book,
   written once and never rewritten. See `record.ts` for what is in them. */

const FILES = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'

export interface DriveFile {
  id: string
  name: string
  modifiedTime: string
  /** bytes, as Drive reports them. Absent on a file it has not sized yet. */
  size?: number
  /** Who last wrote it — "iPhone", "Mac". Rides as Drive's own file metadata
      rather than inside the document, so "where was the last change made" is
      answered by the one listing call a sync already makes, instead of by
      downloading the record to render a sentence. */
  device?: string
}

interface RawFile {
  id: string
  name: string
  modifiedTime: string
  size?: string
  appProperties?: Record<string, string>
}

/** Drive returns custom metadata under `appProperties`, one flat string map,
    and every number as a string. */
function unpack(file: RawFile): DriveFile {
  return {
    id: file.id,
    name: file.name,
    modifiedTime: file.modifiedTime,
    size: file.size === undefined ? undefined : Number(file.size),
    device: file.appProperties?.device,
  }
}

/** Turn Drive's refusal into a sentence somebody can act on. Google puts a
    machine-readable `reason` in the body of every error it returns; this reads
    it and says the corresponding human thing, falling back to the status only
    when the body is something unexpected. */
async function explain(response: Response): Promise<string> {
  let reason = ''
  try {
    const body = (await response.json()) as {
      error?: { errors?: { reason?: string }[]; message?: string }
    }
    reason = body.error?.errors?.[0]?.reason ?? ''
  } catch {
    /* An error page rather than an error object. The status still says
       something, and that is what the last line falls back to. */
  }

  if (reason === 'insufficientPermissions' || reason === 'insufficientFilePermissions')
    return 'Flyleaf was not given permission to use your Drive. Sign in again and leave the box ticked on Google’s screen.'
  if (reason === 'storageQuotaExceeded')
    return 'Your Google Drive is full, so nothing could be saved to it.'
  if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded')
    return 'Google asked us to slow down. Sync will try again shortly.'
  if (response.status === 403)
    return 'Google would not let Flyleaf into your Drive. Sign in again and leave the box ticked.'
  if (response.status >= 500) return 'Google Drive is having trouble. Sync will try again shortly.'
  return 'Your library could not reach Google Drive. Check your connection and try again.'
}

async function ask(token: string, url: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    /* 401 is the one worth naming to the CALLER: it means the hour is up, and
       it can fetch a fresh token and come back rather than reporting a break.

       Everything else is named to the READER, and "Drive said no (403)" is not
       that. A number is not something anybody can act on, and the two things a
       403 actually means here have completely different answers: either the
       Drive box was left unticked on Google's consent screen, or the Drive is
       full. Both are fixable in ten seconds by somebody told which it is. */
    if (response.status === 401) throw new Error('expired')
    throw new Error(await explain(response))
  }
  return response
}

/** Everything in the folder, by name.

    One listing per sync rather than a lookup per file: three record documents
    and a book file per book means a library of forty books is forty-three
    lookups, and Drive is happy to describe the whole folder in one call. The
    page size is the ceiling on how many books can be backed up in one pass and
    is named in `record.ts` where it matters. */
export async function listFolder(token: string): Promise<Map<string, DriveFile>> {
  const found = new Map<string, DriveFile>()
  let pageToken = ''
  do {
    const url =
      `${FILES}?spaces=appDataFolder&pageSize=1000&fields=` +
      `${encodeURIComponent('nextPageToken,files(id,name,modifiedTime,size,appProperties)')}` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '')
    const body = (await (await ask(token, url)).json()) as {
      files?: RawFile[]
      nextPageToken?: string
    }
    for (const file of body.files ?? []) {
      /* Newest wins on a duplicate name. Drive allows two files with the same
         name in one folder, and a half-written upload that was retried is
         exactly how that happens. */
      const row = unpack(file)
      const held = found.get(row.name)
      if (!held || held.modifiedTime < row.modifiedTime) found.set(row.name, row)
    }
    pageToken = body.nextPageToken ?? ''
  } while (pageToken)
  return found
}

export async function readText(token: string, id: string): Promise<string> {
  return (await ask(token, `${FILES}/${id}?alt=media`)).text()
}

export async function readBlob(token: string, id: string): Promise<Blob> {
  return (await ask(token, `${FILES}/${id}?alt=media`)).blob()
}

/** Write a named file up, creating it the first time and overwriting it after
    that. Overwriting is safe here in a way it would not be for most apps,
    because what goes up is always the MERGE of both sides — see sync.ts.
    Nothing is ever replaced by less than itself. */
export async function write(
  token: string,
  name: string,
  body: Blob,
  device: string,
  id?: string,
): Promise<DriveFile> {
  /* Multipart both ways. The metadata half carries `appProperties.device`, and
     a media-only upload has nowhere to put it — so an update would leave
     whichever device created the file named on it forever. The create half
     additionally carries the name and, crucially, `parents: ['appDataFolder']`,
     which is what puts the file in the hidden folder rather than loose among
     somebody's own documents. A file cannot be re-parented on update, so that
     goes on the create only. */
  const meta = id
    ? { appProperties: { device } }
    : { name, parents: ['appDataFolder'], appProperties: { device } }

  const boundary = `flyleaf-${crypto.randomUUID()}`
  const head =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`
  const multipart = new Blob([head, body, `\r\n--${boundary}--`])

  const fields = 'fields=id,name,modifiedTime,size,appProperties'
  const response = await ask(
    token,
    id
      ? `${UPLOAD}/${id}?uploadType=multipart&${fields}`
      : `${UPLOAD}?uploadType=multipart&${fields}`,
    {
      method: id ? 'PATCH' : 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: multipart,
    },
  )
  return unpack((await response.json()) as RawFile)
}

export async function remove(token: string, id: string): Promise<void> {
  await ask(token, `${FILES}/${id}`, { method: 'DELETE' })
}

/** Take the library back out of Drive — every file in the folder, not just the
    ones we expect, so an old name or a half-written upload cannot be left
    behind claiming to be a backup.

    This exists because it could not be done by hand. `appDataFolder` is hidden
    — that is the point of it, and it is why this app can sync without leaving
    files loose among somebody's documents — but hidden also means Drive's own
    interface offers no row to delete. An app that can put a copy of somebody's
    library somewhere has to be able to take it away again, from inside itself,
    in one press.

    The library on the device is untouched. This deletes the copy. */
export async function dropAll(token: string): Promise<number> {
  const found = await listFolder(token)
  let gone = 0
  for (const file of found.values()) {
    await remove(token, file.id)
    gone += 1
  }
  return gone
}

/** How much of the reader's own Drive quota the backup is using, and how much
    of it is left. Both in bytes; `limit` is null on an account with none.

    Worth a call of its own because the book files are opt-in and this is the
    number that decision turns on. "Books take space in your Drive" is an
    abstraction; "1.4 GB of your 15 GB" is a fact. */
export async function quota(
  token: string,
): Promise<{ used: number; limit: number | null } | null> {
  try {
    const url = `${FILES.replace('/files', '/about')}?fields=${encodeURIComponent('storageQuota')}`
    const body = (await (await ask(token, url)).json()) as {
      storageQuota?: { usage?: string; limit?: string }
    }
    const q = body.storageQuota
    if (!q) return null
    return {
      used: Number(q.usage ?? 0),
      limit: q.limit === undefined ? null : Number(q.limit),
    }
  } catch {
    /* A missing number is a missing sentence, not a failed sync. */
    return null
  }
}
