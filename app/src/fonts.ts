/* Every face, self-hosted. Nothing is fetched from a CDN, ever — this app has
   to work with the radio off, and a reading face that arrives over the network
   is a reading face that sometimes does not.

   Latin subsets only. @fontsource's index CSS pulls latin-ext, Cyrillic, Greek
   and Vietnamese as separate files; a reader who needs those is a real reader
   and this is a known gap, recorded rather than hidden.

   ── On "loaded on selection" ──
   DESIGN.md says the alternate reading faces load on selection rather than at
   boot, and they do — but not by imperative loading. @font-face is lazy by
   specification: declaring a rule costs nothing until something on the page is
   actually set in that family. So every rule is installed once, here, and the
   browser fetches exactly the face the reader has chosen. Fifteen families'
   rules cost one <style> element and zero requests.

   Precaching is the opposite decision, and deliberate: all of them ARE precached
   (~1.2MB across fifteen reading families), because the type picker has to work
   on a plane. A face the reader can see in the list but cannot apply offline
   would be worse than not offering it — and the whole set costs less than one
   cover image. */

/* ── chrome: Press's four families, doing Press's four jobs ────────────── */
import sans400 from '@fontsource/archivo/files/archivo-latin-400-normal.woff2?url'
import sans500 from '@fontsource/archivo/files/archivo-latin-500-normal.woff2?url'
import sans600 from '@fontsource/archivo/files/archivo-latin-600-normal.woff2?url'
import serif400 from '@fontsource/playfair-display/files/playfair-display-latin-400-normal.woff2?url'
import serif400i from '@fontsource/playfair-display/files/playfair-display-latin-400-italic.woff2?url'
import serif500 from '@fontsource/playfair-display/files/playfair-display-latin-500-normal.woff2?url'
import serif600 from '@fontsource/playfair-display/files/playfair-display-latin-600-normal.woff2?url'
import mono400 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2?url'
import mono500 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2?url'
import hand400 from '@fontsource/kalam/files/kalam-latin-400-normal.woff2?url'
import hand700 from '@fontsource/kalam/files/kalam-latin-700-normal.woff2?url'

/* ── the reading faces ─────────────────────────────────────────────────────
   Literata carries its OPTICAL SIZE axis (108KB + 112KB rather than 52 + 54).
   That is the whole reason it is the default: opsz is what lets one file be
   correctly drawn at 14px and at 28px — heavier hairlines and looser spacing
   small, finer and tighter large — and this app's type control spans exactly
   that range. font-optical-sizing is auto by default, so it simply works.

   The alternates take the wght-only files. They are alternates: a reader who
   prefers Garamond gets Garamond, and paying another 300KB across four faces
   nobody has selected to give them an axis they will not notice is not a
   trade worth making. If one of them becomes a default, it gets its opsz. */
import readDefault from '@fontsource-variable/literata/files/literata-latin-opsz-normal.woff2?url'
import readDefaultI from '@fontsource-variable/literata/files/literata-latin-opsz-italic.woff2?url'
import garamond from '@fontsource-variable/eb-garamond/files/eb-garamond-latin-wght-normal.woff2?url'
import garamondI from '@fontsource-variable/eb-garamond/files/eb-garamond-latin-wght-italic.woff2?url'
import sourceSerif from '@fontsource-variable/source-serif-4/files/source-serif-4-latin-wght-normal.woff2?url'
import sourceSerifI from '@fontsource-variable/source-serif-4/files/source-serif-4-latin-wght-italic.woff2?url'
import newsreader from '@fontsource-variable/newsreader/files/newsreader-latin-wght-normal.woff2?url'
import newsreaderI from '@fontsource-variable/newsreader/files/newsreader-latin-wght-italic.woff2?url'
import atkinson from '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.woff2?url'
import atkinsonI from '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-italic.woff2?url'
import atkinsonB from '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-700-normal.woff2?url'

/* ── one more serif, on the owner's instruction ────────────────────────────
   "add more serif fonts, like in apple books, like avenir next, and other
   pretty ones."

   Apple Books' serif list is Athelas, Charter, Georgia, Iowan Old Style, New
   York, Palatino and Times. Every one of them is a licensed system face: they
   ship with macOS and iOS under terms that do not cover self-hosting a webfont,
   so none can be put in this repo. What CAN be done is take one's JOB and fill
   it with an OFL face:

     Lora   for Athelas, and the answer to "other pretty ones" — brushed
            curves, more contrast than the rest, and it wants a size up.

   Three faces stood here and were REMOVED on the owner's instruction — "charis
   is not great, gelasio is not a sans serif and volkorn is not san serif …
   remove those 3":

     Charis SIL   was here as Charter itself (Bitstream released Charter
                  permissively in 1992 and SIL extended that outline). The
                  provenance was the argument for it; the owner judged the face
                  on the page and it lost. Provenance is not a reason to keep a
                  face a reader dislikes.
     Gelasio      was here for Georgia's metrics. Broad and low-contrast at
                  chip size it reads as a sans, which is what got it named as
                  one — and a serif that has to be explained is not doing its
                  job in a picker.
     Vollkorn     same, for Palatino: broad enough that the pen angle is the
                  only thing marking it as a serif.

   Iowan Old Style has no entry: EB Garamond already covers the Venetian
   old-style job, and another serif in that same territory would be a longer
   list rather than a wider choice. Said rather than quietly skipped. */
import lora from '@fontsource-variable/lora/files/lora-latin-wght-normal.woff2?url'
import loraI from '@fontsource-variable/lora/files/lora-latin-wght-italic.woff2?url'
/* ── the sans faces ────────────────────────────────────────────────────────
   Added by the owner's instruction: "we have so much serif and not enough sans
   serif, so check out some fonts apple uses too and see if they are free for
   us to use."

   Apple Books' own list is mostly unlicensable for the web — Athelas, Iowan Old
   Style, Seravek, Charter and San Francisco are all system faces Apple ships
   under a licence that does not cover self-hosting, and New York is SF's serif
   sibling under the same terms. So each is a stand-in chosen for the same JOB
   rather than a lookalike, and every one is OFL:

     Inter          for San Francisco. The face SF's own designer credits as
                    the closest open equivalent, and the only sans here with a
                    real opsz axis — which matters more than the resemblance,
                    because this app's size control spans 14–28px and Inter's
                    axis spans 14–32.
     Source Sans 3  for Seravek. Humanist, open apertures, drawn by Adobe as a
                    text face rather than a UI face — the one sans here that is
                    genuinely comfortable for a chapter rather than a caption.
     Nunito Sans    for Avenir Next. Rounded terminals and a low stroke
                    contrast; the warm one, and the only face in the list that
                    softens rather than sharpens.

   Nunito Sans ships an opsz axis too and it is deliberately NOT used: its
   range is 6–12, drawn for small text, and clamping a 24px reading size to a
   12px optical master is worse than having no axis at all. The wght file is
   the correct file for a reading face.

   ── three more, on the owner's instruction ──
   "find other sans serif we can use then that would look great for reading …
   add more than one though, maybe 3 sans serif", and earlier, "like avenir
   next".

   Avenir Next cannot ship: it is Linotype's, licensed to Apple, and there is
   no webfont licence for it at any price this project would pay. Nunito Sans
   above was chosen as its stand-in and that was the weaker half of that
   choice — Avenir has flat, unrounded terminals and Nunito's are rounded, so
   it reads as warmer rather than as cleaner. Mulish is the closer face and it
   is what a reader wanting Avenir should pick. Nunito Sans stays, on its own
   merits, as the soft one.

   These three are chosen for READING rather than for interface — the thing
   that separates the two is aperture and rhythm at 20px over a full page, not
   how a capital G looks at 13px in a toolbar:

     Mulish          for Avenir Next. Geometric, near-circular bowls, almost no
                     stroke contrast. The cleanest face in the list.
     IBM Plex Sans   humanist with a slightly mechanical joint, drawn as a text
                     family rather than a UI one — and the sibling of IBM Plex
                     Mono, which is already this app's mono, so a book set in
                     it and the app around it share a hand.
     Libre Franklin  a Franklin Gothic revival: narrower than the rest, which
                     is the point — on a 360px phone it fits meaningfully more
                     words to the line before the measure has to wrap.

   ── three more, replacing the three serifs the owner cut ──
   "i want sans serif like avenir next, remove those 3 and add other sans serif
   options". So the list moves from eight serifs and seven sans to five and ten,
   which is the balance asked for rather than a longer list.

   Every one is OFL, ships a real italic, and reaches the Light tier on its own
   axis. Italics are not a nicety here: a novel sets emphasis, ship names and
   inner voice in italic on nearly every page, and a face without one hands the
   whole book to the browser's synthetic slant. That requirement is what cut
   Manrope, which was the first choice for the Avenir job and ships normal only.

     DM Sans     the Avenir Next stand-in, and closer than Mulish: geometric
                 bowls with FLAT terminals, where Nunito's are rounded. It is
                 also the only new one with an opsz axis — see its import.
     Figtree     geometric humanist with a tall x-height, so it keeps its
                 shape at 14px where a small-x-height geometric goes muddy.
     Work Sans   drawn for text on screens at reading sizes; its display cuts
                 are a separate family, which is the tell that this one is the
                 reading cut rather than a UI face pressed into the job.

   Deliberately NOT added: Jost, Outfit and Poppins. All three are the Futura
   line — small x-height, near-circular o, and a geometric rhythm that reads
   well as a heading and badly as a chapter. A picker of ten sans faces is only
   useful if all ten are faces you could finish a book in. */
import inter from '@fontsource-variable/inter/files/inter-latin-opsz-normal.woff2?url'
import interI from '@fontsource-variable/inter/files/inter-latin-opsz-italic.woff2?url'
import sourceSans from '@fontsource-variable/source-sans-3/files/source-sans-3-latin-wght-normal.woff2?url'
import sourceSansI from '@fontsource-variable/source-sans-3/files/source-sans-3-latin-wght-italic.woff2?url'
import nunito from '@fontsource-variable/nunito-sans/files/nunito-sans-latin-wght-normal.woff2?url'
import nunitoI from '@fontsource-variable/nunito-sans/files/nunito-sans-latin-wght-italic.woff2?url'
import mulish from '@fontsource-variable/mulish/files/mulish-latin-wght-normal.woff2?url'
import mulishI from '@fontsource-variable/mulish/files/mulish-latin-wght-italic.woff2?url'
import plexSans from '@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-wght-normal.woff2?url'
import plexSansI from '@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-wght-italic.woff2?url'
import franklin from '@fontsource-variable/libre-franklin/files/libre-franklin-latin-wght-normal.woff2?url'
import franklinI from '@fontsource-variable/libre-franklin/files/libre-franklin-latin-wght-italic.woff2?url'
/* DM Sans takes its OPTICAL SIZE file, for Literata's reason: the axis spans
   9–40 and this app's size control spans 14–28, so it sits inside the range
   the designer drew for. The wght-only file is the wrong file when an opsz
   one exists and covers the range. */
import dmSans from '@fontsource-variable/dm-sans/files/dm-sans-latin-opsz-normal.woff2?url'
import dmSansI from '@fontsource-variable/dm-sans/files/dm-sans-latin-opsz-italic.woff2?url'
import figtree from '@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2?url'
import figtreeI from '@fontsource-variable/figtree/files/figtree-latin-wght-italic.woff2?url'
import workSans from '@fontsource-variable/work-sans/files/work-sans-latin-wght-normal.woff2?url'
import workSansI from '@fontsource-variable/work-sans/files/work-sans-latin-wght-italic.woff2?url'

type Face = {
  family: string
  /** a single weight, or a variable range like [200, 900] */
  weight: number | [number, number]
  style: 'normal' | 'italic'
  url: string
  /** variable files need the -variations format hint or Safari ignores the axes */
  variable?: boolean
}

/* The app around the book. Every weight the chrome asks for is here; a weight
   that is missing is a weight the browser synthesises, which looks like a
   slightly wrong font rather than like a bug. */
const CHROME_FACES: Face[] = [
  { family: 'Archivo', weight: 400, style: 'normal', url: sans400 },
  { family: 'Archivo', weight: 500, style: 'normal', url: sans500 },
  { family: 'Archivo', weight: 600, style: 'normal', url: sans600 },
  { family: 'Playfair Display', weight: 400, style: 'normal', url: serif400 },
  { family: 'Playfair Display', weight: 400, style: 'italic', url: serif400i },
  { family: 'Playfair Display', weight: 500, style: 'normal', url: serif500 },
  { family: 'Playfair Display', weight: 600, style: 'normal', url: serif600 },
  { family: 'IBM Plex Mono', weight: 400, style: 'normal', url: mono400 },
  { family: 'IBM Plex Mono', weight: 500, style: 'normal', url: mono500 },
  /* Kalam is the reader's own notes and nothing else — see DESIGN.md. Declared
     with the chrome because it is installed the same way; it is not fetched
     until somebody writes a note. */
  { family: 'Kalam', weight: 400, style: 'normal', url: hand400 },
  { family: 'Kalam', weight: 700, style: 'normal', url: hand700 },
]

/** One entry per selectable reading face, in picker order. */
export type FaceId =
  | 'literata' | 'garamond' | 'source-serif' | 'newsreader' | 'lora'
  | 'inter' | 'source-sans' | 'nunito' | 'atkinson'
  | 'mulish' | 'plex-sans' | 'franklin'
  | 'dm-sans' | 'figtree' | 'work-sans'

export type ReadingFace = {
  /** stored in settings — never renumber or reuse an id */
  id: FaceId
  /** shown in the type sheet */
  label: string
  /** the CSS family, quoted where it needs to be */
  css: string
  /** the picker groups by this. Five serif, ten sans — the split, not the
      count, is what the control is built on, so the list can grow without the
      picker changing. */
  kind: 'serif' | 'sans'
  /** one line in the picker, saying what it is for */
  note: string
  /** the primary family name, for the @font-face lookup below */
  family: string
}

export const READING_FACES: ReadingFace[] = [
  { id: 'literata',     label: 'Literata',    family: 'Literata',             kind: 'serif', css: '"Literata", Georgia, serif',        note: 'The default. Drawn for screens, at every size.' },
  { id: 'garamond',     label: 'EB Garamond', family: 'EB Garamond',          kind: 'serif', css: '"EB Garamond", Georgia, serif',     note: 'Old-style, light on the page. Set it a size up.' },
  { id: 'source-serif', label: 'Source Serif', family: 'Source Serif 4',      kind: 'serif', css: '"Source Serif 4", Georgia, serif',  note: 'Even and quiet. Holds up small.' },
  { id: 'newsreader',   label: 'Newsreader',  family: 'Newsreader',           kind: 'serif', css: '"Newsreader", Georgia, serif',      note: 'Sharper, with more contrast. Good in a large size.' },
  { id: 'lora',         label: 'Lora',        family: 'Lora',                 kind: 'serif', css: '"Lora", Georgia, serif',            note: 'Brushed curves and more contrast. The pretty one.' },
  { id: 'inter',        label: 'Inter',       family: 'Inter',                kind: 'sans',  css: '"Inter", system-ui, sans-serif',    note: 'Neutral and screen-native. Optically sized, like Literata.' },
  { id: 'source-sans',  label: 'Source Sans', family: 'Source Sans 3',        kind: 'sans',  css: '"Source Sans 3", system-ui, sans-serif', note: 'Humanist, open. The sans that reads like a book.' },
  { id: 'nunito',       label: 'Nunito Sans', family: 'Nunito Sans',          kind: 'sans',  css: '"Nunito Sans", system-ui, sans-serif',   note: 'Rounded and warm. Softer than the rest.' },
  { id: 'mulish',       label: 'Mulish',      family: 'Mulish',               kind: 'sans',  css: '"Mulish", system-ui, sans-serif',   note: 'Geometric and near-circular. The closest open face to Avenir.' },
  { id: 'plex-sans',    label: 'Plex Sans',   family: 'IBM Plex Sans',        kind: 'sans',  css: '"IBM Plex Sans", system-ui, sans-serif', note: 'A text family, not a UI one. Shares its hand with the app’s mono.' },
  { id: 'franklin',     label: 'Franklin',    family: 'Libre Franklin',       kind: 'sans',  css: '"Libre Franklin", system-ui, sans-serif', note: 'A news gothic. Narrower, so a phone line holds more words.' },
  { id: 'dm-sans',      label: 'DM Sans',     family: 'DM Sans',              kind: 'sans',  css: '"DM Sans", system-ui, sans-serif',  note: 'Geometric with flat terminals. The closest here to Avenir Next.' },
  { id: 'figtree',      label: 'Figtree',     family: 'Figtree',              kind: 'sans',  css: '"Figtree", system-ui, sans-serif',  note: 'A tall x-height, so it holds its shape at a small size.' },
  { id: 'work-sans',    label: 'Work Sans',   family: 'Work Sans',            kind: 'sans',  css: '"Work Sans", system-ui, sans-serif', note: 'Drawn for text on screens at reading sizes, not for labels.' },
  { id: 'atkinson',     label: 'Atkinson',    family: 'Atkinson Hyperlegible', kind: 'sans', css: '"Atkinson Hyperlegible", system-ui, sans-serif', note: 'Drawn for low vision. Letters that cannot be confused.' },
]

export const READING_FACE_FILES: Face[] = [
  { family: 'Literata', weight: [200, 900], style: 'normal', url: readDefault, variable: true },
  { family: 'Literata', weight: [200, 900], style: 'italic', url: readDefaultI, variable: true },
  { family: 'EB Garamond', weight: [400, 800], style: 'normal', url: garamond, variable: true },
  { family: 'EB Garamond', weight: [400, 800], style: 'italic', url: garamondI, variable: true },
  { family: 'Source Serif 4', weight: [200, 900], style: 'normal', url: sourceSerif, variable: true },
  { family: 'Source Serif 4', weight: [200, 900], style: 'italic', url: sourceSerifI, variable: true },
  { family: 'Newsreader', weight: [200, 800], style: 'normal', url: newsreader, variable: true },
  { family: 'Newsreader', weight: [200, 800], style: 'italic', url: newsreaderI, variable: true },
  { family: 'Lora', weight: [400, 700], style: 'normal', url: lora, variable: true },
  { family: 'Lora', weight: [400, 700], style: 'italic', url: loraI, variable: true },
  { family: 'Atkinson Hyperlegible', weight: 400, style: 'normal', url: atkinson },
  { family: 'Atkinson Hyperlegible', weight: 400, style: 'italic', url: atkinsonI },
  { family: 'Atkinson Hyperlegible', weight: 700, style: 'normal', url: atkinsonB },
  { family: 'Inter', weight: [100, 900], style: 'normal', url: inter, variable: true },
  { family: 'Inter', weight: [100, 900], style: 'italic', url: interI, variable: true },
  { family: 'Source Sans 3', weight: [200, 900], style: 'normal', url: sourceSans, variable: true },
  { family: 'Source Sans 3', weight: [200, 900], style: 'italic', url: sourceSansI, variable: true },
  { family: 'Nunito Sans', weight: [200, 1000], style: 'normal', url: nunito, variable: true },
  { family: 'Nunito Sans', weight: [200, 1000], style: 'italic', url: nunitoI, variable: true },
  { family: 'Mulish', weight: [200, 1000], style: 'normal', url: mulish, variable: true },
  { family: 'Mulish', weight: [200, 1000], style: 'italic', url: mulishI, variable: true },
  { family: 'IBM Plex Sans', weight: [100, 700], style: 'normal', url: plexSans, variable: true },
  { family: 'IBM Plex Sans', weight: [100, 700], style: 'italic', url: plexSansI, variable: true },
  { family: 'Libre Franklin', weight: [100, 900], style: 'normal', url: franklin, variable: true },
  { family: 'Libre Franklin', weight: [100, 900], style: 'italic', url: franklinI, variable: true },
  { family: 'DM Sans', weight: [100, 1000], style: 'normal', url: dmSans, variable: true },
  { family: 'DM Sans', weight: [100, 1000], style: 'italic', url: dmSansI, variable: true },
  { family: 'Figtree', weight: [300, 900], style: 'normal', url: figtree, variable: true },
  { family: 'Figtree', weight: [300, 900], style: 'italic', url: figtreeI, variable: true },
  { family: 'Work Sans', weight: [100, 900], style: 'normal', url: workSans, variable: true },
  { family: 'Work Sans', weight: [100, 900], style: 'italic', url: workSansI, variable: true },
]

/** Faces with no wght axis. One of them, now that Charis is gone: Atkinson
    ships 400 and 700 only, so its three weight steps collapse to two, and the
    type control says so rather than pretending. Everything else here is
    variable.

    Lora is variable but its axis FLOORS at 400, so the Light tier renders at
    400. That is a smaller lie than a collapsed control would be — the tier
    exists, it just cannot go below the regular weight, which is a property of
    the face and not of this app. Figtree floors at 300 and DM Sans and Work
    Sans at 100, so all three reach the Light tier honestly. */
export const STATIC_FACES = new Set<FaceId>(['atkinson'])

const FACES: Face[] = [...CHROME_FACES, ...READING_FACE_FILES]

const rule = (f: Face) => {
  const weight = Array.isArray(f.weight) ? `${f.weight[0]} ${f.weight[1]}` : String(f.weight)
  const format = f.variable ? 'woff2-variations' : 'woff2'
  return (
    `@font-face{font-family:"${f.family}";font-style:${f.style};font-weight:${weight};` +
    /* swap, not optional: on a cold start the reading page should paint in
       Georgia and be replaced, rather than sit blank or keep the fallback for
       the whole session. The launch screen holds long enough that this is
       almost never seen — see main.tsx. */
    `font-display:swap;src:url(${f.url}) format("${format}")}`
  )
}

/** Install every @font-face rule. Called once, before React renders. */
export function installFonts(): void {
  const el = document.createElement('style')
  el.id = 'flyleaf-faces'
  el.textContent = FACES.map(rule).join('\n')
  document.head.appendChild(el)
}

/* ──────────────────────────────────────────────────────────────────────────
   The book document needs its own @font-face rules.

   installFonts() puts them in the HOST document's head. A book section is not
   in the host document — foliate renders each one into an iframe whose src is
   a blob: URL (see vendor/foliate-js/epub.js, where the rewritten section is
   turned into a Blob, and paginator.js, which assigns it as the iframe src).
   @font-face does not cross a document boundary, so setting
   `font-family: "Literata"` inside that iframe named a family the iframe had
   never heard of, and every serif face silently fell back to Georgia. Which is
   exactly the reported symptom: four different serif choices that all looked
   identical, because they were all Georgia.

   Two details make the fix work:

   • The URL must be ABSOLUTE. Vite gives us a root-relative path, and a
     relative URL inside the book document resolves against its blob: base,
     which is not a directory — so the fetch 404s and you are back in Georgia
     with no error worth noticing.
   • It is same-origin, so there is no CORS to satisfy: a blob: URL inherits
     the origin of the document that created it, and the hardening CSP we
     inject restricts script-src only, leaving font-src open. No data URI, no
     base64 inflation, and the file is the same one the host already has in
     the HTTP cache.

   Only the selected face is emitted. Shipping all fifteen would make the iframe
   declare thirty-odd faces it will not use — harmless in bytes, since @font-face is
   lazy, but it makes the injected stylesheet needlessly long to read. */
export function faceRules(id: FaceId): string {
  const family = (READING_FACES.find(f => f.id === id) ?? READING_FACES[0]).family
  return READING_FACE_FILES
    .filter(f => f.family === family)
    .map(f => rule({ ...f, url: new URL(f.url, location.href).href }))
    .join('\n')
}
