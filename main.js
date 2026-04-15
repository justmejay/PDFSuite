import { createIcons, icons } from 'lucide';
import { PDFProcessor } from './pdf-processor.js';
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
