/**
 * pdf-lib based inspection of exported files: page sizes, rotation, decoded
 * content streams and resources. Complements the pdf.js helpers.
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFStream, decodePDFRawStream } from 'pdf-lib';
import type { PDFPage } from 'pdf-lib';

export async function loadWithPdfLib(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
}

function streamText(stream: PDFStream): string {
  const bytes = stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : stream.getContents();
  return new TextDecoder('latin1').decode(bytes);
}

/** The page's content streams, decoded and concatenated with newlines. */
export function pageContent(doc: PDFDocument, page: PDFPage): string {
  const contents = page.node.Contents();
  if (!contents) return '';
  const streams: PDFStream[] = [];
  if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.size(); i++) {
      const s = doc.context.lookup(contents.get(i));
      if (s instanceof PDFStream) streams.push(s);
    }
  } else if (contents instanceof PDFStream) {
    streams.push(contents);
  }
  return streams.map(streamText).join('\n');
}

/**
 * Like {@link pageContent}, but with every `/Name Do` that paints a Form
 * XObject replaced by that form's (decoded) content, recursively. The exporter
 * moves a page's original content into such a form, so this is what a viewer
 * effectively executes for the page.
 */
export function pageContentInlined(doc: PDFDocument, page: PDFPage): string {
  const inline = (content: string, resources: PDFDict | undefined, depth: number): string => {
    if (depth > 8 || !resources) return content;
    const xobjects = resources.lookupMaybe(PDFName.of('XObject'), PDFDict);
    if (!xobjects) return content;
    return content.replace(/\/([^\s/[\]<>(){}%]+)\s+Do\b/g, (match, name: string) => {
      const form = doc.context.lookup(xobjects.get(PDFName.of(name)));
      if (!(form instanceof PDFStream) || form.dict.get(PDFName.of('Subtype')) !== PDFName.of('Form')) return match;
      const own = form.dict.lookupMaybe(PDFName.of('Resources'), PDFDict);
      return `\n${inline(streamText(form), own ?? resources, depth + 1)}\n`;
    });
  };
  return inline(pageContent(doc, page), page.node.Resources(), 0);
}

/**
 * Names → dicts of a resource category (e.g. 'ExtGState', 'XObject', 'Font')
 * on a page. For stream resources (images) the stream's dictionary is returned.
 */
export function pageResources(doc: PDFDocument, page: PDFPage, category: string): Map<string, PDFDict> {
  const out = new Map<string, PDFDict>();
  const resources = page.node.Resources();
  const dict = resources?.lookupMaybe(PDFName.of(category), PDFDict);
  if (!dict) return out;
  for (const [key, value] of dict.entries()) {
    const resolved = doc.context.lookup(value);
    if (resolved instanceof PDFStream) out.set(key.decodeText(), resolved.dict);
    else if (resolved instanceof PDFDict) out.set(key.decodeText(), resolved);
  }
  return out;
}

/** Count indirect image XObjects in the whole document. */
export function countImageXObjects(doc: PDFDocument): number {
  let n = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFStream) {
      const subtype = obj.dict.lookupMaybe(PDFName.of('Subtype'), PDFName);
      if (subtype === PDFName.of('Image')) n++;
    }
  }
  return n;
}

/** Count the number of `q` operators minus `Q` operators in a content string. */
export function graphicsStateBalance(content: string): number {
  const tokens = content.split(/\s+/);
  let depth = 0;
  for (const t of tokens) {
    if (t === 'q') depth++;
    else if (t === 'Q') depth--;
  }
  return depth;
}
