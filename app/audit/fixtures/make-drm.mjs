/* Writes drm.epub — a conforming EPUB whose one chapter is declared encrypted
   with Adobe ADEPT in META-INF/encryption.xml. CLAUDE.md: a DRM'd file is
   refused with a plain explanation, never a silent failure and never a broken
   render. Nothing in the suite exercised that promise before this fixture; the
   refusal copy lives in `src/pages/OpenBook.tsx`, the detection in
   `src/import/epub.ts` (`isEncrypted`), which must let a font's obfuscation
   through and stop at anything else.

   The chapter text is plain, deliberately: a reader that ignored the manifest
   would render it, and the audit would then see a "book" where a refusal was
   owed. Run: node audit/fixtures/make-drm.mjs */

import { writeFileSync } from 'node:fs'
import { deflateRawSync, crc32 } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

/* Same hand-written zip as make-zip-shapes.mjs: mimetype first and stored,
   everything else deflated. */
function zip(entries) {
  const parts = [], central = []
  let offset = 0
  for (const [name, data, stored] of entries) {
    const n = Buffer.from(name, 'utf8')
    const body = stored ? data : deflateRawSync(data)
    const method = stored ? 0 : 8
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(n.length, 26)
    parts.push(local, n, body)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(method, 10)
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(data.length, 24)
    c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42)
    central.push(c, n)
    offset += local.length + n.length + body.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, cd, end])
}

const b = (s) => Buffer.from(s, 'utf8')
/* Two manifests, both locked: the prefixed shape (`enc:`), which is what
   `getElementsByTagName` used to miss, and the default-namespace shape Adobe
   writes. One file each, so a regression in either is named. */
const PREFIXED = `<?xml version="1.0"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
  <enc:EncryptedData>
    <enc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/>
    <enc:CipherData><enc:CipherReference URI="OEBPS/ch1.xhtml"/></enc:CipherData>
  </enc:EncryptedData>
</encryption>`
const ADOBE = `<?xml version="1.0"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#">
    <EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/>
    <KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><resource xmlns="http://ns.adobe.com/adept">urn:uuid:0</resource></KeyInfo>
    <CipherData><CipherReference URI="OEBPS/ch1.xhtml"/></CipherData>
  </EncryptedData>
</encryption>`
const book = (encryption) => zip([
  ['mimetype', b('application/epub+zip'), true],
  ['META-INF/container.xml', b(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`)],
  ['META-INF/encryption.xml', b(encryption)],
  ['META-INF/rights.xml', b('<adept:rights xmlns:adept="http://ns.adobe.com/adept"/>')],
  ['OEBPS/content.opf', b(`<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">urn:uuid:drm-fixture</dc:identifier>
    <dc:title>A Locked Book</dc:title><dc:creator>Nobody</dc:creator><dc:language>en</dc:language>
  </metadata>
  <manifest><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="c1"/></spine>
</package>`)],
  ['OEBPS/ch1.xhtml', b(`<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>1</title></head>
<body><p>If this sentence is on a page, the encryption manifest was ignored.</p></body></html>`)],
])
for (const [name, enc] of [['drm.epub', PREFIXED], ['drm-adobe.epub', ADOBE]]) {
  const epub = book(enc)
  writeFileSync(join(here, name), epub)
  console.log('wrote', name, epub.length, 'bytes')
}
