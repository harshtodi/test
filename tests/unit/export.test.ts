import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFName, PDFStream, StandardFonts } from 'pdf-lib';
import type { PDFFont, PDFNumber } from 'pdf-lib';
import { exportPdf, sanitizeForFont } from '@/core/export';
import { createBlankPageSource, importFile } from '@/core/import';
import { applyMatrix, displayToUserMatrix, getPageGeometry } from '@/core/geometry';
import { ascent, exportPreviewText, isWinAnsiChar, lineHeight, sanitizeText, splitLines } from '@/core/text-metrics';
import { newId } from '@/core/ids';
import type {
  Annotation,
  ImageAnnotation,
  InkAnnotation,
  PageRef,
  RectAnnotation,
  Rotation,
  SourceDoc,
  TextAnnotation,
} from '@/core/types';
import {
  TINY_JPEG,
  TINY_PNG,
  makeLabeledPdf,
  makePdf,
  makePdfWithInfo,
  makeStructuredPdf,
  makeUntypedPageTreePdf,
  toDataUrl,
} from '../helpers/make-pdf';
import { makePng } from '../helpers/make-png';
import {
  countImageXObjects,
  graphicsStateBalance,
  loadWithPdfLib,
  pageContent,
  pageContentInlined,
  pageResources,
} from '../helpers/pdf-inspect';
import { findText, getPageTexts, getPageView, getTextItems, withPdfJs } from '../helpers/pdfjs';

// ---------- fixtures ----------

function ref(source: SourceDoc, sourceIndex: number, extra: Partial<PageRef> = {}): PageRef {
  return { id: newId('p'), sourceId: source.id, sourceIndex, rotation: 0, annotations: [], ...extra };
}

function sourcesOf(...docs: SourceDoc[]): Record<string, SourceDoc> {
  return Object.fromEntries(docs.map((d) => [d.id, d]));
}

function textAnn(partial: Partial<TextAnnotation> = {}): TextAnnotation {
  return {
    id: newId('a'),
    type: 'text',
    x: 100,
    y: 500,
    text: 'Mark',
    fontSize: 20,
    font: 'Helvetica',
    color: { r: 0, g: 0, b: 1 },
    ...partial,
  };
}

function inkAnn(partial: Partial<InkAnnotation> = {}): InkAnnotation {
  return {
    id: newId('a'),
    type: 'ink',
    strokes: [
      [
        { x: 10, y: 10 },
        { x: 50, y: 60 },
        { x: 90, y: 20 },
      ],
      [{ x: 200, y: 200 }], // a single dot
    ],
    color: { r: 0.85, g: 0.1, b: 0.1 },
    strokeWidth: 2,
    opacity: 1,
    blendMode: 'Normal',
    ...partial,
  };
}

function rectAnn(partial: Partial<RectAnnotation> = {}): RectAnnotation {
  return {
    id: newId('a'),
    type: 'rect',
    x: 50,
    y: 50,
    width: 200,
    height: 100,
    fillColor: { r: 1, g: 1, b: 1 },
    strokeColor: null,
    strokeWidth: 0,
    opacity: 1,
    blendMode: 'Normal',
    ...partial,
  };
}

function imageAnn(partial: Partial<ImageAnnotation> = {}): ImageAnnotation {
  return {
    id: newId('a'),
    type: 'image',
    x: 300,
    y: 100,
    width: 120,
    height: 40,
    dataUrl: toDataUrl(TINY_PNG, 'image/png'),
    ...partial,
  };
}

async function labeledSource(count: number, prefix = 'Page'): Promise<SourceDoc> {
  return importFile(`${prefix.toLowerCase()}.pdf`, await makeLabeledPdf(count, prefix));
}

// ---------- page operations ----------

describe('exportPdf — page operations', () => {
  it('throws when there is nothing to export', async () => {
    await expect(exportPdf([], {})).rejects.toThrow('Nothing to export');
  });

  it('throws when a referenced source is missing or the index is out of range', async () => {
    const src = await labeledSource(2);
    const orphan: PageRef = { ...ref(src, 0), sourceId: 'src_missing' };
    await expect(exportPdf([orphan], sourcesOf(src))).rejects.toThrow(/Missing source document/);
    await expect(exportPdf([ref(src, 5)], sourcesOf(src))).rejects.toThrow(/does not exist/);
  });

  it('keeps pages in the given order (reorder)', async () => {
    const src = await labeledSource(3);
    const bytes = await exportPdf([ref(src, 2), ref(src, 0), ref(src, 1)], sourcesOf(src));
    expect(await getPageTexts(bytes)).toEqual(['Page 3', 'Page 1', 'Page 2']);
  });

  it('exports only the referenced pages (delete)', async () => {
    const src = await labeledSource(4);
    const bytes = await exportPdf([ref(src, 0), ref(src, 2)], sourcesOf(src));
    const doc = await loadWithPdfLib(bytes);
    expect(doc.getPageCount()).toBe(2);
    expect(await getPageTexts(bytes)).toEqual(['Page 1', 'Page 3']);
  });

  it('copies the same source page several times (duplicate) into a valid file', async () => {
    const src = await labeledSource(2);
    const bytes = await exportPdf([ref(src, 0), ref(src, 0), ref(src, 1), ref(src, 0)], sourcesOf(src));
    const doc = await loadWithPdfLib(bytes);
    expect(doc.getPageCount()).toBe(4);
    const leaves = doc.getPages().map((p) => p.ref.toString());
    expect(new Set(leaves).size).toBe(4); // four distinct page objects
    expect(await getPageTexts(bytes)).toEqual(['Page 1', 'Page 1', 'Page 2', 'Page 1']);
  });

  it('annotates only the duplicate that carries the annotation', async () => {
    const src = await labeledSource(1);
    const bytes = await exportPdf(
      [ref(src, 0), ref(src, 0, { annotations: [textAnn({ text: 'Only here' })] })],
      sourcesOf(src),
    );
    const texts = await getPageTexts(bytes);
    expect(texts[0]).not.toContain('Only here');
    expect(texts[1]).toContain('Only here');
  });

  it('merges pages from several sources in any interleaving', async () => {
    const a = await labeledSource(2, 'Alpha');
    const b = await labeledSource(2, 'Beta');
    const bytes = await exportPdf([ref(a, 0), ref(b, 1), ref(a, 1), ref(b, 0)], sourcesOf(a, b));
    expect(await getPageTexts(bytes)).toEqual(['Alpha 1', 'Beta 2', 'Alpha 2', 'Beta 1']);
  });

  it('does not leak annotations between pages that share one /Contents array', async () => {
    // Some generators point every template page at the same indirect Contents
    // array. pdf-lib keeps that sharing when copying, so without isolation one
    // page's annotation stream would be appended to all of them.
    const src = await importFile('shared.pdf', await makeStructuredPdf({ pageCount: 3, sharedContentsArray: true }));
    const bytes = await exportPdf(
      [
        ref(src, 0, { annotations: [textAnn({ text: 'OnlyA' })] }),
        ref(src, 1, { annotations: [textAnn({ text: 'OnlyB' })] }),
        ref(src, 2), // same copyPages call, no annotations
        ref(src, 0), // duplicate of an annotated page, no annotations
      ],
      sourcesOf(src),
    );
    const texts = await getPageTexts(bytes);
    expect(texts).toHaveLength(4);
    expect(texts[0]).toContain('OnlyA');
    expect(texts[0]).not.toContain('OnlyB');
    expect(texts[1]).toContain('OnlyB');
    expect(texts[1]).not.toContain('OnlyA');
    expect(texts[2]).toBe('Page 1');
    expect(texts[3]).toBe('Page 1');
    const doc = await loadWithPdfLib(bytes);
    for (const page of doc.getPages()) {
      const content = pageContent(doc, page);
      expect(graphicsStateBalance(content)).toBe(0);
      expect(content.match(/\bcm\b/g) ?? []).toHaveLength(content.includes('Tm') ? 1 : 0); // one wrapper per annotated page
    }
  });

  it('exports pages whose Resources are inherited from the page tree', async () => {
    const src = await importFile('inherited-res.pdf', await makeStructuredPdf({ inherited: { Resources: true } }));
    const highlighter = { opacity: 0.5, blendMode: 'Multiply' as const };
    const bytes = await exportPdf(
      [
        ref(src, 0, { annotations: [inkAnn(highlighter), textAnn({ text: 'OnA' })] }),
        ref(src, 1, { annotations: [inkAnn(highlighter), textAnn({ text: 'OnB' })] }),
      ],
      sourcesOf(src),
    );
    expect(await getPageTexts(bytes)).toEqual(['Page 1 OnA', 'Page 2 OnB']);
    const doc = await loadWithPdfLib(bytes);
    for (const page of doc.getPages()) {
      expect(pageResources(doc, page, 'ExtGState').size).toBeGreaterThan(0);
      expect(graphicsStateBalance(pageContent(doc, page))).toBe(0);
    }
  });

  it('round-trips PDF, image and blank sources together', async () => {
    const pdf = await labeledSource(1);
    const img = await importFile('wide.png', makePng(200, 100));
    const blank = await createBlankPageSource(300, 400);
    const bytes = await exportPdf([ref(pdf, 0), ref(img, 0), ref(blank, 0)], sourcesOf(pdf, img, blank));
    const doc = await loadWithPdfLib(bytes);
    expect(doc.getPageCount()).toBe(3);
    expect(doc.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
    expect(doc.getPage(1).getSize()).toEqual({ width: 792, height: 612 });
    expect(doc.getPage(2).getSize()).toEqual({ width: 300, height: 400 });
    expect(countImageXObjects(doc)).toBe(1);
  });

  it('sets document metadata (source without a Title)', async () => {
    const src = await labeledSource(1, 'Report');
    const bytes = await exportPdf([ref(src, 0)], sourcesOf(src));
    const doc = await loadWithPdfLib(bytes);
    expect(doc.getTitle()).toBe('report.pdf');
    expect(doc.getProducer()).toBe('PDF Editor');
    expect(doc.getCreator()).toBe('PDF Editor');

    const titled = await loadWithPdfLib(await exportPdf([ref(src, 0)], sourcesOf(src), { title: 'My title' }));
    expect(titled.getTitle()).toBe('My title');

    // A blank title option falls back to the source name instead of writing "".
    const blank = await loadWithPdfLib(await exportPdf([ref(src, 0)], sourcesOf(src), { title: '   ' }));
    expect(blank.getTitle()).toBe('report.pdf');
  });

  it('keeps the first source\'s Title, Author, Subject and Keywords', async () => {
    const report = await importFile(
      'report.pdf',
      await makePdfWithInfo({ title: 'Quarterly Report', author: 'Jane Doe', subject: 'Finance', keywords: ['q3,', 'report'] }),
    );
    const other = await importFile('other.pdf', await makePdfWithInfo({ title: 'Other', author: 'Someone Else' }));
    // The output file name must not replace a real title.
    const doc = await loadWithPdfLib(await exportPdf([ref(report, 0), ref(other, 0)], sourcesOf(report, other), { title: 'report-edited' }));
    expect(doc.getTitle()).toBe('Quarterly Report');
    expect(doc.getAuthor()).toBe('Jane Doe');
    expect(doc.getSubject()).toBe('Finance');
    expect(doc.getKeywords()).toBe('q3, report'); // verbatim
    expect(doc.getProducer()).toBe('PDF Editor');

    // The first page decides whose metadata is kept.
    const swapped = await loadWithPdfLib(await exportPdf([ref(other, 0), ref(report, 0)], sourcesOf(report, other)));
    expect(swapped.getTitle()).toBe('Other');
    expect(swapped.getAuthor()).toBe('Someone Else');
    expect(swapped.getSubject()).toBeUndefined();

    // Generated sources (images, blank pages) carry no Title of their own.
    const img = await importFile('photo.png', TINY_PNG);
    const blank = await createBlankPageSource(300, 400);
    const generated = await loadWithPdfLib(await exportPdf([ref(blank, 0), ref(img, 0)], sourcesOf(img, blank), { title: 'untitled-edited' }));
    expect(generated.getTitle()).toBe('untitled-edited');
    expect(generated.getAuthor()).toBeUndefined();
  });

  it('exports pages in the order pdf.js shows them when page leaves lack /Type', async () => {
    // Page 2's leaf has no /Type /Page: pdf.js (the renderer) shows four pages;
    // pdf-lib alone would skip it, so "page 2" would export as "Original 3".
    const bytes = await makeUntypedPageTreePdf(4, { leaves: [1] });
    const shown = await getPageTexts(bytes);
    expect(shown).toEqual(['Original 1', 'Original 2', 'Original 3', 'Original 4']);
    const src = await importFile('untyped.pdf', bytes);
    expect(src.pageCount).toBe(4);
    const out = await exportPdf(
      [ref(src, 1, { annotations: [textAnn({ text: 'OnTwo' })] }), ref(src, 0), ref(src, 3), ref(src, 2)],
      sourcesOf(src),
    );
    expect(await getPageTexts(out)).toEqual(['Original 2 OnTwo', 'Original 1', 'Original 4', 'Original 3']);

    const rootless = await importFile('rootless.pdf', await makeUntypedPageTreePdf(2, { root: true, leaves: 'all' }));
    expect(await getPageTexts(await exportPdf([ref(rootless, 1), ref(rootless, 0)], sourcesOf(rootless)))).toEqual([
      'Original 2',
      'Original 1',
    ]);
  });

  it('exports 200 pages (with duplicates) quickly', async () => {
    const src = await labeledSource(200);
    const pages = [
      ...Array.from({ length: 200 }, (_, i) => ref(src, 199 - i)),
      ...Array.from({ length: 20 }, (_, i) => ref(src, i * 7)),
    ];
    const start = performance.now();
    const bytes = await exportPdf(pages, sourcesOf(src));
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(5000);
    const doc = await loadWithPdfLib(bytes);
    expect(doc.getPageCount()).toBe(220);
    const texts = await getPageTexts(bytes);
    expect(texts[0]).toBe('Page 200');
    expect(texts[199]).toBe('Page 1');
    expect(texts[219]).toBe(`Page ${19 * 7 + 1}`);
  });
});

// ---------- rotation ----------

describe('exportPdf — rotation', () => {
  it('applies user rotation to an unrotated page', async () => {
    const src = await labeledSource(1);
    const bytes = await exportPdf([ref(src, 0, { rotation: 90 })], sourcesOf(src));
    const doc = await loadWithPdfLib(bytes);
    expect(doc.getPage(0).getRotation().angle).toBe(90);
    expect(doc.getPage(0).getSize()).toEqual({ width: 612, height: 792 }); // MediaBox untouched
    expect((await getPageView(bytes, 1)).rotate).toBe(90);
  });

  it('combines source /Rotate with user rotation and normalizes', async () => {
    const src = await importFile(
      'rot.pdf',
      await makePdf([
        { label: 'A', rotation: 90 },
        { label: 'B', rotation: 270 },
        { label: 'C', rotation: 90 },
        { label: 'D', rotation: 180 },
      ]),
    );
    const bytes = await exportPdf(
      [
        ref(src, 0, { rotation: 90 }), // 90 + 90 = 180
        ref(src, 1, { rotation: 90 }), // 270 + 90 = 0
        ref(src, 2, { rotation: 270 }), // 90 + 270 = 0
        ref(src, 3, { rotation: 0 }), // 180 kept
        ref(src, 3, { rotation: 270 }), // 180 + 270 = 90
      ],
      sourcesOf(src),
    );
    const doc = await loadWithPdfLib(bytes);
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([180, 0, 0, 180, 90]);
  });
});

// ---------- text annotations ----------

interface TextCase {
  name: string;
  sourceRotation: Rotation;
  userRotation: Rotation;
}

const TEXT_CASES: TextCase[] = [
  { name: 'unrotated page', sourceRotation: 0, userRotation: 0 },
  { name: 'source /Rotate 90', sourceRotation: 90, userRotation: 0 },
  { name: 'user rotation 90', sourceRotation: 0, userRotation: 90 },
  { name: 'source 90 + user 90 (=180)', sourceRotation: 90, userRotation: 90 },
  { name: 'user rotation 270', sourceRotation: 0, userRotation: 270 },
  { name: 'source 180 + user 90 (=270)', sourceRotation: 180, userRotation: 90 },
];

describe('exportPdf — text annotations', () => {
  for (const tc of TEXT_CASES) {
    it(`places text at the expected user-space position, upright, on a ${tc.name}`, async () => {
      const src = await importFile('t.pdf', await makePdf([{ label: 'Base', rotation: tc.sourceRotation }]));
      const ann = textAnn({ x: 100, y: 500, fontSize: 20, text: 'Mark' });
      const page = ref(src, 0, { rotation: tc.userRotation, annotations: [ann] });
      const geometry = getPageGeometry(page, src);
      const total = geometry.totalRotation;

      const bytes = await exportPdf([page], sourcesOf(src));

      // Expected: baseline of line 0 in display space, mapped to user space.
      const matrix = displayToUserMatrix({ x0: 0, y0: 0, x1: 612, y1: 792 }, total);
      const expected = applyMatrix(matrix, { x: ann.x, y: ann.y - ascent(ann.fontSize) });
      const [a, b, c, d] = matrix;

      const item = await findText(bytes, 1, 'Mark');
      expect(item, 'text annotation should be extractable').toBeDefined();
      const t = item!.transform;
      expect(t[4]).toBeCloseTo(expected.x, 0);
      expect(t[5]).toBeCloseTo(expected.y, 0);
      expect(Math.abs(t[4]! - expected.x)).toBeLessThan(2);
      expect(Math.abs(t[5]! - expected.y)).toBeLessThan(2);
      // Orientation: the text matrix is the font size times the rotation part
      // of the display→user matrix, so the text reads upright for the viewer.
      expect(t[0]).toBeCloseTo(a * ann.fontSize, 3);
      expect(t[1]).toBeCloseTo(b * ann.fontSize, 3);
      expect(t[2]).toBeCloseTo(c * ann.fontSize, 3);
      expect(t[3]).toBeCloseTo(d * ann.fontSize, 3);

      // The page keeps its original content and its rotation.
      const texts = await getPageTexts(bytes);
      expect(texts[0]).toContain('Base');
      expect((await getPageView(bytes, 1)).rotate).toBe(total);
    });
  }

  it('uses the CropBox origin as the display origin', async () => {
    const src = await importFile('crop.pdf', await makePdf([{ label: 'Base', cropBox: [100, 100, 400, 600] }]));
    expect(src.pages[0]).toEqual({ width: 400, height: 600, rotation: 0 });
    const ann = textAnn({ x: 10, y: 50, fontSize: 10, text: 'Cropped' });
    const bytes = await exportPdf([ref(src, 0, { annotations: [ann] })], sourcesOf(src));
    const item = await findText(bytes, 1, 'Cropped');
    expect(item).toBeDefined();
    expect(item!.transform[4]).toBeCloseTo(110, 1);
    expect(item!.transform[5]).toBeCloseTo(150 - ascent(10), 1);
  });

  it('places text correctly when MediaBox, CropBox and Rotate are inherited from the page tree', async () => {
    const box = { x0: 50, y0: 50, x1: 350, y1: 450 };
    const src = await importFile(
      'inherited.pdf',
      await makeStructuredPdf({
        pageCount: 1,
        inherited: { MediaBox: [0, 0, 400, 500], CropBox: [box.x0, box.y0, box.x1, box.y1], Rotate: 90 },
      }),
    );
    expect(src.pages[0]).toEqual({ width: 300, height: 400, rotation: 90 });
    const ann = textAnn({ x: 10, y: 50, fontSize: 20, text: 'Mark' });
    const bytes = await exportPdf([ref(src, 0, { annotations: [ann] })], sourcesOf(src));
    const matrix = displayToUserMatrix(box, 90);
    const expected = applyMatrix(matrix, { x: ann.x, y: ann.y - ascent(ann.fontSize) });
    const item = await findText(bytes, 1, 'Mark');
    expect(item).toBeDefined();
    const t = item!.transform;
    expect(t[4]).toBeCloseTo(expected.x, 1);
    expect(t[5]).toBeCloseTo(expected.y, 1);
    expect(t[0]).toBeCloseTo(matrix[0] * ann.fontSize, 3);
    expect(t[1]).toBeCloseTo(matrix[1] * ann.fontSize, 3);
    expect(t[2]).toBeCloseTo(matrix[2] * ann.fontSize, 3);
    expect(t[3]).toBeCloseTo(matrix[3] * ann.fontSize, 3);
    const view = await getPageView(bytes, 1);
    expect(view.rotate).toBe(90);
    expect(view.view).toEqual([box.x0, box.y0, box.x1, box.y1]);
  });

  it('lays out multiple lines with the shared line height', async () => {
    const src = await labeledSource(1);
    const ann = textAnn({ x: 50, y: 700, fontSize: 12, text: 'First line\n\nThird line' });
    const bytes = await exportPdf([ref(src, 0, { annotations: [ann] })], sourcesOf(src));
    await withPdfJs(bytes, async (pdf) => {
      const items = await getTextItems(pdf, 1);
      const first = items.find((i) => i.str === 'First line');
      const third = items.find((i) => i.str === 'Third line');
      expect(first).toBeDefined();
      expect(third).toBeDefined();
      expect(first!.transform[5]).toBeCloseTo(700 - ascent(12), 1);
      expect(third!.transform[5]).toBeCloseTo(700 - ascent(12) - 2 * lineHeight(12), 1);
      expect(third!.transform[4]).toBeCloseTo(50, 1);
    });
  });

  it('embeds each standard font once and supports all four', async () => {
    const src = await labeledSource(2);
    const fonts = ['Helvetica', 'Helvetica-Bold', 'TimesRoman', 'Courier'] as const;
    const pages = [
      ref(src, 0, { annotations: fonts.map((font) => textAnn({ font, text: `In ${font}` })) }),
      ref(src, 1, { annotations: fonts.map((font) => textAnn({ font, text: `Again ${font}` })) }),
    ];
    const bytes = await exportPdf(pages, sourcesOf(src));
    const doc = await loadWithPdfLib(bytes);
    const baseFonts = new Set<string>();
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFName) continue;
      const dict = obj as { lookupMaybe?: (k: PDFName, t: typeof PDFName) => PDFName | undefined; get?: (k: PDFName) => unknown };
      if (typeof dict.lookupMaybe !== 'function' || typeof dict.get !== 'function') continue;
      if (dict.get(PDFName.of('Type')) !== PDFName.of('Font')) continue;
      const base = dict.lookupMaybe(PDFName.of('BaseFont'), PDFName);
      if (base) baseFonts.add(base.decodeText());
    }
    // 4 fonts for the annotations + Helvetica embedded by the fixture itself (by name it is the same)
    expect(baseFonts).toEqual(new Set(['Helvetica', 'Helvetica-Bold', 'Times-Roman', 'Courier']));
    const texts = await getPageTexts(bytes);
    for (const font of fonts) {
      expect(texts[0]).toContain(`In ${font}`);
      expect(texts[1]).toContain(`Again ${font}`);
    }
  });

  it('replaces characters the standard fonts cannot encode instead of throwing', async () => {
    const src = await labeledSource(1);
    const ann = textAnn({ text: 'Hello 😀 中 world — café' });
    const bytes = await exportPdf([ref(src, 0, { annotations: [ann] })], sourcesOf(src));
    const texts = await getPageTexts(bytes);
    expect(texts[0]).toContain('Hello ? ? world — café');
  });

  it('reports replaced characters through options.warnings', async () => {
    const src = await labeledSource(2);
    const warnings: string[] = [];
    const bytes = await exportPdf(
      [
        ref(src, 0, { annotations: [textAnn({ text: '你好世界' }), textAnn({ text: 'plain ASCII — fine', y: 300 })] }),
        ref(src, 1, { annotations: [textAnn({ text: 'Привет' })] }),
      ],
      sourcesOf(src),
      { warnings },
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^10 characters are not available in the built-in PDF fonts and were replaced with "\?"$/);
    expect((await getPageTexts(bytes))[0]).toContain('????');

    // The on-screen preview helper predicts exactly what was exported.
    expect(exportPreviewText('你好世界')).toBe('????');
    expect(exportPreviewText('plain ASCII — fine')).toBe('plain ASCII — fine');

    const none: string[] = [];
    await exportPdf([ref(src, 0, { annotations: [textAnn({ text: 'ASCII only' })] })], sourcesOf(src), { warnings: none });
    expect(none).toEqual([]);
    const single: string[] = [];
    await exportPdf([ref(src, 0, { annotations: [textAnn({ text: 'one ☃' })] })], sourcesOf(src), { warnings: single });
    expect(single).toEqual(['1 character is not available in the built-in PDF fonts and was replaced with "?"']);
  });

  it('breaks lines at U+2028/U+2029 and lays tabs out as four spaces, like the overlay', async () => {
    const src = await labeledSource(1);
    const ann = textAnn({ x: 50, y: 700, fontSize: 12, text: 'Alpha\u2028Beta\u2029a\tb' });
    const bytes = await exportPdf([ref(src, 0, { annotations: [ann] })], sourcesOf(src));
    await withPdfJs(bytes, async (pdf) => {
      const items = await getTextItems(pdf, 1);
      const alpha = items.find((i) => i.str === 'Alpha');
      const beta = items.find((i) => i.str === 'Beta');
      expect(alpha).toBeDefined();
      expect(beta).toBeDefined();
      expect(beta!.transform[5]).toBeCloseTo(alpha!.transform[5]! - lineHeight(12), 1);
      expect(items.some((i) => i.str.includes('?'))).toBe(false);
    });
    const doc = await loadWithPdfLib(bytes);
    expect(pageContent(doc, doc.getPage(0))).toMatch(/<612020202062> Tj/); // "a    b"
  });

  it('skips empty text but still exports the page', async () => {
    const src = await labeledSource(1);
    const bytes = await exportPdf([ref(src, 0, { annotations: [textAnn({ text: '' })] })], sourcesOf(src));
    expect(await getPageTexts(bytes)).toEqual(['Page 1']);
  });
});

// ---------- ink / rect / image ----------

describe('exportPdf — ink, rect and image annotations', () => {
  async function exportWith(annotations: Annotation[], rotation: Rotation = 0) {
    const src = await labeledSource(1);
    const plain = await exportPdf([ref(src, 0, { rotation })], sourcesOf(src));
    const annotated = await exportPdf([ref(src, 0, { rotation, annotations })], sourcesOf(src));
    const plainDoc = await loadWithPdfLib(plain);
    const doc = await loadWithPdfLib(annotated);
    return {
      bytes: annotated,
      doc,
      page: doc.getPage(0),
      plainContent: pageContentInlined(plainDoc, plainDoc.getPage(0)),
      // The original content now lives in a Form XObject: inline it so these
      // assertions see everything a viewer executes for the page.
      content: pageContentInlined(doc, doc.getPage(0)),
    };
  }

  it('draws ink strokes with round caps/joins and dots for single points', async () => {
    const { content, plainContent, doc, page } = await exportWith([inkAnn()]);
    expect(content.length).toBeGreaterThan(plainContent.length);
    expect(content).toMatch(/0\.85 0\.1 0\.1 RG/);
    expect(content).toMatch(/\b2 w\b/);
    expect(content).toMatch(/\b1 J\b/);
    expect(content).toMatch(/\b1 j\b/);
    expect(content).toMatch(/10 10 m\s+50 60 l\s+90 20 l\s+S/);
    expect(content).toMatch(/200 200 m\s+200\.01 200 l\s+S/);
    expect(graphicsStateBalance(content)).toBe(0);
    expect(pageResources(doc, page, 'ExtGState').size).toBe(0); // opaque: no graphics state needed
  });

  it('creates one ExtGState per (opacity, blend mode) and reuses it', async () => {
    const highlighter = { opacity: 0.5, blendMode: 'Multiply' as const, color: { r: 1, g: 0.92, b: 0.23 } };
    const { content, doc, page } = await exportWith([
      inkAnn(highlighter),
      inkAnn(highlighter),
      rectAnn({ opacity: 0.5, blendMode: 'Multiply' }),
      inkAnn({ opacity: 0.25, blendMode: 'Normal' }),
    ]);
    const states = pageResources(doc, page, 'ExtGState');
    expect([...states.keys()].sort()).toEqual(['PEgs1', 'PEgs2']);
    const gs1 = states.get('PEgs1')!;
    expect(gs1.get(PDFName.of('BM'))).toBe(PDFName.of('Multiply'));
    expect((gs1.get(PDFName.of('ca')) as PDFNumber).asNumber()).toBe(0.5);
    expect((gs1.get(PDFName.of('CA')) as PDFNumber).asNumber()).toBe(0.5);
    const gs2 = states.get('PEgs2')!;
    expect(gs2.get(PDFName.of('BM'))).toBe(PDFName.of('Normal'));
    expect((gs2.get(PDFName.of('ca')) as PDFNumber).asNumber()).toBe(0.25);
    expect(content.match(/\/PEgs1 gs/g)).toHaveLength(3);
    expect(content.match(/\/PEgs2 gs/g)).toHaveLength(1);
    expect(graphicsStateBalance(content)).toBe(0);
  });

  it('draws rectangles with fill, border, both or neither', async () => {
    const { content, plainContent } = await exportWith([
      rectAnn({ fillColor: { r: 1, g: 1, b: 1 }, strokeColor: null }), // whiteout
      rectAnn({ x: 10, y: 10, fillColor: null, strokeColor: { r: 0, g: 0, b: 1 }, strokeWidth: 3 }),
      rectAnn({ x: 20, y: 20, fillColor: { r: 0, g: 1, b: 0 }, strokeColor: { r: 1, g: 0, b: 0 }, strokeWidth: 1 }),
      rectAnn({ x: 30, y: 30, fillColor: null, strokeColor: null }),
    ]);
    expect(content.length).toBeGreaterThan(plainContent.length);
    expect(content).toMatch(/1 1 1 rg\s+50 50 200 100 re\s+f/);
    expect(content).toMatch(/0 0 1 RG\s+3 w\s+10 10 200 100 re\s+S/);
    expect(content).toMatch(/20 20 200 100 re\s+B/);
    expect(content).not.toMatch(/30 30 200 100 re/);
    expect(graphicsStateBalance(content)).toBe(0);
  });

  it('embeds PNG and JPEG images and draws them at the given box', async () => {
    const { content, doc, page } = await exportWith([
      imageAnn(),
      imageAnn({ x: 10, y: 20, width: 30, height: 40, dataUrl: toDataUrl(TINY_JPEG, 'image/jpeg') }),
    ]);
    const xobjects = pageResources(doc, page, 'XObject');
    const subtypes = [...xobjects.values()].map((x) => x.get(PDFName.of('Subtype')));
    expect(subtypes.filter((t) => t === PDFName.of('Image'))).toHaveLength(2);
    expect(subtypes.filter((t) => t === PDFName.of('Form'))).toHaveLength(1); // the isolated original content
    expect(xobjects.size).toBe(3);
    expect(countImageXObjects(doc)).toBe(2);
    expect(content).toMatch(/1 0 0 1 300 100 cm/);
    expect(content).toMatch(/120 0 0 40 0 0 cm/);
    expect(content).toMatch(/1 0 0 1 10 20 cm/);
    expect(content).toMatch(/30 0 0 40 0 0 cm/);
    expect(content).toMatch(/\/\S+ Do/);
  });

  it('embeds the same signature once when used on several pages', async () => {
    const src = await labeledSource(3);
    const sig = toDataUrl(makePng(40, 20), 'image/png');
    const bytes = await exportPdf(
      [
        ref(src, 0, { annotations: [imageAnn({ dataUrl: sig })] }),
        ref(src, 1, { annotations: [imageAnn({ dataUrl: sig }), imageAnn({ dataUrl: sig, x: 10 })] }),
        ref(src, 2, { annotations: [imageAnn({ dataUrl: sig })] }),
      ],
      sourcesOf(src),
    );
    const doc = await loadWithPdfLib(bytes);
    expect(countImageXObjects(doc)).toBe(1);
    for (const page of doc.getPages()) expect(pageResources(doc, page, 'XObject').size).toBeGreaterThan(0);
  });

  it('skips non-finite coordinates instead of writing NaN into the content stream', async () => {
    const { content, plainContent } = await exportWith([
      inkAnn({
        strokes: [
          [{ x: 1, y: 1 }, { x: Number.NaN, y: 5 }, { x: 9, y: Number.POSITIVE_INFINITY }, { x: 9, y: 9 }],
          [{ x: Number.NaN, y: 0 }],
        ],
      }),
      rectAnn({ x: Number.NaN }),
      textAnn({ y: Number.POSITIVE_INFINITY, text: 'Nope' }),
      imageAnn({ width: Number.NaN }),
    ]);
    expect(content).not.toMatch(/NaN|Infinity/);
    // The finite points of the first stroke are still drawn, nothing else is.
    expect(content).toMatch(/1 1 m\s+9 9 l\s+S/);
    expect(content.match(/\bre\b/g) ?? []).toHaveLength(plainContent.match(/\bre\b/g)?.length ?? 0);
    expect(content.match(/\bTj\b/g) ?? []).toHaveLength(plainContent.match(/\bTj\b/g)?.length ?? 0);
    expect(content).not.toMatch(/\bDo\b/);
    expect(graphicsStateBalance(content)).toBe(0);
  });

  it('rejects malformed image annotations with a clear error', async () => {
    const src = await labeledSource(1);
    await expect(
      exportPdf([ref(src, 0, { annotations: [imageAnn({ dataUrl: 'data:image/gif;base64,R0lGODlh' })] })], sourcesOf(src)),
    ).rejects.toThrow(/Unsupported image type/);
    await expect(
      exportPdf([ref(src, 0, { annotations: [imageAnn({ dataUrl: 'nonsense' })] })], sourcesOf(src)),
    ).rejects.toThrow(/invalid data URL/);
  });

  it('isolates the annotation layer in its own balanced content stream', async () => {
    const { doc, page, content, plainContent } = await exportWith([inkAnn(), rectAnn(), textAnn(), imageAnn()], 90);
    const contents = page.node.Contents();
    expect(contents).toBeInstanceOf(PDFArray);
    const arr = contents as PDFArray;
    // [q] [q /PEfm1 Do Q] [Q] [ours]: pdf-lib's q/Q wrapper around the form
    // call that replaced the original content, then our stream.
    expect(arr.size()).toBe(4);
    const streams = pageContent(doc, page).split('\n').filter(Boolean);
    expect(streams[0]).toBe('q');
    expect(streams[1]).toBe('q');
    expect(streams[2]).toBe('/PEfm1 Do');
    expect(streams[3]).toBe('Q');
    expect(streams[4]).toBe('Q');
    expect(streams[streams.length - 1]).toBe('Q');
    // The form carries the original content, the page's MediaBox and resources.
    const form = doc.context.lookup(page.node.Resources()!.lookup(PDFName.of('XObject'), PDFDict).get(PDFName.of('PEfm1')));
    expect(form).toBeInstanceOf(PDFStream);
    const formDict = (form as PDFStream).dict;
    expect(formDict.get(PDFName.of('Subtype'))).toBe(PDFName.of('Form'));
    expect((formDict.lookup(PDFName.of('BBox'), PDFArray).asArray() as PDFNumber[]).map((n) => n.asNumber())).toEqual([0, 0, 612, 792]);
    expect(formDict.lookupMaybe(PDFName.of('Resources'), PDFDict)?.lookupMaybe(PDFName.of('Font'), PDFDict)?.keys().length).toBeGreaterThan(0);
    expect(content).toContain(plainContent.trim());
    expect(graphicsStateBalance(content)).toBe(0);
    // Our stream starts with q + the display→user matrix for 90°: [0 1 -1 0 612 0]
    expect(content).toMatch(/q\s+0 1 -1 0 612 0 cm/);
    // and annotations are drawn in display coordinates exactly as stored
    expect(content).toMatch(/10 10 m\s+50 60 l/);
  });

  it('annotations on a rotated page are drawn in display space', async () => {
    // Same page, same display coordinates, different rotations: the stroke
    // coordinates in the content stream never change, only the cm matrix.
    const results = await Promise.all(([0, 90, 180, 270] as Rotation[]).map((r) => exportWith([inkAnn()], r)));
    const matrices = ['1 0 0 1 0 0 cm', '0 1 -1 0 612 0 cm', '-1 0 0 -1 612 792 cm', '0 -1 1 0 0 792 cm'];
    results.forEach((res, i) => {
      expect(res.content).toContain(matrices[i]!);
      expect(res.content).toMatch(/10 10 m\s+50 60 l\s+90 20 l\s+S/);
    });
  });
});

// ---------- original content that leaves the graphics state unbalanced ----------

describe('exportPdf — unbalanced source content', () => {
  const CASES: [string, string][] = [
    ['a cm followed by one unmatched q', '1 0 0 1 100 100 cm q BT /F1 36 Tf 50 600 Td (Page 1) Tj ET'],
    ['two unmatched q', '1 0 0 1 100 100 cm q q BT /F1 36 Tf 50 600 Td (Page 1) Tj ET'],
    ['a clip followed by an unmatched q', '0 0 10 10 re W n q BT /F1 36 Tf 50 600 Td (Page 1) Tj ET'],
    ['an extra Q followed by a cm', 'Q 2 0 0 2 0 0 cm BT /F1 18 Tf 25 300 Td (Page 1) Tj ET'],
    ['content ending inside BT', 'BT /F1 36 Tf 50 600 Td (Page 1) Tj'],
  ];
  for (const [name, original] of CASES) {
    it(`draws annotations at the right place when the original content has ${name}`, async () => {
      const src = await importFile('q.pdf', await makeStructuredPdf({ pageCount: 1, content: () => original }));
      const ann = textAnn({ x: 100, y: 500, fontSize: 20, text: 'Mark' });
      const out = await exportPdf([ref(src, 0, { annotations: [ann, inkAnn()] })], sourcesOf(src));
      const item = await findText(out, 1, 'Mark');
      expect(item).toBeDefined();
      expect(item!.transform[4]).toBeCloseTo(ann.x, 0);
      expect(item!.transform[5]).toBeCloseTo(ann.y - ascent(ann.fontSize), 0);
      expect(item!.transform[0]).toBeCloseTo(ann.fontSize, 3);
      expect((await getPageTexts(out))[0]).toContain('Page 1'); // original content still there
      const doc = await loadWithPdfLib(out);
      const page = doc.getPage(0);
      expect(graphicsStateBalance(pageContent(doc, page))).toBe(0);
      expect(pageContent(doc, page)).toMatch(/\/PEfm1 Do/);
    });
  }

  it('decodes and joins several content streams into one form (and keeps a single one verbatim)', async () => {
    const two = await importFile('two.pdf', await makeStructuredPdf({ pageCount: 1 }));
    // Give the page two streams: a `q cm` in one and the text in the other.
    const doc = await loadWithPdfLib(two.bytes);
    const page = doc.getPage(0);
    const first = doc.context.register(doc.context.flateStream('q 1 0 0 1 100 100 cm'));
    const second = doc.context.register(doc.context.stream('BT /F1 36 Tf 50 600 Td (Page 1) Tj ET'));
    page.node.set(PDFName.of('Contents'), doc.context.obj([first, second]));
    const src = await importFile('two.pdf', await doc.save({ useObjectStreams: false }));

    const ann = textAnn({ x: 100, y: 500, fontSize: 20, text: 'Mark' });
    const out = await exportPdf([ref(src, 0, { annotations: [ann] })], sourcesOf(src));
    const item = await findText(out, 1, 'Mark');
    expect(item!.transform[4]).toBeCloseTo(100, 0);
    expect(item!.transform[5]).toBeCloseTo(500 - ascent(20), 0);
    const outDoc = await loadWithPdfLib(out);
    const inlined = pageContentInlined(outDoc, outDoc.getPage(0));
    expect(inlined).toMatch(/q 1 0 0 1 100 100 cm\s+BT \/F1 36 Tf 50 600 Td \(Page 1\) Tj ET/);
    expect((await getPageTexts(out))[0]).toContain('Page 1');

    // A single compressed stream keeps its filter (no decode/re-encode).
    const single = await labeledSource(1);
    const singleOut = await loadWithPdfLib(await exportPdf([ref(single, 0, { annotations: [ann] })], sourcesOf(single)));
    const form = singleOut.context.lookup(
      singleOut.getPage(0).node.Resources()!.lookup(PDFName.of('XObject'), PDFDict).get(PDFName.of('PEfm1')),
    ) as PDFStream;
    expect(form.dict.get(PDFName.of('Filter'))).toBe(PDFName.of('FlateDecode'));
  });

  it('uses distinct form names for pages that share one Resources dictionary', async () => {
    const src = await importFile('shared-res.pdf', await makeStructuredPdf({ pageCount: 2, inherited: { Resources: true } }));
    const out = await exportPdf(
      [ref(src, 0, { annotations: [textAnn({ text: 'A' })] }), ref(src, 1, { annotations: [textAnn({ text: 'B' })] })],
      sourcesOf(src),
    );
    expect(await getPageTexts(out)).toEqual(['Page 1 A', 'Page 2 B']);
    const doc = await loadWithPdfLib(out);
    const [p1, p2] = doc.getPages();
    expect(pageContent(doc, p1!)).toMatch(/\/PEfm1 Do/);
    expect(pageContent(doc, p2!)).toMatch(/\/PEfm2 Do/);
    for (const page of doc.getPages()) expect(graphicsStateBalance(pageContentInlined(doc, page))).toBe(0);
  });
});

// ---------- text sanitizing ----------

async function helvetica(): Promise<PDFFont> {
  const { PDFDocument } = await import('pdf-lib');
  return (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
}

describe('sanitizeForFont', () => {
  it('keeps WinAnsi text, replaces the rest with "?" and drops control characters', async () => {
    const font = await helvetica();
    expect(sanitizeForFont('Plain ASCII — café €', font)).toBe('Plain ASCII — café €');
    expect(sanitizeForFont('a😀b中c', font)).toBe('a?b?c');
    expect(sanitizeForFont('tab\there\u0007bell', font)).toBe('tab    herebell');
  });

  it('drops marks and variation selectors, maps compatibility forms, counts replacements', async () => {
    const font = await helvetica();
    expect(sanitizeForFont('\u2764\ufe0f', font)).toBe('?'); // red heart + VS16: one symbol, one "?"
    expect(sanitizeForFont('q\u0303', font)).toBe('q'); // q + combining tilde does not compose: mark dropped, base kept
    expect(sanitizeForFont('\ufb01ne', font)).toBe('fine'); // ligature "fi"
    expect(sanitizeForFont('\uff21\uff22', font)).toBe('AB'); // fullwidth
    expect(sanitizeForFont('\u2460', font)).toBe('1'); // circled digit one
    expect(sanitizeForFont('x\u20e3', font)).toBe('x'); // enclosing keycap mark alone is dropped
    const stats = { replaced: 0 };
    expect(sanitizeForFont('你好 ok 😀\ufe0f', font, new Map(), stats)).toBe('?? ok ?');
    expect(stats.replaced).toBe(3);
  });

  it('agrees with the WinAnsi predicate used for previews, for every code point and all four fonts', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    const fonts = await Promise.all(
      [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.TimesRoman, StandardFonts.Courier].map((f) =>
        doc.embedFont(f),
      ),
    );
    const mismatches: string[] = [];
    for (const font of fonts) {
      for (let cp = 0; cp <= 0xffff; cp++) {
        if (cp >= 0xd800 && cp <= 0xdfff) continue;
        const ch = String.fromCodePoint(cp);
        let encodable = true;
        try {
          font.encodeText(ch);
        } catch {
          encodable = false;
        }
        if (encodable !== isWinAnsiChar(ch)) mismatches.push(`${font.name} U+${cp.toString(16)}`);
      }
    }
    expect(mismatches).toEqual([]);
    expect(isWinAnsiChar('😀')).toBe(false);
    expect(isWinAnsiChar('')).toBe(false);
    expect(isWinAnsiChar('ab')).toBe(false);
    // ... so the generic sanitizer with the predicate matches the font-backed one.
    const font = fonts[0]!;
    for (const sample of ['Plain — café €', 'a😀b中c', '\u2764\ufe0f', 'q\u0303', '\ufb01ne', 'a\u200bb\u200dc\ufeff', 'Ωmega Ελληνικά']) {
      expect(sanitizeText(sample, isWinAnsiChar)).toBe(sanitizeForFont(sample, font));
      expect(exportPreviewText(sample)).toBe(sanitizeForFont(sample, font));
    }
  });

  it('normalizes decomposed characters and drops invisible format characters', async () => {
    const font = await helvetica();
    // "e" + combining acute (NFD, as produced by some keyboards/OSes) becomes "é".
    expect(sanitizeForFont('café', font)).toBe('café');
    // Zero-width space / joiner / BOM are not drawn as "?".
    expect(sanitizeForFont('a​b‍c﻿', font)).toBe('abc');
    // A visible unsupported character is still replaced.
    expect(sanitizeForFont('x☃y', font)).toBe('x?y');
  });
});

describe('splitLines', () => {
  it('splits on CRLF, CR, LF and the Unicode line/paragraph separators', () => {
    expect(splitLines('a\r\nb\rc\nd\u2028e\u2029f')).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(splitLines('')).toEqual(['']);
    expect(splitLines('x\n')).toEqual(['x', '']);
  });

  it('expands a tab to four spaces so overlay, measurement and export agree', () => {
    expect(splitLines('a\tb')).toEqual(['a    b']);
    expect(splitLines('\t\n\t')).toEqual(['    ', '    ']);
  });
});
