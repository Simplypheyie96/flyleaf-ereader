/* What to call this device, when the shelf has to say where a change was made.

   IT IS A GUESS, AND IT IS ALLOWED TO BE. No browser will say honestly what
   machine it is on, and nobody is being asked to act on this — they are being
   reminded which of their own devices they were sitting at. A wrong-but-
   plausible "iPad" is a smaller failure than "another device", which is what
   it replaces. Nothing here identifies a person: it is a category of hardware,
   written into the user's own Drive, readable by nobody but them. */

const KEY = 'flyleaf-ereader-device'

function guess(): string {
  const ua = navigator.userAgent
  /* iPadOS reports itself as a Mac and is only told apart by the touchscreen,
     which is why this test comes before the Mac one. */
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad'
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet'
  if (/Macintosh/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows PC'
  if (/Linux|X11/.test(ua)) return 'Linux computer'
  return 'Another device'
}

/** This device's name, decided once and then remembered — so a browser update
    that changes the user-agent string does not rename a device already shown. */
export function deviceName(): string {
  try {
    const held = localStorage.getItem(KEY)
    if (held) return held
    const name = guess()
    localStorage.setItem(KEY, name)
    return name
  } catch {
    /* Private mode. The name is still right; it just gets worked out again
       each time, which costs one regular expression. */
    return guess()
  }
}
