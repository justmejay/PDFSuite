import { createIcons, icons } from 'lucide';
import { PDFProcessor } from './pdf-processor.js';
import { compressLossless } from '@quicktoolsone/pdf-compress';
import { createWorker } from 'tesseract.js';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import './style.css';

// Initialize Icons
createIcons({ icons });

const processor = new PDFProcessor();

// DOM Elements
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const pagesContainer = document.getElementById('pages-container');
const selectionToolbar = document.getElementById('selection-toolbar');
const exportToolbar = document.getElementById('export-toolbar');
const loadingOverlay = document.getElementById('loading-overlay');
const pageCardTemplate = document.getElementById('page-card-template');

// Buttons
const btnAddMore = document.getElementById('btn-add-more');
const btnClearAll = document.getElementById('btn-clear-all');
const btnExportOne = document.getElementById('btn-export-one');
const btnExportByFile = document.getElementById('btn-export-by-file');
const btnExportBurst = document.getElementById('btn-export-burst');
const btnExtractBilling = document.getElementById('btn-extract-billing');
const btnRotateLeft = document.getElementById('btn-rotate-left');
const btnRotateRight = document.getElementById('btn-rotate-right');
const btnDelete = document.getElementById('btn-delete');
const btnOcrSelected = document.getElementById('btn-ocr-selected');
const btnSelectAll = document.getElementById('btn-select-all');
const btnSelectByPage = document.getElementById('btn-select-by-page');
const inputPageNum = document.getElementById('input-page-num');
const btnToggleSize = document.getElementById('btn-toggle-size');
const btnGridView = document.getElementById('btn-grid-view');

const fsModal = document.getElementById('fullscreen-modal');
const fsLabel = document.getElementById('fs-file-label');
const fsCanvas = document.getElementById('fs-canvas');
const fsTextLayer = document.getElementById('fs-text-layer');
const fsBtnClose = document.getElementById('fs-btn-close');
const fsBtnRotateLeft = document.getElementById('fs-btn-rotate-left');
const fsBtnRotateRight = document.getElementById('fs-btn-rotate-right');
const fsBtnDelete = document.getElementById('fs-btn-delete');
const fsBtnZoomIn = document.getElementById('fs-btn-zoom-in');
const fsBtnZoomOut = document.getElementById('fs-btn-zoom-out');
const fsBtnPrev = document.getElementById('fs-btn-prev');
const fsBtnNext = document.getElementById('fs-btn-next');
const fsBtnOcr = document.getElementById('fs-btn-ocr');
const fsOcrPanel = document.getElementById('fs-ocr-panel');
const fsOcrStatus = document.getElementById('fs-ocr-status');
const fsOcrOutput = document.getElementById('fs-ocr-output');
const fsBtnCopyOcr = document.getElementById('fs-btn-copy-ocr');
const fsBtnCloseOcr = document.getElementById('fs-btn-close-ocr');

// State
let selectedPages = new Set(); // Stores string: `${docId}-${pageIndex}`
let currentFsDocId = null;
let currentFsPageIndex = null;
let currentFsZoom = 1.0;
let ocrWorker = null;
let ocrWorkerPromise = null;
let activeOcrKey = null;
let ocrProgressHandler = null;
let ocrJobToken = 0;
const ocrCache = new Map();
let thumbnailObserver = null;
let thumbnailQueue = [];
let activeThumbnailRenders = 0;
const MAX_ACTIVE_THUMBNAIL_RENDERS = 2;

const waitForNextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
const publicAsset = path => `${import.meta.env.BASE_URL}${path}`.replace(/\/{2,}/g, '/');

// Drag & Drop
dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('drag-over');
});

dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('drag-over');
});

dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');
  if (e.dataTransfer.files.length > 0) {
    handleFiles(e.dataTransfer.files);
  }
});

dropzone.addEventListener('click', () => {
  fileInput.click();
});

btnAddMore.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) {
    handleFiles(e.target.files);
  }
});

async function handleFiles(files) {
  showLoading('Loading PDFs...');
  try {
    const loadedDocs = await processor.loadFiles(files, {
      onProgress: ({ current, total, fileName }) => {
        showLoading(`Loading PDFs ${current}/${total}: ${fileName}`);
      }
    });
    await updateWorkspace(loadedDocs);
  } catch (error) {
    console.error(error);
    alert('Error loading PDFs: ' + error.message);
  } finally {
    hideLoading();
    fileInput.value = ''; // Reset
  }
}

async function updateWorkspace(newDocs = []) {
  if (processor.documents.length > 0) {
    dropzone.classList.add('hidden');
    pagesContainer.classList.remove('hidden');
    exportToolbar.classList.remove('hidden');
    btnClearAll.classList.remove('hidden');
    btnSelectAll.classList.remove('hidden');
  } else {
    dropzone.classList.remove('hidden');
    pagesContainer.classList.add('hidden');
    exportToolbar.classList.add('hidden');
    btnClearAll.classList.add('hidden');
    btnSelectAll.classList.add('hidden');
  }

  const fragment = document.createDocumentFragment();

  for (let doc of newDocs) {
    for (let page of doc.pages) {
      fragment.appendChild(createPageCard(doc, page));
    }
  }

  if (fragment.childNodes.length > 0) {
    pagesContainer.appendChild(fragment);
    createIcons({
      icons,
      nameAttr: 'data-lucide',
      attrs: {
        class: 'lucide-icon'
      }
    });
    observePendingThumbnails();
    await waitForNextFrame();
  }
}

function createPageCard(doc, page) {
  const clone = pageCardTemplate.content.cloneNode(true);
  const card = clone.querySelector('.page-card');
  const canvas = clone.querySelector('.page-canvas');
  const badge = clone.querySelector('.page-number-badge');
  const fileLabel = clone.querySelector('.file-label');
  const checkbox = clone.querySelector('.page-select-checkbox');
  const deleteOverlay = clone.querySelector('.delete-overlay');
  
  const pageId = `${doc.id}-${page.pageIndex}`;
  card.dataset.id = pageId;
  card.dataset.docId = doc.id;
  card.dataset.pageIndex = page.pageIndex;
  
  badge.textContent = page.pageIndex;
  fileLabel.textContent = doc.fileName;

  card.dataset.thumbnailState = 'pending';
  canvas.width = 120;
  canvas.height = 170;

  // Interactions
  card.addEventListener('click', (e) => {
    const miniBtn = e.target.closest('.mini-btn');
    if (miniBtn) {
      e.stopPropagation();
      performActionOnCard(card, miniBtn.dataset.action);
      return;
    }

    // If clicking directly on checkbox, let it bubble but handle selection state
    if (e.target.tagName !== 'INPUT') {
      checkbox.checked = !checkbox.checked;
    }
    toggleSelection(pageId, checkbox.checked, card);
  });

  checkbox.addEventListener('change', (e) => {
    toggleSelection(pageId, e.target.checked, card);
  });

  return clone;
}

function ensureThumbnailObserver() {
  if (thumbnailObserver) return thumbnailObserver;

  thumbnailObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const card = entry.target;
      thumbnailObserver.unobserve(card);
      queueThumbnailRender(card);
    }
  }, {
    root: pagesContainer,
    rootMargin: '900px 0px',
    threshold: 0.01
  });

  return thumbnailObserver;
}

function observePendingThumbnails() {
  const observer = ensureThumbnailObserver();
  pagesContainer.querySelectorAll('.page-card[data-thumbnail-state="pending"]').forEach(card => {
    observer.observe(card);
  });
}

function queueThumbnailRender(card) {
  if (!card || card.dataset.thumbnailState !== 'pending') return;

  card.dataset.thumbnailState = 'queued';
  thumbnailQueue.push(card);
  processThumbnailQueue();
}

function processThumbnailQueue() {
  while (activeThumbnailRenders < MAX_ACTIVE_THUMBNAIL_RENDERS && thumbnailQueue.length > 0) {
    const card = thumbnailQueue.shift();
    if (!card || !card.isConnected || card.dataset.thumbnailState === 'rendered') continue;

    activeThumbnailRenders++;
    renderThumbnail(card).finally(() => {
      activeThumbnailRenders--;
      requestAnimationFrame(processThumbnailQueue);
    });
  }
}

async function renderThumbnail(card) {
  const docId = card.dataset.docId;
  const pageIndex = parseInt(card.dataset.pageIndex, 10);
  const canvas = card.querySelector('.page-canvas');
  if (!docId || !pageIndex || !canvas) return;

  card.dataset.thumbnailState = 'rendering';
  try {
    const viewport = await processor.renderPageToCanvas(docId, pageIndex, canvas);
    if (!card.isConnected) return;

    if (viewport && viewport.width > viewport.height) {
      card.classList.add('landscape');
    } else {
      card.classList.remove('landscape');
    }
    card.dataset.thumbnailState = 'rendered';
  } catch (err) {
    card.dataset.thumbnailState = 'pending';
    console.error(err);
  }
}

function toggleSelection(pageId, isSelected, card, shouldUpdateToolbar = true) {
  if (isSelected) {
    selectedPages.add(pageId);
    card.classList.add('selected');
  } else {
    selectedPages.delete(pageId);
    card.classList.remove('selected');
  }
  if (shouldUpdateToolbar) {
    updateSelectionToolbar();
  }
}

function updateSelectionToolbar() {
  if (selectedPages.size > 0) {
    selectionToolbar.classList.remove('hidden');
  } else {
    selectionToolbar.classList.add('hidden');
  }
}

btnSelectAll.addEventListener('click', () => {
  const allCards = document.querySelectorAll('.page-card');
  if (allCards.length === 0) return;
  
  const allSelected = selectedPages.size === allCards.length;
  
  allCards.forEach(card => {
    const pageId = card.dataset.id;
    const checkbox = card.querySelector('.page-select-checkbox');
    checkbox.checked = !allSelected;
    toggleSelection(pageId, !allSelected, card, false);
  });
  updateSelectionToolbar();
  
  btnSelectAll.querySelector('span').textContent = allSelected ? 'Select All' : 'Deselect All';
});

btnSelectByPage.addEventListener('click', () => {
  const targetPage = parseInt(inputPageNum.value, 10);
  if (!targetPage || targetPage < 1) return;

  // Collect all cards matching that 1-based page position within each file
  // pageIndex is 1-based (pdf.js), so page 2 means pageIndex === 2
  const allCards = document.querySelectorAll('.page-card');
  let matched = 0;

  allCards.forEach(card => {
    const pageIndex = parseInt(card.dataset.pageIndex, 10);
    if (pageIndex === targetPage) {
      matched++;
      const checkbox = card.querySelector('.page-select-checkbox');
      checkbox.checked = true;
      toggleSelection(card.dataset.id, true, card, false);
    }
  });
  updateSelectionToolbar();

  if (matched === 0) {
    // Flash the input red briefly to signal no results
    inputPageNum.style.borderColor = '#ef4444';
    setTimeout(() => inputPageNum.style.borderColor = '', 1000);
  }
});

let isLargePreview = false;
btnToggleSize.addEventListener('click', () => {
  isLargePreview = !isLargePreview;
  if (isLargePreview) {
    pagesContainer.classList.add('large-preview');
    btnToggleSize.innerHTML = '<i data-lucide="zoom-out"></i>';
    btnToggleSize.classList.add('active');
  } else {
    pagesContainer.classList.remove('large-preview');
    btnToggleSize.innerHTML = '<i data-lucide="zoom-in"></i>';
    btnToggleSize.classList.remove('active');
  }
  createIcons({
    icons,
    nameAttr: 'data-lucide',
    attrs: { class: 'lucide-icon' }
  });
});

let isGridView = true;
btnGridView.addEventListener('click', () => {
  isGridView = !isGridView;
  if (isGridView) {
    pagesContainer.classList.remove('list-preview');
    btnGridView.innerHTML = '<i data-lucide="list"></i>';
    btnGridView.title = 'List View';
    btnGridView.classList.add('active');
  } else {
    pagesContainer.classList.add('list-preview');
    btnGridView.innerHTML = '<i data-lucide="grid"></i>';
    btnGridView.title = 'Grid View';
    btnGridView.classList.remove('active');
  }
  createIcons({
    icons,
    nameAttr: 'data-lucide',
    attrs: { class: 'lucide-icon' }
  });
});

// Actions
btnRotateLeft.addEventListener('click', () => applyActionToSelected('rotate-left'));
btnRotateRight.addEventListener('click', () => applyActionToSelected('rotate-right'));
btnDelete.addEventListener('click', () => applyActionToSelected('toggle-delete'));
btnOcrSelected.addEventListener('click', runOcrForSelectedPages);

async function openFullscreen(docId, pageIndex) {
  const doc = processor.getDocument(docId);
  if (!doc) return;
  
  currentFsDocId = docId;
  currentFsPageIndex = pageIndex;
  currentFsZoom = 1.0;
  activeOcrKey = getOcrKey(docId, pageIndex);
  ocrJobToken++;
  
  fsLabel.textContent = `${doc.fileName} - Page ${pageIndex}`;
  fsModal.classList.remove('hidden');
  syncOcrPanelForCurrentPage();
  
  const isDeleted = doc.pages.find(p => p.pageIndex === pageIndex).isDeleted;
  if (isDeleted) {
      fsBtnDelete.innerHTML = '<i data-lucide="rotate-ccw"></i>';
      fsBtnDelete.classList.remove('danger');
  } else {
      fsBtnDelete.innerHTML = '<i data-lucide="trash-2"></i>';
      fsBtnDelete.classList.add('danger');
  }
  createIcons({ icons, nameAttr: 'data-lucide', attrs: { class: 'lucide-icon' } });
  
  await processor.renderFullscreenPage(docId, pageIndex, fsCanvas, fsTextLayer, currentFsZoom);
  applyCachedOcrOverlay();
  updateFullscreenNavButtons();
}

async function renderFullscreenCurrentPage() {
  await processor.renderFullscreenPage(currentFsDocId, currentFsPageIndex, fsCanvas, fsTextLayer, currentFsZoom);
  applyCachedOcrOverlay();
}

function getFlatPageList() {
  const list = [];
  processor.documents.forEach(doc => {
    doc.pages.forEach(p => {
      list.push({ docId: doc.id, pageIndex: p.pageIndex });
    });
  });
  return list;
}

function updateFullscreenNavButtons() {
    const list = getFlatPageList();
    const idx = list.findIndex(item => item.docId === currentFsDocId && item.pageIndex === currentFsPageIndex);
    fsBtnPrev.disabled = idx <= 0;
    fsBtnNext.disabled = idx >= list.length - 1 || idx === -1;
}

function cleanExtractedValue(value = '') {
  return value
    .replace(/\s+/g, ' ')
    .replace(/^[\s:,-]+|[\s:,-]+$/g, '')
    .trim();
}

function parseBillingFields(text = '') {
  const normalized = text
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
  const flat = normalized.replace(/\s+/g, ' ');

  const accountMatch = flat.match(/\baccount\s*(?:number|#|no\.?)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9-]{4,})/i);
  const serviceMatch = flat.match(/service\s+delivered\s+to\s*[:\-]?\s*(.*?)(?=\s+(?:current\s+balance\s+due|due\s+upon|your\s+bill|account\b|page\s+\d+\s+of\s+\d+)|$)/i);
  const balanceMatch = flat.match(/current\s+balance\s+due\s*[:\-]?\s*\$?\s*([0-9][0-9,]*\.\d{2})/i)
    || flat.match(/total\s+amount\s+due\s*[:\-]?\s*\$?\s*([0-9][0-9,]*\.\d{2})/i);

  return {
    account: cleanExtractedValue(accountMatch?.[1] || ''),
    serviceDeliveredTo: cleanExtractedValue(serviceMatch?.[1] || ''),
    currentBalanceDue: balanceMatch?.[1] ? `$${balanceMatch[1]}` : ''
  };
}

function hasRequestedFields(fields) {
  return Boolean(fields.account && fields.serviceDeliveredTo && fields.currentBalanceDue);
}

function mergeBillingFields(current, next) {
  return {
    account: current.account || next.account || '',
    serviceDeliveredTo: current.serviceDeliveredTo || next.serviceDeliveredTo || '',
    currentBalanceDue: current.currentBalanceDue || next.currentBalanceDue || ''
  };
}

function getExtractionGroups(useSelection = false) {
  const selectedByDoc = new Map();

  if (useSelection && selectedPages.size > 0) {
    document.querySelectorAll('.page-card').forEach(card => {
      if (!selectedPages.has(card.dataset.id)) return;
      const pageIndex = parseInt(card.dataset.pageIndex, 10);
      if (!selectedByDoc.has(card.dataset.docId)) selectedByDoc.set(card.dataset.docId, new Set());
      selectedByDoc.get(card.dataset.docId).add(pageIndex);
    });
  }

  return processor.documents.map(doc => {
    const selectedSet = selectedByDoc.get(doc.id);
    const pages = doc.pages
      .filter(page => !page.isDeleted)
      .filter(page => !selectedSet || selectedSet.has(page.pageIndex));

    return { doc, pages };
  }).filter(group => group.pages.length > 0);
}

async function getTextForExtractionPage(doc, page, label, forceOcr = false) {
  if (!forceOcr) {
    const embeddedText = await processor.extractPageText(doc.id, page.pageIndex);
    if (embeddedText.length > 40) {
      return { text: embeddedText, usedOcr: false };
    }
  }

  const ocrResult = await recognizePageOcr(doc.id, page.pageIndex, {
    onProgress: message => {
      if (message.status === 'recognizing text') {
        showLoading(`${label}: OCR ${Math.round((message.progress || 0) * 100)}%`);
      }
    }
  });

  return { text: ocrResult?.text || '', usedOcr: true };
}

async function extractBillingRows(options = {}) {
  const groups = getExtractionGroups(Boolean(options.useSelection));
  const rows = [];

  for (let docIndex = 0; docIndex < groups.length; docIndex++) {
    const { doc, pages } = groups[docIndex];
    let fields = { account: '', serviceDeliveredTo: '', currentBalanceDue: '' };
    const pagesNeedingOcr = [];

    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const page = pages[pageIndex];
      const label = `Extract ${docIndex + 1}/${groups.length} ${doc.fileName} p.${page.pageIndex}`;
      showLoading(label);

      const { text, usedOcr } = await getTextForExtractionPage(doc, page, label);
      fields = mergeBillingFields(fields, parseBillingFields(text));
      if (!usedOcr) pagesNeedingOcr.push(page);
      if (hasRequestedFields(fields)) break;
      await waitForNextFrame();
    }

    if (!hasRequestedFields(fields)) {
      for (const page of pagesNeedingOcr) {
        const label = `Extract ${docIndex + 1}/${groups.length} ${doc.fileName} p.${page.pageIndex}`;
        const { text } = await getTextForExtractionPage(doc, page, label, true);
        fields = mergeBillingFields(fields, parseBillingFields(text));
        if (hasRequestedFields(fields)) break;
        await waitForNextFrame();
      }
    }

    rows.push({
      fileName: doc.fileName,
      ...fields
    });
  }

  return rows;
}

fsBtnClose.addEventListener('click', () => {
  fsModal.classList.add('hidden');
  currentFsDocId = null;
  currentFsPageIndex = null;
  activeOcrKey = null;
  ocrJobToken++;
});

fsBtnZoomIn.addEventListener('click', () => {
    currentFsZoom += 0.25;
    if (currentFsZoom > 3.0) currentFsZoom = 3.0; // max zoom limit
    renderFullscreenCurrentPage();
});

fsBtnZoomOut.addEventListener('click', () => {
    currentFsZoom -= 0.25;
    if (currentFsZoom < 0.25) currentFsZoom = 0.25;
    renderFullscreenCurrentPage();
});

fsBtnPrev.addEventListener('click', () => {
    const list = getFlatPageList();
    const idx = list.findIndex(item => item.docId === currentFsDocId && item.pageIndex === currentFsPageIndex);
    if (idx > 0) {
        openFullscreen(list[idx - 1].docId, list[idx - 1].pageIndex);
    }
});

fsBtnNext.addEventListener('click', () => {
    const list = getFlatPageList();
    const idx = list.findIndex(item => item.docId === currentFsDocId && item.pageIndex === currentFsPageIndex);
    if (idx < list.length - 1 && idx !== -1) {
        openFullscreen(list[idx + 1].docId, list[idx + 1].pageIndex);
    }
});

function getOcrKey(docId, pageIndex) {
  const doc = processor.getDocument(docId);
  const page = doc?.pages.find(p => p.pageIndex === pageIndex);
  return processor.getOcrKey(docId, pageIndex, page?.rotation || 0);
}

function setOcrPanelState(status, text = '') {
  fsOcrPanel.classList.remove('hidden');
  fsOcrStatus.textContent = status;
  fsOcrOutput.value = text;
}

function syncOcrPanelForCurrentPage() {
  if (fsOcrPanel.classList.contains('hidden')) return;

  const cached = ocrCache.get(activeOcrKey);
  if (cached) {
    setOcrPanelState('OCR text', cached.text);
  } else {
    setOcrPanelState('OCR', '');
  }
}

function getOcrBox(item) {
  if (!item) return null;
  const box = item.bbox || item.box;
  if (!box) return null;

  if (Number.isFinite(box.x0)) {
    return {
      x0: box.x0,
      y0: box.y0,
      x1: box.x1,
      y1: box.y1
    };
  }

  if (Number.isFinite(box.left)) {
    return {
      x0: box.left,
      y0: box.top,
      x1: box.left + box.width,
      y1: box.top + box.height
    };
  }

  return null;
}

function collectOcrWords(items = [], words = []) {
  for (const item of items || []) {
    const childCount = (item.words?.length || 0)
      + (item.lines?.length || 0)
      + (item.paragraphs?.length || 0)
      + (item.blocks?.length || 0);

    if (childCount > 0) {
      collectOcrWords(item.words, words);
      collectOcrWords(item.lines, words);
      collectOcrWords(item.paragraphs, words);
      collectOcrWords(item.blocks, words);
      continue;
    }

    const text = (item.text || '').trim();
    const box = getOcrBox(item);

    if (text && box) {
      words.push({ text, box, confidence: item.confidence ?? item.conf ?? 100 });
    }
  }

  return words;
}

function applyOcrOverlay(ocrResult) {
  fsTextLayer.querySelectorAll('.ocr-text-span').forEach(span => span.remove());
  if (!ocrResult?.words?.length || !ocrResult.imageWidth || !ocrResult.imageHeight) return;

  const scaleX = fsCanvas.width / ocrResult.imageWidth;
  const scaleY = fsCanvas.height / ocrResult.imageHeight;
  const fragment = document.createDocumentFragment();

  for (const word of ocrResult.words) {
    const { x0, y0, x1, y1 } = word.box;
    const width = Math.max((x1 - x0) * scaleX, 1);
    const height = Math.max((y1 - y0) * scaleY, 1);

    const span = document.createElement('span');
    span.className = 'ocr-text-span';
    span.textContent = `${word.text} `;
    span.style.left = `${x0 * scaleX}px`;
    span.style.top = `${y0 * scaleY}px`;
    span.style.width = `${width}px`;
    span.style.height = `${height}px`;
    span.style.fontSize = `${Math.max(height * 0.82, 6)}px`;
    fragment.appendChild(span);
  }

  fsTextLayer.appendChild(fragment);
}

function applyCachedOcrOverlay() {
  const cached = ocrCache.get(activeOcrKey);
  if (cached) {
    applyOcrOverlay(cached);
  }
}

async function getOcrWorker() {
  if (ocrWorker) return ocrWorker;

  if (!ocrWorkerPromise) {
    ocrWorkerPromise = createWorker('eng', 1, {
      workerPath: publicAsset('tesseract/worker.min.js'),
      corePath: publicAsset('tesseract/core'),
      langPath: publicAsset('tesseract/lang'),
      logger: message => {
        if (!message?.status) return;

        if (ocrProgressHandler) {
          ocrProgressHandler(message);
        }

        if (activeOcrKey !== getOcrKey(currentFsDocId, currentFsPageIndex)) return;
        if (message.status === 'recognizing text') {
          const percent = Math.round((message.progress || 0) * 100);
          fsOcrStatus.textContent = `OCR ${percent}%`;
        } else if (message.status !== 'loading tesseract core') {
          fsOcrStatus.textContent = message.status.replace(/\b\w/g, char => char.toUpperCase());
        }
      }
    }).then(worker => {
      ocrWorker = worker;
      return worker;
    }).catch(error => {
      ocrWorkerPromise = null;
      throw error;
    });
  }

  return ocrWorkerPromise;
}

async function renderCurrentPageForOcr() {
  const canvas = document.createElement('canvas');
  await processor.renderPageToCanvas(currentFsDocId, currentFsPageIndex, canvas, { scale: 2.4 });
  return canvas;
}

async function recognizePageOcr(docId, pageIndex, options = {}) {
  const doc = processor.getDocument(docId);
  const page = doc?.pages.find(p => p.pageIndex === pageIndex);
  if (!doc || !page) return null;

  const rotation = page.rotation || 0;
  const jobKey = processor.getOcrKey(docId, pageIndex, rotation);
  const cached = ocrCache.get(jobKey);
  if (cached) {
    return cached;
  }

  const previousProgressHandler = ocrProgressHandler;
  ocrProgressHandler = options.onProgress || null;

  try {
    const worker = await getOcrWorker();
    const canvas = document.createElement('canvas');
    await processor.renderPageToCanvas(docId, pageIndex, canvas, { scale: 2.4 });

    const result = await worker.recognize(canvas, {}, { text: true, blocks: true });

    const text = result.data.text.trim();
    const output = text || 'No text recognized on this page.';
    const ocrResult = {
      text: output,
      words: collectOcrWords(result.data.blocks),
      imageWidth: canvas.width,
      imageHeight: canvas.height
    };
    ocrCache.set(jobKey, ocrResult);
    processor.setOcrResult(docId, pageIndex, rotation, ocrResult);
    return ocrResult;
  } finally {
    ocrProgressHandler = previousProgressHandler;
  }
}

async function runOcrForCurrentPage() {
  if (!currentFsDocId || !currentFsPageIndex || fsBtnOcr.disabled) return;

  const jobKey = getOcrKey(currentFsDocId, currentFsPageIndex);
  activeOcrKey = jobKey;
  const token = ++ocrJobToken;
  fsBtnOcr.disabled = true;
  setOcrPanelState('Preparing OCR...', '');

  try {
    const ocrResult = await recognizePageOcr(currentFsDocId, currentFsPageIndex, {
      onProgress: message => {
        if (token !== ocrJobToken || jobKey !== activeOcrKey) return;
        if (message.status === 'recognizing text') {
          setOcrPanelState(`OCR ${Math.round((message.progress || 0) * 100)}%`, fsOcrOutput.value);
        }
      }
    });
    if (token !== ocrJobToken || jobKey !== activeOcrKey || !ocrResult) return;

    setOcrPanelState('OCR text', ocrResult.text);
    applyOcrOverlay(ocrResult);
  } catch (error) {
    console.error(error);
    setOcrPanelState('OCR failed', error.message || 'Unable to recognize text.');
  } finally {
    fsBtnOcr.disabled = false;
  }
}

async function runOcrForSelectedPages() {
  if (selectedPages.size === 0 || btnOcrSelected.disabled) return;

  const selectedCards = Array.from(document.querySelectorAll('.page-card'))
    .filter(card => selectedPages.has(card.dataset.id));
  if (selectedCards.length === 0) return;

  btnOcrSelected.disabled = true;
  fsBtnOcr.disabled = true;

  try {
    for (let index = 0; index < selectedCards.length; index++) {
      const card = selectedCards[index];
      const docId = card.dataset.docId;
      const pageIndex = parseInt(card.dataset.pageIndex, 10);
      const label = `${index + 1}/${selectedCards.length}`;

      showLoading(`OCR ${label}: page ${pageIndex}`);
      const ocrResult = await recognizePageOcr(docId, pageIndex, {
        onProgress: message => {
          if (message.status === 'recognizing text') {
            showLoading(`OCR ${label}: ${Math.round((message.progress || 0) * 100)}%`);
          }
        }
      });

      if (ocrResult && docId === currentFsDocId && pageIndex === currentFsPageIndex) {
        activeOcrKey = getOcrKey(docId, pageIndex);
        setOcrPanelState('OCR text', ocrResult.text);
        applyOcrOverlay(ocrResult);
      }

      await waitForNextFrame();
    }
  } catch (error) {
    console.error(error);
    alert('Error running OCR: ' + error.message);
  } finally {
    hideLoading();
    btnOcrSelected.disabled = false;
    fsBtnOcr.disabled = false;
  }
}

fsBtnOcr.addEventListener('click', runOcrForCurrentPage);

fsBtnCloseOcr.addEventListener('click', () => {
  fsOcrPanel.classList.add('hidden');
});

fsBtnCopyOcr.addEventListener('click', async () => {
  const text = fsOcrOutput.value;
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    fsOcrStatus.textContent = 'Copied';
  } catch (error) {
    fsOcrOutput.select();
    document.execCommand('copy');
    fsOcrStatus.textContent = 'Copied';
  }
});

fsBtnRotateLeft.addEventListener('click', () => {
    processor.rotatePage(currentFsDocId, currentFsPageIndex, 'left');
    activeOcrKey = getOcrKey(currentFsDocId, currentFsPageIndex);
    ocrJobToken++;
    syncOcrPanelForCurrentPage();
    renderFullscreenCurrentPage();
    
    const card = document.querySelector(`.page-card[data-doc-id="${currentFsDocId}"][data-page-index="${currentFsPageIndex}"]`);
    if(card) {
      const origCanvas = card.querySelector('.page-canvas');
      processor.renderPageToCanvas(currentFsDocId, currentFsPageIndex, origCanvas).then(vp => {
        if(vp && vp.width > vp.height) card.classList.add('landscape');
        else card.classList.remove('landscape');
      });
    }
});

fsBtnRotateRight.addEventListener('click', () => {
    processor.rotatePage(currentFsDocId, currentFsPageIndex, 'right');
    activeOcrKey = getOcrKey(currentFsDocId, currentFsPageIndex);
    ocrJobToken++;
    syncOcrPanelForCurrentPage();
    renderFullscreenCurrentPage();
    
    const card = document.querySelector(`.page-card[data-doc-id="${currentFsDocId}"][data-page-index="${currentFsPageIndex}"]`);
    if(card) {
      const origCanvas = card.querySelector('.page-canvas');
      processor.renderPageToCanvas(currentFsDocId, currentFsPageIndex, origCanvas).then(vp => {
        if(vp && vp.width > vp.height) card.classList.add('landscape');
        else card.classList.remove('landscape');
      });
    }
});

fsBtnDelete.addEventListener('click', () => {
    const isDeleted = processor.togglePageDeletion(currentFsDocId, currentFsPageIndex);
    const card = document.querySelector(`.page-card[data-doc-id="${currentFsDocId}"][data-page-index="${currentFsPageIndex}"]`);
    if(card) {
        if (isDeleted) {
          card.classList.add('deleted');
          card.querySelector('.delete-overlay').classList.remove('hidden');
          fsBtnDelete.innerHTML = '<i data-lucide="rotate-ccw"></i>';
          fsBtnDelete.classList.remove('danger');
        } else {
          card.classList.remove('deleted');
          card.querySelector('.delete-overlay').classList.add('hidden');
          fsBtnDelete.innerHTML = '<i data-lucide="trash-2"></i>';
          fsBtnDelete.classList.add('danger');
        }
        createIcons({ icons, nameAttr: 'data-lucide', attrs: { class: 'lucide-icon' } });
    }
});

function performActionOnCard(card, action) {
  const docId = card.dataset.docId;
  const pageIndex = parseInt(card.dataset.pageIndex, 10);
  const canvas = card.querySelector('.page-canvas');
  const deleteOverlay = card.querySelector('.delete-overlay');

  if (action === 'view-fullscreen') {
      openFullscreen(docId, pageIndex);
  }
  else if (action === 'rotate-left') {
    processor.rotatePage(docId, pageIndex, 'left');
    canvas.style.transform = 'rotate(-90deg) scale(0.85)';
    setTimeout(() => {
      processor.renderPageToCanvas(docId, pageIndex, canvas).then(vp => {
        canvas.style.transition = 'none';
        canvas.style.transform = 'none';
        if (vp && vp.width > vp.height) card.classList.add('landscape');
        else card.classList.remove('landscape');
        setTimeout(() => canvas.style.transition = '', 30);
      });
    }, 300);
  } 
  else if (action === 'rotate-right') {
    processor.rotatePage(docId, pageIndex, 'right');
    canvas.style.transform = 'rotate(90deg) scale(0.85)';
    setTimeout(() => {
      processor.renderPageToCanvas(docId, pageIndex, canvas).then(vp => {
        canvas.style.transition = 'none';
        canvas.style.transform = 'none';
        if (vp && vp.width > vp.height) card.classList.add('landscape');
        else card.classList.remove('landscape');
        setTimeout(() => canvas.style.transition = '', 30);
      });
    }, 300);
  }
  else if (action === 'toggle-delete') {
    const isDeleted = processor.togglePageDeletion(docId, pageIndex);
    if (isDeleted) {
      card.classList.add('deleted');
      deleteOverlay.classList.remove('hidden');
    } else {
      card.classList.remove('deleted');
      deleteOverlay.classList.add('hidden');
    }
  }
}

function applyActionToSelected(action) {
  if (action === 'toggle-delete') {
    selectedPages.forEach(pageId => {
      const card = document.querySelector(`.page-card[data-id="${pageId}"]`);
      if (card) performActionOnCard(card, action);
    });
    return;
  }

  selectedPages.forEach(pageId => {
    const card = document.querySelector(`.page-card[data-id="${pageId}"]`);
    if (!card) return;

    const docId = card.dataset.docId;
    const pageIndex = parseInt(card.dataset.pageIndex, 10);
    processor.rotatePage(docId, pageIndex, action === 'rotate-left' ? 'left' : 'right');
    card.dataset.thumbnailState = 'pending';
  });

  observePendingThumbnails();
}

btnClearAll.addEventListener('click', () => {
  processor.clear();
  pagesContainer.innerHTML = '';
  thumbnailQueue = [];
  activeThumbnailRenders = 0;
  ocrCache.clear();
  ocrJobToken++;
  activeOcrKey = null;
  if (thumbnailObserver) {
    thumbnailObserver.disconnect();
  }
  selectedPages.clear();
  updateSelectionToolbar();
  updateWorkspace();
});

btnExportOne.addEventListener('click', async () => {
  showLoading('Generating Document...');
  try {
    await processor.exportAsOne();
  } catch (error) {
    console.error(error);
    alert('Error exporting PDF: ' + error.message);
  } finally {
    hideLoading();
  }
});

btnExportByFile.addEventListener('click', async () => {
  showLoading('Generating Zipped Documents...');
  try {
    const extractionRows = await extractBillingRows({ useSelection: false });
    showLoading('Generating Zipped Documents...');
    await processor.exportByFile({ extractionRows });
  } catch (error) {
    console.error(error);
    alert('Error exporting ZIP: ' + error.message);
  } finally {
    hideLoading();
  }
});

btnExportBurst.addEventListener('click', async () => {
  showLoading('Generating Split ZIP...');
  try {
    const extractionRows = await extractBillingRows({ useSelection: false });
    showLoading('Generating Split ZIP...');
    await processor.exportBurst({ extractionRows });
  } catch (error) {
    console.error(error);
    alert('Error exporting ZIP: ' + error.message);
  } finally {
    hideLoading();
  }
});

btnExtractBilling.addEventListener('click', async () => {
  showLoading('Extracting billing fields...');
  try {
    const extractionRows = await extractBillingRows({ useSelection: true });
    const workbook = await processor.buildExtractionWorkbook(extractionRows);
    saveAs(workbook, 'billing_extract.xlsx');
  } catch (error) {
    console.error(error);
    alert('Error extracting billing fields: ' + error.message);
  } finally {
    hideLoading();
  }
});

function showLoading(text) {
  document.getElementById('loading-text').textContent = text;
  loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
  loadingOverlay.classList.add('hidden');
}

// ─────────────────────────────────────────────
// Nav Switching
// ─────────────────────────────────────────────
const navBtnOrganize = document.getElementById('nav-btn-organize');
const navItemOrganize = document.getElementById('nav-item-organize');
const navBtnCompress = document.getElementById('nav-btn-compress');
const navItemCompress = document.getElementById('nav-item-compress');
const navBtnMsDownloader = document.getElementById('nav-btn-ms-downloader');
const navItemMsDownloader = document.getElementById('nav-item-ms-downloader');
const workspaceOrganize = document.getElementById('workspace-organize');
const workspaceCompress = document.getElementById('workspace-compress');
const workspaceMsDownloader = document.getElementById('workspace-ms-downloader');
const sidebarOrganize = document.getElementById('sidebar-organize');
const sidebarCompress = document.getElementById('sidebar-compress');
const sidebarMsDownloader = document.getElementById('sidebar-ms-downloader');

function switchToOrganize() {
  navItemOrganize.classList.add('active');
  navItemCompress.classList.remove('active');
  navItemMsDownloader.classList.remove('active');
  workspaceOrganize.classList.remove('hidden');
  workspaceCompress.classList.add('hidden');
  workspaceMsDownloader.classList.add('hidden');
  sidebarOrganize.classList.remove('hidden');
  sidebarCompress.classList.add('hidden');
  sidebarMsDownloader.classList.add('hidden');
}

function switchToCompress() {
  navItemCompress.classList.add('active');
  navItemOrganize.classList.remove('active');
  navItemMsDownloader.classList.remove('active');
  workspaceCompress.classList.remove('hidden');
  workspaceOrganize.classList.add('hidden');
  workspaceMsDownloader.classList.add('hidden');
  sidebarCompress.classList.remove('hidden');
  sidebarOrganize.classList.add('hidden');
  sidebarMsDownloader.classList.add('hidden');
}

function switchToMsDownloader() {
  navItemMsDownloader.classList.add('active');
  navItemOrganize.classList.remove('active');
  navItemCompress.classList.remove('active');
  workspaceMsDownloader.classList.remove('hidden');
  workspaceOrganize.classList.add('hidden');
  workspaceCompress.classList.add('hidden');
  sidebarMsDownloader.classList.remove('hidden');
  sidebarOrganize.classList.add('hidden');
  sidebarCompress.classList.add('hidden');
}

navBtnOrganize.addEventListener('click', switchToOrganize);
navBtnCompress.addEventListener('click', switchToCompress);
navBtnMsDownloader.addEventListener('click', switchToMsDownloader);

// ─────────────────────────────────────────────
// Compress PDF Module
// ─────────────────────────────────────────────

// MS Downloader Module
const msDownloaderForm = document.getElementById('ms-downloader-form');
const msDownloadUrl = document.getElementById('ms-download-url');
const msDownloadName = document.getElementById('ms-download-name');
const msDownloadFolder = document.getElementById('ms-download-folder');
const btnMsSelectFolder = document.getElementById('btn-ms-select-folder');
const btnMsRun = document.getElementById('btn-ms-run');
const msCommandOutput = document.getElementById('ms-command-output');
const msProgressWrap = document.getElementById('ms-progress-wrap');
const msProgressFill = document.getElementById('ms-progress-fill');
const msProgressValue = document.getElementById('ms-progress-value');
const msProgressStatus = document.getElementById('ms-progress-status');

let msDestinationPath = '';
let msDestinationHandle = null;

function sanitizeVideoName(name) {
  return name.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/\.+$/g, '') || 'video';
}

function buildMsOutputPath() {
  const safeName = sanitizeVideoName(msDownloadName.value);
  const folder = msDestinationPath || 'path';
  const separator = folder.endsWith('\\') || folder.endsWith('/') ? '' : '\\';
  return `${folder}${separator}${safeName}.mp4`;
}

function updateMsCommandPreview() {
  const url = msDownloadUrl.value.trim() || 'Inputted URL';
  msCommandOutput.textContent = `ffmpeg -i "${url}" -codec copy "${buildMsOutputPath()}"`;
}

function setMsProgress(percent, status = 'Processing download...') {
  const normalized = Math.max(0, Math.min(100, Number(percent) || 0));
  msProgressFill.style.width = `${normalized}%`;
  msProgressValue.textContent = `${Math.round(normalized)}%`;
  msProgressStatus.textContent = status;
}

async function selectMsDestinationViaLocalApi() {
  const response = await fetch('/api/ms-select-folder', { method: 'POST' });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || 'Folder picker failed.');
  }
  return result.path;
}

async function selectMsDestinationFolder() {
  try {
    if (window.msDownloader?.selectFolder) {
      const result = await window.msDownloader.selectFolder();
      const selectedPath = typeof result === 'string' ? result : result?.path;
      if (!selectedPath) return;
      msDestinationPath = selectedPath;
      msDestinationHandle = null;
      msDownloadFolder.value = selectedPath;
      updateMsCommandPreview();
      return;
    }

    try {
      const selectedPath = await selectMsDestinationViaLocalApi();
      if (!selectedPath) return;
      msDestinationPath = selectedPath;
      msDestinationHandle = null;
      msDownloadFolder.value = selectedPath;
      updateMsCommandPreview();
      return;
    } catch (localApiError) {
      console.warn('Local folder picker API is unavailable:', localApiError);
    }

    if (window.showDirectoryPicker) {
      msDestinationHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      msDestinationPath = msDestinationHandle.name;
      msDownloadFolder.value = msDestinationHandle.name;
      updateMsCommandPreview();
      return;
    }

    alert('Folder selection is not available in this browser. Run this app in a desktop shell with an MS Downloader bridge.');
  } catch (error) {
    if (error?.name === 'AbortError') return;
    alert('Error selecting folder: ' + error.message);
  }
}

async function runMsDownloaderViaLocalApi(request) {
  const response = await fetch('/api/ms-download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok || !response.body) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || 'Download failed.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.error) {
        throw new Error(event.error);
      }
      setMsProgress(event.percent ?? 50, event.status ?? 'Processing download...');
    }

    if (done) break;
  }
}

async function runMsDownloader(event) {
  event.preventDefault();

  const url = msDownloadUrl.value.trim();
  const videoName = sanitizeVideoName(msDownloadName.value);

  if (!url || !videoName || !msDestinationPath) {
    alert('Please enter a URL, video name, and destination folder.');
    return;
  }

  const outputPath = buildMsOutputPath();
  const request = {
    url,
    videoName,
    destinationFolder: msDestinationPath,
    outputPath,
    command: `ffmpeg -i "${url}" -codec copy "${outputPath}"`
  };

  btnMsRun.disabled = true;
  btnMsSelectFolder.disabled = true;
  msProgressWrap.classList.remove('hidden');
  msProgressWrap.classList.add('is-active');
  setMsProgress(5, 'Starting ffmpeg...');

  try {
    const progressHandler = (progress) => {
      if (typeof progress === 'number') {
        setMsProgress(progress);
        return;
      }
      setMsProgress(progress?.percent ?? 50, progress?.status ?? 'Processing download...');
    };

    if (window.msDownloader?.download) {
      await window.msDownloader.download(request, progressHandler);
    } else {
      await runMsDownloaderViaLocalApi(request);
    }

    msProgressWrap.classList.remove('is-active');
    setMsProgress(100, 'Download complete');
  } catch (error) {
    msProgressWrap.classList.remove('is-active');
    setMsProgress(0, 'Download failed');
    alert('MS Downloader error: ' + (error?.message || error));
  } finally {
    btnMsRun.disabled = false;
    btnMsSelectFolder.disabled = false;
  }
}

btnMsSelectFolder.addEventListener('click', selectMsDestinationFolder);
msDownloaderForm.addEventListener('submit', runMsDownloader);
msDownloadUrl.addEventListener('input', updateMsCommandPreview);
msDownloadName.addEventListener('input', updateMsCommandPreview);
updateMsCommandPreview();

const compressDropzone = document.getElementById('compress-dropzone');
const compressFileInput = document.getElementById('compress-file-input');
const compressFileList = document.getElementById('compress-file-list');
const compressActionsToolbar = document.getElementById('compress-actions-toolbar');
const btnCompressRun = document.getElementById('btn-compress-run');
const btnCompressDownloadAll = document.getElementById('btn-compress-download-all');
const btnCompressAdd = document.getElementById('btn-compress-add');
const btnCompressClear = document.getElementById('btn-compress-clear');
const compressLoadingOverlay = document.getElementById('compress-loading-overlay');
const compressLoadingText = document.getElementById('compress-loading-text');

// state: array of { file, originalSize, compressedBytes, rowEl, dlBtn, progressFill, metaEl, statusIcon }
let compressItems = [];

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function buildCompressRow(file) {
  const row = document.createElement('div');
  row.className = 'compress-file-row';

  const info = document.createElement('div');
  info.className = 'compress-file-info';

  const name = document.createElement('div');
  name.className = 'compress-file-name';
  name.textContent = file.name;
  name.title = file.name;

  const meta = document.createElement('div');
  meta.className = 'compress-file-meta';

  const originalBadge = document.createElement('span');
  originalBadge.className = 'compress-size-badge original';
  originalBadge.textContent = formatBytes(file.size);
  meta.appendChild(originalBadge);

  const progressBar = document.createElement('div');
  progressBar.className = 'compress-progress-bar';
  progressBar.style.width = '100%';
  const progressFill = document.createElement('div');
  progressFill.className = 'compress-progress-fill';
  progressBar.appendChild(progressFill);

  info.appendChild(name);
  info.appendChild(meta);
  info.appendChild(progressBar);

  const actions = document.createElement('div');
  actions.className = 'compress-file-actions';

  const statusIcon = document.createElement('div');
  statusIcon.className = 'compress-status-icon pending';
  statusIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;

  const dlBtn = document.createElement('button');
  dlBtn.className = 'compress-download-btn';
  dlBtn.disabled = true;
  dlBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download`;

  actions.appendChild(statusIcon);
  actions.appendChild(dlBtn);

  row.appendChild(info);
  row.appendChild(actions);

  return { row, meta, progressFill, statusIcon, dlBtn, originalBadge };
}

function renderCompressSummary() {
  const existing = compressFileList.querySelector('.compress-summary-bar');
  if (existing) existing.remove();

  const done = compressItems.filter(i => i.compressedBytes);
  if (done.length === 0) return;

  const totalOriginal = done.reduce((s, i) => s + i.file.size, 0);
  const totalCompressed = done.reduce((s, i) => s + i.compressedBytes.byteLength, 0);
  const savedPct = totalOriginal > 0 ? (((totalOriginal - totalCompressed) / totalOriginal) * 100).toFixed(1) : 0;

  const bar = document.createElement('div');
  bar.className = 'compress-summary-bar';
  bar.innerHTML = `
    <div class="compress-summary-stat"><div class="value">${formatBytes(totalOriginal)}</div><div class="label">Original</div></div>
    <div class="compress-summary-stat"><div class="value">${formatBytes(totalCompressed)}</div><div class="label">Compressed</div></div>
    <div class="compress-summary-stat"><div class="value" style="color:#4ade80">${savedPct}%</div><div class="label">Saved</div></div>
  `;
  compressFileList.insertBefore(bar, compressFileList.firstChild);
}

function addCompressFiles(files) {
  for (const file of files) {
    if (file.type !== 'application/pdf') continue;
    const { row, meta, progressFill, statusIcon, dlBtn, originalBadge } = buildCompressRow(file);
    compressFileList.appendChild(row);
    const item = { file, originalSize: file.size, compressedBytes: null, row, meta, progressFill, statusIcon, dlBtn, originalBadge };
    compressItems.push(item);

    dlBtn.addEventListener('click', () => {
      if (!item.compressedBytes) return;
      const blob = new Blob([item.compressedBytes], { type: 'application/pdf' });
      saveAs(blob, `compressed_${file.name}`);
    });
  }

  if (compressItems.length > 0) {
    compressDropzone.classList.add('hidden');
    compressFileList.classList.remove('hidden');
    compressActionsToolbar.classList.remove('hidden');
    btnCompressClear.classList.remove('hidden');
    btnCompressRun.disabled = false;
  }
}

compressDropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  compressDropzone.classList.add('drag-over');
});
compressDropzone.addEventListener('dragleave', () => compressDropzone.classList.remove('drag-over'));
compressDropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  compressDropzone.classList.remove('drag-over');
  if (e.dataTransfer.files.length > 0) addCompressFiles(e.dataTransfer.files);
});
compressDropzone.addEventListener('click', () => compressFileInput.click());
btnCompressAdd.addEventListener('click', () => compressFileInput.click());
compressFileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) addCompressFiles(e.target.files);
  compressFileInput.value = '';
});

btnCompressClear.addEventListener('click', () => {
  compressItems = [];
  compressFileList.innerHTML = '';
  compressFileList.classList.add('hidden');
  compressDropzone.classList.remove('hidden');
  compressActionsToolbar.classList.add('hidden');
  btnCompressClear.classList.add('hidden');
  btnCompressDownloadAll.style.display = 'none';
});

btnCompressRun.addEventListener('click', async () => {
  const pending = compressItems; // compress all (re-run replaces results)
  if (pending.length === 0) return;

  // Reset previous results
  btnCompressDownloadAll.style.display = 'none';
  const oldSummary = compressFileList.querySelector('.compress-summary-bar');
  if (oldSummary) oldSummary.remove();

  compressLoadingText.textContent = `Compressing 0 / ${pending.length}...`;
  compressLoadingOverlay.classList.remove('hidden');
  btnCompressRun.disabled = true;

  let done = 0;
  for (const item of pending) {
    // Reset row state
    item.compressedBytes = null;
    item.dlBtn.disabled = true;
    item.row.classList.remove('state-done', 'state-error');
    item.progressFill.style.width = '0%';
    // Remove old result badges (keep original)
    item.meta.querySelectorAll('.compress-size-badge:not(.original)').forEach(b => b.remove());
    item.statusIcon.className = 'compress-status-icon pending';
    item.statusIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;

    try {
      const ab = await item.file.arrayBuffer();
      const result = await compressLossless(ab);
      const compressedAb = result.pdf;
      item.compressedBytes = new Uint8Array(compressedAb);

      const origSize = item.file.size;
      const newSize = item.compressedBytes.byteLength;
      const savedPct = (((origSize - newSize) / origSize) * 100).toFixed(1);
      const hasSaving = newSize < origSize;

      // Update UI
      item.progressFill.style.width = '100%';
      item.row.classList.add('state-done');
      item.statusIcon.className = 'compress-status-icon done';
      item.statusIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

      const compressedBadge = document.createElement('span');
      compressedBadge.className = 'compress-size-badge compressed';
      compressedBadge.textContent = formatBytes(newSize);

      const savingBadge = document.createElement('span');
      savingBadge.className = hasSaving ? 'compress-size-badge saving' : 'compress-size-badge no-saving';
      savingBadge.textContent = hasSaving ? `−${savedPct}%` : 'No change';

      item.meta.appendChild(compressedBadge);
      item.meta.appendChild(savingBadge);
      item.dlBtn.disabled = false;
    } catch (err) {
      console.error(`Compression failed for ${item.file.name}:`, err);
      item.row.classList.add('state-error');
      item.statusIcon.className = 'compress-status-icon error';
      item.statusIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
    }

    done++;
    compressLoadingText.textContent = `Compressing ${done} / ${pending.length}...`;
  }

  compressLoadingOverlay.classList.add('hidden');
  btnCompressRun.disabled = false;

  // Show download all if at least one succeeded
  const anyDone = compressItems.some(i => i.compressedBytes);
  if (anyDone) {
    btnCompressDownloadAll.style.display = '';
  }
  renderCompressSummary();
});

btnCompressDownloadAll.addEventListener('click', async () => {
  const ready = compressItems.filter(i => i.compressedBytes);
  if (ready.length === 0) return;
  if (ready.length === 1) {
    const blob = new Blob([ready[0].compressedBytes], { type: 'application/pdf' });
    saveAs(blob, `compressed_${ready[0].file.name}`);
    return;
  }
  const zip = new JSZip();
  for (const item of ready) {
    zip.file(`compressed_${item.file.name}`, item.compressedBytes);
  }
  const content = await zip.generateAsync({ type: 'blob' });
  saveAs(content, 'compressed_pdfs.zip');
});
