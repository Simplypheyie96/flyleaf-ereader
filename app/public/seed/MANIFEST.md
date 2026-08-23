# Included books — provenance

Two public-domain books ship on the shelf. `SPEC.md` § 1 says why they exist and how they arrive;
this file is the record of *what* they are, so no seed file is ever in the repo without its
licence and its byte count written down beside it.

Both are from **[Standard Ebooks](https://standardebooks.org)** — chosen over Project Gutenberg
because Gutenberg files carry a licence header that must be stripped before redistribution, and
because Standard Ebooks are typeset properly, which matters when the app's whole subject is
typesetting.

Each file's `dc:rights` carries, verbatim:

> The source text and artwork in this ebook are believed to be in the United States public
> domain… The creators of, and contributors to, this ebook dedicate their contributions to the
> worldwide public domain via the terms in the CC0 1.0 Universal Public Domain Dedication.

Source text public domain · Standard Ebooks' own contributions **CC0 1.0**. Nothing here needs
attribution to redistribute, and it is given anyway.

## The files

| File | Book | Bytes | Sections | Cover | Language |
|---|---|---|---|---|---|
| `the-time-machine.epub` | *The Time Machine* — H. G. Wells | 535,571 | 18 | `epub/images/cover.jpg`, 360 KB | `en-GB` |
| `pride-and-prejudice.epub` | *Pride and Prejudice* — Jane Austen | 831,946 | 65 | `epub/images/cover.jpg`, 389 KB | `en-GB` |

**Total 1,367,517 bytes — 1.30 MiB**, against the 2.5 MB budget in `SPEC.md` § 1.1. Both are
under Workbox's 2 MiB per-file default, so neither needs the precache limit raised.

Downloaded from (the `?source=download` is required — the bare path serves an interstitial page):

```
https://standardebooks.org/ebooks/h-g-wells/the-time-machine/downloads/h-g-wells_the-time-machine.epub?source=download
https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice/downloads/jane-austen_pride-and-prejudice.epub?source=download
```

## Why these two

The slots, per `SPEC.md`, are *one short* and *one long with a real chapter tree*:

- **The Time Machine** — 18 sections, 536 KB. Finishable in a sitting, so the first book anyone
  opens is a book they can actually finish. Opens instantly even unwarmed.
- **Pride and Prejudice** — 65 sections. The deep chapter tree the TOC, the per-chapter progress
  readout and the paginator all need to be tested against, and a book people are glad to find on
  a shelf.

**Alice's Adventures in Wonderland was the first choice for the long slot and was dropped.** The
Tenniel-illustrated edition is **18.4 MB** — 7× the whole seed budget and 9× Workbox's per-file
limit. `SPEC.md` § 1.1 says the book changes and the budget does not, so the book changed.

## Rules for touching this folder

- A seed file added without a row above, a licence line and a byte count is not shipped.
- These are **not** vendored source to be edited. They are the publisher's bytes; the app reads
  them through the ordinary import path and never rewrites them.
- Replacing one is a decision about the shelf, not a chore: it changes the first screen every new
  reader sees. Update this file, `seed.ts`, and the row above in the same commit.
