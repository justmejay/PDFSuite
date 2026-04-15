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
const btnExportBurst = document.getElementById('btn-export-burst');
const btnRotateLeft = document.getElementById('btn-rotate-left');
const btnRotateRight = document.getElementById('btn-rotate-right');
const btnDelete = document.getElementById('btn-delete');
const btnSelectAll = document.getElementById('btn-select-all');

// State
let selectedPages = new Set(); // Stores string: `${docId}-${pageIndex}`

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

  // Render canvas
  processor.renderPageToCanvas(doc.id, page.pageIndex, canvas);

  // Interactions
  card.addEventListener('click', (e) => {
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

// Actions
btnRotateLeft.addEventListener('click', () => applyActionToSelected('rotate-left'));
btnRotateRight.addEventListener('click', () => applyActionToSelected('rotate-right'));
btnDelete.addEventListener('click', () => applyActionToSelected('toggle-delete'));

function applyActionToSelected(action) {
  selectedPages.forEach(pageId => {
    const card = document.querySelector(`.page-card[data-id="${pageId}"]`);
    if (!card) return;
    
    const docId = card.dataset.docId;
    const pageIndex = parseInt(card.dataset.pageIndex, 10);
    const canvas = card.querySelector('.page-canvas');
    const deleteOverlay = card.querySelector('.delete-overlay');

    if (action === 'rotate-left') {
      const newRot = processor.rotatePage(docId, pageIndex, 'left');
      canvas.style.transform = `rotate(${newRot}deg)`;
    } 
    else if (action === 'rotate-right') {
      const newRot = processor.rotatePage(docId, pageIndex, 'right');
      canvas.style.transform = `rotate(${newRot}deg)`;
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
