// Dependency-free .docx text extractor.
//
// A .docx is a ZIP archive whose body text lives in `word/document.xml`. We avoid adding a
// new npm dependency (no mammoth/jszip in this repo) by scanning the ZIP's local file
// headers, inflating that one entry, and stripping the WordprocessingML tags. Good enough to
// feed an offer sheet's prose into the avatar-distill Claude call — it is not a full Office
// parser (tables/numbering are flattened to text, which is exactly what we want here).

import { inflateRawSync } from "zlib";

const LOCAL_FILE_HEADER_SIG = 0x04034b50; // "PK\x03\x04"

interface ZipEntry {
  name: string;
  method: number; // 0 = stored, 8 = deflate
  data: Buffer; // raw (compressed or stored) bytes for this entry
}

/** Walk the ZIP local file headers and return the named entry, or null. */
function findZipEntry(buf: Buffer, wanted: string): ZipEntry | null {
  let offset = 0;
  while (offset + 30 <= buf.length) {
    if (buf.readUInt32LE(offset) !== LOCAL_FILE_HEADER_SIG) break;

    const method = buf.readUInt16LE(offset + 8);
    const flags = buf.readUInt16LE(offset + 6);
    let compressedSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const name = buf.toString("utf8", offset + 30, offset + 30 + nameLen);
    const dataStart = offset + 30 + nameLen + extraLen;

    // Bit 3: sizes live in a trailing data descriptor, not the header. We don't support that
    // streaming case here — Word writes the sizes inline, so this is a defensive bail-out.
    if (flags & 0x08 && compressedSize === 0) return null;

    if (name === wanted) {
      return { name, method, data: buf.subarray(dataStart, dataStart + compressedSize) };
    }
    offset = dataStart + compressedSize;
  }
  return null;
}

const XML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => XML_ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) => String.fromCodePoint(parseInt(n, 16)));
}

/** Extract readable text from a .docx buffer. Returns "" if the entry can't be parsed. */
export function extractDocxText(buf: Buffer): string {
  try {
    const entry = findZipEntry(buf, "word/document.xml");
    if (!entry) return "";

    const xml =
      entry.method === 0
        ? entry.data.toString("utf8")
        : inflateRawSync(entry.data).toString("utf8");

    return xml
      // Paragraph and line-break tags become real newlines before tag-stripping.
      .replace(/<\/w:p>/g, "\n")
      .replace(/<w:br\s*\/?>/g, "\n")
      .replace(/<w:tab\s*\/?>/g, "\t")
      // Drop every remaining tag.
      .replace(/<[^>]+>/g, "")
      .split("\n")
      .map((line) => decodeXmlEntities(line).replace(/[ \t]+/g, " ").trim())
      .filter((line) => line.length > 0)
      .join("\n")
      .trim();
  } catch {
    return "";
  }
}
