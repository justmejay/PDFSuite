import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, degrees } from 'pdf-lib';
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
  }

  async loadFiles(files) {
    const loadedDocs = [];
    for (let file of files) {
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
      loadedDocs.push(docEntry);
    }
    return loadedDocs;
  }

  async renderPageToCanvas(docId, pageIndex, canvas) {
    const doc = this.documents.find(d => d.id === docId);
    if (!doc) return;

    const pageData = doc.pages.find(p => p.pageIndex === pageIndex);
    const page = await doc.pdfjsDoc.getPage(pageIndex);
    const viewport = page.getViewport({ scale: 1.5, rotation: page.rotate + (pageData ? pageData.rotation : 0) });
    
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
    const doc = this.documents.find(d => d.id === docId);
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
    const doc = this.documents.find(d => d.id === docId);
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
    const doc = this.documents.find(d => d.id === docId);
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
    this.globalPageCounter = 0;
  }

  // Exports all valid pages into ONE PDF
  async exportAsOne() {
    const finalPdf = await PDFDocument.create();
    
    for (let doc of this.documents) {
      // Load a fresh ArrayBuffer from the file object directly
      const buffer = await doc.file.arrayBuffer();
      const currentDoc = await PDFDocument.load(buffer);
      
      for (let p of doc.pages) {
        if (p.isDeleted) continue;
        
        const [copiedPage] = await finalPdf.copyPages(currentDoc, [p.pageIndex - 1]);
        
        // Apply user rotation
        if (p.rotation !== 0) {
          const currentRotation = copiedPage.getRotation().angle;
          copiedPage.setRotation(degrees(currentRotation + p.rotation));
        }
        
        finalPdf.addPage(copiedPage);
      }
    }

    const pdfBytes = await finalPdf.save();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    saveAs(blob, 'combined_output.pdf');
  }

  // Exports all valid pages grouped by their original file into a ZIP.
  async exportByFile() {
    const zip = new JSZip();

    for (let doc of this.documents) {
      const buffer = await doc.file.arrayBuffer();
      const currentDoc = await PDFDocument.load(buffer);
      
      const singlePdf = await PDFDocument.create();
      let addedPages = 0;
      
      for (let p of doc.pages) {
        if (p.isDeleted) continue;
        
        const [copiedPage] = await singlePdf.copyPages(currentDoc, [p.pageIndex - 1]);
        
        if (p.rotation !== 0) {
          const currentRotation = copiedPage.getRotation().angle;
          copiedPage.setRotation(degrees(currentRotation + p.rotation));
        }
        
        singlePdf.addPage(copiedPage);
        addedPages++;
      }
      
      if (addedPages > 0) {
        const pdfBytes = await singlePdf.save();
        zip.file(`modified_${doc.fileName}`, pdfBytes);
      }
    }

    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, 'modified_files.zip');
  }

  // Exports every single valid page as a separate PDF, then ZIPs it.
  async exportBurst() {
    const zip = new JSZip();
    let counter = 1;

    for (let doc of this.documents) {
      // Load a fresh ArrayBuffer from the file object directly
      const buffer = await doc.file.arrayBuffer();
      const currentDoc = await PDFDocument.load(buffer);
      
      for (let p of doc.pages) {
        if (p.isDeleted) continue;
        
        const singlePdf = await PDFDocument.create();
        const [copiedPage] = await singlePdf.copyPages(currentDoc, [p.pageIndex - 1]);
        
        if (p.rotation !== 0) {
          const currentRotation = copiedPage.getRotation().angle;
          copiedPage.setRotation(degrees(currentRotation + p.rotation));
        }
        
        singlePdf.addPage(copiedPage);
        const pdfBytes = await singlePdf.save();
        
        const baseName = doc.fileName.replace('.pdf', '');
        zip.file(`${counter}_${baseName}_page_${p.pageIndex}.pdf`, pdfBytes);
        counter++;
      }
    }

    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, 'split_pages.zip');
  }
}
