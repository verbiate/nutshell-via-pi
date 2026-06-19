/**
 * Position tracking library for EPUB reading positions.
 *
 * Bidirectional mapping between:
 * - CFIs (EPUB Canonical Fragment Identifiers): used at runtime for instant navigation
 * - Paragraph index + char offset: persisted to database for theme-reflow survival
 *
 * The paragraph map (ParagraphMap) is built lazily per section to avoid blocking
 * the main thread on large books.
 */

import type { Book } from "@likecoin/epub-ts";
import type { SpineItem } from "@likecoin/epub-ts";

/**
 * Reading position stored in the database.
 * - paragraphIndex: cumulative count of <p> elements before the target across all spine items
 * - charOffset: character offset within the target paragraph's text content
 * - cfi: optional full CFI for instant restore (preferred when available)
 */
export interface ReadingPosition {
  paragraphIndex: number;
  charOffset: number;
  cfi?: string;
}

/**
 * One entry in the paragraph map, corresponding to one spine item (one section/chapter).
 */
export interface ParagraphMapEntry {
  /** 0-based index into book.spine.spineItems */
  spineIndex: number;
  /** HREF of this section, e.g. "chapter1.xhtml" */
  sectionHref: string;
  /** Number of <p> elements in this section */
  paragraphCount: number;
  /**
   * CFI prefix for this section, e.g. "epubcfi(/6/4[chap01]!/".
   * Pre-computed once per section for fast paragraph→CFI conversion.
   */
  cfiPrefix: string;
}

export type ParagraphMap = ParagraphMapEntry[];

/**
 * Build the paragraph map for an entire book.
 *
 * Iterates all spine items, loads each section's HTML, counts <p> elements,
 * and pre-computes the CFI prefix for each section.
 *
 * Built lazily — call this once after `book.ready` resolves and cache the result.
 */
export async function buildParagraphMap(book: Book): Promise<ParagraphMap> {
  const map: ParagraphMap = [];

  // book.spine.spineItems is the array of Section objects
  const sections = book.spine.spineItems;

  await Promise.all(
    sections.map(async (section, spineIndex) => {
      try {
        // section.render() returns serialized HTML string
        const html = await section.render();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "application/xhtml+xml");

        // Count <p> elements (EPUB uses XHTML namespace)
        const paragraphs = doc.querySelectorAll("p");
        const paragraphCount = paragraphs.length;

        // Pre-compute CFI prefix for this section.
        // The CFI prefix is: epubcfi(/6/4[idref]!/  — the path to the root of the section.
        // We derive this from the spine item's idref and spine index.
        const idref = section.idref ?? "";
        const spineNodeIndex = spineIndex;
        // generateChapterComponent generates /{spineNodeIndex*2+2}/{pos*2+2} with optional [id]
        // We use pos=0 to get the chapter root, then append !/
        const chapterComponent = generateChapterComponent(spineNodeIndex, 0, idref);
        // Find the manifest item idref from the spine item index
        // book.packaging.manifest has id → href mapping
        const manifestId = idref;
        const cfiPrefix = `epubcfi(/6/4[${manifestId}]!/`;

        // Store using spineIndex as key — map is parallel to spineItems array
        map[spineIndex] = {
          spineIndex,
          sectionHref: section.href ?? "",
          paragraphCount,
          cfiPrefix,
        };
      } catch {
        // Section failed to render — record zero paragraphs
        map[spineIndex] = {
          spineIndex,
          sectionHref: section.href ?? "",
          paragraphCount: 0,
          cfiPrefix: "",
        };
      }
    })
  );

  return map;
}

/**
 * Convert a CFI to a ReadingPosition (paragraph index + char offset).
 *
 * @param book - The loaded EPUB Book instance
 * @param cfi  - Full CFI string from rendition relocation, e.g. "epubcfi(/6/4[chap01]!/4/2/8/1:100)"
 * @param paragraphMap - Pre-built paragraph map
 * @returns ReadingPosition with paragraphIndex, charOffset, and original cfi
 */
export function cfiToParagraphOffset(
  book: Book,
  cfi: string,
  paragraphMap: ParagraphMap
): ReadingPosition {
  // Parse the CFI to find the spine position (which spine item it points to)
  const parsed = parseCfi(cfi);
  if (!parsed) {
    return { paragraphIndex: 0, charOffset: 0, cfi };
  }

  const { spineIndex, elementSteps } = parsed;

  // Count paragraphs in all preceding spine items
  let paragraphIndex = 0;
  for (let i = 0; i < spineIndex; i++) {
    paragraphIndex += paragraphMap[i]?.paragraphCount ?? 0;
  }

  // Within the current section, we need to find which <p> the element path points to
  const section = book.spine.spineItems[spineIndex];
  if (section) {
    // Synchronously find the element in the loaded section document
    // If the section hasn't been loaded yet, we can't resolve the element path
    const sectionElement = (section as any).document as Document | undefined;
    if (sectionElement) {
      // Use EpubCFI.findNode to locate the element from the element path steps
      const node = findNodeInDocument(sectionElement, elementSteps);
      if (node && node.nodeName === "P") {
        // Count <p> elements up to and including this one within the section
        const paras = sectionElement.querySelectorAll("p");
        const idx = Array.from(paras).indexOf(node as HTMLParagraphElement);
        if (idx >= 0) {
          paragraphIndex += idx;
          // Extract char offset from CFI terminal if present (":100" suffix)
          const charOffset = parsed.charOffset ?? 0;
          return { paragraphIndex, charOffset, cfi };
        }
      }
    }

    // Fallback: estimate paragraph index from element steps
    // elementSteps[-1] should be the paragraph index within the section
    if (elementSteps.length > 0) {
      const lastStep = elementSteps[elementSteps.length - 1];
      if (lastStep.type !== "text") {
        // The last step is the element itself — its index among siblings of same type
        // For <p> elements, this gives us a rough paragraph index
        const paraIdx = lastStep.index;
        if (paraIdx >= 0) {
          paragraphIndex += paraIdx;
        }
      }
    }
  }

  // Extract char offset from CFI terminal if present
  const charOffset = parsed.charOffset ?? 0;
  return { paragraphIndex, charOffset, cfi };
}

/**
 * Convert a ReadingPosition (paragraph index + char offset) to a CFI.
 *
 * @param book         - The loaded EPUB Book instance
 * @param position     - paragraphIndex + charOffset from database
 * @param paragraphMap - Pre-built paragraph map
 * @returns CFI string that can be passed to rendition.display()
 */
export function paragraphOffsetToCfi(
  book: Book,
  position: ReadingPosition,
  paragraphMap: ParagraphMap
): string {
  const { paragraphIndex, charOffset } = position;

  // Find which spine item contains this paragraph
  let accumulated = 0;
  let targetSpineIndex = 0;
  let localParagraphIndex = paragraphIndex;

  for (let i = 0; i < paragraphMap.length; i++) {
    const entry = paragraphMap[i];
    if (!entry) continue;
    if (accumulated + entry.paragraphCount > paragraphIndex) {
      targetSpineIndex = i;
      localParagraphIndex = paragraphIndex - accumulated;
      break;
    }
    accumulated += entry.paragraphCount;
  }

  const section = book.spine.spineItems[targetSpineIndex];
  if (!section) {
    return "";
  }

  // Load the section document synchronously if available
  const sectionDoc = (section as any).document as Document | undefined;
  if (sectionDoc) {
    const paras = sectionDoc.querySelectorAll("p");
    if (localParagraphIndex < paras.length) {
      const para = paras[localParagraphIndex];
      // Use section.cfiFromElement to generate a proper CFI
      const elementCfi = section.cfiFromElement(para);
      // Append character offset to the CFI if needed
      if (charOffset > 0 && elementCfi) {
        // Insert char offset: the CFI terminal format is ".../X:Y)" where Y is offset
        return insertCharOffset(elementCfi, charOffset);
      }
      return elementCfi ?? "";
    }
  }

  // Fallback: construct CFI from chapter component + element path
  // This is used when the section document hasn't been loaded yet
  const cfiPrefix = paragraphMap[targetSpineIndex]?.cfiPrefix ?? `epubcfi(/6/4[]!/`;
  // Use element index as a rough path — this is an approximation
  const elementPath = `/${(localParagraphIndex + 1) * 2}`;
  const offsetSuffix = charOffset > 0 ? `:${charOffset}` : "";
  return `${cfiPrefix}${elementPath}${offsetSuffix})`;
}

/**
 * Find which spine item contains a given paragraph index.
 */
export function getSectionForParagraph(
  paragraphMap: ParagraphMap,
  paragraphIndex: number
): { spineIndex: number; sectionHref: string } | null {
  let accumulated = 0;
  for (const entry of paragraphMap) {
    if (!entry) continue;
    if (accumulated + entry.paragraphCount > paragraphIndex) {
      return { spineIndex: entry.spineIndex, sectionHref: entry.sectionHref };
    }
    accumulated += entry.paragraphCount;
  }
  return null;
}

// ─── Internal helpers ───────────────────────────────────────────────────────────

/**
 * Parse a CFI string into its components.
 * Returns spine index, element path steps, and optional char offset.
 */
function parseCfi(
  cfi: string
): { spineIndex: number; elementSteps: EpubCFIStep[]; charOffset?: number } | null {
  // CFI format: epubcfi(/6/4[idref]!/elementPath:charOffset)
  // We need to extract: spine index from /6/4[X]/, element path from !/, char offset from :N)
  try {
    // Strip epubcfi() wrapper if present
    const inner = cfi.replace(/^epubcfi\(/, "").replace(/\)$/, "");

    // Split at !/ to separate spine path from element path
    const exclIdx = inner.indexOf("!/");
    if (exclIdx === -1) return null;

    const spineAndId = inner.slice(0, exclIdx); // e.g. /6/4[chap01]
    const elementPart = inner.slice(exclIdx + 2); // e.g. 4/2/8/1:100

    // Parse spine index from spineAndId
    // Format: /6/4[idref] — steps[0]=/6, steps[1]=/4[X]
    const spineSteps = spineAndId.split("/").filter(Boolean);
    // spineSteps[0] = "6" (container), spineSteps[1] = "4[chap01]" (package + idref)
    // spineIndex is encoded in the spine step: step_index * 2 gives the actual position
    // But we need the manifest item index — let's extract from the step content
    const spineStepContent = spineSteps[1] ?? ""; // "4[chap01]"
    const spineIndexMatch = spineStepContent.match(/^(\d+)/);
    const spineNodeIndex = spineIndexMatch ? parseInt(spineIndexMatch[1]) : 0;
    // spineNodeIndex is even (2, 4, 6...), the actual spine index is spineNodeIndex/2 - 1
    const spineIndex = spineNodeIndex > 0 ? spineNodeIndex / 2 - 1 : 0;

    // Parse element path and char offset
    const colonIdx = elementPart.lastIndexOf(":");
    let elementPath = elementPart;
    let charOffset: number | undefined;

    if (colonIdx !== -1) {
      elementPath = elementPart.slice(0, colonIdx);
      const offsetStr = elementPart.slice(colonIdx + 1);
      charOffset = parseInt(offsetStr) || 0;
    }

    // Parse element path steps. CFI element indices are even (2,4,6...);
    // convert to 0-based element index with (cfiIndex / 2) - 1.
    const stepStrings = elementPath.split("/").filter(Boolean);
    const elementSteps: EpubCFIStep[] = stepStrings.map((s) => {
      const idMatch = s.match(/^(\d+)(?:\[([^\]]+)\])?$/);
      if (idMatch) {
        const cfiIndex = parseInt(idMatch[1]);
        return {
          index: cfiIndex / 2 - 1,
          id: idMatch[2] ?? null,
          tagName: "",
          type: cfiIndex % 2 === 0 ? "element" : "text",
        };
      }
      return { index: 0, id: null, tagName: "", type: "element" };
    });

    return { spineIndex, elementSteps, charOffset };
  } catch {
    return null;
  }
}

interface EpubCFIStep {
  index: number;
  id: string | null;
  tagName: string;
  type: string;
}

/**
 * Find a DOM node from parsed CFI element steps within a document.
 */
function findNodeInDocument(doc: Document, steps: EpubCFIStep[]): Node | null {
  let node: Node = doc.documentElement;

  for (const step of steps) {
    // Text-node steps (odd CFI indices) have no element children to traverse.
    if (step.type === "text") continue;

    const children = node.childNodes;
    let elementCount = -1;
    let child: Node | null = null;

    for (let i = 0; i < children.length; i++) {
      const c = children[i];
      if (c.nodeType === Node.ELEMENT_NODE) {
        elementCount++;
        if (elementCount === step.index) {
          child = c;
          break;
        }
      }
    }

    if (!child) break;
    node = child;
  }

  return node;
}

/**
 * Insert a character offset into a CFI string.
 * The CFI terminal format is ".../X)" — we insert ":offset" before the closing paren.
 */
function insertCharOffset(cfi: string, charOffset: number): string {
  if (cfi.endsWith(")")) {
    return cfi.slice(0, -1) + `:${charOffset})`;
  }
  return cfi;
}

/**
 * Generate a CFI chapter component string for a spine item.
 * Mirrors the logic in @likecoin/epub-ts EpubCFI.generateChapterComponent.
 */
function generateChapterComponent(
  spineNodeIndex: number,
  pos: number,
  id?: string
): string {
  const step1 = (spineNodeIndex + 1) * 2;
  const step2 = (pos + 1) * 2;
  let result = `/${step1}/${step2}`;
  if (id) {
    result += `[${id}]`;
  }
  return result;
}
