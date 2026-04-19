import { createIcons, icons } from 'lucide';
import { PDFProcessor } from './pdf-processor.js';
import { compressLossless } from '@quicktoolsone/pdf-compress';
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
const btnRotateLeft = document.getElementById('btn-rotate-left');
const btnRotateRight = document.getElementById('btn-rotate-right');
const btnDelete = document.getElementById('btn-delete');
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

// State
let selectedPages = new Set(); // Stores string: `${docId}-${pageIndex}`
let currentFsDocId = null;
let currentFsPageIndex = null;
let currentFsZoom = 1.0;

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
    const loadedDocs = await processor.loadFiles(files);
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

  // Render cards for new docs
  for (let doc of newDocs) {
    for (let page of doc.pages) {
      createPageCard(doc, page);
    }
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

  // Render canvas and determine orientation
  processor.renderPageToCanvas(doc.id, page.pageIndex, canvas).then(viewport => {
    if (viewport && viewport.width > viewport.height) {
      card.classList.add('landscape');
    }
  }).catch(err => console.error(err));

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

  pagesContainer.appendChild(clone);
  
  // Need to Re-instantiate lucide on new elements
  createIcons({
    icons,
    nameAttr: 'data-lucide',
    attrs: {
      class: 'lucide-icon'
    }
  });
}

function toggleSelection(pageId, isSelected, card) {
  if (isSelected) {
    selectedPages.add(pageId);
    card.classList.add('selected');
  } else {
    selectedPages.delete(pageId);
    card.classList.remove('selected');
  }
  updateSelectionToolbar();
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
    toggleSelection(pageId, !allSelected, card);
  });
  
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
      toggleSelection(card.dataset.id, true, card);
    }
  });

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

async function openFullscreen(docId, pageIndex) {
  const doc = processor.documents.find(d => d.id === docId);
  if (!doc) return;
  
  currentFsDocId = docId;
  currentFsPageIndex = pageIndex;
  currentFsZoom = 1.0;
  
  fsLabel.textContent = `${doc.fileName} - Page ${pageIndex}`;
  fsModal.classList.remove('hidden');
  
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
  updateFullscreenNavButtons();
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

fsBtnClose.addEventListener('click', () => {
  fsModal.classList.add('hidden');
  currentFsDocId = null;
  currentFsPageIndex = null;
});

fsBtnZoomIn.addEventListener('click', () => {
    currentFsZoom += 0.25;
    if (currentFsZoom > 3.0) currentFsZoom = 3.0; // max zoom limit
    processor.renderFullscreenPage(currentFsDocId, currentFsPageIndex, fsCanvas, fsTextLayer, currentFsZoom);
});

fsBtnZoomOut.addEventListener('click', () => {
    currentFsZoom -= 0.25;
    if (currentFsZoom < 0.25) currentFsZoom = 0.25;
    processor.renderFullscreenPage(currentFsDocId, currentFsPageIndex, fsCanvas, fsTextLayer, currentFsZoom);
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

fsBtnRotateLeft.addEventListener('click', () => {
    processor.rotatePage(currentFsDocId, currentFsPageIndex, 'left');
    processor.renderFullscreenPage(currentFsDocId, currentFsPageIndex, fsCanvas, fsTextLayer, currentFsZoom);
    
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
    processor.renderFullscreenPage(currentFsDocId, currentFsPageIndex, fsCanvas, fsTextLayer, currentFsZoom);
    
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
  selectedPages.forEach(pageId => {
    const card = document.querySelector(`.page-card[data-id="${pageId}"]`);
    if (card) performActionOnCard(card, action);
  });
}

btnClearAll.addEventListener('click', () => {
  processor.clear();
  pagesContainer.innerHTML = '';
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
    await processor.exportByFile();
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
    await processor.exportBurst();
  } catch (error) {
    console.error(error);
    alert('Error exporting ZIP: ' + error.message);
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
const workspaceOrganize = document.getElementById('workspace-organize');
const workspaceCompress = document.getElementById('workspace-compress');
const sidebarOrganize = document.getElementById('sidebar-organize');
const sidebarCompress = document.getElementById('sidebar-compress');

function switchToOrganize() {
  navItemOrganize.classList.add('active');
  navItemCompress.classList.remove('active');
  workspaceOrganize.classList.remove('hidden');
  workspaceCompress.classList.add('hidden');
  sidebarOrganize.classList.remove('hidden');
  sidebarCompress.classList.add('hidden');
}

function switchToCompress() {
  navItemCompress.classList.add('active');
  navItemOrganize.classList.remove('active');
  workspaceCompress.classList.remove('hidden');
  workspaceOrganize.classList.add('hidden');
  sidebarCompress.classList.remove('hidden');
  sidebarOrganize.classList.add('hidden');
}

navBtnOrganize.addEventListener('click', switchToOrganize);
navBtnCompress.addEventListener('click', switchToCompress);

// ─────────────────────────────────────────────
// Compress PDF Module
// ─────────────────────────────────────────────

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
