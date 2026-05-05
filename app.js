// ─────────────────────────────────────────────────────────
//  CineRank — App Logic (v2 UPDATED)
//  + Post-insert validation system fix
// ─────────────────────────────────────────────────────────

// ── CONFIG ──────────────────────────────────────────────
const TMDB_TOKEN = 'YOUR_TOKEN_HERE';
const TMDB_BASE  = 'https://api.themoviedb.org/3';
const IMG_BASE   = 'https://image.tmdb.org/t/p/w342';

// ── STATE ────────────────────────────────────────────────
let rankedFilms  = JSON.parse(localStorage.getItem('cinerank-films') || '[]');
let pendingFilm  = null;

let duelLow      = 0;
let duelHigh     = 0;
let duelBucket   = null;

let searchTimer  = null;

// 🔥 VALIDATION STATE (NEW)
let validationIndex = null;

// Import queue
let importQueue  = JSON.parse(localStorage.getItem('cinerank-import-queue') || '[]');
let importTotal  = parseInt(localStorage.getItem('cinerank-import-total') || '0', 10);

// ── SAVE ────────────────────────────────────────────────
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

// ── DOM ────────────────────────────────────────────────
const views = {
  search: document.getElementById('view-search'),
  import: document.getElementById('view-import'),
  sentiment: document.getElementById('view-sentiment'),
  duel: document.getElementById('view-duel'),
  rank: document.getElementById('view-rank'),
};

const totalCount    = document.getElementById('total-count');
const searchInput   = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const rankedList    = document.getElementById('ranked-list');

// ── VIEW ROUTER ─────────────────────────────────────────
function showView(name) {
  Object.keys(views).forEach(k => {
    views[k].classList.toggle('hidden', k !== name);
  });

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === name);
  });

  if (name === 'search') searchInput.focus();
  if (name === 'rank') renderRankedList();
  if (name === 'import') refreshImportView();
}

// ── SEARCH (UNCHANGED) ──────────────────────────────────
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  if (!q) return searchResults.innerHTML = '';
  searchTimer = setTimeout(() => searchFilms(q), 350);
});

// (keep your TMDB search code unchanged)

// ── DUPLICATE CHECK ─────────────────────────────────────
function isDuplicate(film) {
  return rankedFilms.some(f =>
    (film.id && f.id && f.id === film.id) ||
    (film.imdbId && f.imdbId && f.imdbId === film.imdbId)
  );
}

// ── ADD FILM ────────────────────────────────────────────
function addFilm(film) {
  if (isDuplicate(film)) return;

  pendingFilm = film;

  if (rankedFilms.length === 0) {
    rankedFilms.unshift(film);
    save();
    updateCount();
    afterInsert();
    return;
  }

  showSentimentScreen(film);
}

// ── SENTIMENT (UNCHANGED) ───────────────────────────────

// (your sentiment logic stays exactly the same)

// ── DUEL START ──────────────────────────────────────────
function startDuel() {
  if (duelLow >= duelHigh) {
    insertPending(duelLow);
    return;
  }

  const mid = Math.floor((duelLow + duelHigh) / 2);
  showView('duel');
  renderDuel(mid);
}

// ── 🔥 FIXED INSERT (NOW WITH VALIDATION) ───────────────
function insertPending(position) {
  rankedFilms.splice(position, 0, pendingFilm);
  save();
  updateCount();

  startValidation(position); // NEW
}

// ── 🔥 VALIDATION SYSTEM (NEW CORE FIX) ─────────────────
function startValidation(startIndex) {
  validationIndex = startIndex;
  runValidation();
}

function runValidation() {
  // Validate UPWARD
  if (validationIndex > 0) {
    const current = rankedFilms[validationIndex];
    const above   = rankedFilms[validationIndex - 1];

    showView('duel');
    setDuelSide('left', current);
    setDuelSide('right', above);

    document.getElementById('duel-left').dataset.validation = 'up';
    document.getElementById('duel-right').dataset.validation = 'up';
    return;
  }

  // Validate DOWNWARD
  if (validationIndex < rankedFilms.length - 1) {
    const current = rankedFilms[validationIndex];
    const below   = rankedFilms[validationIndex + 1];

    showView('duel');
    setDuelSide('left', current);
    setDuelSide('right', below);

    document.getElementById('duel-left').dataset.validation = 'down';
    document.getElementById('duel-right').dataset.validation = 'down';
    return;
  }

  // DONE
  const pos = validationIndex + 1;
  showToast(`"${rankedFilms[validationIndex].title}" ranked #${pos}`);

  pendingFilm = null;
  validationIndex = null;

  afterInsert();
}

// ── DUEL CLICK (UPDATED FOR VALIDATION) ────────────────
document.querySelectorAll('.duel-card').forEach(card => {
  card.addEventListener('click', () => {

    // 🔥 VALIDATION MODE
    if (card.dataset.validation) {
      const direction = card.dataset.validation;

      if (direction === 'up') {
        if (card.dataset.side === 'left') {
          [rankedFilms[validationIndex], rankedFilms[validationIndex - 1]] =
            [rankedFilms[validationIndex - 1], rankedFilms[validationIndex]];
          validationIndex--;
        } else {
          document.getElementById('duel-left').dataset.validation = '';
          document.getElementById('duel-right').dataset.validation = '';
        }
      }

      if (direction === 'down') {
        if (card.dataset.side === 'right') {
          [rankedFilms[validationIndex], rankedFilms[validationIndex + 1]] =
            [rankedFilms[validationIndex + 1], rankedFilms[validationIndex]];
          validationIndex++;
        } else {
          document.getElementById('duel-left').dataset.validation = '';
          document.getElementById('duel-right').dataset.validation = '';
        }
      }

      save();
      runValidation();
      return;
    }

    // ── NORMAL BINARY SEARCH ──
    const mid = parseInt(card.dataset.mid);

    if (card.dataset.side === 'left') {
      duelHigh = mid;
    } else {
      duelLow = mid + 1;
    }

    startDuel();
  });
});

// ── AFTER INSERT ───────────────────────────────────────
function afterInsert() {
  if (importQueue.length > 0) {
    const next = importQueue.shift();
    saveQueue();
    setTimeout(() => addFilm(next), 100);
  } else {
    clearQueue();
    showView('rank');
  }
}

// ── UTILITIES ──────────────────────────────────────────
function updateCount() {
  totalCount.textContent = rankedFilms.length;
}

function setDuelSide(side, film) {
  const img = document.getElementById(`duel-${side}-img`);
  const title = document.getElementById(`duel-${side}-title`);
  const year = document.getElementById(`duel-${side}-year`);

  img.src = film.poster || '';
  title.textContent = film.title;
  year.textContent = film.year || '';
}

// ── INIT ───────────────────────────────────────────────
updateCount();
showView('rank');