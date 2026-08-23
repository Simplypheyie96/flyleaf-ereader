import type { Entry, FileEntry } from '@zip.js/zip.js'

/* zip.js models an entry as a union — a directory has no `getData`, a file
   does — so every read has to narrow first. One guard, shared, rather than the
   same `entry?.getData &&` dance in each extractor. Undefined folds in on
   purpose: "the archive has no such entry" and "the entry is a folder" are the
   same answer to the only question a caller asks, which is whether there are
   bytes here to read. */
export const isFile = (entry: Entry | undefined): entry is FileEntry =>
  entry !== undefined && !entry.directory
