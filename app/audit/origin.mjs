/* Does Google accept this app's origin?

   The one question here, and the only way to answer it is to press the real
   button and read what Google sends back. It cannot be read off the Console: a
   saved form is not proof the change reached Google's edge, and their own note
   allows five minutes to a few hours for it to.

   What the answer looks like:

     · PASS — the popup lands on an accounts.google.com sign-in or account
       chooser page. Google has accepted the origin and is now asking who is
       signing in.
     · FAIL — the popup lands on /signin/oauth/error?authError=…, which decodes
       to origin_mismatch. That is Google refusing the origin itself, before any
       question of identity.

   This driver deliberately stops at that page and signs in to nothing. Reaching
   the sign-in screen is the whole proof; going through it would be granting a
   real account's consent, which is not a thing an audit run should do.

   And this is the check that used to lie. origin_mismatch reaches the GSI SDK as
   popup_closed — Google paints the error in the popup and all the SDK sees is
   the window going away — so the panel said "Sign-in was closed before it
   finished" and blamed the reader for a Console setting. So this reads the
   POPUP's URL, not the panel's message. */
import { chromium } from '/Users/simplypheyie/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'

const BASE = process.env.BASE ?? 'http://localhost:4173'
const findings = []
const bad = (w, m) => findings.push(`${w}: ${m}`)

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()

await page.goto(BASE + '/settings', { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)

const connect = page.getByRole('button', { name: /connect/i })
if (!await connect.count()) {
    bad('panel', 'no Connect button on /settings — the Drive panel is hidden, so VITE_GOOGLE_CLIENT_ID is missing from this build')
} else {
    /* The popup is the answer, so it is awaited alongside the click rather than
       looked for afterwards — by then it may already have navigated. */
    const opened = ctx.waitForEvent('page', { timeout: 20000 }).catch(() => null)
    await connect.first().click()
    const pop = await opened

    if (!pop) {
        bad('popup', 'Connect opened no popup at all in 20s')
    } else {
        await pop.waitForLoadState('domcontentloaded').catch(() => {})
        /* Google redirects a few times before it settles; the error page is the
           last hop, not the first, so this samples until the URL stops moving. */
        let url = pop.url(), still = 0
        for (let i = 0; i < 14 && still < 3; i++) {
            await pop.waitForTimeout(500)
            const now = pop.url()
            still = now === url ? still + 1 : 0
            url = now
        }
        const err = /\/signin\/oauth\/error/.test(url)
        const authError = new URL(url).searchParams.get('authError')
        let decoded = null
        if (authError) { try { decoded = Buffer.from(authError, 'base64').toString('utf8').slice(0, 300) } catch { decoded = '(undecodable)' } }

        console.log('popup settled at: ' + url.slice(0, 160))
        if (decoded) console.log('authError decodes to: ' + decoded)

        if (err) bad('origin', `Google refused the origin — ${/origin_mismatch/.test(decoded ?? '') ? 'origin_mismatch' : 'an OAuth error page'}. ${BASE} is not on the client's authorised list, or the change has not propagated yet.`)
        else if (!/accounts\.google\.com/.test(url)) bad('origin', `the popup went somewhere unexpected: ${url.slice(0, 120)}`)
        else console.log(`• PASS — Google accepted ${BASE} and is asking who is signing in. Not signing in; that is the proof.`)

        await pop.close().catch(() => {})
    }
}

console.log(`\n=== FINDINGS: ${findings.length} ===`)
for (const x of findings) console.log(' - ' + x)
await browser.close()
