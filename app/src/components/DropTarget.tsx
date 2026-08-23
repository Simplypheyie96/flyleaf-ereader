import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { queueFiles } from '../openQueue'

/* Drop a book anywhere in the window.

   The whole app is the target, not a rectangle on one screen: a reader dragging
   a file at the shelf should not have to find the import screen first. What a
   drop does is put the file in the open queue and go to /open — which is
   exactly what the OS file handler does, so a drop and a double-click are one
   code path and get the same messages when the file turns out to be a DRM'd
   one.

   Counting enters and leaves rather than toggling on dragover: dragging across
   a child element fires dragleave on the parent, and a toggle flickers the
   overlay off and on the whole way across the window. */

export function DropTarget() {
  const navigate = useNavigate()
  const [over, setOver] = useState(false)

  useEffect(() => {
    let depth = 0

    /* Only a file drag. Dragging selected text across the app is not an
       import, and an overlay that appears when you drag a word is a bug that
       looks like a haunting. */
    const isFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files')

    const enter = (event: DragEvent) => {
      if (!isFiles(event)) return
      event.preventDefault()
      depth++
      setOver(true)
    }
    const move = (event: DragEvent) => {
      if (!isFiles(event)) return
      /* Without this the browser treats the window as a place a file cannot be
         dropped, and the drop event never fires. */
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }
    const leave = (event: DragEvent) => {
      if (!isFiles(event)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setOver(false)
    }
    const drop = (event: DragEvent) => {
      if (!isFiles(event)) return
      /* Preventing the default is what stops the browser from navigating away
         to the file it was handed — which on a PWA closes the app. */
      event.preventDefault()
      depth = 0
      setOver(false)
      const files = Array.from(event.dataTransfer?.files ?? [])
      if (!files.length) return
      queueFiles(files)
      navigate('/open')
    }

    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', move)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', move)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [navigate])

  if (!over) return null
  return (
    <div className="dropveil" aria-hidden="true">
      <span>Drop it anywhere</span>
    </div>
  )
}
