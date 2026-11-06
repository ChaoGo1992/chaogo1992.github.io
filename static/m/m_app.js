/* 育儿日记 移动端 PWA */

let draft = null;
let allEntries = [];
let settings = { name: '', birthday: '' };
let cropPhotoId = null;
let cropRotate = 0;
let cropBox = { x: 0, y: 0, w: 1, h: 1 };
let cropAction = null;
let cropImageNatural = { w: 0, h: 0 };

const $ = id => document.getElementById(id);

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}
function fmtTime(d) {
  return d.toTimeString().slice(0, 5);
}
function pad2(n) { return String(n).padStart(2, '0'); }

function dayLabel(date) {
  const d = new Date(date + 'T00:00:00');
  const parts = ['日', '一', '二', '三', '四', '五', '六'];
  return `${d.getMonth() + 1}月${d.getDate()}日 · 星期${parts[d.getDay()]}`;
}

function agePhrase(birthday, today) {
  if (!birthday || !today) return '';
  const b = new Date(birthday + 'T00:00:00');
  const t = new Date(today + 'T00:00:00');
  if (isNaN(b) || isNaN(t) || t < b) return '';
  let months = (t.getFullYear() - b.getFullYear()) * 12 + (t.getMonth() - b.getMonth());
  if (t.getDate() < b.getDate()) months--;
  if (months < 0) months = 0;
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m}个月`;
  if (m === 0) return `${y}岁`;
  return `${y}岁${m}个月`;
}

function toast(t, duration = 2200) {
  const el = $('toast');
  el.textContent = t;
  el.style.opacity = 1;
  if (el._h) clearTimeout(el._h);
  el._h = setTimeout(() => el.style.opacity = 0, duration);
}

function newDraft() {
  const now = new Date();
  draft = { id: '', date: fmtDate(now), time: fmtTime(now), title: '', tags: [], body: '', photos: [] };
  renderComposer();
}

function renderComposer() {
  $('m-date').value = draft.date;
  $('m-title').value = draft.title;
  $('m-tags').value = (draft.tags || []).join(', ');
  $('m-body').value = draft.body;
  $('composer-date-text').textContent = dayLabel(draft.date);
  renderThumbs();
}

function switchTab(id) {
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.v === id));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === id));
  if (id === 'view-list') renderList();
  if (id === 'view-export') renderExportPanel();
}

async function loadSettings() {
  settings = (await getSettings()) || { name: '', birthday: '' };
  $('set-name').value = settings.name || '';
  $('set-birthday').value = settings.birthday || '';
  updateTopbar();
}

function updateTopbar() {
  const name = settings.name || '宝宝';
  const age = agePhrase(settings.birthday, fmtDate(new Date()));
  $('m-age').innerHTML = age ? `${escapeHtml(name)} · <b>${escapeHtml(age)}</b>` : escapeHtml(name);
}

function escapeHtml(s) {
  return (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* ===== 照片压缩与显示 ===== */
async function compressPhoto(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const longEdge = 2000;
  let w = bmp.width, h = bmp.height;
  if (Math.max(w, h) > longEdge) {
    const s = longEdge / Math.max(w, h);
    w *= s; h *= s;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w);
  canvas.height = Math.round(h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.88));
}

function applyDisplayToCanvas(source, display, targetW, targetH, cover = false) {
  let imgW = source.width || source.videoWidth || source.naturalWidth;
  let imgH = source.height || source.videoHeight || source.naturalHeight;
  let crop = (display && display.crop) || { x: 0, y: 0, w: 1, h: 1 };
  let cropW = Math.max(1, Math.round(crop.w * imgW));
  let cropH = Math.max(1, Math.round(crop.h * imgH));
  let cropX = Math.max(0, Math.min(Math.round(crop.x * imgW), imgW - cropW));
  let cropY = Math.max(0, Math.min(Math.round(crop.y * imgH), imgH - cropH));

  // 1) crop
  const c1 = document.createElement('canvas');
  c1.width = cropW; c1.height = cropH;
  const ctx1 = c1.getContext('2d');
  ctx1.drawImage(source, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

  // 2) rotate
  const rot = (display && display.rotate) || 0;
  let rw = cropW, rh = cropH;
  if (rot === 90 || rot === 270) { rw = cropH; rh = cropW; }
  const c2 = document.createElement('canvas');
  c2.width = rw; c2.height = rh;
  const ctx2 = c2.getContext('2d');
  ctx2.translate(rw / 2, rh / 2);
  ctx2.rotate(rot * Math.PI / 180);
  ctx2.drawImage(c1, -cropW / 2, -cropH / 2);

  // 3) scale to target (cover or contain)
  const canvas = document.createElement('canvas');
  canvas.width = targetW; canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (cover) {
    const rect = coverRect(rw, rh, targetW, targetH);
    ctx.drawImage(c2, rect.sx, rect.sy, rect.sw, rect.sh, rect.dx, rect.dy, rect.dw, rect.dh);
  } else {
    const s = Math.min(targetW / rw, targetH / rh);
    const dw = Math.round(rw * s), dh = Math.round(rh * s);
    ctx.drawImage(c2, (targetW - dw) / 2, (targetH - dh) / 2, dw, dh);
  }
  return canvas;
}

function coverRect(srcW, srcH, dstW, dstH) {
  const srcR = srcW / srcH, dstR = dstW / dstH;
  let sw, sh, sx, sy;
  if (srcR > dstR) {
    sh = srcH; sw = Math.round(sh * dstR); sy = 0; sx = Math.round((srcW - sw) / 2);
  } else {
    sw = srcW; sh = Math.round(sw / dstR); sx = 0; sy = Math.round((srcH - sh) / 2);
  }
  return { sx, sy, sw, sh, dx: 0, dy: 0, dw: dstW, dh: dstH };
}

async function renderThumbs() {
  const strip = $('thumb-strip');
  strip.innerHTML = '';
  for (const p of draft.photos) {
    const photo = await getPhoto(p.id);
    if (!photo) continue;
    const url = URL.createObjectURL(photo.blob);
    const img = new Image();
    img.onload = () => {
      const canvas = applyDisplayToCanvas(img, p.display, 92, 70, true);
      URL.revokeObjectURL(url);
      const fig = document.createElement('figure');
      fig.className = 'thumb';
      fig.dataset.id = p.id;
      fig.innerHTML = `<canvas width="92" height="70"></canvas><span class="del" data-act="del-photo" data-id="${p.id}">✕</span><figcaption>点击裁切</figcaption>`;
      fig.querySelector('canvas').getContext('2d').drawImage(canvas, 0, 0);
      fig.addEventListener('click', (e) => {
        if (e.target.closest('.del')) return;
        openCrop(p.id);
      });
      strip.appendChild(fig);
    };
    img.src = url;
  }
}

async function handlePhotoFile(file) {
  if (!draft) newDraft();
  if (!draft.date) { toast('请先设置日期'); return; }
  try {
    const blob = await compressPhoto(file);
    const pid = newId().replace(/-/g, '').slice(0, 12);
    await putPhoto({ id: pid, blob, caption: '', display: {} });
    draft.photos.push({ id: pid, caption: '', display: {} });
    draft.body = $('m-body').value + `\n{{photo:${pid}}}\n`;
    $('m-body').value = draft.body;
    renderThumbs();
  } catch (e) {
    toast('照片处理失败: ' + e.message);
  }
}

async function handlePhotoFiles(files) {
  for (const f of files) await handlePhotoFile(f);
}

/* ===== 裁切 ===== */
function getCropStageRect() {
  const stage = $('crop-stage');
  return { w: stage.clientWidth, h: stage.clientHeight };
}

function getContainedImageRect(nw, nh, stageW, stageH) {
  const s = Math.min(stageW / nw, stageH / nh);
  const w = Math.round(nw * s), h = Math.round(nh * s);
  return { x: Math.round((stageW - w) / 2), y: Math.round((stageH - h) / 2), w, h, s };
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

function drawCropBox() {
  const stage = getCropStageRect();
  const img = getContainedImageRect(cropImageNatural.w, cropImageNatural.h, stage.w, stage.h);
  const box = $('crop-box');
  box.style.left = (img.x + cropBox.x * img.w) + 'px';
  box.style.top = (img.y + cropBox.y * img.h) + 'px';
  box.style.width = (cropBox.w * img.w) + 'px';
  box.style.height = (cropBox.h * img.h) + 'px';
}

async function openCrop(pid) {
  cropPhotoId = pid;
  const photo = await getPhoto(pid);
  if (!photo) return;
  const p = draft.photos.find(x => x.id === pid);
  cropRotate = (p && p.display && p.display.rotate) || 0;
  cropBox = (p && p.display && p.display.crop) ? { ...p.display.crop } : { x: 0, y: 0, w: 1, h: 1 };
  const url = URL.createObjectURL(photo.blob);
  const img = $('crop-img');
  img.onload = () => {
    cropImageNatural = { w: img.naturalWidth, h: img.naturalHeight };
    drawCropBox();
    URL.revokeObjectURL(url);
  };
  img.src = url;
  $('crop-angle').textContent = `${cropRotate}°`;
  $('crop-modal').classList.remove('hidden');
}

function closeCrop() {
  $('crop-modal').classList.add('hidden');
  cropPhotoId = null;
  cropAction = null;
}

function onCropPointerDown(e) {
  const handle = e.target.closest('.handle');
  const kind = handle ? 'resize' : 'move';
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  cropAction = { kind, handle: handle ? handle.dataset.h : null, startX: clientX, startY: clientY, ox: cropBox.x, oy: cropBox.y, ow: cropBox.w, oh: cropBox.h };
  e.preventDefault();
}

function onCropPointerMove(e) {
  if (!cropAction) return;
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  const stage = getCropStageRect();
  const img = getContainedImageRect(cropImageNatural.w, cropImageNatural.h, stage.w, stage.h);
  const dx = (clientX - cropAction.startX) / img.w;
  const dy = (clientY - cropAction.startY) / img.h;
  if (cropAction.kind === 'move') {
    cropBox.x = clamp01(cropAction.ox + dx);
    cropBox.y = clamp01(cropAction.oy + dy);
    if (cropBox.x + cropBox.w > 1) cropBox.x = 1 - cropBox.w;
    if (cropBox.y + cropBox.h > 1) cropBox.y = 1 - cropBox.h;
  } else {
    const h = cropAction.handle;
    let x = cropAction.ox, y = cropAction.oy, w = cropAction.ow, hh = cropAction.oh;
    if (h.includes('e')) w = clamp01(cropAction.ow + dx);
    if (h.includes('w')) {
      const nx = clamp01(cropAction.ox + dx);
      const nw = cropAction.ow + cropAction.ox - nx;
      if (nw > 0.02) { x = nx; w = nw; }
    }
    if (h.includes('s')) hh = clamp01(cropAction.oh + dy);
    if (h.includes('n')) {
      const ny = clamp01(cropAction.oy + dy);
      const nh = cropAction.oh + cropAction.oy - ny;
      if (nh > 0.02) { y = ny; hh = nh; }
    }
    if (w < 0.02) w = 0.02;
    if (hh < 0.02) hh = 0.02;
    if (x + w > 1) w = 1 - x;
    if (y + hh > 1) hh = 1 - y;
    cropBox = { x, y, w, h: hh };
  }
  drawCropBox();
  e.preventDefault();
}

function onCropPointerUp() {
  cropAction = null;
}

function confirmCrop() {
  const p = draft.photos.find(x => x.id === cropPhotoId);
  if (p) {
    p.display = { rotate: cropRotate };
    if (cropBox.x !== 0 || cropBox.y !== 0 || cropBox.w !== 1 || cropBox.h !== 1) {
      p.display.crop = { ...cropBox };
    }
  }
  closeCrop();
  renderThumbs();
}

/* ===== 日记本体 ===== */
async function saveDraft() {
  if (!draft) newDraft();
  draft.title = $('m-title').value;
  draft.tags = $('m-tags').value.split(/[,\uff0c]/).map(s => s.trim()).filter(Boolean);
  draft.body = $('m-body').value;
  draft.photos = syncPhotos(draft.body, draft.photos);
  // 移除未对应实际照片的占位符（手势输入错误 id 时保护 PC 导入）
  const photoIds = new Set(draft.photos.map(p => p.id));
  draft.body = draft.body.replace(/\{\{photo:([a-zA-Z0-9]+)\}\}/g, (m, id) => photoIds.has(id) ? m : '');
  if (!draft.id) draft.id = newId();
  await putEntry({ ...draft });
  toast('已存入日记');
  newDraft();
  await loadEntries();
}

async function loadEntries() {
  allEntries = await getAllEntries();
  allEntries.sort((a, b) => (b.date + b.time).localeCompare(a.date + b.time));
  renderFilters();
  renderList();
}

function getYearMonths() {
  const map = new Map();
  allEntries.forEach(e => {
    const y = e.date.slice(0, 4);
    const m = e.date.slice(5, 7);
    if (!map.has(y)) map.set(y, new Set());
    map.get(y).add(m);
  });
  return Array.from(map.entries()).map(([y, ms]) => ({ y, ms: Array.from(ms).sort() })).sort((a, b) => b.y.localeCompare(a.y));
}

function renderFilters() {
  const data = getYearMonths();
  const yearSel = $('f-year');
  const oldY = yearSel.value;
  yearSel.innerHTML = data.map(d => `<option value="${d.y}">${d.y} 年</option>`).join('');
  yearSel.value = oldY || String(new Date().getFullYear());
  fillMonths();
}

function fillMonths() {
  const y = $('f-year').value;
  const data = getYearMonths().find(d => d.y === y);
  const monthSel = $('f-month');
  const oldM = monthSel.value;
  monthSel.innerHTML = '<option value="all">全年</option>' +
    (data ? data.ms.map(m => `<option value="${m}">${parseInt(m, 10)} 月</option>`).join('') : '');
  if (data && data.ms.includes(oldM)) monthSel.value = oldM;
  else if (y === String(new Date().getFullYear())) monthSel.value = pad2(new Date().getMonth() + 1);
  else monthSel.value = 'all';
}

async function renderList() {
  const y = $('f-year').value;
  const m = $('f-month').value;
  const items = allEntries.filter(e => e.date.startsWith(y) && (m === 'all' || e.date.slice(5, 7) === m));
  $('f-count').textContent = `共 ${items.length} 篇`;
  const container = $('list-body');
  if (!items.length) {
    container.innerHTML = '<div class="month-head"><div class="zh">无日记</div><div class="rule"></div></div>';
    return;
  }
  const groups = {};
  items.forEach(e => { const ym = e.date.slice(0, 7); (groups[ym] = groups[ym] || []).push(e); });
  const zh = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
  let html = '';
  for (const ym of Object.keys(groups).sort().reverse()) {
    const es = groups[ym];
    html += `<div class="month-head"><div class="zh">${zh[parseInt(ym.slice(5, 7), 10) - 1]}月</div><div class="en">${ym} · 共 ${es.length} 篇</div><div class="rule"></div></div>`;
    for (const e of es) {
      const tags = (e.tags || []).map(t => t === '里程碑' ? `<span class="milestone">里程碑</span>` : `<span class="tag-chip">${escapeHtml(t)}</span>`).join('');
      const bodyText = (e.body || '').replace(/\{\{photo:[a-zA-Z0-9]+\}\}/g, '').trim();
      html += `
        <article data-id="${e.id}">
          <div class="head"><span class="t">${escapeHtml(e.title || '无标题')}</span>${tags}<span class="d">${escapeHtml(dayLabel(e.date))}</span></div>
          <div class="body">${escapeHtml(bodyText).replace(/\n/g, '<br>')}</div>
          <div class="figs" data-id="${e.id}"></div>
          <div class="ops-mini">
            <button data-act="edit" data-id="${e.id}">编辑</button>
            <button data-act="copy" data-id="${e.id}">复制文本</button>
            <button data-act="del" data-id="${e.id}">删除</button>
          </div>
        </article>`;
    }
  }
  container.innerHTML = html;
  // render photos asynchronously
  for (const e of items) {
    const figs = container.querySelector(`.figs[data-id="${e.id}"]`);
    if (!figs) continue;
    for (const p of e.photos) {
      const photo = await getPhoto(p.id);
      if (!photo) continue;
      const url = URL.createObjectURL(photo.blob);
      const img = new Image();
      img.onload = () => {
        const canvas = applyDisplayToCanvas(img, p.display, 118, 90, true);
        URL.revokeObjectURL(url);
        canvas.className = 'list-photo';
        figs.appendChild(canvas);
      };
      img.src = url;
    }
  }
}

async function editEntry(id) {
  const e = await getEntry(id);
  if (!e) return;
  draft = JSON.parse(JSON.stringify(e));
  renderComposer();
  switchTab('view-write');
}

async function copyEntry(id) {
  const e = await getEntry(id);
  if (!e) return;
  const text = entryToFm(e);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    toast('已复制 Markdown 全文');
  } else {
    toast('剪贴板不可用');
  }
}

async function deleteEntry(id) {
  if (!confirm('确定删除这篇日记？')) return;
  const e = await getEntry(id);
  await deleteEntryStore(id);
  // 清理未引用照片
  if (e && e.photos) {
    for (const p of e.photos) await deletePhoto(p.id);
  }
  toast('已删除');
  await loadEntries();
}

async function deleteEntryStore(id) { return deleteEntry(id); }

/* ===== 导出 ===== */
function renderExportPanel() {
  const data = getYearMonths();
  const sel = $('export-month');
  const opts = [];
  for (const d of data) {
    for (const m of d.ms) {
      opts.push(`<option value="${d.y}-${m}">${d.y}年${parseInt(m, 10)}月</option>`);
    }
  }
  sel.innerHTML = opts.join('') || '<option value="">无数据</option>';
}

async function buildZip(entries) {
  if (!entries.length) { toast('没有可导出的日记'); return; }
  const zip = new JSZip();
  const manifest = { version: 1, photos: {} };
  for (const e of entries) {
    const fileName = `${e.date}_${e.time.replace(/:/g, '')}.md`;
    zip.file(`entries/${fileName}`, entryToFm(e));
    for (const p of e.photos) {
      if (manifest.photos[p.id]) continue;
      const photo = await getPhoto(p.id);
      if (photo && photo.blob) {
        zip.file(`photos/${p.id}.jpg`, photo.blob);
        manifest.photos[p.id] = `photos/${p.id}.jpg`;
      }
    }
  }
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `baby-diary-${fmtDate(new Date())}.zip`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`已导出 ${entries.length} 篇`);
}

async function exportAll() {
  await buildZip(allEntries);
}

async function exportMonth() {
  const ym = $('export-month').value;
  if (!ym) return;
  await buildZip(allEntries.filter(e => e.date.startsWith(ym)));
}

/* ===== 设置 ===== */
async function saveSettings() {
  settings = { name: $('set-name').value, birthday: $('set-birthday').value };
  await putSettings(settings);
  updateTopbar();
  toast('已保存');
}

/* ===== 事件 ===== */
function bindEvents() {
  document.querySelectorAll('.tabbar button').forEach(b => {
    b.addEventListener('click', () => switchTab(b.dataset.v));
  });
  $('btn-save').addEventListener('click', saveDraft);
  $('btn-new').addEventListener('click', newDraft);
  $('btn-capture').addEventListener('click', () => $('input-capture').click());
  $('btn-gallery').addEventListener('click', () => $('input-gallery').click());
  $('input-capture').addEventListener('change', e => { handlePhotoFiles(e.target.files); e.target.value = ''; });
  $('input-gallery').addEventListener('change', e => { handlePhotoFiles(e.target.files); e.target.value = ''; });
  $('m-date').addEventListener('change', () => {
    draft.date = $('m-date').value;
    $('composer-date-text').textContent = dayLabel(draft.date);
  });
  $('btn-save-settings').addEventListener('click', saveSettings);
  $('btn-export-all').addEventListener('click', exportAll);
  $('btn-export-all-again').addEventListener('click', exportAll);
  $('btn-export-month').addEventListener('click', exportMonth);
  $('btn-copy-current')?.addEventListener('click', () => {
    if (!draft || !draft.id) { toast('先在日记列表选一篇'); return; }
    copyEntry(draft.id);
  });

  // 裁切事件
  const box = $('crop-box');
  box.addEventListener('mousedown', onCropPointerDown);
  box.addEventListener('touchstart', onCropPointerDown, { passive: false });
  window.addEventListener('mousemove', onCropPointerMove);
  window.addEventListener('touchmove', onCropPointerMove, { passive: false });
  window.addEventListener('mouseup', onCropPointerUp);
  window.addEventListener('touchend', onCropPointerUp);
  $('btn-crop-rotate').addEventListener('click', () => {
    cropRotate = (cropRotate + 90) % 360;
    $('crop-angle').textContent = `${cropRotate}°`;
  });
  $('btn-crop-reset').addEventListener('click', () => {
    cropBox = { x: 0, y: 0, w: 1, h: 1 };
    cropRotate = 0;
    $('crop-angle').textContent = '0°';
    drawCropBox();
  });
  $('btn-crop-confirm').addEventListener('click', confirmCrop);
  $('btn-crop-cancel').addEventListener('click', closeCrop);

  // 列表事件委托
  $('list-body').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.act === 'edit') await editEntry(id);
    else if (btn.dataset.act === 'copy') await copyEntry(id);
    else if (btn.dataset.act === 'del') await deleteEntry(id);
  });
}

async function init() {
  try {
    await openDB();
    await loadSettings();
    newDraft();
    bindEvents();
    await loadEntries();
    // Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/static/m/sw.js').catch(err => console.error('SW fail', err));
    }
  } catch (e) {
    console.error(e);
    toast('初始化失败: ' + e.message);
  }
}

init();
