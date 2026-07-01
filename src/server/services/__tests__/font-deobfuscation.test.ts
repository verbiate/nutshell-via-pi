import { describe, it, expect } from "vitest";
import {
  adobeKey,
  idpfKey,
  xorPrefix,
  parseEncryptionXml,
  deobfuscateEpubFonts,
} from "@/server/services/font-deobfuscation";
import JSZip from "jszip";

// ponytail: ground-truth vectors taken from data/uploads/epubs/ba9f8b9…epub
// ("Why We Sleep"), whose encryption.xml declares Adobe RC over fonts/0000N.otf
// and whose unique-id is urn:uuid:3c4a2ab8-2892-47a0-b93f-5348838075ce. The
// obfuscated first 4 bytes 0x73 0x1e 0x7e 0xf7 MUST decrypt to "OTTO" (the CFF
// OpenType magic). If this ever breaks, the deobfuscation is wrong.

const UID = "urn:uuid:3c4a2ab8-2892-47a0-b93f-5348838075ce";

describe("font-deobfuscation key derivation", () => {
  it("derives the 16-byte Adobe RC key from the uuid (strips urn:uuid: + hyphens + colons)", () => {
    expect(adobeKey(UID).toString("hex")).toBe(
      "3c4a2ab8289247a0b93f5348838075ce",
    );
  });

  it("derives the 20-byte IDPF key as SHA-1 of the whitespace-stripped identifier", () => {
    // sha1("urn:uuid:3c4a2ab8-2892-47a0-b93f-5348838075ce") — precomputed
    expect(idpfKey(UID).toString("hex")).toBe(
      "3539448902fd797af21fd6731f5bf31556805ae9",
    );
  });

  it("strips colons too (not just hyphens) for the Adobe key", () => {
    // Some epubs use urn:uuid: with colons inside the hex body; ensure both strip.
    expect(adobeKey("urn:uuid:3c:4a:2a:b8").toString("hex")).toBe("3c4a2ab8");
  });
});

describe("font-deobfuscation XOR", () => {
  it("recovers 'OTTO' (CFF OpenType magic) from the real obfuscated bytes", () => {
    const obf = Buffer.from([
      0x73, 0x1e, 0x7e, 0xf7, 0x28, 0x9f, 0x47, 0x20, 0xb9, 0x3c, 0x53, 0x18,
      0xc1, 0xc1, 0x26, 0x8b,
    ]);
    const dec = xorPrefix(obf, adobeKey(UID), 1024);
    expect(dec.slice(0, 4).toString("latin1")).toBe("OTTO");
  });

  it("XORs only the first N bytes; the tail is byte-for-byte unchanged", () => {
    const data = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const key = Buffer.from([0xff, 0x00]);
    const out = xorPrefix(data, key, 4);
    expect(Array.from(out.slice(0, 4))).toEqual([1 ^ 0xff, 2, 3 ^ 0xff, 4]);
    expect(out.slice(4)).toEqual(data.slice(4));
  });
});

describe("font-deobfuscation encryption.xml parsing", () => {
  it("extracts Adobe-RC font entries and ignores non-font / unknown-algo entries", () => {
    const xml = `<?xml version="1.0"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"
            xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
  <enc:EncryptedData>
    <enc:EncryptionMethod Algorithm="http://ns.adobe.com/pdf/enc#RC"/>
    <enc:CipherData><enc:CipherReference URI="fonts/00002.otf"/></enc:CipherData>
  </enc:EncryptedData>
  <EncryptedData>
    <EncryptionMethod Algorithm="http://ns.adobe.com/pdf/enc#RC"/>
    <CipherData><CipherReference URI="images/cover.jpeg"/></CipherData>
  </EncryptedData>
  <enc:EncryptedData>
    <enc:EncryptionMethod Algorithm="http://example.com/unknown"/>
    <enc:CipherData><enc:CipherReference URI="fonts/00003.otf"/></enc:CipherData>
  </enc:EncryptedData>
</encryption>`;
    const entries = parseEncryptionXml(xml);
    expect(entries).toEqual([{ uri: "fonts/00002.otf", algorithm: "adobe" }]);
  });

  it("returns [] for an encryption.xml with no supported font entries", () => {
    const xml = `<encryption><EncryptedData>
      <EncryptionMethod Algorithm="http://ns.adobe.com/pdf/enc#RC"/>
      <CipherData><CipherReference URI="images/cover.jpeg"/></CipherData>
    </EncryptedData></encryption>`;
    expect(parseEncryptionXml(xml)).toEqual([]);
  });
});

describe("font-deobfuscation end-to-end", () => {
  async function buildFakeEpub(): Promise<Buffer> {
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
    zip.file(
      "META-INF/container.xml",
      `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile media-type="application/oebps-package+xml" full-path="content.opf"/></rootfiles>
</container>`,
    );
    zip.file(
      "content.opf",
      `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">${UID}</dc:identifier>
  </metadata>
  <manifest><item id="f" href="fonts/x.otf" media-type="application/vnd.ms-opentype"/></manifest>
  <spine/>
</package>`,
    );
    zip.file(
      "META-INF/encryption.xml",
      `<encryption xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
  <enc:EncryptedData>
    <enc:EncryptionMethod Algorithm="http://ns.adobe.com/pdf/enc#RC"/>
    <enc:CipherData><enc:CipherReference URI="fonts/x.otf"/></enc:CipherData>
  </enc:EncryptedData>
</encryption>`,
    );
    // The real obfuscated head of fonts/00002.otf — should decrypt to "OTTO…".
    const obfHead = Buffer.from([
      0x73, 0x1e, 0x7e, 0xf7, 0x28, 0x9f, 0x47, 0x20, 0xb9, 0x3c, 0x53, 0x18,
      0xc1, 0xc1, 0x26, 0x8b,
    ]);
    const tail = Buffer.alloc(2048 - obfHead.length, 0xab); // rest of "font"
    zip.file("fonts/x.otf", Buffer.concat([obfHead, tail]));
    return Buffer.from(await zip.generateAsync({ type: "uint8array" }));
  }

  it("deobfuscates the font, strips encryption.xml, and recovers 'OTTO'", async () => {
    const original = await buildFakeEpub();
    const cleaned = await deobfuscateEpubFonts(original);
    expect(cleaned.equals(original)).toBe(false);

    const zip = await JSZip.loadAsync(cleaned);
    expect(zip.file("META-INF/encryption.xml")).toBeNull(); // stripped
    const font = Buffer.from(await zip.file("fonts/x.otf")!.async("uint8array"));
    expect(font.slice(0, 4).toString("latin1")).toBe("OTTO");
    // XOR covers only the first 1024 bytes; bytes beyond must be untouched.
    expect(font.slice(1024)).toEqual(Buffer.alloc(2048 - 1024, 0xab));
  });

  it("is a no-op when there is no encryption.xml", async () => {
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
    zip.file(
      "META-INF/container.xml",
      `<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
       <rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    );
    zip.file("content.opf", `<package unique-identifier="uid">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:identifier id="uid">${UID}</dc:identifier>
      </metadata><manifest/><spine/></package>`);
    const original = Buffer.from(
      await zip.generateAsync({ type: "uint8array" }),
    );
    const out = await deobfuscateEpubFonts(original);
    expect(out.equals(original)).toBe(true);
  });
});
