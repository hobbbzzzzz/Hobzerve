// Draws a ReportDocument into an A4 PDF with pdf-lib. Server-only (reads font files).
// Output is deterministic for the same snapshot: fixed dates and font names, no random IDs.

import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import type { Block, ReportDocument } from "./document";

const PAGE = { w: 595.28, h: 841.89 };
const M = { x: 44, top: 48, bottom: 64 };
const CONTENT_W = PAGE.w - M.x * 2;

const C = {
  ink: hex("#182338"),
  soft: hex("#5b677a"),
  primary: hex("#4d5ccf"),
  line: hex("#e1e7f2"),
  band: hex("#f1f4fd"),
  tile: hex("#f6f8fe"),
  warning: hex("#9a5d14"),
};

function hex(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  charset: Set<number>;
}

const FONT_DIR = path.join(process.cwd(), "src/features/reports/fonts");

async function loadFonts(doc: PDFDocument): Promise<Fonts> {
  try {
    doc.registerFontkit(fontkit);
    const [r, b] = await Promise.all([
      readFile(path.join(FONT_DIR, "poppins-latin-400-normal.woff")),
      readFile(path.join(FONT_DIR, "poppins-latin-600-normal.woff")),
    ]);
    const regular = await doc.embedFont(r, { subset: true, customName: "Poppins-Regular" });
    const bold = await doc.embedFont(b, { subset: true, customName: "Poppins-SemiBold" });
    return { regular, bold, charset: new Set(regular.getCharacterSet()) };
  } catch {
    // Fallback keeps reports working if the font files are missing from the deployment bundle.
    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const charset = new Set<number>();
    for (let c = 32; c < 127; c++) charset.add(c);
    for (const c of "—–“”‘’…·→›−€") charset.add(c.codePointAt(0)!);
    return { regular, bold, charset };
  }
}

class Layout {
  page!: PDFPage;
  y = 0;
  pages: PDFPage[] = [];
  replaced = false;

  constructor(
    private doc: PDFDocument,
    private f: Fonts,
  ) {
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage([PAGE.w, PAGE.h]);
    this.pages.push(this.page);
    this.y = PAGE.h - M.top;
  }

  ensure(h: number) {
    if (this.y - h < M.bottom) this.newPage();
  }

  /** Replaces characters the embedded font can't draw (e.g. Arabic) and flattens whitespace. */
  clean(text: string): string {
    let out = "";
    for (const ch of String(text ?? "").replace(/[\r\n\t]+/g, " ")) {
      const cp = ch.codePointAt(0)!;
      if (this.f.charset.has(cp)) out += ch;
      else {
        out += "?";
        this.replaced = true;
      }
    }
    return out;
  }

  wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const words = this.clean(text).split(" ");
    const lines: string[] = [];
    let line = "";
    const fits = (s: string) => font.widthOfTextAtSize(s, size) <= width;
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (fits(candidate)) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      if (fits(word)) {
        line = word;
        continue;
      }
      // Break very long tokens (fingerprints, URLs) by character.
      let chunk = "";
      for (const ch of word) {
        if (fits(chunk + ch)) chunk += ch;
        else {
          lines.push(chunk);
          chunk = ch;
        }
      }
      line = chunk;
    }
    if (line || !lines.length) lines.push(line);
    return lines;
  }

  text(t: string, x: number, y: number, size: number, font: PDFFont, color: RGB = C.ink) {
    this.page.drawText(t, { x, y, size, font, color });
  }

  header(title: string, subtitle: string[]) {
    this.text("HOBZERVE", M.x, this.y, 8, this.f.bold, C.primary);
    this.page.drawRectangle({ x: M.x, y: this.y - 8, width: CONTENT_W, height: 1.2, color: C.primary });
    this.y -= 32;
    for (const line of this.wrap(title, this.f.bold, 18, CONTENT_W)) {
      this.text(line, M.x, this.y, 18, this.f.bold);
      this.y -= 23;
    }
    this.y -= 2;
    for (const s of subtitle) {
      for (const line of this.wrap(s, this.f.regular, 8.5, CONTENT_W)) {
        this.text(line, M.x, this.y, 8.5, this.f.regular, C.soft);
        this.y -= 12;
      }
    }
    this.y -= 8;
  }

  block(b: Block) {
    switch (b.type) {
      case "h2": {
        // Keep a heading with at least the start of what follows it.
        this.ensure(90);
        this.y -= 10;
        this.text(this.clean(b.text), M.x, this.y, 12, this.f.bold, C.primary);
        this.y -= 16;
        break;
      }
      case "p": {
        const lines = this.wrap(b.text, this.f.regular, 9, CONTENT_W);
        for (const line of lines) {
          this.ensure(13);
          this.text(line, M.x, this.y, 9, this.f.regular, b.tone === "soft" ? C.soft : b.tone === "warning" ? C.warning : C.ink);
          this.y -= 13;
        }
        this.y -= 6;
        break;
      }
      case "stats": {
        const n = b.items.length;
        const gap = 8;
        const w = (CONTENT_W - gap * (n - 1)) / n;
        const h = 50;
        this.ensure(h + 8);
        b.items.forEach((it, i) => {
          const x = M.x + i * (w + gap);
          this.page.drawRectangle({ x, y: this.y - h, width: w, height: h, color: C.tile, borderColor: C.line, borderWidth: 0.8 });
          this.text(this.wrap(it.label, this.f.regular, 7.5, w - 16)[0]!, x + 8, this.y - 13, 7.5, this.f.regular, C.soft);
          this.text(this.wrap(it.value, this.f.bold, 12, w - 16)[0]!, x + 8, this.y - 30, 12, this.f.bold);
          if (it.hint) this.text(this.wrap(it.hint, this.f.regular, 7, w - 16)[0]!, x + 8, this.y - 42, 7, this.f.regular, C.soft);
        });
        this.y -= h + 16;
        break;
      }
      case "kv": {
        const labelW = CONTENT_W * 0.36;
        for (const it of b.items) {
          const l = this.wrap(it.label, this.f.regular, 9, labelW - 8);
          const v = this.wrap(it.value ?? "—", this.f.bold, 9, CONTENT_W - labelW);
          const h = Math.max(l.length, v.length) * 12.5 + 4;
          this.ensure(h);
          l.forEach((line, i) => this.text(line, M.x, this.y - i * 12.5, 9, this.f.regular, C.soft));
          v.forEach((line, i) => this.text(line, M.x + labelW, this.y - i * 12.5, 9, this.f.bold));
          this.y -= h;
          this.page.drawLine({ start: { x: M.x, y: this.y + 6 }, end: { x: M.x + CONTENT_W, y: this.y + 6 }, thickness: 0.5, color: C.line });
        }
        this.y -= 8;
        break;
      }
      case "table":
        this.table(b);
        break;
    }
  }

  table(b: Extract<Block, { type: "table" }>) {
    const pad = 5;
    const size = 8.5;
    const lh = 11;
    const widths = b.columns.map((c) => c.width * CONTENT_W);
    const drawHeader = () => {
      const heads = b.columns.map((c, i) => this.wrap(c.header, this.f.bold, 7.5, widths[i]! - pad * 2));
      const h = Math.max(...heads.map((x) => x.length)) * 10 + pad * 2;
      this.ensure(h + lh + pad * 2);
      this.page.drawRectangle({ x: M.x, y: this.y - h, width: CONTENT_W, height: h, color: C.band });
      let x = M.x;
      heads.forEach((lines, i) => {
        lines.forEach((line, j) => {
          const w = this.f.bold.widthOfTextAtSize(line, 7.5);
          const tx = b.columns[i]!.align === "right" ? x + widths[i]! - pad - w : x + pad;
          this.text(line, tx, this.y - pad - 7.5 - j * 10, 7.5, this.f.bold, C.soft);
        });
        x += widths[i]!;
      });
      this.y -= h;
    };

    if (!b.rows.length) {
      if (b.empty) this.block({ type: "p", text: b.empty, tone: "soft" });
      return;
    }
    drawHeader();
    for (const row of b.rows) {
      const cells = row.map((cell, i) => this.wrap(cell ?? "", this.f.regular, size, widths[i]! - pad * 2));
      const h = Math.max(...cells.map((x) => x.length)) * lh + pad * 2;
      if (this.y - h < M.bottom) {
        this.newPage();
        drawHeader();
      }
      let x = M.x;
      cells.forEach((lines, i) => {
        lines.forEach((line, j) => {
          const w = this.f.regular.widthOfTextAtSize(line, size);
          const tx = b.columns[i]!.align === "right" ? x + widths[i]! - pad - w : x + pad;
          this.text(line, tx, this.y - pad - size - j * lh + 1, size, this.f.regular);
        });
        x += widths[i]!;
      });
      this.y -= h;
      this.page.drawLine({ start: { x: M.x, y: this.y }, end: { x: M.x + CONTENT_W, y: this.y }, thickness: 0.5, color: C.line });
    }
    this.y -= 10;
  }

  footers(lines: string[]) {
    const total = this.pages.length;
    this.pages.forEach((p, i) => {
      p.drawLine({ start: { x: M.x, y: 42 }, end: { x: M.x + CONTENT_W, y: 42 }, thickness: 0.5, color: C.line });
      const all = [...lines.map((l) => this.clean(l)), `Page ${i + 1} of ${total}`];
      all.forEach((line, j) => {
        const size = 6.8;
        const w = this.f.regular.widthOfTextAtSize(line, size);
        const x = j === all.length - 1 ? M.x + CONTENT_W - w : M.x;
        const y = j === all.length - 1 ? 32 - (all.length - 2) * 9 : 32 - j * 9;
        p.drawText(line, { x, y, size, font: this.f.regular, color: C.soft });
      });
    });
  }
}

export async function renderReportPdf(d: ReportDocument): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(d.meta.title);
  doc.setSubject(`Hobzerve report for ${d.meta.subject}`);
  doc.setAuthor("Hobzerve");
  doc.setCreator("Hobzerve report renderer");
  doc.setProducer("Hobzerve");
  doc.setCreationDate(d.meta.generatedAt);
  doc.setModificationDate(d.meta.generatedAt);

  const fonts = await loadFonts(doc);
  const layout = new Layout(doc, fonts);
  layout.header(d.title, d.subtitle);
  for (const b of d.blocks) layout.block(b);
  if (layout.replaced) {
    layout.block({ type: "p", tone: "warning", text: "Some characters (for example Arabic text) can't be shown in this PDF yet and appear as “?”. The app shows them correctly." });
  }
  layout.footers(d.footer);
  return doc.save({ useObjectStreams: false });
}
