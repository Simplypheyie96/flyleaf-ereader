import type { Format } from '../types'
import type { Meta } from './meta'

/* Plain text, Markdown and HTML carry no metadata table, so the title is read
   out of the top of the document the way a person would read it: the first
   thing that looks like a title. Where nothing does, the caller falls back to
   the filename, which is what the reader named it and therefore what they will
   look for on the shelf. */

export async function readText(file: File, format: Format): Promise<Meta> {
  /* 8KB. A title that is not in the first 8KB of a text file is not a title. */
  const head = await file.slice(0, 8192).text()

  if (format === 'html') {
    const doc = new DOMParser().parseFromString(head, 'text/html')
    const title = doc.querySelector('title')?.textContent?.trim()
      || doc.querySelector('h1')?.textContent?.trim()
    return {
      title: title || undefined,
      author: doc.querySelector('meta[name="author"]')?.getAttribute('content')?.trim() || undefined,
      language: doc.documentElement.getAttribute('lang') || undefined,
      description: doc.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() || undefined,
    }
  }

  if (format === 'markdown') {
    /* YAML front matter first, because a file that has it means it. */
    const front = head.match(/^---\r?\n([\s\S]{0,2000}?)\r?\n---/)
    if (front) {
      const field = (key: string) =>
        front[1].match(new RegExp(`^${key}\\s*:\\s*["']?(.+?)["']?\\s*$`, 'im'))?.[1]?.trim()
      const title = field('title')
      if (title) return { title, author: field('author'), language: field('lang') }
    }
    const atx = head.match(/^#\s+(.+)$/m)?.[1]?.trim()
    const setext = head.match(/^(\S.*)\r?\n=+\s*$/m)?.[1]?.trim()
    return { title: atx || setext || undefined }
  }

  /* Plain text. Project Gutenberg's own convention — "Title: X" near the top —
     is worth reading because a great many .txt books on disk are exactly that
     file, and the alternative is a shelf full of filenames in caps. */
  const labelled = head.match(/^Title:\s*(.+)$/im)?.[1]?.trim()
  const author = head.match(/^Author:\s*(.+)$/im)?.[1]?.trim()
  if (labelled) return { title: labelled, author }

  /* Otherwise the first non-empty line, but only if it reads like a title:
     short, and not a sentence. A first line of prose is prose, and putting it
     on the shelf as a title is worse than the filename. */
  const first = head.split(/\r?\n/).find((l) => l.trim().length > 0)?.trim()
  if (first && first.length <= 80 && !/[.!?]\s*$/.test(first)) return { title: first }
  return {}
}
