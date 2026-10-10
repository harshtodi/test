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
 * 3. Annotations are drawn inside their own content stream as
 *    `q <cm> ... Q`, where `cm` is {@link displayToUserMatrix} for the page's
 *    visible box and total rotation. Everything is therefore drawn in display
 *    space exactly as stored, and comes out upright for the viewer regardless
 *    of rotation. pdf-lib wraps the original content in `q`/`Q` streams when
 *    we add ours, so graphics state left unbalanced by the original content
 *    cannot leak into the annotations.
 *
 * Pure TypeScript, no DOM: runs in Node under Vitest.
 */
import {
  LineCapStyle,
  LineJoinStyle,
  PDFDocument,
  PDFName,
  StandardFonts,
  beginText,
  concatTransformationMatrix,
  degrees,
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
import type { PDFFont, PDFImage, PDFOperator, PDFPage } from 'pdf-lib';
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
import { ascent, lineHeight, splitLines } from './text-metrics';
import { getPageRotation, getVisibleBox, parseDataUrl } from './pdf-utils';

export interface ExportOptions {
  /** Document title metadata. Defaults to the first source's file name. */
  title?: string;
}

const LOAD_OPTIONS = { ignoreEncryption: true, updateMetadata: false } as const;

/** Shared, lazily-created resources for one export run. */
interface ExportContext {
  out: PDFDocument;
  fonts: Map<StandardFontName, Promise<PDFFont>>;
  /** Code points each font can encode, memoized per font. */
  encodable: Map<StandardFontName, Map<string, boolean>>;
  images: Map<string, Promise<PDFImage>>;
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
  for (const [sourceId, rounds] of groups) {
    const source = sources[sourceId]!;
    const srcDoc = await loadSource(source);
    for (const group of rounds.values()) {
      const result = await out.copyPages(srcDoc, group.indices);
      for (let i = 0; i < result.length; i++) copied[group.positions[i]!] = result[i];
    }
  }

  // ---- assemble, rotate, annotate ----
  const ctx: ExportContext = { out, fonts: new Map(), encodable: new Map(), images: new Map() };
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
  const firstSource = sources[pages[0]!.sourceId];
  const title = options.title ?? firstSource?.name ?? 'Document';
  out.setTitle(title);
  out.setProducer('PDF Editor');
  out.setCreator('PDF Editor');
  const now = new Date();
  out.setCreationDate(now);
  out.setModificationDate(now);

  return out.save();
}

async function loadSource(source: SourceDoc): Promise<PDFDocument> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(source.bytes, LOAD_OPTIONS);
  } catch {
    throw new Error(`"${source.name}" could not be read: it is not a valid PDF file or it is damaged`);
  }
  if (doc.isEncrypted) throw new Error(`"${source.name}" is password protected; remove the password first`);
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

  // Own content stream (pdf-lib creates it on the first pushOperators call and
  // wraps the pre-existing content in q/Q streams), then our balanced q ... Q.
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
 * Standard 14 fonts only support WinAnsi. Replace characters the font cannot
 * encode with "?" (and drop control characters) instead of throwing.
 */
export function sanitizeForFont(
  text: string,
  font: PDFFont,
  memo: Map<string, boolean> = new Map(),
): string {
  let outText = '';
  for (const ch of text.replace(/\t/g, '    ')) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue; // control characters
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
    outText += ok ? ch : '?';
  }
  return outText;
}

async function drawText(
  ctx: ExportContext,
  page: PDFPage,
  resources: PageResources,
  ann: TextAnnotation,
): Promise<void> {
  const lines = splitLines(ann.text);
  if (lines.every((l) => l.length === 0)) return;
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
    const line = sanitizeForFont(lines[i]!, font, memo);
    if (line.length === 0) continue;
    ops.push(setTextMatrix(1, 0, 0, 1, r3(ann.x), r3(top - i * lh)), showText(font.encodeText(line)));
  }
  ops.push(endText(), popGraphicsState());
  page.pushOperators(...ops);
}

// ----- ink -----

function drawInk(page: PDFPage, resources: PageResources, ann: InkAnnotation): void {
  const strokes = ann.strokes.filter((s) => s.length > 0);
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
  const hasFill = ann.fillColor !== null;
  const hasStroke = ann.strokeColor !== null && ann.strokeWidth > 0;
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
  if (!(ann.width > 0) || !(ann.height > 0)) return;
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
