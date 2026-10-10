/**
 * Export: assembles the working document (ordered {@link PageRef}s) into a
 * single PDF with pdf-lib.
 *
 * 1. Every referenced source is loaded once. Pages are copied with
 *    `copyPages`, grouped per source for speed. The same source page used
 *    twice (duplicate) is copied in a separate `copyPages` call, because
 *    pdf-lib reuses already-copied objects within one call and two page
 *    leaves must not share mutable state.
 * 2. `/Rotate` is set to (source rotation + user rotation).
 * 3. The page's original content is moved into a Form XObject and the page's
 *    own content becomes `q /PEfm1 Do Q`: a viewer restores its graphics state
 *    stack when a form ends, so a `q` the original content never closed (or an
 *    extra `Q`) cannot shift the matrix our annotations are drawn with.
 * 4. Annotations are drawn inside their own content stream as
 *    `q <cm> ... Q`, where `cm` is {@link displayToUserMatrix} for the page's
 *    visible box and total rotation. Everything is therefore drawn in display
 *    space exactly as stored, and comes out upright for the viewer regardless
 *    of rotation.
 *
 * Pure TypeScript, no DOM: runs in Node under Vitest.
 */
import {
  LineCapStyle,
  LineJoinStyle,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFStream,
  ParseSpeeds,
  StandardFonts,
  beginText,
  concatTransformationMatrix,
  decodePDFRawStream,
  degrees,
  drawObject,
  endPath,
  endText,
  fill,
  fillAndStroke,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  setFillingColor,
  setFontAndSize,
  setGraphicsState,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingColor,
  setTextMatrix,
  showText,
  stroke,
} from 'pdf-lib';
import type { PDFFont, PDFImage, PDFObject, PDFOperator, PDFPage, PDFPageLeaf } from 'pdf-lib';
import type {
  Annotation,
  BlendMode,
  ImageAnnotation,
  InkAnnotation,
  PageRef,
  RGB,
  RectAnnotation,
  Rotation,
  SourceDoc,
  SourceId,
  StandardFontName,
  TextAnnotation,
} from './types';
import { addRotation, displayToUserMatrix } from './geometry';
import { ascent, lineHeight, sanitizeText, splitLines } from './text-metrics';
import type { SanitizeStats } from './text-metrics';
import { encryptedMessage, getPageRotation, getVisibleBox, parseDataUrl, repairPageTree } from './pdf-utils';

export interface ExportOptions {
  /**
   * Document title metadata, used when the first source has no Title of its
   * own. Defaults to the first source's file name.
   */
  title?: string;
  /**
   * When given, non-fatal problems are appended here (one message each), e.g.
   * text annotations containing characters the built-in fonts cannot show.
   */
  warnings?: string[];
}

/**
 * `Fastest` disables pdf-lib's `setTimeout(0)` yield every 100 parsed objects
 * (browsers clamp nested timers to 4 ms, which made saves of object-heavy
 * files ~10x slower while the UI stayed blocked between ticks anyway).
 */
const LOAD_OPTIONS = { ignoreEncryption: true, updateMetadata: false, parseSpeed: ParseSpeeds.Fastest } as const;

/** Shared, lazily-created resources for one export run. */
interface ExportContext {
  out: PDFDocument;
  fonts: Map<StandardFontName, Promise<PDFFont>>;
  /** Code points each font can encode, memoized per font. */
  encodable: Map<StandardFontName, Map<string, boolean>>;
  images: Map<string, Promise<PDFImage>>;
  /** Characters replaced with "?" because no built-in font has them. */
  text: SanitizeStats;
}

/** Per-page resource keys so fonts/ExtGStates are registered once per page. */
interface PageResources {
  fonts: Map<StandardFontName, PDFName>;
  graphicsStates: Map<string, PDFName>;
}

/**
 * Build the output PDF for `pages`, in order, from `sources`.
 * Throws when there is nothing to export or a referenced source is missing.
 */
export async function exportPdf(
  pages: PageRef[],
  sources: Record<SourceId, SourceDoc>,
  options: ExportOptions = {},
): Promise<Uint8Array> {
  if (pages.length === 0) throw new Error('Nothing to export');

  // ---- validate references and group page copies ----
  // groups: source → round → { source page indices, output positions }.
  // Round r holds the (r+1)-th occurrence of each (source, index) pair, so
  // within one copyPages call every source page appears at most once.
  type Group = { indices: number[]; positions: number[] };
  const groups = new Map<SourceId, Map<number, Group>>();
  const occurrences = new Map<string, number>();
  pages.forEach((ref, position) => {
    const source = sources[ref.sourceId];
    if (!source) throw new Error(`Missing source document for page ${position + 1}`);
    if (!Number.isInteger(ref.sourceIndex) || ref.sourceIndex < 0 || ref.sourceIndex >= source.pageCount) {
      throw new Error(`Page ${position + 1} refers to page ${ref.sourceIndex + 1} of "${source.name}", which does not exist`);
    }
    const key = `${ref.sourceId}\u0000${ref.sourceIndex}`;
    const round = occurrences.get(key) ?? 0;
    occurrences.set(key, round + 1);

    let rounds = groups.get(ref.sourceId);
    if (!rounds) groups.set(ref.sourceId, (rounds = new Map()));
    let group = rounds.get(round);
    if (!group) rounds.set(round, (group = { indices: [], positions: [] }));
    group.indices.push(ref.sourceIndex);
    group.positions.push(position);
  });

  const out = await PDFDocument.create();

  // ---- copy pages ----
  const copied: (PDFPage | undefined)[] = new Array<PDFPage | undefined>(pages.length);
  let firstDoc: PDFDocument | undefined;
  for (const [sourceId, rounds] of groups) {
    const source = sources[sourceId]!;
    const srcDoc = await loadSource(source);
    if (sourceId === pages[0]!.sourceId) firstDoc = srcDoc;
    for (const group of rounds.values()) {
      const result = await out.copyPages(srcDoc, group.indices);
      for (let i = 0; i < result.length; i++) copied[group.positions[i]!] = result[i];
    }
  }

  // ---- assemble, rotate, annotate ----
  const ctx: ExportContext = { out, fonts: new Map(), encodable: new Map(), images: new Map(), text: { replaced: 0 } };
  for (let i = 0; i < pages.length; i++) {
    const ref = pages[i]!;
    const page = copied[i];
    if (!page) throw new Error(`Internal error: page ${i + 1} was not copied`);
    out.addPage(page);

    const sourceRotation = getPageRotation(page);
    const total = addRotation(sourceRotation, ref.rotation);
    page.setRotation(degrees(total));

    if (ref.annotations.length > 0) await drawAnnotations(ctx, page, ref.annotations, total);
  }

  // ---- metadata ----
  // Keep the first source's bibliographic metadata; its Title wins over the
  // output file name so an edited report is not retitled "report-edited".
  const firstSource = sources[pages[0]!.sourceId];
  const info = firstDoc ? readInfo(firstDoc) : {};
  const title = info.title || options.title?.trim() || firstSource?.name || 'Document';
  out.setTitle(title);
  if (info.author) out.setAuthor(info.author);
  if (info.subject) out.setSubject(info.subject);
  if (info.keywords) out.setKeywords([info.keywords]); // one element: keeps the string verbatim
  out.setProducer('PDF Editor');
  out.setCreator('PDF Editor');
  const now = new Date();
  out.setCreationDate(now);
  out.setModificationDate(now);

  if (ctx.text.replaced > 0 && options.warnings) options.warnings.push(replacedWarning(ctx.text.replaced));

  // objectsPerTick: Infinity — no setTimeout(0) every 50 objects (see LOAD_OPTIONS).
  return out.save({ objectsPerTick: Number.POSITIVE_INFINITY });
}

interface SourceInfo {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
}

/** Title/Author/Subject/Keywords of a source, skipping entries that are missing or malformed. */
function readInfo(doc: PDFDocument): SourceInfo {
  const read = (get: () => string | undefined): string | undefined => {
    try {
      const value = get()?.trim();
      return value ? value : undefined;
    } catch {
      return undefined;
    }
  };
  return {
    title: read(() => doc.getTitle()),
    author: read(() => doc.getAuthor()),
    subject: read(() => doc.getSubject()),
    keywords: read(() => doc.getKeywords()),
  };
}

function replacedWarning(count: number): string {
  const one = count === 1;
  return `${count} character${one ? '' : 's'} ${one ? 'is' : 'are'} not available in the built-in PDF fonts and ${
    one ? 'was' : 'were'
  } replaced with "?"`;
}

async function loadSource(source: SourceDoc): Promise<PDFDocument> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(source.bytes, LOAD_OPTIONS);
  } catch {
    throw new Error(`"${source.name}" could not be read: it is not a valid PDF file or it is damaged`);
  }
  if (doc.isEncrypted) throw new Error(encryptedMessage(`"${source.name}"`));
  // Same page enumeration as the importer (and pdf.js): must precede getPages().
  repairPageTree(doc);
  return doc;
}

// ---------------------------------------------------------------------------
// Annotations
// ---------------------------------------------------------------------------

async function drawAnnotations(
  ctx: ExportContext,
  page: PDFPage,
  annotations: Annotation[],
  totalRotation: Rotation,
): Promise<void> {
  const box = getVisibleBox(page);
  const [a, b, c, d, e, f] = displayToUserMatrix(box, totalRotation);
  const resources: PageResources = { fonts: new Map(), graphicsStates: new Map() };

  // Original content into a Form XObject (or at least its own q/Q wrapper),
  // then our own content stream with a balanced q <cm> ... Q.
  isolateOriginalContent(page);
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(a, b, c, d, e, f));
  try {
    for (const annotation of annotations) {
      switch (annotation.type) {
        case 'text':
          await drawText(ctx, page, resources, annotation);
          break;
        case 'ink':
          drawInk(page, resources, annotation);
          break;
        case 'rect':
          drawRect(page, resources, annotation);
          break;
        case 'image':
          await drawImage(ctx, page, annotation);
          break;
      }
    }
  } finally {
    page.pushOperators(popGraphicsState());
  }
}

/**
 * Move the page's original content into a Form XObject `/PEfmN` and make the
 * page's own content `q /PEfmN Do Q`.
 *
 * pdf-lib wraps pre-existing content in `q`/`Q` streams when a stream is
 * appended, but that neutralises exactly one unmatched `q`; a `cm` or clip
 * followed by a single unclosed `q` (or an extra `Q`) still leaks into our
 * annotation stream and shifts everything we draw. Viewers restore the whole
 * graphics state stack when a form XObject ends, so inside a form the original
 * content can be as unbalanced as it likes.
 *
 * Runs before pdf-lib normalizes the page: the wrapper stream is installed as
 * /Contents first, then the form is registered (which normalizes and wraps the
 * wrapper — harmless). Falls back to {@link isolateContents} and pdf-lib's own
 * wrapper when a content stream cannot be read.
 */
function isolateOriginalContent(page: PDFPage): void {
  const { context } = page.doc;
  let form: PDFRawStream;
  try {
    const streams = originalContentStreams(page);
    if (streams.length === 0) return; // nothing to isolate
    const dict = context.obj({ Type: 'XObject', Subtype: 'Form', BBox: formBBox(page) });
    const resources = inheritedEntry(page.node, PDFName.of('Resources'));
    if (resources) dict.set(PDFName.of('Resources'), resources);
    if (streams.length === 1) {
      // Keep the bytes and their filter as they are: no decode/re-encode.
      const only = streams[0]!;
      for (const key of ['Filter', 'DecodeParms']) {
        const value = only.dict.get(PDFName.of(key));
        if (value) dict.set(PDFName.of(key), value);
      }
      form = PDFRawStream.of(dict, only.contents);
    } else {
      // Streams may only be split at token boundaries, so a newline joins them.
      const parts = streams.map((s) => decodePDFRawStream(s).decode());
      const joined = new Uint8Array(parts.reduce((n, p) => n + p.length + 1, 0));
      let offset = 0;
      for (const part of parts) {
        joined.set(part, offset);
        offset += part.length;
        joined[offset++] = 0x0a;
      }
      const flate = context.flateStream(joined);
      for (const [key, value] of dict.entries()) flate.dict.set(key, value);
      form = flate;
    }
  } catch {
    isolateContents(page);
    return;
  }

  const name = unusedXObjectName(page);
  const wrapper = context.register(context.contentStream([pushGraphicsState(), drawObject(name), popGraphicsState()]));
  page.node.set(PDFName.of('Contents'), wrapper);
  page.node.setXObject(name, context.register(form)); // normalizes: /Contents becomes [q, wrapper, Q]
}

/** The page's content streams in order; throws when one is not a plain stream. */
function originalContentStreams(page: PDFPage): PDFRawStream[] {
  const contents = page.node.Contents();
  if (!contents) return [];
  const { context } = page.doc;
  const items = contents instanceof PDFArray ? contents.asArray().map((item) => context.lookup(item)) : [contents];
  return items.map((item) => {
    if (item instanceof PDFRawStream) return item;
    if (item instanceof PDFStream) throw new Error('content stream is not a raw stream');
    if (item === undefined) throw new Error('content stream is missing');
    throw new Error('content stream is not a stream');
  });
}

/** Form bounding box: the MediaBox (never clips anything visible), or a box no page exceeds. */
function formBBox(page: PDFPage): number[] {
  try {
    const m = page.getMediaBox();
    if (finite(m.x, m.y, m.width, m.height) && m.width !== 0 && m.height !== 0) {
      return [Math.min(m.x, m.x + m.width), Math.min(m.y, m.y + m.height), Math.max(m.x, m.x + m.width), Math.max(m.y, m.y + m.height)];
    }
  } catch {
    /* fall through */
  }
  return [-32767, -32767, 32767, 32767];
}

/** The raw (ref or direct) value of an inheritable page attribute. */
function inheritedEntry(node: PDFPageLeaf, key: PDFName): PDFObject | undefined {
  let value: PDFObject | undefined;
  node.ascend((n) => {
    if (value === undefined) value = n.get(key);
  });
  return value;
}

/** `/PEfm1`, `/PEfm2`, ... — the first name not already used by the page's XObject resources. */
function unusedXObjectName(page: PDFPage): PDFName {
  const xobjects = page.node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict);
  let n = 1;
  let name = PDFName.of(`PEfm${n}`);
  while (xobjects?.has(name)) name = PDFName.of(`PEfm${++n}`);
  return name;
}

/**
 * Fallback isolation: give the page a private, direct /Contents array before
 * pdf-lib normalizes the page. pdf-lib leaves an *indirect* /Contents array in
 * place and mutates it when it wraps the original content in q/Q and appends
 * our stream. Pages copied in the same `copyPages` call keep sharing objects
 * they shared in the source, so with a shared array the annotations of one
 * page would show up on every page using it (and the wrapper would nest once
 * per page).
 */
function isolateContents(page: PDFPage): void {
  const key = PDFName.of('Contents');
  const raw = page.node.get(key);
  if (!(raw instanceof PDFRef)) return;
  const resolved = page.doc.context.lookup(raw);
  if (resolved instanceof PDFArray) page.node.set(key, page.doc.context.obj(resolved.asArray()));
}

function finite(...values: number[]): boolean {
  return values.every((v) => Number.isFinite(v));
}

// ----- text -----

const STANDARD_FONT: Record<StandardFontName, StandardFonts> = {
  Helvetica: StandardFonts.Helvetica,
  'Helvetica-Bold': StandardFonts.HelveticaBold,
  TimesRoman: StandardFonts.TimesRoman,
  Courier: StandardFonts.Courier,
};

function getFont(ctx: ExportContext, name: StandardFontName): Promise<PDFFont> {
  let p = ctx.fonts.get(name);
  if (!p) {
    p = ctx.out.embedFont(STANDARD_FONT[name] ?? StandardFonts.Helvetica);
    ctx.fonts.set(name, p);
  }
  return p;
}

/**
 * Standard 14 fonts only support WinAnsi. Make `text` drawable with `font`
 * instead of throwing: see {@link sanitizeText} for the rules (NFC first,
 * invisible characters and marks dropped, NFKC compatibility forms, "?" for
 * the rest). `stats.replaced` counts the "?" substitutions.
 */
export function sanitizeForFont(
  text: string,
  font: PDFFont,
  memo: Map<string, boolean> = new Map(),
  stats?: SanitizeStats,
): string {
  const canEncode = (ch: string): boolean => {
    let ok = memo.get(ch);
    if (ok === undefined) {
      try {
        font.encodeText(ch);
        ok = true;
      } catch {
        ok = false;
      }
      memo.set(ch, ok);
    }
    return ok;
  };
  return sanitizeText(text, canEncode, stats);
}

async function drawText(
  ctx: ExportContext,
  page: PDFPage,
  resources: PageResources,
  ann: TextAnnotation,
): Promise<void> {
  if (!finite(ann.x, ann.y)) return;
  const lines = splitLines(ann.text);
  if (lines.every((l) => l.trim().length === 0)) return;
  const fontSize = ann.fontSize > 0 && Number.isFinite(ann.fontSize) ? ann.fontSize : 12;

  const font = await getFont(ctx, ann.font);
  let memo = ctx.encodable.get(ann.font);
  if (!memo) ctx.encodable.set(ann.font, (memo = new Map()));

  let fontKey = resources.fonts.get(ann.font);
  if (!fontKey) {
    fontKey = page.node.newFontDictionary(font.name, font.ref);
    resources.fonts.set(ann.font, fontKey);
  }

  const ops: PDFOperator[] = [
    pushGraphicsState(),
    beginText(),
    setFillingColor(toColor(ann.color)),
    setFontAndSize(fontKey, fontSize),
  ];
  const top = ann.y - ascent(fontSize);
  const lh = lineHeight(fontSize);
  for (let i = 0; i < lines.length; i++) {
    const line = sanitizeForFont(lines[i]!, font, memo, ctx.text);
    if (line.length === 0) continue;
    ops.push(setTextMatrix(1, 0, 0, 1, r3(ann.x), r3(top - i * lh)), showText(font.encodeText(line)));
  }
  ops.push(endText(), popGraphicsState());
  page.pushOperators(...ops);
}

// ----- ink -----

function drawInk(page: PDFPage, resources: PageResources, ann: InkAnnotation): void {
  // Non-finite points would end up as "NaN" operands and corrupt the stream.
  const strokes = ann.strokes.map((s) => s.filter((p) => finite(p.x, p.y))).filter((s) => s.length > 0);
  if (strokes.length === 0) return;
  const width = ann.strokeWidth > 0 && Number.isFinite(ann.strokeWidth) ? ann.strokeWidth : 1;

  const ops: PDFOperator[] = [pushGraphicsState()];
  const gs = graphicsState(page, resources, ann.opacity, ann.blendMode);
  if (gs) ops.push(setGraphicsState(gs));
  ops.push(
    setStrokingColor(toColor(ann.color)),
    setLineWidth(width),
    setLineCap(LineCapStyle.Round),
    setLineJoin(LineJoinStyle.Round),
  );
  for (const points of strokes) {
    const first = points[0]!;
    ops.push(moveTo(r3(first.x), r3(first.y)));
    if (points.length === 1) {
      // A dot: a (nearly) zero-length segment with round caps renders as a disc.
      ops.push(lineTo(r3(first.x + 0.01), r3(first.y)));
    } else {
      for (let i = 1; i < points.length; i++) {
        const p = points[i]!;
        ops.push(lineTo(r3(p.x), r3(p.y)));
      }
    }
    ops.push(stroke());
  }
  ops.push(popGraphicsState());
  page.pushOperators(...ops);
}

// ----- rect -----

function drawRect(page: PDFPage, resources: PageResources, ann: RectAnnotation): void {
  if (!finite(ann.x, ann.y, ann.width, ann.height)) return;
  const hasFill = ann.fillColor !== null;
  const hasStroke = ann.strokeColor !== null && ann.strokeWidth > 0 && Number.isFinite(ann.strokeWidth);
  if (!hasFill && !hasStroke) return;

  const ops: PDFOperator[] = [pushGraphicsState()];
  const gs = graphicsState(page, resources, ann.opacity, ann.blendMode);
  if (gs) ops.push(setGraphicsState(gs));
  if (ann.fillColor) ops.push(setFillingColor(toColor(ann.fillColor)));
  if (hasStroke && ann.strokeColor) ops.push(setStrokingColor(toColor(ann.strokeColor)), setLineWidth(ann.strokeWidth));
  ops.push(rectangle(r3(ann.x), r3(ann.y), r3(ann.width), r3(ann.height)));
  ops.push(hasFill && hasStroke ? fillAndStroke() : hasFill ? fill() : hasStroke ? stroke() : endPath());
  ops.push(popGraphicsState());
  page.pushOperators(...ops);
}

// ----- image -----

function getImage(ctx: ExportContext, dataUrl: string): Promise<PDFImage> {
  let p = ctx.images.get(dataUrl);
  if (!p) {
    p = (async () => {
      const { mime, bytes } = parseDataUrl(dataUrl);
      if (mime === 'image/png') return ctx.out.embedPng(bytes);
      if (mime === 'image/jpeg' || mime === 'image/jpg') return ctx.out.embedJpg(bytes);
      throw new Error(`Unsupported image type "${mime}" in image annotation (use PNG or JPEG)`);
    })();
    // Do not cache failures.
    p.catch(() => ctx.images.delete(dataUrl));
    ctx.images.set(dataUrl, p);
  }
  return p;
}

async function drawImage(ctx: ExportContext, page: PDFPage, ann: ImageAnnotation): Promise<void> {
  if (!finite(ann.x, ann.y, ann.width, ann.height) || !(ann.width > 0) || !(ann.height > 0)) return;
  const image = await getImage(ctx, ann.dataUrl);
  page.drawImage(image, { x: r3(ann.x), y: r3(ann.y), width: r3(ann.width), height: r3(ann.height) });
}

// ----- shared helpers -----

/**
 * One ExtGState per (page, opacity, blend mode), reused across annotations.
 * Returns `undefined` when no graphics state change is needed.
 */
function graphicsState(
  page: PDFPage,
  resources: PageResources,
  opacity: number,
  blendMode: BlendMode,
): PDFName | undefined {
  const alpha = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1;
  const mode: BlendMode = blendMode === 'Multiply' ? 'Multiply' : 'Normal';
  if (alpha >= 1 && mode === 'Normal') return undefined;

  const cacheKey = `${alpha}|${mode}`;
  let name = resources.graphicsStates.get(cacheKey);
  if (name) return name;

  const extGStates = page.node.normalizedEntries().ExtGState;
  let n = 1;
  name = PDFName.of(`PEgs${n}`);
  while (extGStates.has(name)) name = PDFName.of(`PEgs${++n}`);
  page.node.setExtGState(name, page.doc.context.obj({ Type: 'ExtGState', CA: alpha, ca: alpha, BM: mode }));
  resources.graphicsStates.set(cacheKey, name);
  return name;
}

function toColor(c: RGB) {
  return rgb(clamp01(c.r), clamp01(c.g), clamp01(c.b));
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

/** Round to 3 decimals to keep content streams compact (0.001 pt precision). */
function r3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
