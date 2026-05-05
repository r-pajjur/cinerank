// ─────────────────────────────────────────────────────────
//  CineRank — App Logic (v2)
// ─────────────────────────────────────────────────────────

// ── CONFIG ──────────────────────────────────────────────
const TMDB_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJiMjRiYWI1OTNiNDc0NWY4ZWRlODNhMzlkZDc1YmYxMSIsIm5iZiI6MTcwODM2OTQ4NS4zMzQsInN1YiI6IjY1ZDNhNjRkYWZhMWIwMDE2MzUxNzk1MCIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.hzUlzO6hKqS1uXlxMO64Nt8Dax847S2wOix9tJcBL6c';
const TMDB_BASE  = 'https://api.themoviedb.org/3';
const IMG_BASE   = 'https://image.tmdb.org/t/p/w342';

// ── STATE ────────────────────────────────────────────────
let rankedFilms  = JSON.parse(localStorage.getItem('cinerank-films') || '[]');
let pendingFilm  = null;
let duelLow      = 0;
let duelHigh     = 0;
let duelBucket   = null; // 'bad' | 'mid' | 'good' — sentiment bucket
let duelCount    = 0;    // tracks comparisons made for current film
let searchTimer  = null;

// Import queue: films waiting to be batch-added (persisted so you can pause & resume)
let importQueue  = JSON.parse(localStorage.getItem('cinerank-import-queue') || '[]');
let importTotal  = parseInt(localStorage.getItem('cinerank-import-total') || '0', 10);

// ── SAVE ─────────────────────────────────────────────────
function save() {
  localStorage.setItem('cinerank-films', JSON.stringify(rankedFilms));
}

function saveQueue() {
  localStorage.setItem('cinerank-import-queue', JSON.stringify(importQueue));
  localStorage.setItem('cinerank-import-total', String(importTotal));
}

function clearQueue() {
  importQueue = [];
  importTotal = 0;
  localStorage.removeItem('cinerank-import-queue');
  localStorage.removeItem('cinerank-import-total');
}

// ── DOM REFS ─────────────────────────────────────────────
const views = {
  search:    document.getElementById('view-search'),
  import:    document.getElementById('view-import'),
  sentiment: document.getElementById('view-sentiment'),
  duel:      document.getElementById('view-duel'),
  rank:      document.getElementById('view-rank'),
};
const totalCount    = document.getElementById('total-count');
const searchInput   = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const rankedList    = document.getElementById('ranked-list');

// ── VIEW ROUTING ─────────────────────────────────────────
function showView(name) {
  Object.keys(views).forEach(k => {
    views[k].classList.toggle('hidden', k !== name);
  });
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === name);
  });
  if (name === 'search') searchInput.focus();
  if (name === 'rank')   renderRankedList();
  if (name === 'import') refreshImportView();
}

document.addEventListener('click', e => {
  const target = e.target.closest('[data-view]');
  if (target) showView(target.dataset.view);
});

// ── SEARCH ───────────────────────────────────────────────
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  if (!q) { searchResults.innerHTML = ''; return; }
  searchTimer = setTimeout(() => searchFilms(q), 380);
});

async function searchFilms(query) {
  searchResults.innerHTML = `
    <div class="loading-spinner">
      <div class="spinner-ring"></div>
      Searching...
    </div>`;
  try {
    const url = `${TMDB_BASE}/search/movie?query=${encodeURIComponent(query)}&page=1&include_adult=false`;
    const res  = await fetch(url, {
      headers: { 'Authorization': `Bearer ${TMDB_TOKEN}`, 'Accept': 'application/json' }
    });
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    renderSearchResults(data.results || []);
  } catch (err) {
    searchResults.innerHTML = `
      <div class="no-results">
        Couldn't reach the movie database.
        <a href="https://www.themoviedb.org/settings/api" target="_blank">
          Set up your TMDB API key
        </a> in app.js for full functionality.
      </div>`;
    console.error('Search error:', err);
  }
}

function renderSearchResults(films) {
  if (!films.length) {
    searchResults.innerHTML = '<div class="no-results">No films found.</div>';
    return;
  }
  const top = films.slice(0, 12);
  searchResults.innerHTML = top.map(f => {
    const year    = f.release_date ? f.release_date.slice(0, 4) : '';
    const poster  = f.poster_path ? `${IMG_BASE}${f.poster_path}` : null;
    const already = isDuplicate({ id: f.id });
    return `
      <div class="result-card ${already ? 'already-added' : ''}"
           data-id="${f.id}"
           data-title="${escHtml(f.title)}"
           data-year="${year}"
           data-poster="${poster || ''}"
           title="${already ? 'Already in your ranking' : 'Click to add'}">
        ${poster
          ? `<img class="result-poster" src="${poster}" alt="${escHtml(f.title)}" loading="lazy" />`
          : `<div class="result-poster-placeholder">🎬</div>`
        }
        <div class="result-overlay">
          <span class="add-label">${already ? '✓ Added' : '+ Add'}</span>
          <span class="result-title">${escHtml(f.title)}</span>
          ${year ? `<span class="result-year">${year}</span>` : ''}
        </div>
      </div>`;
  }).join('');

  searchResults.querySelectorAll('.result-card').forEach(card => {
    card.addEventListener('click', () => {
      const id     = parseInt(card.dataset.id);
      const title  = card.dataset.title;
      const year   = card.dataset.year;
      const poster = card.dataset.poster || null;
      if (isDuplicate({ id })) {
        showToast(`"${title}" is already in your ranking`);
        return;
      }
      addFilm({ id, title, year, poster });
    });
  });
}

// ── DUPLICATE CHECK ──────────────────────────────────────
// Checks both TMDB id and imdbId so CSV imports + manual searches don't collide
function isDuplicate(film) {
  return rankedFilms.some(f =>
    (film.id    && f.id    && f.id    === film.id) ||
    (film.imdbId && f.imdbId && f.imdbId === film.imdbId)
  );
}

// ── SENTIMENT SCREEN ─────────────────────────────────────
// Before binary-search duels, ask the user: bad / okay / good
// This divides the ranked list into thirds, dramatically reducing duel count.
function addFilm(film) {
  if (isDuplicate(film)) {
    showToast(`"${film.title}" is already in your ranking`);
    // Still move to next in queue if batch importing
    if (importQueue.length > 0) {
      const next = importQueue.shift();
      saveQueue();
      setTimeout(() => addFilm(next), 120);
    }
    return;
  }

  pendingFilm = film;

  if (rankedFilms.length === 0) {
    rankedFilms.unshift(film);
    save();
    updateCount();
    showToast(`"${film.title}" added at #1`);
    afterInsert();
    return;
  }

  // Show sentiment picker first
  showSentimentScreen(film);
}

function showSentimentScreen(film) {
  const img   = document.getElementById('sentiment-poster');
  const title = document.getElementById('sentiment-title');
  const year  = document.getElementById('sentiment-year');

  if (film.poster) {
    img.src = film.poster;
    img.style.display = 'block';
  } else {
    img.src = '';
    img.style.display = 'none';
  }
  title.textContent = film.title;
  year.textContent  = film.year || '';
  showView('sentiment');
}

document.querySelectorAll('.sentiment-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const sentiment = btn.dataset.sentiment; // 'bad' | 'mid' | 'good'
    duelBucket = sentiment;
    duelCount  = 0; // reset comparison counter for new film

    // Map sentiment to a slice of the ranked list
    const n = rankedFilms.length;
    if (sentiment === 'bad') {
      // Bottom third
      duelLow  = Math.floor(n * 2 / 3);
      duelHigh = n;
    } else if (sentiment === 'mid') {
      // Middle third
      duelLow  = Math.floor(n / 3);
      duelHigh = Math.floor(n * 2 / 3);
    } else {
      // Top third
      duelLow  = 0;
      duelHigh = Math.floor(n / 3);
    }

    // If the bucket is empty (small list), use the full list
    if (duelLow >= duelHigh) {
      duelLow  = 0;
      duelHigh = n;
    }

    startDuel();
  });
});

// ── DUEL (binary search) ──────────────────────────────────
function startDuel() {
  if (duelLow >= duelHigh) {
    // Enforce minimum 2 comparisons before inserting
    if (duelCount < 2) {
      // Widen the window slightly to force another comparison
      const n   = rankedFilms.length;
      const mid = Math.min(duelLow, n - 1);
      duelLow   = Math.max(0, mid - 1);
      duelHigh  = Math.min(n, mid + 2);

      // If still collapsed (e.g. only 1 film exists), just insert
      if (duelLow >= duelHigh || rankedFilms.length < 2) {
        insertPending(duelLow);
        return;
      }
    } else {
      insertPending(duelLow);
      return;
    }
  }

  const mid = Math.floor((duelLow + duelHigh) / 2);
  showView('duel');
  renderDuel(mid);
}

function insertPending(position) {
  rankedFilms.splice(position, 0, pendingFilm);
  save();
  updateCount();
  const pos = position + 1;
  showToast(`"${pendingFilm.title}" ranked #${pos}`);
  pendingFilm = null;
  duelBucket  = null;
  duelCount   = 0; // reset
  afterInsert();
}

// Called after every successful insert — processes import queue or returns home
function afterInsert() {
  if (importQueue.length > 0) {
    const next = importQueue.shift();
    saveQueue();
    updateImportProgress();
    setTimeout(() => addFilm(next), 120);
  } else {
    clearQueue();
    showView('rank');
  }
}

function renderDuel(mid) {
  const opponent = rankedFilms[mid];
  setDuelSide('left',  pendingFilm);
  setDuelSide('right', opponent);
  document.getElementById('duel-left').dataset.mid  = mid;
  document.getElementById('duel-right').dataset.mid = mid;

  // Show queue progress if batch importing
  const progressEl = document.getElementById('duel-import-progress');
  if (importTotal > 0 && importQueue.length >= 0) {
    const done  = importTotal - importQueue.length;
    const pct   = Math.round((done / importTotal) * 100);
    progressEl.textContent = `Importing ${done} / ${importTotal} films`;
    progressEl.style.display = 'block';
  } else {
    progressEl.style.display = 'none';
  }
}

function setDuelSide(side, film) {
  const img   = document.getElementById(`duel-${side}-img`);
  const title = document.getElementById(`duel-${side}-title`);
  const year  = document.getElementById(`duel-${side}-year`);
  if (film.poster) {
    img.src = film.poster;
    img.style.display = 'block';
  } else {
    img.src = '';
    img.style.display = 'none';
  }
  title.textContent = film.title;
  year.textContent  = film.year || '';
}

// DUEL CLICKS
document.querySelectorAll('.duel-card').forEach(card => {
  card.addEventListener('click', () => {
    const side = card.dataset.side;
    const mid  = parseInt(card.dataset.mid);
    duelCount++; // increment on every choice made
    if (side === 'left') {
      duelHigh = mid;
    } else {
      duelLow = mid + 1;
    }
    startDuel();
  });
});

// TOO TOUGH: insert pending film right next to the current opponent
document.getElementById('too-tough-btn').addEventListener('click', () => {
  const leftCard = document.getElementById('duel-left');
  const mid = parseInt(leftCard.dataset.mid);
  insertPending(mid + 1);
});

// PAUSE IMPORT — saves queue and goes to rank view
document.getElementById('pause-import-btn')?.addEventListener('click', () => {
  saveQueue();
  pendingFilm = null;
  duelBucket  = null;
  duelCount   = 0;
  showToast(`Import paused — ${importQueue.length} films remaining`);
  showView('rank');
});

// ── SCORES OUT OF 10 ──────────────────────────────────────
// Only shown when 10+ films are ranked. Position 1 = 10.0, last = 1.0,
// spread evenly across one decimal place.
function getScore(index, total) {
  if (total < 10) return null;
  if (total === 1) return 10.0;
  const score = 10 - (index / (total - 1)) * 9;
  return Math.round(score * 10) / 10; // one decimal
}

// ── RENDER RANKING ────────────────────────────────────────
function renderRankedList() {
  updateCount();

  if (rankedFilms.length === 0) {
    rankedList.innerHTML = `
      <li class="empty-state">
        <span>No films yet — search to add one!</span>
      </li>`;
    return;
  }

  const total = rankedFilms.length;
  const showScores = total >= 10;

  rankedList.innerHTML = rankedFilms.map((film, i) => {
    const rank     = i + 1;
    const numClass = rank === 1 ? 'top-1' : rank === 2 ? 'top-2' : rank === 3 ? 'top-3' : '';
    const score    = showScores ? getScore(i, total) : null;

    return `
      <li class="rank-item" data-id="${film.id}">
        <span class="rank-number ${numClass}">${rank}</span>
        ${film.poster
          ? `<img class="rank-poster" src="${film.poster}" alt="${escHtml(film.title)}" loading="lazy" />`
          : `<div class="rank-poster-placeholder">🎬</div>`
        }
        <div class="rank-meta">
          ${film.year ? `<p class="rank-film-year">${film.year}</p>` : ''}
          <h3 class="rank-film-title">${escHtml(film.title)}</h3>
        </div>
        <div class="rank-actions">
          ${score !== null ? `<span class="rank-score">${score.toFixed(1)}</span>` : ''}
          <button class="remove-btn" data-remove="${film.id}" title="Remove">✕</button>
        </div>
      </li>`;
  }).join('');

  rankedList.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id   = parseInt(btn.dataset.remove);
      const film = rankedFilms.find(f => f.id === id);
      rankedFilms = rankedFilms.filter(f => f.id !== id);
      save();
      renderRankedList();
      if (film) showToast(`"${film.title}" removed`);
    });
  });

  // Show resume-import banner if queue exists
  const resumeBanner = document.getElementById('resume-import-banner');
  if (resumeBanner) {
    if (importQueue.length > 0) {
      resumeBanner.style.display = 'flex';
      document.getElementById('resume-count').textContent = importQueue.length;
    } else {
      resumeBanner.style.display = 'none';
    }
  }
}

function updateCount() {
  totalCount.textContent = rankedFilms.length;
}

// ── RESUME IMPORT ────────────────────────────────────────
document.getElementById('resume-import-btn')?.addEventListener('click', () => {
  if (importQueue.length === 0) return;
  const next = importQueue.shift();
  saveQueue();
  addFilm(next);
});

document.getElementById('discard-import-btn')?.addEventListener('click', () => {
  clearQueue();
  renderRankedList();
  showToast('Import queue cleared');
});

// ── IMPORT VIEW STATUS ────────────────────────────────────
function refreshImportView() {
  // Restore pending import info if any
  const importStatus = document.getElementById('import-status');
  if (importQueue.length > 0 && importStatus) {
    importStatus.innerHTML = `<span class="status-ok">⏸</span> Import paused — <strong>${importQueue.length}</strong> films remaining. Go to Rankings to resume.`;
    importStatus.classList.remove('hidden');
  }
}

// ── IMDB IMPORT ──────────────────────────────────────────
const dropZone  = document.getElementById('drop-zone');
const csvInput  = document.getElementById('csv-input');
const importStatus = document.getElementById('import-status');

dropZone.addEventListener('click', () => csvInput.click());
csvInput.addEventListener('change', () => {
  if (csvInput.files[0]) handleCsvFile(csvInput.files[0]);
});
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.name.endsWith('.csv')) handleCsvFile(file);
  else showToast('Please drop a .csv file');
});

async function handleCsvFile(file) {
  const text = await file.text();
  const rows = parseCsv(text);

  if (!rows.length) {
    showImportStatus('No films found in this CSV. Make sure it\'s an IMDb export.');
    return;
  }

  const sorted = rows
    .filter(r => r.rating)
    .sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating));

  showImportStatus(`Found <strong>${sorted.length}</strong> rated films. Looking them up on TMDB…`);

  // Filter out duplicates (by imdbId AND tmdbId)
  const toAdd = sorted.filter(r => !isDuplicate({ imdbId: r.imdbId }));

  if (!toAdd.length) {
    showImportStatus('All films from this export are already in your ranking!');
    return;
  }

  let lookupDone = 0;
  const lookupTotal = toAdd.length;
  showImportStatus(`Matching <strong>0 / ${lookupTotal}</strong> films on TMDB…<div class="status-bar-wrap"><div class="status-bar" id="import-progress-bar" style="width:0%"></div></div>`);

  const resolved = [];
  for (const row of toAdd) {
    const film = await resolveImdbFilm(row);
    if (film && !isDuplicate(film)) resolved.push(film);
    lookupDone++;
    const bar = document.getElementById('import-progress-bar');
    if (bar) bar.style.width = Math.round((lookupDone / lookupTotal) * 100) + '%';
    const statusText = importStatus.querySelector('strong');
    if (statusText) statusText.textContent = `${lookupDone} / ${lookupTotal}`;
    await sleep(120);
  }

  if (!resolved.length) {
    showImportStatus('Couldn\'t match any films. Check your TMDB token in app.js.');
    return;
  }

  // Store entire queue in localStorage so it survives navigation/pausing
  importQueue = resolved.slice(1);
  importTotal = resolved.length;
  saveQueue();

  showImportStatus(`<span class="status-ok">✓</span> Matched <strong>${resolved.length}</strong> films. Starting ranking… <em>You can pause any time.</em>`);

  showView('rank');
  addFilm(resolved[0]);
}

async function resolveImdbFilm(row) {
  try {
    const url = `${TMDB_BASE}/find/${row.imdbId}?external_source=imdb_id`;
    const res  = await fetch(url, {
      headers: { 'Authorization': `Bearer ${TMDB_TOKEN}`, 'Accept': 'application/json' }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const movie = (data.movie_results || [])[0];
    if (!movie) return null;
    return {
      id:     movie.id,
      imdbId: row.imdbId,
      title:  movie.title || row.title,
      year:   (movie.release_date || '').slice(0, 4) || row.year,
      poster: movie.poster_path ? `${IMG_BASE}${movie.poster_path}` : null,
    };
  } catch {
    return null;
  }
}

function updateImportProgress() {
  const bar = document.getElementById('import-progress-bar');
  if (bar && importTotal > 0) {
    const done = importTotal - importQueue.length;
    bar.style.width = Math.round((done / importTotal) * 100) + '%';
  }
}

function showImportStatus(html) {
  importStatus.innerHTML = html;
  importStatus.classList.remove('hidden');
}

// ── CSV PARSER ────────────────────────────────────────────
function parseCsv(text) {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return [];

  const header   = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim().toLowerCase());
  const idxConst  = header.findIndex(h => h === 'const' || h === 'imdb id' || h === 'tconst');
  const idxTitle  = header.findIndex(h => h === 'title' || h === 'primary title');
  const idxYear   = header.findIndex(h => h === 'year' || h === 'release date');
  const idxRating = header.findIndex(h => h === 'your rating' || h === 'rating');

  if (idxConst === -1 || idxTitle === -1) return [];

  const results = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    if (!cols[idxConst]) continue;
    const imdbId = cols[idxConst].replace(/^"|"$/g, '').trim();
    if (!imdbId.startsWith('tt')) continue;
    results.push({
      imdbId,
      title:  idxTitle  >= 0 ? cols[idxTitle].replace(/^"|"$/g, '').trim()   : '',
      year:   idxYear   >= 0 ? cols[idxYear].replace(/^"|"$/g, '').slice(0,4) : '',
      rating: idxRating >= 0 ? cols[idxRating].replace(/^"|"$/g, '').trim()  : '',
    });
  }
  return results;
}

function splitCsvLine(line) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── TOAST ─────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

// ── UTILS ─────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── INIT ──────────────────────────────────────────────────
updateCount();
showView('rank');