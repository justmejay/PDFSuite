import * as pdfjsLib from 'pdfjs-dist';
import {
  PDFDocument,
  StandardFonts,
  TextRenderingMode,
  beginText,
  endText,
  degrees,
  popGraphicsState,
  pushGraphicsState,
  setCharacterSqueeze,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText
} from 'pdf-lib';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

// Setup pdf.js worker using Vite's URL handling
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

export class PDFProcessor {
  constructor() {
    this.documents = []; // { id, file, pdfDoc, pages: [{ pageIndex, isDeleted, rotation }] }
    this.globalPageCounter = 0;
    this.documentMap = new Map();
    this.ocrResults = new Map();
  }

  async loadFiles(files, options = {}) {
    const loadedDocs = [];
    const pdfFiles = Array.from(files).filter(file => file.type === 'application/pdf');

    for (let index = 0; index < pdfFiles.length; index++) {
      const file = pdfFiles[index];
      if (file.type !== 'application/pdf') continue;

      const fileId = Math.random().toString(36).substring(2, 9);
      const arrayBuffer = await file.arrayBuffer();
      // Pass a clone of the arrayBuffer to pdfjs because it detaches the buffer by default
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
      
      const docEntry = {
        id: fileId,
        file: file,
        fileName: file.name,
        originalBuffer: arrayBuffer,
        pdfjsDoc: pdf,
        pages: []
      };

      for (let i = 1; i <= pdf.numPages; i++) {
        docEntry.pages.push({
          pageIndex: i,
          globalIndex: this.globalPageCounter++,
          isDeleted: false,
          rotation: 0 // Additional rotation inside app (degrees)
        });
      }

      this.documents.push(docEntry);
      this.documentMap.set(fileId, docEntry);
      loadedDocs.push(docEntry);

      if (options.onProgress) {
        options.onProgress({
          current: index + 1,
          total: pdfFiles.length,
          fileName: file.name
        });
      }

      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    return loadedDocs;
  }

  getDocument(docId) {
    return this.documentMap.get(docId) || this.documents.find(d => d.id === docId);
  }

  getOcrKey(docId, pageIndex, rotation = 0) {
    return `${docId}-${pageIndex}-${rotation || 0}`;
  }

  setOcrResult(docId, pageIndex, rotation, result) {
    this.ocrResults.set(this.getOcrKey(docId, pageIndex, rotation), result);
  }

  getOcrResult(docId, pageIndex, rotation = 0) {
    return this.ocrResults.get(this.getOcrKey(docId, pageIndex, rotation));
  }

  async extractPageText(docId, pageIndex) {
    const doc = this.getDocument(docId);
    if (!doc) return '';

    const page = await doc.pdfjsDoc.getPage(pageIndex);
    const textContent = await page.getTextContent();
    return textContent.items
      .map(item => item.str || '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async renderPageToCanvas(docId, pageIndex, canvas, options = {}) {
    const doc = this.getDocument(docId);
    if (!doc) return;

    const pageData = doc.pages.find(p => p.pageIndex === pageIndex);
    const page = await doc.pdfjsDoc.getPage(pageIndex);
    const scale = options.scale || 0.65;
    const viewport = page.getViewport({ scale, rotation: page.rotate + (pageData ? pageData.rotation : 0) });
    
    // adjust canvas
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    
    const ctx = canvas.getContext('2d');
    const renderContext = {
      canvasContext: ctx,
      viewport: viewport
    };

    await page.render(renderContext).promise;
    return viewport;
  }

  async renderFullscreenPage(docId, pageIndex, canvas, textContainer, zoomMultiplier = 1.0) {
    const doc = this.getDocument(docId);
    if (!doc) return null;

    const pageData = doc.pages.find(p => p.pageIndex === pageIndex);
    const page = await doc.pdfjsDoc.getPage(pageIndex);
    
    const baseViewport = page.getViewport({ scale: 1.0 });
    const screenHeight = window.innerHeight * 0.9;
    const scale = screenHeight / baseViewport.height;
    const finalScale = Math.min(Math.max(scale, 1.0), 4.0) * zoomMultiplier;
    
    const viewport = page.getViewport({ scale: finalScale, rotation: page.rotate + (pageData ? pageData.rotation : 0) });
    
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    
    textContainer.parentElement.style.width = `${viewport.width}px`;
    textContainer.parentElement.style.height = `${viewport.height}px`;
    
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;

    textContainer.innerHTML = '';
    
    try {
      const textContent = await page.getTextContent();
      
      const applyTransform = (p1, p2) => [
        p1[0] * p2[0] + p1[2] * p2[1],
        p1[1] * p2[0] + p1[3] * p2[1],
        p1[0] * p2[2] + p1[2] * p2[3],
        p1[1] * p2[2] + p1[3] * p2[3],
        p1[0] * p2[4] + p1[2] * p2[5] + p1[4],
        p1[1] * p2[4] + p1[3] * p2[5] + p1[5]
      ];

      for (const item of textContent.items) {
          const tx = applyTransform(viewport.transform, item.transform);
          const fontHeight = Math.sqrt((tx[2] * tx[2]) + (tx[3] * tx[3]));
          
          const span = document.createElement('span');
          span.textContent = item.str + (item.hasEOL ? ' ' : '');
          span.style.left = `${tx[4]}px`;
          span.style.top = `${tx[5] - fontHeight * 0.8}px`; 
          span.style.fontSize = `${fontHeight}px`;
          span.style.lineHeight = '1';
          
          textContainer.appendChild(span);
      }
    } catch (e) {
      console.warn("Failed to render text layer", e);
    }
    
    return viewport;
  }


  rotatePage(docId, pageIndex, direction) {
    const doc = this.getDocument(docId);
    if (!doc) return;
    
    const pageData = doc.pages.find(p => p.pageIndex === pageIndex);
    if (pageData) {
      if (direction === 'left') {
        pageData.rotation = (pageData.rotation - 90) % 360;
      } else {
        pageData.rotation = (pageData.rotation + 90) % 360;
      }
    }
    return pageData.rotation;
  }
  
  togglePageDeletion(docId, pageIndex) {
    const doc = this.getDocument(docId);
    if (!doc) return;
    
    const pageData = doc.pages.find(p => p.pageIndex === pageIndex);
    if (pageData) {
      pageData.isDeleted = !pageData.isDeleted;
    }
    return pageData.isDeleted;
  }

  getAllActivePages() {
    let all = [];
    for (let doc of this.documents) {
      for (let p of doc.pages) {
        if (!p.isDeleted) {
          all.push({ doc, page: p });
        }
      }
    }
    // we could dynamically reorder them if we supported drag/drop reordering.
    return all;
  }

  clear() {
    this.documents = [];
    this.documentMap.clear();
    this.ocrResults.clear();
    this.globalPageCounter = 0;
  }

  escapeXml(value) {
    return `${value ?? ''}`
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  columnName(index) {
    let name = '';
    let current = index + 1;
    while (current > 0) {
      const remainder = (current - 1) % 26;
      name = String.fromCharCode(65 + remainder) + name;
      current = Math.floor((current - 1) / 26);
    }
    return name;
  }

  buildExtractionWorkbook(rows = []) {
    const headers = ['File Name', 'Account', 'Service Delivered to', 'Current Balance Due'];
    const data = [headers, ...rows.map(row => [
      row.fileName || '',
      row.account || '',
      row.serviceDeliveredTo || '',
      row.currentBalanceDue || ''
    ])];

    const sheetRows = data.map((row, rowIndex) => {
      const cells = row.map((value, colIndex) => {
        const ref = `${this.columnName(colIndex)}${rowIndex + 1}`;
        return `<c r="${ref}" t="inlineStr"><is><t>${this.escapeXml(value)}</t></is></c>`;
      }).join('');
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    }).join('');

    const zip = new JSZip();
    zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`);
    zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);
    zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Extracted Billing" sheetId="1" r:id="rId1"/></sheets>
</workbook>`);
    zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`);
    zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:D${Math.max(data.length, 1)}"/>
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols><col min="1" max="1" width="42" customWidth="1"/><col min="2" max="4" width="28" customWidth="1"/></cols>
  <sheetData>${sheetRows}</sheetData>
</worksheet>`);

    return zip.generateAsync({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  }

  async addExtractionWorkbook(zip, rows) {
    if (!rows) return;
    const workbook = await this.buildExtractionWorkbook(rows);
    zip.file('billing_extract.xlsx', workbook);
  }

  async addOcrLayer(targetPdf, pdfPage, doc, pageData, fontCache) {
    const ocrResult = this.getOcrResult(doc.id, pageData.pageIndex, pageData.rotation);
    if (!ocrResult?.words?.length || !ocrResult.imageWidth || !ocrResult.imageHeight) return;

    if (!fontCache.font) {
      fontCache.font = await targetPdf.embedFont(StandardFonts.Helvetica);
    }

    const pageWidth = pdfPage.getWidth();
    const pageHeight = pdfPage.getHeight();
    const scaleX = pageWidth / ocrResult.imageWidth;
    const scaleY = pageHeight / ocrResult.imageHeight;

    for (const word of ocrResult.words) {
      const text = `${word.text || ''}`.trim();
      const box = word.box;
      if (!text || !box) continue;
      if (Number.isFinite(word.confidence) && word.confidence < 45) continue;

      const x = box.x0 * scaleX;
      const y = pageHeight - (box.y1 * scaleY);
      const size = Math.max((box.y1 - box.y0) * scaleY * 0.82, 1);
      const maxWidth = Math.max((box.x1 - box.x0) * scaleX, 1);

      try {
        const exportText = `${text} `;
        const encodedText = fontCache.font.encodeText(exportText);
        const textWidth = fontCache.font.widthOfTextAtSize(exportText, size);
        const squeeze = textWidth > 0 ? Math.max(Math.min((maxWidth / textWidth) * 100, 100), 20) : 100;

        pdfPage.pushOperators(
          pushGraphicsState(),
          beginText(),
          setTextRenderingMode(TextRenderingMode.Invisible),
          setFontAndSize(fontCache.font.name, size),
          setCharacterSqueeze(squeeze),
          setTextMatrix(1, 0, 0, 1, x, y),
          showText(encodedText),
          endText(),
          popGraphicsState()
        );
      } catch (error) {
        // Skip words the built-in Helvetica font cannot encode.
      }
    }
  }

  // Exports all valid pages into ONE PDF
  async exportAsOne() {
    const finalPdf = await PDFDocument.create();
    const fontCache = {};
    
    for (let doc of this.documents) {
      const buffer = doc.originalBuffer || await doc.file.arrayBuffer();
      const currentDoc = await PDFDocument.load(buffer);
      
      for (let p of doc.pages) {
        if (p.isDeleted) continue;
        
        const [copiedPage] = await finalPdf.copyPages(currentDoc, [p.pageIndex - 1]);
        
        // Apply user rotation
        if (p.rotation !== 0) {
          const currentRotation = copiedPage.getRotation().angle;
          copiedPage.setRotation(degrees(currentRotation + p.rotation));
        }

        await this.addOcrLayer(finalPdf, copiedPage, doc, p, fontCache);
        
        finalPdf.addPage(copiedPage);
      }
    }

    const pdfBytes = await finalPdf.save();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    saveAs(blob, 'combined_output.pdf');
  }

  // Exports all valid pages grouped by their original file into a ZIP.
  async exportByFile(options = {}) {
    const zip = new JSZip();

    for (let doc of this.documents) {
      const buffer = doc.originalBuffer || await doc.file.arrayBuffer();
      const currentDoc = await PDFDocument.load(buffer);
      
      const singlePdf = await PDFDocument.create();
      const fontCache = {};
      let addedPages = 0;
      
      for (let p of doc.pages) {
        if (p.isDeleted) continue;
        
        const [copiedPage] = await singlePdf.copyPages(currentDoc, [p.pageIndex - 1]);
        
        if (p.rotation !== 0) {
          const currentRotation = copiedPage.getRotation().angle;
          copiedPage.setRotation(degrees(currentRotation + p.rotation));
        }

        await this.addOcrLayer(singlePdf, copiedPage, doc, p, fontCache);
        
        singlePdf.addPage(copiedPage);
        addedPages++;
      }
      
      if (addedPages > 0) {
        const pdfBytes = await singlePdf.save();
        zip.file(`modified_${doc.fileName}`, pdfBytes);
      }
    }

    await this.addExtractionWorkbook(zip, options.extractionRows);

    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, 'modified_files.zip');
  }

  // Exports every single valid page as a separate PDF, then ZIPs it.
  async exportBurst(options = {}) {
    const zip = new JSZip();
    let counter = 1;

    for (let doc of this.documents) {
      const buffer = doc.originalBuffer || await doc.file.arrayBuffer();
      const currentDoc = await PDFDocument.load(buffer);
      
      for (let p of doc.pages) {
        if (p.isDeleted) continue;
        
        const singlePdf = await PDFDocument.create();
        const fontCache = {};
        const [copiedPage] = await singlePdf.copyPages(currentDoc, [p.pageIndex - 1]);
        
        if (p.rotation !== 0) {
          const currentRotation = copiedPage.getRotation().angle;
          copiedPage.setRotation(degrees(currentRotation + p.rotation));
        }

        await this.addOcrLayer(singlePdf, copiedPage, doc, p, fontCache);
        
        singlePdf.addPage(copiedPage);
        const pdfBytes = await singlePdf.save();
        
        const baseName = doc.fileName.replace('.pdf', '');
        zip.file(`${counter}_${baseName}_page_${p.pageIndex}.pdf`, pdfBytes);
        counter++;
      }
    }

    await this.addExtractionWorkbook(zip, options.extractionRows);

    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, 'split_pages.zip');
  }
}
