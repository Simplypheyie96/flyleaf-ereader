/* record.ts imports the Dexie database at module scope. `ours` is a pure
   function of a file's name and tag and touches none of it, so the driver
   aliases ../db to this rather than standing up IndexedDB in node. If a future
   change makes ownership depend on the database, this stub is what will tell
   you — loudly, rather than by passing. */
const reject = (name: string) => {
  throw new Error(`audit/fixtures/db-stub: ours() must not read the database (touched ${name})`)
}
export const db = new Proxy({}, { get: (_t, k) => reject(String(k)) })
export const pruneGraves = () => reject('pruneGraves')
