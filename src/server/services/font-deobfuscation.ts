import crypto from "crypto";

// EPUB font obfuscation is NOT DRM — per the IDPF OCF spec it's a documented
// permissions scheme that every compliant reader (ADE, calibre, Apple Books,
// Sigil) deobfuscates to render. Both algorithms are simple XOR-with-cycled-key
// over the head of the font. Verified against Sigil's FontObfuscation.cpp and
// confirmed against the real bytes of data/uploads/epubs/ba9f8b9…epub
// (decrypts to "OTTO" = valid CFF OpenType header).

const ADOBE_ALGO = "http://ns.adobe.com/pdf/enc#RC";
const IDPF_ALGO = "http://www.idpf.org/2008/embedding";
const ADOBE_BYTES = 1024; // first 1024 bytes are obfuscated
const IDPF_BYTES = 1040; // first 1040 bytes are obfuscated

export function adobeKey(uid: string): Buffer {
  // strip "urn:uuid:", hyphens, colons; hex-decode → 16-byte AES... no, XOR key.
  const hex = uid.replace(/urn:uuid:/i, "").replace(/[-:]/g, "");
  return Buffer.from(hex, "hex");
}

export function idpfKey(uid: string): Buffer {
  // strip ALL whitespace; SHA-1 of the UTF-8 bytes → 20-byte key.
  const cleaned = uid.replace(/\s/g, "");
  return crypto.createHash("sha1").update(cleaned, "utf8").digest();
}

/** XOR the first `bytes` of `data` with `key` cycled. Returns a new Buffer. */
export function xorPrefix(data: Buffer, key: Buffer, bytes: number): Buffer {
  const out = Buffer.from(data);
  const n = Math.min(bytes, data.length);
  for (let i = 0; i < n; i++) out[i] = data[i] ^ key[i % key.length];
  return out;
}

interface EncryptedFont {
  uri: string;
  algorithm: "adobe" | "idpf";
}

function isFontUri(uri: string): boolean {
  return /\.(woff2?|ttf|otf|eot)$/i.test(uri);
}

/** Parse META-INF/encryption.xml → font entries using a known obfuscation algo. */
export function parseEncryptionXml(xml: string): EncryptedFont[] {
  const out: EncryptedFont[] = [];
  // Each <EncryptedData> holds one <EncryptionMethod Algorithm="…"> and one
  // <CipherReference URI="…">. Iterate block by block; tag prefixes vary
  // (enc:, deenc:, none) so match loosely on local names.
  const blockRe = /<(?:[a-z]+:)?EncryptedData\b[^>]*>([\s\S]*?)<\/(?:[a-z]+:)?EncryptedData>/gi;
  const algoRe = /<(?:[a-z]+:)?EncryptionMethod\b[^>]*Algorithm="([^"]+)"/i;
  const uriRe = /<(?:[a-z]+:)?CipherReference\b[^>]*URI="([^"]+)"/i;
  let block: RegExpExecArray | null;
  while ((block = blockRe.exec(xml)) !== null) {
    const inner = block[1];
    const algo = inner.match(algoRe)?.[1];
    const uri = inner.match(uriRe)?.[1];
    if (!algo || !uri) continue;
    const normalized =
      algo === ADOBE_ALGO ? "adobe" : algo === IDPF_ALGO ? "idpf" : null;
    // Only collect font entries under the two supported algorithms; other
    // encryption types (e.g. actual DRM) are left untouched and encryption.xml
    // is preserved.
    if (normalized && isFontUri(uri)) out.push({ uri, algorithm: normalized });
  }
  return out;
}

/** Read the OPF unique-identifier text (the deobfuscation key source). */
export async function readUniqueIdentifier(zip: any): Promise<string | null> {
  const containerXml = await zip.file("META-INF/container.xml")?.async("text");
  const opfPath = containerXml?.match(/full-path="([^"]+\.opf)"/i)?.[1];
  if (!opfPath) return null;
  const opf = await zip.file(opfPath)?.async("text");
  if (!opf) return null;
  const uidId = opf.match(/unique-identifier="([^"]+)"/i)?.[1];
  if (!uidId) return null;
  // <dc:identifier id="<uidId>" …>value</dc:identifier> — id may sit in any
  // attribute position, so anchor on a \b word boundary on the attr name.
  const idEsc = uidId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<dc:identifier\\b[^>]*\\bid="${idEsc}"[^>]*>([^<]*)</dc:identifier>`,
    "i",
  );
  return opf.match(re)?.[1].trim() ?? null;
}

/**
 * Deobfuscate EPUB fonts in-place. Returns the ORIGINAL buffer untouched when:
 *  - there is no META-INF/encryption.xml, or
 *  - it declares no font entries under the two supported algorithms.
 * Otherwise returns a freshly re-zipped buffer with fonts decrypted and the
 * now-stale encryption.xml removed. Non-font / unsupported encryption is left
 * as-is (and encryption.xml is kept in that case).
 *
 * ponytail: re-zips the whole epub when changes are needed (only ~6% of a real
 * library triggers it). mimetype is re-stored STORED-first to stay spec-legal;
 * epub.js (our only consumer) is tolerant either way.
 */
export async function deobfuscateEpubFonts(buffer: Buffer): Promise<Buffer> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);

  const encXml = await zip.file("META-INF/encryption.xml")?.async("text");
  if (!encXml) return buffer;

  const fonts = parseEncryptionXml(encXml);
  if (fonts.length === 0) return buffer;

  const uid = await readUniqueIdentifier(zip);
  if (!uid) return buffer; // can't derive a key → leave the book untouched

  let changed = false;
  for (const { uri, algorithm } of fonts) {
    const entry = zip.file(uri);
    if (!entry) continue;
    const data = Buffer.from(await entry.async("uint8array"));
    const key = algorithm === "adobe" ? adobeKey(uid) : idpfKey(uid);
    if (key.length === 0) continue;
    const bytes = algorithm === "adobe" ? ADOBE_BYTES : IDPF_BYTES;
    zip.file(uri, xorPrefix(data, key, bytes));
    changed = true;
  }

  if (!changed) return buffer;

  // Fonts are now plaintext → the encryption declarations are stale. If EVERY
  // declared entry was a font we just handled, drop encryption.xml entirely.
  // (If non-font / unsupported-algo entries remain, keep it so we don't lie
  // about their state.)
  const nonFontEntriesRemain = countCipherReferences(encXml) > fonts.length;
  if (!nonFontEntriesRemain) zip.remove("META-INF/encryption.xml");

  // Preserve mimetype as first entry, STORED (uncompressed) per EPUB/OCF.
  const mimetype = zip.file("mimetype");
  if (mimetype) {
    const mt = await mimetype.async("uint8array");
    zip.file("mimetype", mt, { compression: "STORE" });
  }

  return Buffer.from(
    await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    }),
  );
}

function countCipherReferences(xml: string): number {
  return (xml.match(/<(?:[a-z]+:)?CipherReference\b/gi) || []).length;
}
