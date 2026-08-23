/* Re-export surface for audit/appdata.mjs. Exists so the driver bundles the
   real record.ts and the real drive.ts, and so `APP` under test is the same
   string the writer stamps rather than one retyped in the driver. */
export { ours, SHELF, MARKS, PLACE, bookFileName } from '../../src/sync/record'
export { APP } from '../../src/sync/drive'
