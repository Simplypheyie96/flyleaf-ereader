/* ── audit/tip.mjs ───────────────────────────────────────────────────────
   The tip jar, which used to be a link to Press.

   It exists because the first version of this was a `.set-link` row reading
   "Buy me a coffee" that navigated to press.flyleaf.cc/settings — a different
   product's settings screen. So two of the checks here are regressions rather
   than requirements: no row whose text mentions coffee, and no href into
   Press. They stay because that is exactly the kind of thing that comes back
   when a panel is copied between the two apps.

   No transaction is ever initiated. The driver opens the jar, proves the
   Paystack SDK is on the page and that a popup handler exists, and stops
   there: the boundary is "the sheet would open", because the key is live and
   a charge is not a test result.

   The request log is split at the moment of checkout, because Settings loads
   Google's GSI client for the Drive panel on every visit. Counting that as an
   off-origin request before the checkout produced a finding on every run. */

import { chromium } from '/Users/simplypheyie/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'
const B='http://localhost:4173'
const bad=[]; const f=(w,m)=>bad.push({where:w,what:m})
const b=await chromium.launch()
for (const [name,w,h] of [['mobile',390,844],['desktop',1280,900]]){
  const ctx=await b.newContext({viewport:{width:w,height:h},deviceScaleFactor:2})
  const p=await ctx.newPage()
  const errs=[]; const off=[]
  p.on('console',m=>{ if(m.type()==='error') errs.push(m.text()) })
  let phase='load'
  p.on('request',r=>{ if(!r.url().startsWith(B)&&!r.url().startsWith('data:')&&!r.url().startsWith('blob:')) off.push(phase+' '+r.url()) })
  await p.goto(B+'/settings',{waitUntil:'networkidle'})
  // the jar's panel
  const jar = p.locator('section.panel', { has: p.locator('.tip-mark') })
  if (await jar.count()!==1) f(name,'no tip panel on Settings')
  // no Press redirect left
  const links = await p.$$eval('.set-link', els=>els.map(e=>({t:e.textContent.replace(/\s+/g,' ').trim(), h:e.getAttribute('href')})))
  if (links.some(l=>/coffee/i.test(l.t))) f(name,'the coffee row still points outside: '+JSON.stringify(links.find(l=>/coffee/i.test(l.t))))
  if (links.some(l=>/press\.flyleaf\.cc\/settings/.test(l.h||''))) f(name,'a link still goes to press settings')
  // panel geometry: both inline edges equal
  const box = await jar.evaluate(el=>{ const r=el.getBoundingClientRect(); const pr=el.parentElement.getBoundingClientRect(); return {l:r.left-pr.left, r:pr.right-r.right, w:r.width} })
  if (Math.abs(box.l-box.r)>0.6) f(name,`tip panel edges unequal: left ${box.l} right ${box.r}`)
  // open the jar
  await p.getByRole('button',{name:/Leave something in the jar/i}).click()
  await p.waitForTimeout(250)
  const amounts = await p.$$eval('.tip-amount', els=>els.map(e=>{const r=e.getBoundingClientRect(); return {t:e.textContent.trim(), w:+r.width.toFixed(1), h:+r.height.toFixed(1), pressed:e.getAttribute('aria-pressed')}}))
  if (amounts.length!==3) f(name,`expected 3 amount pills, got ${amounts.length}`)
  for (const a of amounts) if (a.h<44) f(name,`amount pill "${a.t}" is ${a.h}px tall, under the 44px floor`)
  // 16px input floor, both fields
  const ins = await p.$$eval('.tip-field input', els=>els.map(e=>({ph:e.placeholder, fs:getComputedStyle(e).fontSize, h:+e.getBoundingClientRect().height.toFixed(1), w:+e.getBoundingClientRect().width.toFixed(1)})))
  if (ins.length!==2) f(name,`expected 2 fields, got ${ins.length}`)
  for (const i of ins) if (parseFloat(i.fs)<16) f(name,`field "${i.ph}" is ${i.fs} — under the 16px iOS floor`)
  // focus must not move the page (the reported bug)
  const before = await p.evaluate(()=>{const g=s=>{const e=document.querySelector(s); if(!e) return null; const r=e.getBoundingClientRect(); return [r.x,r.y,r.width]}; return {page:g('.page'),panel:g('section.panel'),tab:g('.tabbar')}})
  await p.locator('.tip-field input[type="email"]').focus()
  await p.waitForTimeout(200)
  const after = await p.evaluate(()=>{const g=s=>{const e=document.querySelector(s); if(!e) return null; const r=e.getBoundingClientRect(); return [r.x,r.y,r.width]}; return {page:g('.page'),panel:g('section.panel'),tab:g('.tabbar')}})
  if (JSON.stringify(before)!==JSON.stringify(after)) f(name,`focusing the email field moved the layout: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`)
  // the floor note
  await p.locator('.tip-field input[inputmode="numeric"]').fill('50')
  await p.waitForTimeout(150)
  const note = await p.locator('.tip-note').count()
  if (note!==1) f(name,'no floor note under the Paystack minimum')
  const goDisabled = await p.getByRole('button',{name:/Continue with/i}).isDisabled()
  if (!goDisabled) f(name,'Continue is enabled at an amount under the floor')
  await p.locator('.tip-field input[inputmode="numeric"]').fill('')
  // email validation before any SDK load
  phase='bademail'
  await p.locator('.tip-field input[type="email"]').fill('not-an-email')
  await p.getByRole('button',{name:/Continue with/i}).click()
  await p.waitForTimeout(250)
  const why = await p.locator('.tip-why').textContent().catch(()=>null)
  if (!why || !/email/i.test(why)) f(name,`a bad email did not produce the email note (got ${JSON.stringify(why)})`)
  /* Only what the BAD EMAIL caused. The Drive panel's Google Identity script
     loads with the page whether or not there is a jar on it, so counting it
     here blamed the jar for the sync panel's request. */
  const onBad = off.filter(u=>u.startsWith('bademail '))
  if (onBad.length) f(name,'a bad email fetched something off-origin: '+onBad.join(', '))
  if (off.some(u=>/paystack/.test(u))) f(name,'Paystack was fetched before anybody chose to pay: '+off.filter(u=>/paystack/.test(u)).join(', '))
  // now a good one: the SDK must actually load, and we stop there
  phase='checkout'
  await p.locator('.tip-field input[type="email"]').fill('reader@example.com')
  await p.getByRole('button',{name:/Continue with/i}).click()
  await p.waitForTimeout(4000)
  const sdk = off.filter(u=>/js\.paystack\.co/.test(u))
  if (!sdk.length) f(name,'the Paystack SDK was never requested')
  const hasPop = await p.evaluate(()=>typeof window.PaystackPop)
  if (hasPop!=='function') f(name,`PaystackPop did not arrive (typeof ${hasPop})`)
  /* Everything Paystack's own checkout drags in with it — gtag, pusher,
     posthog — arrives inside the checkout phase and is Paystack's supply
     chain, not this app's. What would be a finding is any of it arriving
     BEFORE the reader chose to continue. */
  const early = off.filter(u=>!u.startsWith('checkout ')&&!/accounts\.google\.com\/gsi/.test(u))
  if (early.length) f(name,'off-origin requests before the checkout: '+early.join(', '))
  console.log(name, 'checkout pulled in:', off.filter(u=>u.startsWith('checkout ')).map(u=>new URL(u.slice(9)).host).join(', '))
  console.log(name, 'before the checkout:', off.filter(u=>!u.startsWith('checkout ')).join(', ')||'nothing but the Drive panel\'s GSI script')
  const real = errs.filter(e=>!/Content Security|paystack/i.test(e))
  if (real.length) f(name,'console errors: '+real.join(' | '))
  await p.screenshot({path:`/tmp/fl/tip-${name}.png`, fullPage:false})
  console.log(name, JSON.stringify({box, amounts, ins, sdk:sdk.length, hasPop}))
  await ctx.close()
}
await b.close()
console.log('FINDINGS:', bad.length)
for (const x of bad) console.log(' -', x.where, x.what)
