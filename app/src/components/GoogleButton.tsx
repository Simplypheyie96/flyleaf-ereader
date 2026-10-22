/* Google's own "Continue with Google", drawn by Google into this box.

   It has to be theirs. The ID-token sign-in that keeps a reader signed in for
   good (see sync/cloud.ts) only answers a press on Google's rendered button;
   a button of ours would have to go back to the hour-long Drive tokens that
   signed everybody out. Ported from Flyleaf Journal. */

import { useEffect, useRef } from 'react'
import { googleButton } from '../sync/cloud'

interface Props {
  onDone: (email: string) => void
  onError: (message: string) => void
}

export function GoogleButton({ onDone, onError }: Props) {
  const box = useRef<HTMLDivElement>(null)
  /* Latest callbacks without redrawing Google's iframe on every render. */
  const done = useRef(onDone)
  const fail = useRef(onError)
  done.current = onDone
  fail.current = onError

  useEffect(() => {
    if (!box.current) return
    googleButton(
      box.current,
      (email) => done.current(email),
      (message) => fail.current(message),
    ).catch((error: Error) => fail.current(error.message))
  }, [])

  /* `colorScheme: light` matches Google's iframe document. In dark mode the page
     is `color-scheme: dark`, and a mismatch makes the browser paint an opaque
     white backdrop behind the iframe: the white box around the button. */
  return (
    <div
      ref={box}
      style={{ width: '100%', maxWidth: 400, minHeight: 44, display: 'flex', justifyContent: 'center', alignItems: 'center', colorScheme: 'light' }}
    />
  )
}
