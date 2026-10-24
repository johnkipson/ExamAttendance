import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Directory, File, Paths } from 'expo-file-system';
import { AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';

export type Report = { title: string; dateDisplay: string; present: string[]; total: number };

/** A file ready to hand over: its bytes, name and type. */
export type ReadyFile = { name: string; mime: string; bytes: Uint8Array; cacheUri?: string };

export const MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  json: 'application/json',
};

/** dd/mm/yyyy, like the web version (en-GB). */
export function displayDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function baseFileName(title: string, dateDisplay: string): string {
  // keep letters from any script (Tamil titles included), drop characters file systems dislike
  const clean = title.replace(/[\\/:*?"<>|#%{}~&]/g, '').trim().replace(/\s+/g, '_') || 'Exam_Attendance';
  return `${clean}_${dateDisplay.replace(/\//g, '-')}`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function reportHtml(r: Report): string {
  const rows = r.present.map((n, i) => `<tr><td class="n">${i + 1}</td><td>${esc(n)}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { margin: 18mm 16mm; }
  body { font-family: 'Noto Sans', 'Noto Sans Tamil', Roboto, Arial, sans-serif; color: #2b2420; }
  h1 { text-align: center; font-size: 20px; margin: 0 0 6px; }
  .meta { text-align: center; font-size: 13px; margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 12.5px; }
  th { background: #8a5a3b; color: #fff; text-align: left; padding: 7px 8px; }
  td { padding: 6px 8px; border-bottom: 1px solid #e6ddd0; }
  tr:nth-child(even) td { background: #faf7f2; }
  td.n, th.n { width: 42px; text-align: right; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  </style></head><body>
  <h1>${esc(r.title)}</h1>
  <p class="meta">Date: ${esc(r.dateDisplay)}</p>
  <p class="meta">Present: ${r.present.length} of ${r.total}</p>
  <table><thead><tr><th class="n">#</th><th>Name</th></tr></thead><tbody>${rows}</tbody></table>
  </body></html>`;
}

export async function makePdf(r: Report): Promise<ReadyFile> {
  const name = baseFileName(r.title, r.dateDisplay) + '.pdf';
  const html = reportHtml(r);
  if (Platform.OS === 'web') {
    await Print.printAsync({ html }); // browser print dialog → "Save as PDF"
    return { name, mime: MIME.pdf, bytes: new Uint8Array() };
  }
  const { uri } = await Print.printToFileAsync({ html });
  const bytes = new Uint8Array(await new File(uri).arrayBuffer());
  return { name, mime: MIME.pdf, bytes };
}

export async function makeDocx(r: Report): Promise<ReadyFile> {
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'E6DDD0' };
  const borders = { top: border, bottom: border, left: border, right: border };
  const cell = (text: string, opts: { head?: boolean; width: number; right?: boolean }) => new TableCell({
    width: { size: opts.width, type: WidthType.PERCENTAGE },
    borders,
    shading: opts.head ? { type: ShadingType.CLEAR, color: 'auto', fill: '8A5A3B' } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ alignment: opts.right ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [new TextRun({ text, bold: !!opts.head, color: opts.head ? 'FFFFFF' : '2B2420' })] })],
  });
  const rows = [
    new TableRow({ tableHeader: true, children: [cell('#', { head: true, width: 10, right: true }), cell('Name', { head: true, width: 90 })] }),
    ...r.present.map((n, i) => new TableRow({ cantSplit: true, children: [cell(String(i + 1), { width: 10, right: true }), cell(n, { width: 90 })] })),
  ];
  const doc = new Document({
    creator: 'Exam Attendance',
    title: r.title,
    sections: [{
      children: [
        new Paragraph({ heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, children: [new TextRun({ text: r.title })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun('Date: ' + r.dateDisplay)] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 300 }, children: [new TextRun(`Present: ${r.present.length} of ${r.total}`)] }),
        new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }),
      ],
    }],
  });
  const buf = await Packer.toArrayBuffer(doc);
  return { name: baseFileName(r.title, r.dateDisplay) + '.docx', mime: MIME.docx, bytes: new Uint8Array(buf) };
}

export function makeJson(name: string, data: unknown): ReadyFile {
  const text = JSON.stringify(data, null, 2);
  return { name, mime: MIME.json, bytes: new TextEncoder().encode(text) };
}

function webDownload(f: ReadyFile) {
  const blob = new Blob([f.bytes as BlobPart], { type: f.mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = f.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** Opens the Android share sheet (WhatsApp, Gmail, Drive, Files…). */
export async function shareFile(f: ReadyFile): Promise<void> {
  if (Platform.OS === 'web') return webDownload(f);
  const file = new File(Paths.cache, f.name);
  if (file.exists) file.delete();
  file.create();
  await file.write(f.bytes);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this phone.');
  await Sharing.shareAsync(file.uri, { mimeType: f.mime, dialogTitle: f.name });
}

/** Lets the user pick a folder (for example Download) and writes the file there. Returns the folder name, or null if cancelled. */
export async function saveToFolder(f: ReadyFile): Promise<string | null> {
  if (Platform.OS === 'web') { webDownload(f); return 'Downloads'; }
  let dir: Directory;
  try { dir = await Directory.pickDirectoryAsync(); } catch { return null; }
  if (!dir) return null;
  const out = dir.createFile(f.name, f.mime);
  await out.write(f.bytes);
  return decodeURIComponent(dir.name || 'the chosen folder');
}
