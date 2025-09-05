// js/compressor.js
// Requires pdfjs-dist, pdf-lib and jszip loaded in the page (see image-compressor.html head)

document.addEventListener('DOMContentLoaded', () => {
  // DOM references
  const fileInput = document.getElementById('fileInput');
  const chooseBtn = document.getElementById('chooseBtn');
  const dropzone = document.getElementById('dropzone');
  const qualityRange = document.getElementById('quality');
  const qualityValue = document.getElementById('qualityValue');
  const formatSel = document.getElementById('format');
  const resizeToggle = document.getElementById('resizeToggle');
  const maxSideSel = document.getElementById('maxSide');
  const processBtn = document.getElementById('processBtn');
  const previewGrid = document.getElementById('previewGrid');
  const downloadAllBtn = document.getElementById('downloadAllBtn');
  const pdfQualityRange = document.getElementById('pdfQuality');
  const pdfQualityValue = document.getElementById('pdfQualityValue');
  const processPdfBtn = document.getElementById('processPdfBtn');
  const pdfStatus = document.getElementById('pdfStatus');

  // state
  const items = []; // {id,file,type,previewURL,outputBlob,selected}

  // helpers
  const uid = () => Math.random().toString(36).slice(2,9);
  const bytesToHuman = (b) => (b>1024*1024) ? (Math.round(b/1024/1024*100)/100)+' MB' : (Math.round(b/1024*10)/10)+' KB';
  const isImage = m => /^image\//.test(m);
  const isPdf = m => m === 'application/pdf';

  // init values
  qualityValue.textContent = qualityRange.value;
  pdfQualityValue.textContent = pdfQualityRange.value;

  // events
  chooseBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });

  ['dragenter','dragover'].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add('drag'); }));
  ['dragleave','drop'].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.remove('drag'); }));
  dropzone.addEventListener('drop', e => handleFiles(e.dataTransfer.files));
  dropzone.addEventListener('click', () => fileInput.click());

  qualityRange.addEventListener('input', () => qualityValue.textContent = qualityRange.value);
  pdfQualityRange.addEventListener('input', () => pdfQualityValue.textContent = pdfQualityRange.value);

  function handleFiles(fileList) {
    Array.from(fileList).forEach(f => {
      if (!isImage(f.type) && !isPdf(f.type)) return;
      const id = uid();
      const url = URL.createObjectURL(f);
      items.push({ id, file: f, type: isPdf(f.type) ? 'pdf' : 'image', previewURL: url, outputBlob: null, selected: true });
    });
    render();
  }

  function render() {
    previewGrid.innerHTML = '';
    items.forEach((it, idx) => {
      const card = document.createElement('div'); card.className = 'preview';
      if (it.type === 'image') {
        const img = document.createElement('img'); img.src = it.previewURL; img.alt = it.file.name; card.appendChild(img);
      } else {
        const ic = document.createElement('div'); ic.style.fontSize='44px'; ic.textContent='📄'; card.appendChild(ic);
      }
      const meta = document.createElement('div'); meta.className = 'muted'; meta.innerHTML = `<strong>${it.file.name}</strong><br>${bytesToHuman(it.file.size)}`; card.appendChild(meta);

      const row = document.createElement('div'); row.style.display='flex'; row.style.justifyContent='space-between'; row.style.gap='8px';
      const chk = document.createElement('input'); chk.type = 'checkbox'; chk.checked = !!it.selected;
      chk.addEventListener('change', () => { it.selected = chk.checked; updateDownloadButton(); });
      const dlBtn = document.createElement('button'); dlBtn.className='btn ghost'; dlBtn.textContent='Download'; dlBtn.disabled = !it.outputBlob;
      dlBtn.addEventListener('click', () => { if (it.outputBlob) downloadBlob(it.outputBlob, it.type === 'pdf' ? it.file.name.replace(/\.pdf$/i,'-optimized.pdf') : it.file.name); });
      row.appendChild(chk); row.appendChild(dlBtn);
      card.appendChild(row);

      previewGrid.appendChild(card);
    });
    updateDownloadButton();
  }

  function updateDownloadButton() {
    const ready = items.some(i => i.selected && i.outputBlob);
    downloadAllBtn.disabled = !ready;
  }

  // compression routines
  async function compressImageFile(file, { quality=0.8, outputFormat='auto', maxSide=null } = {}) {
    const bitmap = await createImageBitmap(file);
    let w = bitmap.width, h = bitmap.height;
    if (maxSide && Math.max(w,h) > maxSide) {
      const scale = maxSide / Math.max(w,h);
      w = Math.round(w * scale); h = Math.round(h * scale);
    }
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);

    let mime = file.type;
    if (outputFormat === 'png') mime = 'image/png';
    else if (outputFormat === 'jpeg') mime = 'image/jpeg';
    else if (outputFormat === 'webp') mime = 'image/webp';
    else if (outputFormat === 'auto') {
      mime = file.type.includes('png') ? 'image/png' : 'image/jpeg';
    }

    const blob = await new Promise(resolve => canvas.toBlob(resolve, mime, quality));
    return blob;
  }

  // PDF optimization (rasterize pages then re-embed as JPEGs)
  if (window.pdfjsLib && pdfjsLib.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.7.107/build/pdf.worker.min.js';
  }
  async function optimizePdfFile(file, qualityPercent = 70, maxSide = 2048) {
    const arrayBuffer = await file.arrayBuffer();
    const loading = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loading.promise;
    const newPdf = await PDFLib.PDFDocument.create();

    for (let i = 1; i <= pdf.numPages; ++i) {
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const scale = Math.min(1, maxSide / Math.max(vp.width, vp.height));
      const rvp = page.getViewport({ scale });
      const canvas = document.createElement('canvas'); canvas.width = Math.round(rvp.width); canvas.height = Math.round(rvp.height);
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: rvp }).promise;
      const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', qualityPercent/100));
      const bytes = await blob.arrayBuffer();
      const img = await newPdf.embedJpg(bytes);
      const p = newPdf.addPage([img.width, img.height]);
      p.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    }

    const outBytes = await newPdf.save();
    return new Blob([outBytes], { type: 'application/pdf' });
  }

  // processing event handlers
  processBtn.addEventListener('click', async () => {
    const selected = items.filter(i => i.selected && i.type === 'image');
    if (!selected.length) { alert('No images selected to compress.'); return; }
    processBtn.disabled = true; processBtn.textContent = 'Processing...';
    try {
      for (const it of selected) {
        const q = parseInt(qualityRange.value) / 100;
        const fmt = formatSel.value;
        const maxSide = resizeToggle.checked ? parseInt(maxSideSel.value) : null;
        const blob = await compressImageFile(it.file, { quality: q, outputFormat: fmt, maxSide });
        it.outputBlob = blob;
        try { URL.revokeObjectURL(it.previewURL); } catch (e) {}
        it.previewURL = URL.createObjectURL(blob);
      }
      render();
      alert('Images compressed. Download them individually or use Download Selected.');
    } catch (err) {
      console.error(err);
      alert('Error while compressing: ' + (err.message || err));
    } finally {
      processBtn.disabled = false; processBtn.textContent = 'Compress Selected';
    }
  });

  processPdfBtn.addEventListener('click', async () => {
    const selected = items.filter(i => i.selected && i.type === 'pdf');
    if (!selected.length) { alert('No PDFs selected.'); return; }
    processPdfBtn.disabled = true; processPdfBtn.textContent = 'Optimizing...'; pdfStatus.textContent = 'Processing PDFs...';
    try {
      for (const it of selected) {
        const q = parseInt(pdfQualityRange.value);
        const maxSide = resizeToggle.checked ? parseInt(maxSideSel.value) : 2048;
        const out = await optimizePdfFile(it.file, q, maxSide);
        it.outputBlob = out;
      }
      render();
      pdfStatus.textContent = 'Done.';
      alert('PDF(s) optimized.');
    } catch (err) {
      console.error(err);
      pdfStatus.textContent = 'Error';
      alert('Error optimizing PDF: ' + (err.message || err));
    } finally {
      processPdfBtn.disabled = false; processPdfBtn.textContent = 'Optimize PDF(s)';
    }
  });

  // downloads
  function downloadBlob(blob, filename) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  downloadAllBtn.addEventListener('click', async () => {
    const selected = items.filter(i => i.selected && i.outputBlob);
    if (!selected.length) { alert('No processed files to download.'); return; }
    downloadAllBtn.disabled = true; downloadAllBtn.textContent = 'Preparing ZIP...';
    try {
      const zip = new JSZip();
      for (const it of selected) {
        const name = it.type === 'pdf' ? it.file.name.replace(/\.pdf$/i,'-optimized.pdf') : it.file.name;
        zip.file(name, it.outputBlob);
      }
      const content = await zip.generateAsync({ type: 'blob' });
      downloadBlob(content, 'iconverter-output.zip');
    } catch (err) {
      console.error(err);
      alert('Failed to create ZIP: ' + (err.message || err));
    } finally {
      downloadAllBtn.disabled = false; downloadAllBtn.textContent = 'Download Selected';
    }
  });
});
