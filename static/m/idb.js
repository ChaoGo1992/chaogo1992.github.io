// IndexedDB 封装：与 PC 日记数据模型对齐
const DB_NAME = 'baby-diary-mobile';
const DB_VERSION = 1;

let _db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (_db) return resolve(_db);
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('entries')) db.createObjectStore('entries', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
    };
  });
}

function _tx(store, mode) {
  return _db.transaction(store, mode).objectStore(store);
}

function _request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function putEntry(entry) {
  await openDB();
  return _request(_tx('entries', 'readwrite').put(entry));
}

async function getEntry(id) {
  await openDB();
  return _request(_tx('entries', 'readonly').get(id));
}

async function getAllEntries() {
  await openDB();
  return _request(_tx('entries', 'readonly').getAll());
}

async function deleteEntry(id) {
  await openDB();
  return _request(_tx('entries', 'readwrite').delete(id));
}

async function putPhoto(photo) {
  await openDB();
  return _request(_tx('photos', 'readwrite').put(photo));
}

async function getPhoto(id) {
  await openDB();
  return _request(_tx('photos', 'readonly').get(id));
}

async function deletePhoto(id) {
  await openDB();
  return _request(_tx('photos', 'readwrite').delete(id));
}

async function getSettings() {
  await openDB();
  try {
    return await _request(_tx('settings', 'readonly').get('main'));
  } catch (e) {
    return null;
  }
}

async function putSettings(settings) {
  await openDB();
  return _request(_tx('settings', 'readwrite').put(settings, 'main'));
}

function syncPhotos(body, photos) {
  const referenced = new Set((body || '').match(/\{\{photo:([a-zA-Z0-9]+)\}\}/g)?.map(m => m.replace(/\{\{photo:|\}\}/g, '')) || []);
  return (photos || []).filter(p => referenced.has(p.id));
}

function _escapeYamlString(s) {
  if (s === null || s === undefined) return "''";
  if (/[:#\[\]{}|>&*!,'"\n\r]/.test(s) || s.startsWith('-') || s.startsWith(' ')) {
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  return s || "''";
}

function yamlDump(v, indent) {
  indent = indent || 0;
  const prefix = ' '.repeat(indent);
  if (v === null || v === undefined) return "''";
  if (typeof v === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(v) || /^\d{2}:\d{2}$/.test(v)) return '"' + v + '"';
    return _escapeYamlString(v);
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    return '\n' + v.map(item => `${prefix}- ${yamlDump(item, indent + 2).trimStart()}`).join('\n');
  }
  if (typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.length === 0) return '{}';
    return '\n' + keys.map(k => `${prefix}${k}: ${yamlDump(v[k], indent + 2).trimStart()}`).join('\n');
  }
  return _escapeYamlString(String(v));
}

function entryToFm(entry) {
  const photos = (entry.photos || []).map(p => ({
    id: p.id,
    caption: p.caption || '',
    display: p.display || {}
  }));
  const fm = {
    id: entry.id,
    date: entry.date,
    time: entry.time,
    title: entry.title || '',
    tags: entry.tags || [],
    photos: photos
  };
  let yaml = '';
  for (const [k, v] of Object.entries(fm)) {
    const dumped = yamlDump(v, 2);
    if (dumped.startsWith('\n')) {
      yaml += `${k}:${dumped}\n`;
    } else {
      yaml += `${k}: ${dumped}\n`;
    }
  }
  return `---\n${yaml}---\n\n${entry.body || ''}`;
}

function _parseSimpleYaml(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const root = {};
  let i = 0;
  let currentListKey = null;
  let currentListItem = null;
  let currentSubKey = null;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i++; continue; }
    const indent = line.length - line.trimStart().length;
    if (indent === 0) {
      currentListItem = null;
      if (line.trim() === '---') { i++; continue; }
      if (line.startsWith('- ')) {
        // top-level list item (not expected)
        i++; continue;
      }
      const colon = line.indexOf(':');
      if (colon === -1) { i++; continue; }
      const key = line.slice(0, colon).trim();
      const rest = line.slice(colon + 1).trim();
      currentListKey = null;
      currentSubKey = null;
      if (rest === '' || rest === '[]' || rest === '{}') {
        root[key] = rest === '[]' ? [] : rest === '{}' ? {} : [];
        // peek next lines to determine type
        let j = i + 1;
        while (j < lines.length && lines[j].trim() !== '') {
          const ni = lines[j].length - lines[j].trimStart().length;
          if (ni === 0) break;
          if (lines[j].startsWith('  - ')) { root[key] = []; currentListKey = key; break; }
          if (lines[j].startsWith('    ')) { root[key] = []; currentListKey = key; break; }
          if (ni === 2 && !lines[j].startsWith('  -')) { root[key] = {}; currentListKey = key; break; }
          j++;
        }
      } else {
        root[key] = _unquote(rest);
      }
      i++;
      continue;
    }
    if (indent === 2 && line.startsWith('  - ')) {
      const rest = line.slice(4).trim();
      // object list item starts with key: value
      if (/^[^'"\s]+:\s/.test(rest)) {
        currentListItem = {};
        if (currentListKey) root[currentListKey].push(currentListItem);
        const colon = rest.indexOf(':');
        const k = rest.slice(0, colon).trim();
        const v = rest.slice(colon + 1).trim();
        currentListItem[k] = _parseYamlValue(v);
        currentSubKey = k;
      } else {
        currentListItem = null;
        if (currentListKey) root[currentListKey].push(_unquote(rest));
      }
      i++;
      continue;
    }
    if (indent === 4 && currentListItem) {
      const colon = line.indexOf(':');
      if (colon !== -1) {
        const k = line.slice(4, colon).trim();
        const v = line.slice(colon + 1).trim();
        currentListItem[k] = _parseYamlValue(v);
        currentSubKey = k;
      }
      i++;
      continue;
    }
    i++;
  }
  return root;
}

function _unquote(s) {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  }
  return s;
}

function _parseYamlValue(s) {
  if (s === '[]') return [];
  if (s === '{}') return {};
  if (s === "''" || s === '""') return '';
  return _unquote(s);
}

function fmToEntry(text) {
  const trim = text.trim();
  if (!trim.startsWith('---')) return null;
  const end = trim.indexOf('\n---', 3);
  if (end === -1) return null;
  const fmText = trim.slice(3, end).trim();
  const body = trim.slice(end + 4).trim();
  const fm = _parseSimpleYaml(fmText);
  return {
    id: fm.id || '',
    date: fm.date || '',
    time: fm.time || '',
    title: fm.title || '',
    tags: Array.isArray(fm.tags) ? fm.tags : [],
    photos: Array.isArray(fm.photos) ? fm.photos : [],
    body: body
  };
}

function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const arr = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(arr);
  else for (let i = 0; i < 16; i++) arr[i] = Math.floor(Math.random() * 256);
  const hex = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-${hex.slice(16,18)}${hex.slice(18,20)}-${hex.slice(20,32)}`;
}
