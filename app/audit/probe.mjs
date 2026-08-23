/* Runs in the page. Drains animations first — a colour transition sampled
   mid-flight reports a contrast pair that never actually renders, which is
   how a 2.89:1 "failure" turned out to be the nav fading between themes. */
export const PROBE = () => {
  const settle = async () => {
    for (let i = 0; i < 40; i++) {
      const running = document.getAnimations().filter(a => a.playState === 'running')
      if (!running.length) break
      await Promise.race([
        Promise.allSettled(running.map(a => a.finished)),
        new Promise(r => setTimeout(r, 120)),
      ])
    }
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
  }
  const lum = (rgb) => { const [r, g, b] = rgb.map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
  const parse = (s) => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(parseFloat); return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 } }
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]; return +((hi + 0.05) / (lo + 0.05)).toFixed(2) }
  const bgOf = (el) => { let n = el; while (n) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0) return c.rgb; n = n.parentElement } return parse(getComputedStyle(document.body).backgroundColor).rgb }
  const box = (el) => { const q = el.getBoundingClientRect(); return { x: +q.x.toFixed(1), r: +q.right.toFixed(1), w: +q.width.toFixed(1), t: +q.top.toFixed(1), b: +q.bottom.toFixed(1) } }
  const rendered = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'

  return settle().then(() => {
    /* contrast over every pair that actually renders */
    const seen = new Map()
    document.querySelectorAll('body *').forEach(el => {
      if (!rendered(el)) return
      if (!Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim())) return
      const cs = getComputedStyle(el)
      if (parseFloat(cs.opacity) < 0.5) return
      const fg = parse(cs.color); if (!fg) return
      const bg = bgOf(el)
      const size = parseFloat(cs.fontSize), weight = parseInt(cs.fontWeight, 10) || 400
      const large = size >= 24 || (size >= 18.66 && weight >= 700)
      const key = `${cs.color}|${bg.join(',')}|${size}|${weight}`
      if (seen.has(key)) return
      const cr = ratio(fg.rgb, bg)
      seen.set(key, { cr, size, weight, need: large ? 3 : 4.5, pass: cr >= (large ? 3 : 4.5), sample: el.textContent.trim().slice(0, 34), fg: cs.color, bg: `rgb(${bg.join(',')})` })
    })
    const contrast = Array.from(seen.values()).sort((a, b) => a.cr - b.cr)

    /* every block that should share the content column, both edges */
    const inner = document.querySelector('.page-inner')
    /* Block children only. A back link is inline-flex and correctly as wide as
       the words in it — measuring its right edge against the column's says
       every screen with a back link is broken. */
    const blocks = inner
      ? Array.from(inner.children)
          .filter(el => rendered(el) && !getComputedStyle(el).display.startsWith('inline'))
          .map(el => ({ cls: String(el.className).slice(0, 40), ...box(el) }))
      : []

    /* Lists that dropped their bullets but kept the UA's 40px indent. This is
       here because it cost a full pass to find by eye: the list's own border
       box is flush to the column, so the block-edge check above reports L0 R0
       and passes, while every child inside it sits 40px in — and on a grid the
       indent silently narrows every column instead of moving anything. */
    const strayListPad = Array.from(document.querySelectorAll('.page-inner ul, .page-inner ol'))
      .filter(rendered)
      .map(el => ({ el, cs: getComputedStyle(el) }))
      /* NET of a negative inline margin, not the padding alone. A full-bleed
         scroller is padding-inline:gutter against margin-inline:-gutter on
         purpose — DESIGN.md's rule that content bleeds and controls do not —
         so its first card is exactly on the column and its last one runs off
         the edge, which is the whole point. Measured on .rail: +20px padding,
         -20px margin, 0px of indent, reported as a finding on four themes. */
      .map(({ el, cs }) => ({ el, cs, net: parseFloat(cs.paddingInlineStart) + parseFloat(cs.marginInlineStart) }))
      .filter(({ cs, net }) => cs.listStyleType === 'none' && net > 0.5)
      .map(({ el, net }) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)} +${net.toFixed(1)}px`)

    /* touch targets */
    const targets = Array.from(document.querySelectorAll('a,button,input,select,[tabindex]'))
      .filter(rendered)
      .map(el => {
        const q = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        return {
          tag: el.tagName, cls: String(el.className).slice(0, 30), txt: el.textContent.trim().slice(0, 20),
          w: +q.width.toFixed(1), h: +q.height.toFixed(1),
          /* WCAG 2.5.8 exempts a target that is inline in a sentence or block
             of text — its size is the text's, and padding it out would break
             the line it sits in. */
          inlineText: cs.display.startsWith('inline'),
          focusable: el.tabIndex >= 0,
        }
      })
      /* Something that cannot be focused and has no pointer surface is not a
         target at all — the visually-hidden file input behind the Choose a
         file button is 1x1 by design and carries tabIndex -1. */
      .filter(t => (t.w < 24 || t.h < 24) && t.focusable)
    const small = targets.filter(t => !t.inlineText)
    const smallInline = targets.filter(t => t.inlineText)

    /* The same element is a bottom-centred pill below 1024 and a left rail at
       or above it. Only the rail shares a horizontal axis with the content, so
       only the rail can crowd it — comparing the pill's right edge to the
       content's left edge produced a -295px "clearance" on every phone width. */
    const railEl = document.querySelector('.tabbar')
    const rail = railEl && rendered(railEl) && getComputedStyle(railEl).flexDirection === 'column' ? railEl : null
    return {
      docW: document.documentElement.scrollWidth,
      winW: innerWidth,
      overflowX: document.documentElement.scrollWidth > innerWidth,
      scrollH: document.documentElement.scrollHeight,
      theme: document.documentElement.getAttribute('data-theme'),
      innerBox: inner ? box(inner) : null,
      leftMargin: inner ? +box(inner).x.toFixed(1) : null,
      rightMargin: inner ? +(innerWidth - box(inner).r).toFixed(1) : null,
      railBox: rail ? box(rail) : null,
      blocks,
      strayListPad,
      misaligned: inner ? blocks.filter(b => Math.abs(b.x - box(inner).x) > 0.5 || Math.abs(b.r - box(inner).r) > 0.5).map(b => b.cls) : [],
      contrastPairs: contrast.length,
      contrastFailing: contrast.filter(c => !c.pass),
      contrastWorst: contrast[0] ?? null,
      smallTargets: small,
      smallInlineTargets: smallInline,
      empty: !!document.querySelector('.empty'),
      cards: document.querySelectorAll('.shelf-card').length,
      rows: document.querySelectorAll('.shelf-row').length,
    }
  })
}

/* The finding rules, kept next to the probe so every driver — the route sweep
   and the state pass — judges the same numbers the same way. */
export function check(tag, res) {
  const out = []
  if (res.overflowX) out.push(`${tag}: horizontal overflow — docW ${res.docW} > win ${res.winW}`)
  if (res.misaligned.length) out.push(`${tag}: blocks off the content column — ${res.misaligned.join(', ')}`)
  if (res.strayListPad?.length) out.push(`${tag}: unstyled list indent — ${res.strayListPad.join(', ')}`)
  if (res.contrastFailing.length) out.push(`${tag}: contrast — ` + res.contrastFailing.map(c => `${c.cr}:1 needs ${c.need} (${c.size}px "${c.sample}") ${c.fg} on ${c.bg}`).join(' | '))
  if (res.smallTargets.length) out.push(`${tag}: targets under 24px — ` + res.smallTargets.map(t => `${t.tag}.${t.cls} "${t.txt}" ${t.w}x${t.h}`).join(' | '))
  if (res.railBox && res.innerBox) {
    const clear = +(res.innerBox.x - res.railBox.r).toFixed(1)
    if (clear < 16) out.push(`${tag}: rail clearance ${clear}px (rail ends ${res.railBox.r}, content starts ${res.innerBox.x})`)
    const asym = Math.abs(clear - res.rightMargin)
    if (asym > 1) out.push(`${tag}: asymmetric — ${clear}px left of content vs ${res.rightMargin}px right`)
  } else if (res.innerBox && Math.abs(res.leftMargin - res.rightMargin) > 1) {
    out.push(`${tag}: asymmetric gutters — left ${res.leftMargin} vs right ${res.rightMargin}`)
  }
  return out
}
