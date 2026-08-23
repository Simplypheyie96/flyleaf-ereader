/* ─────────────────────────────────────────────────────────────
   The reading sheet — Text · Page · Turn.

   Fifteen controls, SPEC.md §§ 3–5, in the order SPEC.md § 8 sets:
   Size heads Text, Stock heads Page, and the sheet opens on whichever
   tab was last used.

   Three rules it is built around.

   1. It is a GRID ROW, not an overlay. The reading pane shrinks, so a
      control never covers the sentence it is setting — the same rule the
      bars follow, and the only way "shows its effect live behind the
      sheet" is true rather than nearly true.

   2. A slider applies LIVE and persists LATE. Dragging Size calls
      `onLive` on every input, which restyles the book and nothing else;
      the Dexie write lands 320ms after the finger stops. A write per
      input event would put an IndexedDB transaction and a liveQuery
      round-trip inside a drag.

   3. A control that cannot do its job is ABSENT or DISABLED WITH A
      REASON, never present and inert. Letter spacing on Arabic,
      hyphenation with no declared language, and Line width on a phone —
      each one is handled here, and each one says why.
   ───────────────────────────────────────────────────────────── */

import { useEffect, useRef, useState } from 'react'
import type { Settings, Stock } from '../types'
import { READING_FACES, STATIC_FACES } from '../fonts'
import type { FaceId } from '../fonts'
import { hyphenationAvailable, letterSpacingAllowed, letterSpacingReason } from './readingCss'

const TABS: { id: Settings['sheetTab']; label: string }[] = [
    { id: 'text', label: 'Text' },
    { id: 'page', label: 'Page' },
    { id: 'turn', label: 'Turn' },
]

/* Light to dark, warm throughout. The order is the order a reader moves
   through them across a day, which is why Press sits beside Day and Pitch at
   the end rather than the seven being alphabetical or grouped by temperature. */
export const STOCKS: { id: Stock; label: string }[] = [
    { id: 'press', label: 'Press' },
    { id: 'day', label: 'Day' },
    { id: 'butter', label: 'Butter' },
    { id: 'tea', label: 'Tea' },
    { id: 'coal', label: 'Coal' },
    { id: 'dusk', label: 'Dusk' },
    { id: 'pitch', label: 'Pitch' },
]

/* Three, and there is no fourth. A Curl sat here — a real hinged fold, its
   back face a second render of the section — and it passed the frame gate it
   was built to pass. It was cut on how it felt, not on what it cost, which is
   the one reason a control leaves a shipped app without leaving a note behind
   in its place. SPEC.md § 5.2 and reader/turn.ts carry that note. */
const TURNS: { id: Settings['turn']; label: string; note: string }[] = [
    { id: 'slide', label: 'Slide', note: 'The page moves with your thumb, parted by a hairline.' },
    { id: 'fade', label: 'Fade', note: 'A 120ms cross-fade. Free on any device.' },
    { id: 'instant', label: 'Instant', note: 'No motion at all. The page changes.' },
]

export interface SheetProps {
    settings: Settings
    /** the book's declared language — gates tracking and hyphens */
    lang: string | null
    /** true when a line-width cap can actually bite on this pane. SPEC.md § 4 */
    measureBites: boolean
    /** the measure the reader is actually getting, in em, for the rivers note */
    emMeasure: number
    /** apply now, do not persist — every input event of a drag */
    onLive: (patch: Partial<Settings>) => void
    /** apply and persist — every discrete choice, and the end of a drag */
    onSet: (patch: Partial<Settings>) => void
}

export function Sheet({ settings: s, lang, measureBites, emMeasure, onLive, onSet }: SheetProps) {
    const tab = s.sheetTab ?? 'text'
    const trackingOk = letterSpacingAllowed(lang)
    const hyphenOk = hyphenationAvailable(lang)

    /* The rivers note, and the "not twice for the same setting" rule from
       SPEC.md § 3: the signature is the pair of settings that raised it, so
       dismissing it silences that pair and no other. Turning justification
       off and on again is a new question and gets the note back. */
    const [dismissed, setDismissed] = useState<string | null>(null)
    const riverSig = `${s.align}:${s.hyphenate}`
    const rivers =
        s.align === 'justify' && !s.hyphenate && hyphenOk &&
        emMeasure < 30 && dismissed !== riverSig

    return (
        <section className="sheet" aria-label="Reading settings">
            <div className="sheet-tabs" role="tablist" aria-label="Reading settings">
                {TABS.map(t => (
                    <button
                        key={t.id}
                        type="button"
                        role="tab"
                        id={`sheet-tab-${t.id}`}
                        aria-selected={tab === t.id}
                        aria-controls="sheet-panel"
                        className="sheet-tab"
                        onClick={() => onSet({ sheetTab: t.id })}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            <div
                className="sheet-body"
                id="sheet-panel"
                role="tabpanel"
                aria-labelledby={`sheet-tab-${tab}`}
            >
                {tab === 'text' && (
                    <>
                        <Slider
                            label="Size" value={s.size} min={14} max={28} step={0.5}
                            fmt={v => `${v % 1 === 0 ? v : v.toFixed(1)}px`}
                            onLive={v => onLive({ size: v })} onCommit={v => onSet({ size: v })}
                        />

                        {/* Two rows, not one of fifteen. Serif and sans is the
                            first decision a reader makes about a face and the
                            only one they can make without reading a sample, so
                            the control is split on it rather than sorted by it.
                            The label is set IN the face, so each chip is the
                            sample and the control at once — a picker that names
                            fifteen faces in the chrome face asks the reader to
                            remember what Newsreader looks like.

                            The note goes under whichever row holds the current
                            face, never both: a description of Lora sitting
                            under the sans row reads as a description of the
                            sans row. */}
                        <Row label="Serif" note={faceNote(s.face, 'serif')}>
                            {READING_FACES.filter(f => f.kind === 'serif').map(f => (
                                <button
                                    key={f.id}
                                    type="button"
                                    className="sheet-opt sheet-opt--face"
                                    style={{ fontFamily: f.css }}
                                    aria-pressed={s.face === f.id}
                                    onClick={() => onSet({ face: f.id })}
                                >
                                    {f.label}
                                </button>
                            ))}
                        </Row>

                        <Row label="Sans" note={faceNote(s.face, 'sans')}>
                            {READING_FACES.filter(f => f.kind === 'sans').map(f => (
                                <button
                                    key={f.id}
                                    type="button"
                                    className="sheet-opt sheet-opt--face"
                                    style={{ fontFamily: f.css }}
                                    aria-pressed={s.face === f.id}
                                    onClick={() => onSet({ face: f.id })}
                                >
                                    {f.label}
                                </button>
                            ))}
                        </Row>

                        <Weight face={s.face} value={s.weight} onSet={onSet} />

                        <Slider
                            label="Leading" value={s.leading} min={1.2} max={2.2} step={0.05}
                            fmt={v => v.toFixed(2)}
                            onLive={v => onLive({ leading: v })} onCommit={v => onSet({ leading: v })}
                        />

                        <Slider
                            label="Word spacing" value={s.wordSpacing} min={-0.04} max={0.24} step={0.005}
                            fmt={em} zero
                            onLive={v => onLive({ wordSpacing: v })} onCommit={v => onSet({ wordSpacing: v })}
                        />

                        <Slider
                            label="Letter spacing" value={s.letterSpacing} min={-0.02} max={0.1} step={0.005}
                            fmt={em} zero
                            disabled={!trackingOk}
                            note={trackingOk ? undefined : letterSpacingReason(lang)}
                            onLive={v => onLive({ letterSpacing: v })} onCommit={v => onSet({ letterSpacing: v })}
                        />

                        <Row label="Paragraphs">
                            <Opt on={s.paragraph === 'published'} onClick={() => onSet({ paragraph: 'published' })}>As published</Opt>
                            <Opt on={s.paragraph === 'indent'} onClick={() => onSet({ paragraph: 'indent' })}>Indented</Opt>
                            <Opt on={s.paragraph === 'spaced'} onClick={() => onSet({ paragraph: 'spaced' })}>Spaced</Opt>
                        </Row>

                        <Row label="Alignment">
                            <Opt on={s.align === 'published'} onClick={() => onSet({ align: 'published' })}>As published</Opt>
                            <Opt on={s.align === 'left'} onClick={() => onSet({ align: 'left' })}>Left</Opt>
                            <Opt on={s.align === 'justify'} onClick={() => onSet({ align: 'justify' })}>Justified</Opt>
                        </Row>

                        {rivers && (
                            /* A note, not a modal, and it carries the fix
                               inline — SPEC.md § 3. */
                            <p className="sheet-note">
                                <span>Justified narrow text without hyphens leaves rivers.</span>
                                <button type="button" className="sheet-note-do" onClick={() => onSet({ hyphenate: true })}>
                                    Hyphenate
                                </button>
                                <button
                                    type="button"
                                    className="sheet-note-no"
                                    aria-label="Dismiss this note"
                                    onClick={() => setDismissed(riverSig)}
                                >
                                    Not now
                                </button>
                            </p>
                        )}

                        <Toggle
                            label="Hyphenation" value={s.hyphenate} disabled={!hyphenOk}
                            note={hyphenOk ? undefined : 'This book declares no language, so there is no dictionary to hyphenate with.'}
                            onSet={v => onSet({ hyphenate: v })}
                        />

                        <Toggle
                            label="Publisher’s font" value={s.publisherFont}
                            note="On honours the book’s own faces — right for poetry and technical setting, wrong for a badly made EPUB."
                            onSet={v => onSet({ publisherFont: v })}
                        />
                    </>
                )}

                {tab === 'page' && (
                    <>
                        <Row label="Stock" note={`${STOCKS.find(k => k.id === s.stock)?.label ?? 'Day'} — the page, chosen separately from the app’s theme.`}>
                            {STOCKS.map(k => (
                                <button
                                    key={k.id}
                                    type="button"
                                    className="sheet-opt sheet-opt--stock"
                                    aria-pressed={s.stock === k.id}
                                    onClick={() => onSet({ stock: k.id })}
                                >
                                    {/* The swatch carries data-stock, so its
                                        colour comes from the same block in
                                        index.css the page itself reads. No
                                        second table of seven values. */}
                                    <span className="sheet-sw" data-stock={k.id} aria-hidden="true" />
                                    {k.label}
                                </button>
                            ))}
                        </Row>

                        <Slider
                            label="Side margins" value={s.margin} min={4} max={12} step={0.5}
                            fmt={v => `${v % 1 === 0 ? v : v.toFixed(1)}%`}
                            onLive={v => onLive({ margin: v })} onCommit={v => onSet({ margin: v })}
                        />

                        {/* Hidden, not greyed: on a phone the pane is narrower
                            than the narrowest cap, so no option here would
                            change anything. SPEC.md § 4. */}
                        {measureBites && (
                            <Row label="Line width">
                                <Opt on={s.measure === 30} onClick={() => onSet({ measure: 30 })}>Narrow</Opt>
                                <Opt on={s.measure === 34} onClick={() => onSet({ measure: 34 })}>Comfortable</Opt>
                                <Opt on={s.measure === 40} onClick={() => onSet({ measure: 40 })}>Wide</Opt>
                            </Row>
                        )}

                        <Row label="Columns" note="Auto is two columns on a pane wider than 1180px.">
                            <Opt on={s.columns === 'auto'} onClick={() => onSet({ columns: 'auto' })}>Auto</Opt>
                            <Opt on={s.columns === 1} onClick={() => onSet({ columns: 1 })}>One</Opt>
                            <Opt on={s.columns === 2} onClick={() => onSet({ columns: 2 })}>Two</Opt>
                        </Row>
                    </>
                )}

                {tab === 'turn' && (
                    <>
                        <Row label="Flow" note={s.flow === 'paginated'
                            ? 'Discrete pages, turned.'
                            : 'One continuous column per chapter, with native momentum.'}>
                            <Opt on={s.flow === 'paginated'} onClick={() => onSet({ flow: 'paginated' })}>Paginated</Opt>
                            <Opt on={s.flow === 'scrolled'} onClick={() => onSet({ flow: 'scrolled' })}>Scrolled</Opt>
                        </Row>

                        {/* Hidden in scrolled flow rather than greyed — there is
                            no turn to style. SPEC.md § 5.1. */}
                        {s.flow === 'paginated' && (
                            <Row label="Turn" note={TURNS.find(t => t.id === s.turn)?.note ?? ''}>
                                {TURNS.map(t => (
                                    <Opt key={t.id} on={s.turn === t.id} onClick={() => onSet({ turn: t.id })}>
                                        {t.label}
                                    </Opt>
                                ))}
                            </Row>
                        )}

                        <Toggle
                            label="Tap to turn" value={s.tapToTurn}
                            note={s.flow === 'scrolled'
                                ? 'In scrolled flow a tap only shows and hides the chrome.'
                                : 'Left third back, right third forward. Off leaves the whole page a chrome toggle.'}
                            disabled={s.flow === 'scrolled'}
                            onSet={v => onSet({ tapToTurn: v })}
                        />
                    </>
                )}
            </div>
        </section>
    )
}

/* ── the three primitives ───────────────────────────────────────────────── */

export function Row({ label, note, children }: {
    label: string
    note?: string
    children: React.ReactNode
}) {
    return (
        <div className="ctl">
            <p className="ctl-head"><span className="ctl-lbl">{label}</span></p>
            <div className="ctl-opts">{children}</div>
            {note && <p className="ctl-note">{note}</p>}
        </div>
    )
}

export function Opt({ on, onClick, children }: {
    on: boolean
    onClick: () => void
    children: React.ReactNode
}) {
    return (
        <button type="button" className="sheet-opt" aria-pressed={on} onClick={onClick}>
            {children}
        </button>
    )
}

export function Toggle({ label, value, note, disabled, onSet }: {
    label: string
    value: boolean
    note?: string
    disabled?: boolean
    onSet: (v: boolean) => void
}) {
    return (
        <div className="ctl ctl--row" data-off={disabled ? '' : undefined}>
            <div className="ctl-grow">
                <p className="ctl-head"><span className="ctl-lbl">{label}</span></p>
                {note && <p className="ctl-note">{note}</p>}
            </div>
            {/* A switch, not a pair of chips: on/off is one thing with two
                states, and two chips make it look like two choices. */}
            <button
                type="button"
                role="switch"
                className="sw"
                aria-checked={disabled ? false : value}
                aria-label={label}
                disabled={disabled}
                onClick={() => onSet(!value)}
            >
                <span className="sw-knob" aria-hidden="true" />
            </button>
        </div>
    )
}

/** −0.04 … +0.24 in em, printed the way a typographer writes it: a signed
    hundredth, and a bare `0` rather than `0.00em` at the default so the
    untouched state is visibly untouched. */
function em(v: number): string {
    if (Math.abs(v) < 0.0005) return '0'
    return `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(3).replace(/0$/, '')}em`
}

export function Slider({ label, value, min, max, step, fmt, note, disabled, zero, onLive, onCommit }: {
    label: string
    value: number
    min: number
    max: number
    step: number
    fmt: (v: number) => string
    note?: string
    disabled?: boolean
    /** draw a tick at 0 — only meaningful on the two signed ranges */
    zero?: boolean
    onLive: (v: number) => void
    onCommit: (v: number) => void
}) {
    /* The live value is local while a finger is on it, so the control does not
       wait for a Dexie round-trip to move. `dirty` is what stops an
       in-flight drag being yanked back by the row it is about to write. */
    const [v, setV] = useState(value)
    const dirty = useRef(false)
    const timer = useRef<number | null>(null)

    useEffect(() => { if (!dirty.current) setV(value) }, [value])
    useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

    const change = (n: number) => {
        dirty.current = true
        setV(n)
        onLive(n)
        if (timer.current) clearTimeout(timer.current)
        /* 320ms after the last movement — long enough that a slow drag does
           not write, short enough that letting go and closing the sheet
           always persists. Covers pointer, keyboard and wheel with one
           mechanism, which is why it is a timer and not a pointerup. */
        timer.current = window.setTimeout(() => {
            dirty.current = false
            onCommit(n)
        }, 320)
    }

    /* Unitless fractions, not percentages: the CSS positions the fill stop and
       the zero tick on the thumb's travel, calc(11px + (100% - 22px) * n). */
    const p = (v - min) / (max - min)
    return (
        <div className="ctl" data-off={disabled ? '' : undefined}>
            <p className="ctl-head">
                <span className="ctl-lbl">{label}</span>
                <span className="ctl-val">{fmt(v)}</span>
            </p>
            <div className="rng-wrap">
                <input
                    type="range"
                    className="rng"
                    min={min} max={max} step={step} value={v}
                    disabled={disabled}
                    aria-label={label}
                    aria-valuetext={fmt(v)}
                    style={{ ['--p' as string]: String(p) }}
                    onChange={e => change(Number(e.currentTarget.value))}
                />
                {zero && (
                    <span
                        className="rng-zero"
                        aria-hidden="true"
                        style={{ ['--z' as string]: String((0 - min) / (max - min)) }}
                    />
                )}
            </div>
            {note && <p className="ctl-note">{note}</p>}
        </div>
    )
}

/** The current face's own description, or nothing if the current face is not
    in this row. Both rows call it; only one can answer. */
function faceNote(face: string, kind: 'serif' | 'sans') {
    const f = READING_FACES.find(x => x.id === face)
    return f?.kind === kind ? f.note : undefined
}

/** Three tiers on a variable face, two on a static one — and the two are
    labelled Regular and Bold rather than Light and Medium, because 400 and
    700 is what the static faces actually have. SPEC.md § 3 asks for the middle
    tier to be hidden; hiding the tier and keeping its label would be the same
    lie in a different place. */
function Weight({ face, value, onSet }: {
    face: string
    value: Settings['weight']
    onSet: (patch: Partial<Settings>) => void
}) {
    const variable = !STATIC_FACES.has(face as FaceId)
    if (variable) return (
        <Row label="Weight">
            <Opt on={value === 'light'} onClick={() => onSet({ weight: 'light' })}>Light</Opt>
            <Opt on={value === 'regular'} onClick={() => onSet({ weight: 'regular' })}>Regular</Opt>
            <Opt on={value === 'medium'} onClick={() => onSet({ weight: 'medium' })}>Medium</Opt>
        </Row>
    )
    return (
        <Row label="Weight" note={`${READING_FACES.find(f => f.id === face)?.label ?? 'This face'} ships two weights, so it has two.`}>
            {/* 'light' renders at 400 on a static face, so it is shown as the
                regular tier rather than as an option that does nothing. */}
            <Opt on={value !== 'medium'} onClick={() => onSet({ weight: 'regular' })}>Regular</Opt>
            <Opt on={value === 'medium'} onClick={() => onSet({ weight: 'medium' })}>Bold</Opt>
        </Row>
    )
}
