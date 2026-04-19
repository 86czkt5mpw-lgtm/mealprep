/* ── CONSTANTS ───────────────────────────────────────────────────────────────── */
const TARGETS = { cal: 2400, prot: 150, carb: 285, fat: 75 };
const MEALS   = ['colazione', 'pranzo', 'cena', 'snack'];
// Sostituisci 'DEMO_KEY' con la tua key USDA da https://api.nal.usda.gov/
const CONFIG = {
  usdaApiKey: 'DEMO_KEY',
};

const STORAGE = {
  recipes:     'mealprep_recipes',
  plans:       'mealprep_plans',
  customIngs:  'mealprep_custom_ingredients',
  lastExport:  'mealprep_last_export',
  prepChecked: 'mealprep_prep_checked',
};
const BACKUP_REMINDER_DAYS = 7;
const CAT_LABELS = { colazione: 'COLAZIONE', pranzo: 'PRANZO', cena: 'CENA', snack: 'SNACK' };
const DAY_NAMES  = ['DOM', 'LUN', 'MAR', 'MER', 'GIO', 'VEN', 'SAB'];

/* ── STATE ───────────────────────────────────────────────────────────────────── */
const state = {
  recipes:           [],
  plans:             {},
  customIngredients: [],
  selectedDate:      '',
  pickerTargetMeal:  null,
  pickerTargetDate:  null,
  pickerMode:        'ricette',
  weekOffset:        0,
  pianoView:         'giorno',
  copySource:           null, // { entry, meal, dateStr }
  copyTargetDays:       [],   // dateStr[] selezionati
  prepChecked:          new Set(), // ingredientIds già in casa
  pendingIngredientRow: null, // riga ricetta in attesa di nuovo ingrediente
};

/* ── DATE HELPERS ────────────────────────────────────────────────────────────── */
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function getWeekDays(baseDate, weekOffset) {
  const date = new Date(baseDate + 'T12:00:00');
  date.setDate(date.getDate() + weekOffset * 7);
  const dow = date.getDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(date);
  monday.setDate(date.getDate() + mondayOffset);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

function formatDateLabel(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase();
}

function dayNumber(dateStr) {
  return new Date(dateStr + 'T12:00:00').getDate();
}

function dayName(dateStr) {
  return DAY_NAMES[new Date(dateStr + 'T12:00:00').getDay()];
}

/* ── PLAN HELPERS ────────────────────────────────────────────────────────────── */
function ensurePlan(dateStr) {
  if (!state.plans[dateStr]) {
    state.plans[dateStr] = { colazione: [], pranzo: [], cena: [], snack: [], garmin: 0 };
  }
  return state.plans[dateStr];
}

function currentPlan() {
  return ensurePlan(state.selectedDate);
}

/* ── ENTRY HELPERS (recipe ID string OR inline ingredient object) ─────────────── */
function getEntryMacros(entry) {
  if (typeof entry === 'string') {
    const recipe = state.recipes.find(r => r.id === entry);
    return recipe ? calcRecipeMacros(recipe) : { cal: 0, prot: 0, carb: 0, fat: 0 };
  }
  if (entry && entry.type === 'ingredient') {
    const ing = allIngredients().find(i => i.id === entry.ingredientId);
    if (!ing) return { cal: 0, prot: 0, carb: 0, fat: 0 };
    const f = entry.grams / 100;
    return { cal: ing.cal * f, prot: ing.prot * f, carb: ing.carb * f, fat: ing.fat * f };
  }
  return { cal: 0, prot: 0, carb: 0, fat: 0 };
}

function getEntryLabel(entry) {
  if (typeof entry === 'string') {
    const recipe = state.recipes.find(r => r.id === entry);
    return recipe ? recipe.name : 'Ricetta eliminata';
  }
  if (entry && entry.type === 'ingredient') {
    const ing = allIngredients().find(i => i.id === entry.ingredientId);
    return ing ? `${ing.name} — ${entry.grams}g` : 'Ingrediente';
  }
  return '—';
}

/* ── INGREDIENTS MERGE ───────────────────────────────────────────────────────── */
// Returns base + custom ingredients merged. Custom entries have custom:true.
function allIngredients() {
  return [...INGREDIENTS, ...state.customIngredients];
}

/* ── MACRO UTILS ─────────────────────────────────────────────────────────────── */
function calcRecipeMacros(recipe) {
  if (recipe.type === 'product') return { ...recipe.macros };
  return recipe.ingredients.reduce((acc, item) => {
    const ing = allIngredients().find(i => i.id === item.ingredientId);
    if (!ing) return acc;
    const f = item.grams / 100;
    return { cal: acc.cal + ing.cal * f, prot: acc.prot + ing.prot * f,
             carb: acc.carb + ing.carb * f, fat: acc.fat + ing.fat * f };
  }, { cal: 0, prot: 0, carb: 0, fat: 0 });
}

function calcPlanMacros(dateStr) {
  const plan = state.plans[dateStr];
  if (!plan) return { cal: 0, prot: 0, carb: 0, fat: 0 };
  const t = { cal: 0, prot: 0, carb: 0, fat: 0 };
  MEALS.forEach(meal => {
    (plan[meal] || []).forEach(entry => {
      const m = getEntryMacros(entry);
      t.cal += m.cal; t.prot += m.prot; t.carb += m.carb; t.fat += m.fat;
    });
  });
  return t;
}

function effectiveCalTarget(dateStr) {
  const garmin = (state.plans[dateStr] || {}).garmin || 0;
  return TARGETS.cal + garmin;
}

function fmt(n) { return Math.round(n); }

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function barClass(pct) {
  if (pct > 1.05) return 'over';
  if (pct >= 0.85) return 'ok';
  if (pct >= 0.5)  return 'near';
  return '';
}

/* ── STORAGE ─────────────────────────────────────────────────────────────────── */
function saveState() {
  localStorage.setItem(STORAGE.recipes,    JSON.stringify(state.recipes));
  localStorage.setItem(STORAGE.plans,      JSON.stringify(state.plans));
  localStorage.setItem(STORAGE.customIngs, JSON.stringify(state.customIngredients));
}

function loadState() {
  const storedRecipes = localStorage.getItem(STORAGE.recipes);
  state.recipes = storedRecipes
    ? JSON.parse(storedRecipes)
    : DEFAULT_RECIPES.map(r => ({ ...r, ingredients: r.ingredients.map(i => ({ ...i })) }));

  const storedPlans = localStorage.getItem(STORAGE.plans);
  if (storedPlans) {
    state.plans = JSON.parse(storedPlans);
  } else {
    state.plans = {};
    // Migrate old single-plan format if present
    const oldPlan = localStorage.getItem('mealprep_current_plan');
    const oldGarmin = localStorage.getItem('mealprep_garmin');
    if (oldPlan) {
      const parsed = JSON.parse(oldPlan);
      const today = todayStr();
      state.plans[today] = { ...parsed, garmin: Number(oldGarmin) || 0 };
    }
  }

  const storedCustom = localStorage.getItem(STORAGE.customIngs);
  state.customIngredients = storedCustom ? JSON.parse(storedCustom) : [];

  const storedPrepChecked = localStorage.getItem(STORAGE.prepChecked);
  state.prepChecked = storedPrepChecked ? new Set(JSON.parse(storedPrepChecked)) : new Set();

  state.selectedDate = todayStr();
  state.weekOffset   = 0;
}

/* ── RENDER: WEEK STRIP ──────────────────────────────────────────────────────── */
function renderWeekStrip() {
  const today = todayStr();
  const days  = getWeekDays(today, state.weekOffset);
  const strip = document.getElementById('week-strip');

  strip.innerHTML = days.map(dateStr => {
    const plan    = state.plans[dateStr];
    const macros  = plan ? calcPlanMacros(dateStr) : null;
    const calTgt  = effectiveCalTarget(dateStr);
    const pct     = macros ? Math.min(macros.cal / calTgt, 1) : 0;
    const cls     = macros ? barClass(macros.cal / calTgt) : '';
    const isToday  = dateStr === today;
    const isActive = dateStr === state.selectedDate;

    return `<button class="week-day-btn ${isActive ? 'active' : ''} ${isToday ? 'is-today' : ''}"
      data-date="${dateStr}">
      <span class="wd-name">${dayName(dateStr)}</span>
      <span class="wd-num">${dayNumber(dateStr)}</span>
      <div class="wd-bar-track">
        <div class="wd-bar-fill ${cls}" style="width:${Math.round(pct * 100)}%"></div>
      </div>
    </button>`;
  }).join('');

  strip.querySelectorAll('.week-day-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.selectedDate = btn.dataset.date;
      renderWeekStrip();
      if (state.pianoView === 'giorno') renderPiano();
      else renderWeekOverview();
    });
  });
}

/* ── RENDER: PIANO ───────────────────────────────────────────────────────────── */
function renderPiano() {
  document.getElementById('piano-date').textContent = formatDateLabel(state.selectedDate);
  const plan = currentPlan();
  document.getElementById('garmin-input').value = plan.garmin || '';
  renderMacroBars();
  renderMealSlots();
}

function renderMealSlots() {
  const plan = currentPlan();
  MEALS.forEach(meal => {
    const container = document.getElementById(`meal-${meal}`);
    const entries   = plan[meal] || [];
    container.innerHTML = entries.map((entry, idx) => {
      const m     = getEntryMacros(entry);
      const label = getEntryLabel(entry);
      return `<div class="meal-recipe-card">
        <div>
          <div class="meal-recipe-name">${label}</div>
          <div class="meal-recipe-macros">${fmt(m.cal)} kcal &middot; ${fmt(m.prot)}g P &middot; ${fmt(m.carb)}g C &middot; ${fmt(m.fat)}g F</div>
        </div>
        <button class="meal-recipe-remove" data-meal="${meal}" data-idx="${idx}" title="Rimuovi">✕</button>
      </div>`;
    }).join('');

    container.querySelectorAll('.meal-recipe-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const m   = btn.dataset.meal;
        const idx = parseInt(btn.dataset.idx, 10);
        currentPlan()[m].splice(idx, 1);
        saveState();
        renderMacroBars();
        renderMealSlots();
        renderWeekStrip();
      });
    });
  });
}

function renderMacroBars() {
  const macros  = calcPlanMacros(state.selectedDate);
  const calTgt  = effectiveCalTarget(state.selectedDate);
  const targets = { cal: calTgt, prot: TARGETS.prot, carb: TARGETS.carb, fat: TARGETS.fat };

  const stats = [
    { label: 'KCAL',   val: macros.cal,  target: targets.cal  },
    { label: 'PROT',   val: macros.prot, target: targets.prot },
    { label: 'CARB',   val: macros.carb, target: targets.carb },
    { label: 'GRASSI', val: macros.fat,  target: targets.fat  },
  ];

  document.getElementById('macro-totals').innerHTML = stats.map(s => {
    const pct = s.target > 0 ? s.val / s.target : 0;
    const cls = barClass(pct);
    return `<div class="macro-stat">
      <span class="macro-stat-label">${s.label}</span>
      <span class="macro-stat-value ${cls}">${fmt(s.val)}</span>
      <span class="macro-stat-target">/ ${fmt(s.target)}</span>
    </div>`;
  }).join('');

  document.getElementById('macro-bars').innerHTML = stats.map(s => {
    const pct     = s.target > 0 ? s.val / s.target : 0;
    const fillPct = Math.min(Math.round(pct * 100), 100);
    const cls     = barClass(pct);
    return `<div class="macro-bar-row">
      <span class="macro-bar-name">${s.label}</span>
      <div class="macro-bar-track">
        <div class="macro-bar-fill ${cls}" style="width:${fillPct}%"></div>
      </div>
      <span class="macro-bar-pct">${Math.round(pct * 100)}%</span>
    </div>`;
  }).join('');
}

/* ── PICKER MODAL ────────────────────────────────────────────────────────────── */
function openRecipePicker(meal, dateStr = state.selectedDate) {
  state.pickerTargetMeal = meal;
  state.pickerTargetDate = dateStr;
  state.pickerMode = 'ricette';
  switchPickerMode('ricette');
  document.getElementById('recipe-picker-modal').classList.remove('hidden');
}

function closeRecipePicker() {
  document.getElementById('recipe-picker-modal').classList.add('hidden');
  state.pickerTargetMeal = null;
}

function switchPickerMode(mode) {
  state.pickerMode = mode;

  document.querySelectorAll('.picker-mode-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.mode === mode);
  });

  const listEl = document.getElementById('recipe-picker-list');
  const ingEl  = document.getElementById('ingredient-picker-form');

  if (mode === 'ricette') {
    listEl.classList.remove('hidden');
    ingEl.classList.add('hidden');
    renderPickerRecipeList();
  } else {
    listEl.classList.add('hidden');
    ingEl.classList.remove('hidden');
    renderIngredientPickerForm();
  }
}

function renderPickerRecipeList() {
  const list = document.getElementById('recipe-picker-list');
  if (state.recipes.length === 0) {
    list.innerHTML = '<p style="color:var(--muted);font-size:13px">Nessuna ricetta nel database.</p>';
    return;
  }
  list.innerHTML = state.recipes.map(recipe => {
    const m = calcRecipeMacros(recipe);
    return `<div class="picker-recipe-item" data-id="${recipe.id}">
      <span class="picker-recipe-name">${recipe.name}</span>
      <span class="picker-recipe-cal">${fmt(m.cal)} kcal</span>
    </div>`;
  }).join('');

  list.querySelectorAll('.picker-recipe-item').forEach(item => {
    item.addEventListener('click', () => {
      ensurePlan(state.pickerTargetDate)[state.pickerTargetMeal].push(item.dataset.id);
      saveState();
      if (state.pianoView === 'giorno') { renderMacroBars(); renderMealSlots(); }
      else renderWeekOverview();
      renderWeekStrip();
      closeRecipePicker();
    });
  });
}

function renderIngredientPickerForm() {
  const select = document.getElementById('picker-ing-select');
  select.innerHTML = '<option value="">— scegli ingrediente —</option>'
    + allIngredients().map(i => `<option value="${i.id}">${i.name}${i.custom ? ' ★' : ''}</option>`).join('');
  document.getElementById('picker-ing-grams').value = '';
  document.getElementById('picker-ing-preview').innerHTML = '';
}

function updateIngredientPickerPreview() {
  const ingId = document.getElementById('picker-ing-select').value;
  const grams = parseFloat(document.getElementById('picker-ing-grams').value) || 0;
  const preview = document.getElementById('picker-ing-preview');

  if (!ingId || !grams) { preview.innerHTML = ''; return; }
  const ing = allIngredients().find(i => i.id === ingId);
  if (!ing) return;
  const f = grams / 100;
  const m = { cal: ing.cal * f, prot: ing.prot * f, carb: ing.carb * f, fat: ing.fat * f };

  preview.innerHTML = `
    <div class="picker-ing-preview-stat"><div class="picker-ing-preview-val">${fmt(m.cal)}</div><div class="picker-ing-preview-label">KCAL</div></div>
    <div class="picker-ing-preview-stat"><div class="picker-ing-preview-val">${fmt(m.prot)}</div><div class="picker-ing-preview-label">PROT</div></div>
    <div class="picker-ing-preview-stat"><div class="picker-ing-preview-val">${fmt(m.carb)}</div><div class="picker-ing-preview-label">CARB</div></div>
    <div class="picker-ing-preview-stat"><div class="picker-ing-preview-val">${fmt(m.fat)}</div><div class="picker-ing-preview-label">GRAS</div></div>`;
}

function confirmIngredientPicker() {
  const ingId = document.getElementById('picker-ing-select').value;
  const grams = parseFloat(document.getElementById('picker-ing-grams').value) || 0;
  if (!ingId || !grams) return;

  ensurePlan(state.pickerTargetDate)[state.pickerTargetMeal].push({ type: 'ingredient', ingredientId: ingId, grams });
  saveState();
  if (state.pianoView === 'giorno') { renderMacroBars(); renderMealSlots(); }
  else renderWeekOverview();
  renderWeekStrip();
  closeRecipePicker();
}

/* ── RENDER: RICETTE ─────────────────────────────────────────────────────────── */
function renderRecipes() {
  const grid = document.getElementById('recipe-grid');
  if (state.recipes.length === 0) {
    grid.innerHTML = '<p style="color:var(--muted);font-size:14px">Nessuna ricetta. Creane una con "+ NUOVA RICETTA".</p>';
    return;
  }
  grid.innerHTML = state.recipes.map(recipe => {
    const m      = calcRecipeMacros(recipe);
    const cat    = recipe.category || 'snack';
    const isProd = recipe.type === 'product';
    return `<div class="recipe-card">
      <div class="cat-badge cat-${cat}"></div>
      <button class="recipe-card-delete" data-id="${recipe.id}" title="Elimina">✕</button>
      <div class="recipe-card-name">${recipe.name}${isProd ? '<span class="ing-custom-badge prod-badge">PRODOTTO</span>' : ''}</div>
      <div class="recipe-card-category">${CAT_LABELS[cat] || cat}</div>
      <div class="recipe-card-macros">
        <div class="recipe-macro"><div class="recipe-macro-val">${fmt(m.cal)}</div><div class="recipe-macro-label">KCAL</div></div>
        <div class="recipe-macro"><div class="recipe-macro-val">${fmt(m.prot)}</div><div class="recipe-macro-label">PROT</div></div>
        <div class="recipe-macro"><div class="recipe-macro-val">${fmt(m.carb)}</div><div class="recipe-macro-label">CARB</div></div>
        <div class="recipe-macro"><div class="recipe-macro-val">${fmt(m.fat)}</div><div class="recipe-macro-label">GRAS</div></div>
      </div>
    </div>`;
  }).join('');

  grid.querySelectorAll('.recipe-card-delete').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.id;
      state.recipes = state.recipes.filter(r => r.id !== id);
      // Remove from all plans
      Object.values(state.plans).forEach(plan => {
        MEALS.forEach(meal => {
          plan[meal] = (plan[meal] || []).filter(entry => entry !== id);
        });
      });
      saveState();
      renderRecipes();
      renderMacroBars();
      renderMealSlots();
    });
  });
}

/* ── RECIPE BUILDER ──────────────────────────────────────────────────────────── */
function openRecipeBuilder() {
  document.getElementById('recipe-name-input').value = '';
  document.getElementById('recipe-category-input').value = 'snack';
  document.getElementById('builder-ingredients').innerHTML = '';
  switchBuilderType('ricetta');
  ['product-cal','product-prot','product-carb','product-fat'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('product-search-input').value = '';
  document.getElementById('product-search-results').classList.add('hidden');
  document.getElementById('product-search-mode').classList.add('hidden');
  updateBuilderPreview();
  addIngredientRow();
  document.getElementById('recipe-builder-modal').classList.remove('hidden');
}

function closeRecipeBuilder() {
  document.getElementById('recipe-builder-modal').classList.add('hidden');
}

function switchBuilderType(type) {
  document.querySelectorAll('.builder-type-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === type);
  });
  document.getElementById('builder-ricetta-section').classList.toggle('hidden', type !== 'ricetta');
  document.getElementById('builder-prodotto-section').classList.toggle('hidden', type !== 'prodotto');
  if (type === 'prodotto') updateProductPreview();
  else updateBuilderPreview();
}

function updateProductPreview() {
  const cal  = parseFloat(document.getElementById('product-cal').value)  || 0;
  const prot = parseFloat(document.getElementById('product-prot').value) || 0;
  const carb = parseFloat(document.getElementById('product-carb').value) || 0;
  const fat  = parseFloat(document.getElementById('product-fat').value)  || 0;
  document.getElementById('builder-preview').innerHTML = `
    <div class="builder-preview-stat"><div class="builder-preview-val">${fmt(cal)}</div><div class="builder-preview-label">KCAL</div></div>
    <div class="builder-preview-stat"><div class="builder-preview-val">${fmt(prot)}</div><div class="builder-preview-label">PROT</div></div>
    <div class="builder-preview-stat"><div class="builder-preview-val">${fmt(carb)}</div><div class="builder-preview-label">CARB</div></div>
    <div class="builder-preview-stat"><div class="builder-preview-val">${fmt(fat)}</div><div class="builder-preview-label">GRAS</div></div>`;
}

function applyProductSearchResult(result) {
  if (!document.getElementById('recipe-name-input').value.trim()) {
    document.getElementById('recipe-name-input').value = result.name;
  }
  document.getElementById('product-cal').value  = result.cal;
  document.getElementById('product-prot').value = result.prot;
  document.getElementById('product-carb').value = result.carb;
  document.getElementById('product-fat').value  = result.fat;
  updateProductPreview();
}

let productSearchDebounceTimer = null;

async function handleProductSearch(query) {
  const modeEl    = document.getElementById('product-search-mode');
  const resultsEl = document.getElementById('product-search-results');

  if (query.length < 2) {
    resultsEl.classList.add('hidden');
    modeEl.classList.add('hidden');
    return;
  }

  const barcode = isBarcode(query);
  modeEl.textContent = barcode ? '▸ BARCODE RILEVATO — ricerca su Open Food Facts' : '▸ RICERCA TESTUALE — USDA + Open Food Facts';
  modeEl.className   = `ing-search-mode ${barcode ? 'barcode' : ''}`;

  resultsEl.innerHTML = '<div class="ing-search-loading">Ricerca in corso...</div>';
  resultsEl.classList.remove('hidden');

  try {
    let results = [];
    if (barcode) {
      results = await searchByBarcode(query);
      if (results.length === 0) {
        resultsEl.innerHTML = '<div class="ing-search-loading">Barcode non trovato su Open Food Facts.</div>';
        return;
      }
    } else {
      const [usdaRes, offRes] = await Promise.allSettled([searchUSDA(query), searchOpenFoodFacts(query)]);
      const usda = usdaRes.status === 'fulfilled' ? usdaRes.value : [];
      const off  = offRes.status  === 'fulfilled' ? offRes.value  : [];
      const maxLen = Math.max(usda.length, off.length);
      for (let i = 0; i < maxLen && results.length < 8; i++) {
        if (usda[i]) results.push(usda[i]);
        if (off[i])  results.push(off[i]);
      }
    }
    if (results.length === 0) {
      resultsEl.innerHTML = '<div class="ing-search-loading">Nessun risultato.</div>';
      return;
    }
    resultsEl.innerHTML = results.map((r, i) => `
      <div class="ing-search-result" data-idx="${i}">
        <span class="ing-source-badge ${r.source.toLowerCase()}">${r.source}</span>
        <span class="ing-search-result-name" title="${r.name}">${r.name}</span>
        <span class="ing-search-result-macros">${r.cal} kcal · ${r.prot}P · ${r.carb}C · ${r.fat}F</span>
      </div>`).join('');
    resultsEl.querySelectorAll('.ing-search-result').forEach(el => {
      el.addEventListener('click', () => {
        applyProductSearchResult(results[parseInt(el.dataset.idx, 10)]);
        resultsEl.classList.add('hidden');
      });
    });
  } catch (err) {
    console.error('Product search error:', err);
    resultsEl.innerHTML = '<div class="ing-search-loading">Errore di rete. Controlla la connessione.</div>';
  }
}

function addIngredientRow() {
  const container = document.getElementById('builder-ingredients');
  const row = document.createElement('div');
  row.className = 'builder-ingredient-row';
  row.dataset.ingId = '';

  const acWrapper = document.createElement('div');
  acWrapper.className = 'builder-ac-wrapper';

  const acInput = document.createElement('input');
  acInput.type = 'text';
  acInput.className = 'mono-input builder-ac-input';
  acInput.placeholder = '— cerca ingrediente —';
  acInput.autocomplete = 'off';

  const acDropdown = document.createElement('div');
  acDropdown.className = 'builder-ac-dropdown hidden';

  acWrapper.append(acInput, acDropdown);

  acInput.addEventListener('input', () => {
    row.dataset.ingId = '';
    updateBuilderPreview();
    const query = acInput.value.trim();
    if (!query) { acDropdown.classList.add('hidden'); return; }
    const matches = allIngredients()
      .filter(i => i.name.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 8);
    renderBuilderAcDropdown(acDropdown, acInput, row, matches, query);
  });

  acInput.addEventListener('focus', () => {
    const query = acInput.value.trim();
    if (query && !row.dataset.ingId) acInput.dispatchEvent(new Event('input'));
  });

  const gramsInput = document.createElement('input');
  gramsInput.type = 'number'; gramsInput.className = 'mono-input';
  gramsInput.placeholder = 'g'; gramsInput.min = '0'; gramsInput.max = '2000';
  gramsInput.addEventListener('input', updateBuilderPreview);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'remove-row-btn'; removeBtn.textContent = '✕'; removeBtn.type = 'button';
  removeBtn.addEventListener('click', () => { row.remove(); updateBuilderPreview(); });

  row.append(acWrapper, gramsInput, removeBtn);
  container.appendChild(row);
  return row;
}

function renderBuilderAcDropdown(dropdown, input, row, matches, rawQuery) {
  let html = matches.map(ing =>
    `<div class="builder-ac-item" data-id="${ing.id}" data-name="${ing.name}">
      <span class="builder-ac-name">${ing.name}</span>
      <span class="builder-ac-cat">${ing.category}</span>
    </div>`
  ).join('');

  html += `<div class="builder-ac-item builder-ac-create" data-create="${rawQuery}">
    <span>+ Aggiungi "<strong>${rawQuery}</strong>" come nuovo ingrediente</span>
  </div>`;

  dropdown.innerHTML = html;
  dropdown.classList.remove('hidden');

  dropdown.querySelectorAll('.builder-ac-item:not(.builder-ac-create)').forEach(item => {
    item.addEventListener('click', () => {
      row.dataset.ingId = item.dataset.id;
      input.value = item.dataset.name;
      dropdown.classList.add('hidden');
      updateBuilderPreview();
    });
  });

  dropdown.querySelector('.builder-ac-create').addEventListener('click', () => {
    dropdown.classList.add('hidden');
    openIngredientBuilderFromRecipe(rawQuery, row);
  });
}

function openIngredientBuilderFromRecipe(name, row) {
  state.pendingIngredientRow = row;
  openIngredientBuilder();
  document.getElementById('ing-name-input').value = name;
}

function updateBuilderPreview() {
  const totals = { cal: 0, prot: 0, carb: 0, fat: 0 };
  document.querySelectorAll('.builder-ingredient-row').forEach(row => {
    const ingId = row.dataset.ingId;
    const grams = parseFloat(row.querySelector('input[type="number"]')?.value) || 0;
    if (!ingId || !grams) return;
    const ing = allIngredients().find(i => i.id === ingId);
    if (!ing) return;
    const f = grams / 100;
    totals.cal += ing.cal * f; totals.prot += ing.prot * f;
    totals.carb += ing.carb * f; totals.fat += ing.fat * f;
  });
  document.getElementById('builder-preview').innerHTML = `
    <div class="builder-preview-stat"><div class="builder-preview-val">${fmt(totals.cal)}</div><div class="builder-preview-label">KCAL</div></div>
    <div class="builder-preview-stat"><div class="builder-preview-val">${fmt(totals.prot)}</div><div class="builder-preview-label">PROT</div></div>
    <div class="builder-preview-stat"><div class="builder-preview-val">${fmt(totals.carb)}</div><div class="builder-preview-label">CARB</div></div>
    <div class="builder-preview-stat"><div class="builder-preview-val">${fmt(totals.fat)}</div><div class="builder-preview-label">GRAS</div></div>`;
}

function saveNewRecipe() {
  const name     = document.getElementById('recipe-name-input').value.trim();
  const category = document.getElementById('recipe-category-input').value;
  if (!name) { document.getElementById('recipe-name-input').focus(); return; }

  const isProduct = document.querySelector('.builder-type-btn[data-type="prodotto"]').classList.contains('active');

  if (isProduct) {
    const cal  = parseFloat(document.getElementById('product-cal').value)  || 0;
    const prot = parseFloat(document.getElementById('product-prot').value) || 0;
    const carb = parseFloat(document.getElementById('product-carb').value) || 0;
    const fat  = parseFloat(document.getElementById('product-fat').value)  || 0;
    if (cal === 0 && prot === 0 && carb === 0 && fat === 0) return;
    state.recipes.push({ id: uid(), name, category, type: 'product', macros: { cal, prot, carb, fat } });
  } else {
    const ingredients = [];
    document.querySelectorAll('.builder-ingredient-row').forEach(row => {
      const ingId = row.dataset.ingId;
      const grams = parseFloat(row.querySelector('input[type="number"]')?.value) || 0;
      if (ingId && grams > 0) ingredients.push({ ingredientId: ingId, grams });
    });
    if (ingredients.length === 0) return;
    state.recipes.push({ id: uid(), name, category, ingredients });
  }

  saveState();
  renderRecipes();
  closeRecipeBuilder();
}

/* ── RENDER: PREP ────────────────────────────────────────────────────────────── */
function renderPrep() {
  const days      = parseInt(document.getElementById('prep-days').value, 10) || 5;
  const container = document.getElementById('prep-content');
  const today     = todayStr();

  // Build list of next N days from today
  const dates = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(today + 'T12:00:00');
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }

  // Aggregate across all planned days
  const ingTotals    = {};
  const recipeCounts = {};
  let   hasAny       = false;

  dates.forEach(dateStr => {
    const plan = state.plans[dateStr];
    if (!plan) return;
    MEALS.forEach(meal => {
      (plan[meal] || []).forEach(entry => {
        hasAny = true;
        if (typeof entry === 'string') {
          recipeCounts[entry] = (recipeCounts[entry] || 0) + 1;
          const recipe = state.recipes.find(r => r.id === entry);
          if (recipe && recipe.ingredients) {
            recipe.ingredients.forEach(item => {
              ingTotals[item.ingredientId] = (ingTotals[item.ingredientId] || 0) + item.grams;
            });
          }
        } else if (entry.type === 'ingredient') {
          ingTotals[entry.ingredientId] = (ingTotals[entry.ingredientId] || 0) + entry.grams;
        }
        // Products: nessun ingrediente da aggregare
      });
    });
  });

  const fromLabel = formatDateLabel(dates[0]);
  const toLabel   = formatDateLabel(dates[dates.length - 1]);

  if (!hasAny) {
    container.innerHTML = `<p class="prep-empty">Nessun pasto pianificato dal <strong>${fromLabel}</strong> al <strong>${toLabel}</strong>.<br>Vai su <strong>PIANO</strong> e aggiungi pasti ai giorni.</p>`;
    return;
  }

  let html = `<p class="prep-range-label">${fromLabel} → ${toLabel}</p>`;

  // --- Lista cottura ---
  if (Object.keys(recipeCounts).length > 0) {
    html += '<p class="prep-section-title">RICETTE DA CUCINARE</p>';
    html += '<table class="prep-table"><thead><tr><th>RICETTA</th><th>PORZIONI</th><th>KCAL TOTALI</th></tr></thead><tbody>';
    Object.entries(recipeCounts).forEach(([rid, count]) => {
      const recipe = state.recipes.find(r => r.id === rid);
      if (!recipe) return;
      const m = calcRecipeMacros(recipe);
      html += `<tr><td>${recipe.name}</td><td>${count}×</td><td>${fmt(m.cal * count)}</td></tr>`;
    });
    html += '</tbody></table>';
  }

  // --- Lista spesa con checkbox ---
  const sortedIng = Object.entries(ingTotals).sort(([a], [b]) => {
    const ia = allIngredients().find(i => i.id === a);
    const ib = allIngredients().find(i => i.id === b);
    if (!ia || !ib) return 0;
    return ia.category !== ib.category
      ? ia.category.localeCompare(ib.category)
      : ia.name.localeCompare(ib.name);
  });

  const unchecked = sortedIng.filter(([id]) => !state.prepChecked.has(id));
  const checked   = sortedIng.filter(([id]) =>  state.prepChecked.has(id));

  html += '<p class="prep-section-title">LISTA SPESA</p>';
  html += '<table class="prep-table prep-shopping-table"><thead><tr><th></th><th>INGREDIENTE</th><th>CATEGORIA</th><th>QUANTITÀ</th></tr></thead><tbody>';

  [...unchecked, ...checked].forEach(([ingId, totalGrams]) => {
    const ing = allIngredients().find(i => i.id === ingId);
    if (!ing) return;
    const isChecked = state.prepChecked.has(ingId);
    const display   = totalGrams >= 1000
      ? `${(totalGrams / 1000).toFixed(2).replace('.', ',')} kg`
      : `${Math.round(totalGrams)} g`;
    html += `<tr class="${isChecked ? 'prep-checked-row' : ''}">
      <td><button class="prep-check-btn ${isChecked ? 'checked' : ''}" data-ing="${ingId}">✓</button></td>
      <td>${ing.name}</td>
      <td style="color:var(--muted)">${ing.category}</td>
      <td>${display}</td>
    </tr>`;
  });

  html += '</tbody></table>';
  container.innerHTML = html;

  container.querySelectorAll('.prep-check-btn').forEach(btn => {
    btn.addEventListener('click', () => togglePrepCheck(btn.dataset.ing));
  });
}

function togglePrepCheck(ingId) {
  if (state.prepChecked.has(ingId)) state.prepChecked.delete(ingId);
  else state.prepChecked.add(ingId);
  localStorage.setItem(STORAGE.prepChecked, JSON.stringify([...state.prepChecked]));
  renderPrep();
}

function resetPrepSession() {
  state.prepChecked.clear();
  localStorage.setItem(STORAGE.prepChecked, JSON.stringify([]));
  renderPrep();
}

/* ── RENDER: WEEK OVERVIEW ───────────────────────────────────────────────────── */
function renderWeekOverview() {
  const today   = todayStr();
  // Show 2 weeks: current + next, so user can scroll forward without clicking →
  const days    = [
    ...getWeekDays(today, state.weekOffset),
    ...getWeekDays(today, state.weekOffset + 1),
  ];
  const container = document.getElementById('week-overview');

  container.innerHTML = days.map(dateStr => {
    const plan    = state.plans[dateStr] || {};
    const macros  = calcPlanMacros(dateStr);
    const calTgt  = effectiveCalTarget(dateStr);
    const pct     = calTgt > 0 ? Math.min(macros.cal / calTgt, 1) : 0;
    const cls     = barClass(macros.cal / calTgt);
    const isToday    = dateStr === today;
    const isSelected = dateStr === state.selectedDate;

    const mealsHtml = MEALS.map(meal => {
      const entries = plan[meal] || [];
      const chipsHtml = entries.map((entry, idx) => {
        const label = getEntryLabel(entry);
        return `<div class="wov-chip">
          <span class="wov-chip-name" title="${label}">${label}</span>
          <button class="wov-chip-copy" data-date="${dateStr}" data-meal="${meal}" data-idx="${idx}" title="Copia in altri giorni">⊕</button>
          <button class="wov-chip-remove" data-date="${dateStr}" data-meal="${meal}" data-idx="${idx}">✕</button>
        </div>`;
      }).join('');

      return `<div class="wov-meal">
        <span class="wov-meal-label">${CAT_LABELS[meal]}</span>
        <div class="wov-chips">${chipsHtml}</div>
        <button class="wov-add-btn" data-date="${dateStr}" data-meal="${meal}">+</button>
      </div>`;
    }).join('');

    return `<div class="wov-col ${isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''}" data-date="${dateStr}">
      <div class="wov-header" data-date="${dateStr}">
        <span class="wov-day-name">${dayName(dateStr)}</span>
        <span class="wov-day-num">${dayNumber(dateStr)}</span>
        <div class="wov-cal-bar">
          <div class="wov-cal-fill ${cls}" style="width:${Math.round(pct * 100)}%"></div>
        </div>
      </div>
      <div class="wov-meals">${mealsHtml}</div>
    </div>`;
  }).join('');

  // Header click → switch to day view on that date
  container.querySelectorAll('.wov-header').forEach(el => {
    el.addEventListener('click', () => {
      state.selectedDate = el.dataset.date;
      switchPianoView('giorno');
    });
  });

  // Add button → open picker for that day+meal
  container.querySelectorAll('.wov-add-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openRecipePicker(btn.dataset.meal, btn.dataset.date);
    });
  });

  // Copy chip to other days
  container.querySelectorAll('.wov-chip-copy').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const { date, meal, idx } = btn.dataset;
      const entry = ensurePlan(date)[meal][parseInt(idx, 10)];
      openCopyDayModal(entry, meal, date);
    });
  });

  // Remove chip
  container.querySelectorAll('.wov-chip-remove').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const { date, meal, idx } = btn.dataset;
      ensurePlan(date)[meal].splice(parseInt(idx, 10), 1);
      saveState();
      renderWeekOverview();
      renderWeekStrip();
    });
  });
}

/* ── COPY DAY MODAL ──────────────────────────────────────────────────────────── */
function openCopyDayModal(entry, meal, sourceDate) {
  state.copySource     = { entry, meal, dateStr: sourceDate };
  state.copyTargetDays = [];

  document.getElementById('copy-day-item-label').textContent = getEntryLabel(entry);

  const today = todayStr();
  const days  = [
    ...getWeekDays(today, state.weekOffset),
    ...getWeekDays(today, state.weekOffset + 1),
  ];
  const grid  = document.getElementById('copy-day-grid');

  grid.innerHTML = days.map(dateStr => {
    const isSource = dateStr === sourceDate;
    return `<button class="copy-day-btn ${isSource ? 'is-source' : ''}" data-date="${dateStr}" ${isSource ? 'disabled' : ''}>
      <span class="cd-name">${dayName(dateStr)}</span>
      <span class="cd-num">${dayNumber(dateStr)}</span>
    </button>`;
  }).join('');

  grid.querySelectorAll('.copy-day-btn:not(.is-source)').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = btn.dataset.date;
      if (state.copyTargetDays.includes(d)) {
        state.copyTargetDays = state.copyTargetDays.filter(x => x !== d);
        btn.classList.remove('selected');
      } else {
        state.copyTargetDays.push(d);
        btn.classList.add('selected');
      }
    });
  });

  document.getElementById('copy-day-modal').classList.remove('hidden');
}

function closeCopyDayModal() {
  document.getElementById('copy-day-modal').classList.add('hidden');
  state.copySource     = null;
  state.copyTargetDays = [];
}

function applyCopyToDays() {
  if (!state.copySource || state.copyTargetDays.length === 0) {
    closeCopyDayModal();
    return;
  }
  const { entry, meal } = state.copySource;
  state.copyTargetDays.forEach(dateStr => {
    const plan = ensurePlan(dateStr);
    // Evita duplicati esatti
    const alreadyPresent = plan[meal].some(e => JSON.stringify(e) === JSON.stringify(entry));
    if (!alreadyPresent) plan[meal].push(typeof entry === 'string' ? entry : { ...entry });
  });
  saveState();
  renderWeekOverview();
  renderWeekStrip();
  closeCopyDayModal();
}

/* ── VIEW TOGGLE ─────────────────────────────────────────────────────────────── */
function switchPianoView(view) {
  state.pianoView = view;
  document.querySelectorAll('.view-toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  document.getElementById('piano-giorno-view').classList.toggle('hidden', view !== 'giorno');
  document.getElementById('piano-settimana-view').classList.toggle('hidden', view !== 'settimana');

  if (view === 'giorno') {
    renderPiano();
    renderWeekStrip();
  } else {
    renderWeekOverview();
  }
}

/* ── RENDER: INGREDIENTI ─────────────────────────────────────────────────────── */
function renderIngredients() {
  const container  = document.getElementById('ingredients-table');
  const all        = allIngredients();
  const categories = ['proteine', 'carboidrati', 'grassi', 'verdure', 'frutta', 'altro'];

  let html = '<table class="ing-table"><thead><tr>'
    + '<th>NOME</th><th>CATEGORIA</th><th>KCAL</th><th>PROT g</th><th>CARB g</th><th>GRAS g</th><th></th>'
    + '</tr></thead><tbody>';

  categories.forEach(cat => {
    const items = all.filter(i => i.category === cat);
    if (items.length === 0) return;
    html += `<tr class="ing-category-row"><td colspan="7">${cat.toUpperCase()}</td></tr>`;
    items.forEach(ing => {
      const isCustom = !!ing.custom;
      const badge    = isCustom ? '<span class="ing-custom-badge">CUSTOM</span>' : '';
      const del      = isCustom
        ? `<button class="ing-delete-btn" data-id="${ing.id}" title="Elimina">✕</button>`
        : '';
      html += `<tr>
        <td>${ing.name}${badge}</td>
        <td style="color:var(--muted)">${ing.category}</td>
        <td>${ing.cal}</td><td>${ing.prot}</td><td>${ing.carb}</td><td>${ing.fat}</td>
        <td>${del}</td>
      </tr>`;
    });
  });

  container.innerHTML = html + '</tbody></table>';

  container.querySelectorAll('.ing-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.customIngredients = state.customIngredients.filter(i => i.id !== btn.dataset.id);
      saveState();
      renderIngredients();
    });
  });
}

/* ── INGREDIENT SEARCH ───────────────────────────────────────────────────────── */
let searchDebounceTimer = null;

function guessCategoryFromMacros(prot, carb, fat, cal) {
  if (prot >= 15)             return 'proteine';
  if (fat >= 20)              return 'grassi';
  if (carb >= 40 && fat < 10) return 'carboidrati';
  if (cal < 50)               return 'verdure';
  return 'altro';
}

async function searchUSDA(query) {
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(query)}&api_key=${CONFIG.usdaApiKey}&pageSize=4&dataType=Foundation,SR%20Legacy`;
  const res  = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();

  return (data.foods || []).map(food => {
    const get = id => {
      const n = (food.foodNutrients || []).find(n => n.nutrientId === id);
      return n ? Math.round(n.value * 10) / 10 : 0;
    };
    const cal  = Math.round(get(1008));
    const prot = get(1003);
    const carb = get(1005);
    const fat  = get(1004);
    return {
      name:     food.description,
      source:   'USDA',
      cal, prot, carb, fat,
      category: guessCategoryFromMacros(prot, carb, fat, cal),
    };
  });
}

async function searchOpenFoodFacts(query) {
  const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&json=true&fields=product_name,generic_name,nutriments&page_size=4&action=process`;
  const res  = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();

  return (data.products || [])
    .filter(p => p.nutriments)
    .map(p => {
      const n    = p.nutriments;
      const cal  = offKcal(n);
      const prot = Math.round((n['proteins_100g']       || 0) * 10) / 10;
      const carb = Math.round((n['carbohydrates_100g']  || 0) * 10) / 10;
      const fat  = Math.round((n['fat_100g']            || 0) * 10) / 10;
      return {
        name:     p.product_name || p.generic_name || '—',
        source:   'OFF',
        cal, prot, carb, fat,
        category: guessCategoryFromMacros(prot, carb, fat, cal),
      };
    })
    .filter(p => p.name && p.name !== '—');
}

function renderSearchResults(results, isLoading = false) {
  const container = document.getElementById('ing-search-results');

  if (isLoading) {
    container.innerHTML = '<div class="ing-search-loading">Ricerca in corso...</div>';
    container.classList.remove('hidden');
    return;
  }

  if (results.length === 0) {
    container.innerHTML = '<div class="ing-search-loading">Nessun risultato.</div>';
    container.classList.remove('hidden');
    return;
  }

  container.innerHTML = results.map((r, i) => `
    <div class="ing-search-result" data-idx="${i}">
      <span class="ing-source-badge ${r.source.toLowerCase()}">${r.source}</span>
      <span class="ing-search-result-name" title="${r.name}">${r.name}</span>
      <span class="ing-search-result-macros">${r.cal} kcal · ${r.prot}P · ${r.carb}C · ${r.fat}F</span>
    </div>`).join('');

  container.querySelectorAll('.ing-search-result').forEach(el => {
    el.addEventListener('click', () => {
      const result = results[parseInt(el.dataset.idx, 10)];
      applySearchResult(result);
      container.classList.add('hidden');
    });
  });

  container.classList.remove('hidden');
}

function applySearchResult(result) {
  document.getElementById('ing-name-input').value     = result.name;
  document.getElementById('ing-category-input').value = result.category;
  document.getElementById('ing-cal').value            = result.cal;
  document.getElementById('ing-prot').value           = result.prot;
  document.getElementById('ing-carb').value           = result.carb;
  document.getElementById('ing-fat').value            = result.fat;
}

function isBarcode(query) {
  return /^\d{8,13}$/.test(query.trim());
}

function offKcal(n) {
  if (n['energy-kcal_100g'])  return Math.round(n['energy-kcal_100g']);
  if (n['energy-kj_100g'])    return Math.round(n['energy-kj_100g'] / 4.184);
  if (n['energy_100g'])       return Math.round(n['energy_100g'] / 4.184);
  return 0;
}

async function searchByBarcode(barcode) {
  const url = `https://world.openfoodfacts.org/api/v0/product/${barcode}.json?fields=product_name,generic_name,nutriments`;
  const res  = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  if (data.status !== 1 || !data.product) return [];

  const p    = data.product;
  const n    = p.nutriments || {};
  const cal  = offKcal(n);
  const prot = Math.round((n['proteins_100g']       || 0) * 10) / 10;
  const carb = Math.round((n['carbohydrates_100g']  || 0) * 10) / 10;
  const fat  = Math.round((n['fat_100g']            || 0) * 10) / 10;
  return [{
    name:     p.product_name || p.generic_name || barcode,
    source:   'OFF',
    cal, prot, carb, fat,
    category: guessCategoryFromMacros(prot, carb, fat, cal),
  }];
}

async function handleIngredientSearch(query) {
  const modeEl    = document.getElementById('ing-search-mode');
  const resultsEl = document.getElementById('ing-search-results');

  if (query.length < 2) {
    resultsEl.classList.add('hidden');
    modeEl.classList.add('hidden');
    return;
  }

  const barcode = isBarcode(query);
  modeEl.textContent  = barcode ? '▸ BARCODE RILEVATO — ricerca su Open Food Facts' : '▸ RICERCA TESTUALE — USDA + Open Food Facts';
  modeEl.className    = `ing-search-mode ${barcode ? 'barcode' : ''}`;

  renderSearchResults([], true);

  try {
    let merged = [];

    if (barcode) {
      merged = await searchByBarcode(query);
      if (merged.length === 0) {
        resultsEl.innerHTML = '<div class="ing-search-loading">Barcode non trovato su Open Food Facts.</div>';
        resultsEl.classList.remove('hidden');
        return;
      }
    } else {
      const [usdaResults, offResults] = await Promise.allSettled([
        searchUSDA(query),
        searchOpenFoodFacts(query),
      ]);
      const usda = usdaResults.status === 'fulfilled' ? usdaResults.value : [];
      const off  = offResults.status  === 'fulfilled' ? offResults.value  : [];
      const maxLen = Math.max(usda.length, off.length);
      for (let i = 0; i < maxLen && merged.length < 8; i++) {
        if (usda[i]) merged.push(usda[i]);
        if (off[i])  merged.push(off[i]);
      }
    }

    renderSearchResults(merged);
  } catch (err) {
    console.error('Ingredient search error:', err);
    resultsEl.innerHTML = '<div class="ing-search-loading">Errore di rete. Controlla la connessione.</div>';
    resultsEl.classList.remove('hidden');
  }
}

/* ── INGREDIENT BUILDER MODAL ────────────────────────────────────────────────── */
function openIngredientBuilder() {
  ['ing-search-input','ing-name-input','ing-cal','ing-prot','ing-carb','ing-fat'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('ing-category-input').value = 'proteine';
  document.getElementById('ing-search-results').classList.add('hidden');
  document.getElementById('ing-search-mode').classList.add('hidden');
  document.getElementById('ingredient-builder-modal').classList.remove('hidden');
}

function closeIngredientBuilder() {
  document.getElementById('ingredient-builder-modal').classList.add('hidden');
}

function saveCustomIngredient() {
  const name     = document.getElementById('ing-name-input').value.trim();
  const category = document.getElementById('ing-category-input').value;
  const cal      = parseFloat(document.getElementById('ing-cal').value)  || 0;
  const prot     = parseFloat(document.getElementById('ing-prot').value) || 0;
  const carb     = parseFloat(document.getElementById('ing-carb').value) || 0;
  const fat      = parseFloat(document.getElementById('ing-fat').value)  || 0;

  if (!name) { document.getElementById('ing-name-input').focus(); return; }

  const id = 'custom_' + uid();
  state.customIngredients.push({ id, name, category, cal, prot, carb, fat, custom: true });
  saveState();
  renderIngredients();

  // Se siamo arrivati qui dal recipe builder, auto-seleziona la riga in attesa
  if (state.pendingIngredientRow) {
    const row = state.pendingIngredientRow;
    row.dataset.ingId = id;
    const acInput = row.querySelector('.builder-ac-input');
    if (acInput) acInput.value = name;
    state.pendingIngredientRow = null;
    updateBuilderPreview();
  }

  closeIngredientBuilder();
}

/* ── EXPORT / IMPORT ─────────────────────────────────────────────────────────── */
function exportData() {
  const backup = {
    version:           1,
    exportedAt:        new Date().toISOString(),
    recipes:           state.recipes,
    plans:             state.plans,
    customIngredients: state.customIngredients,
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  a.href     = url;
  a.download = `mealprep-backup-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);

  localStorage.setItem(STORAGE.lastExport, Date.now().toString());
  checkBackupReminder();
}

function importData(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const backup = JSON.parse(e.target.result);
      if (!backup.recipes || !backup.plans) throw new Error('Formato non valido');

      state.recipes           = backup.recipes           || [];
      state.plans             = backup.plans             || {};
      state.customIngredients = backup.customIngredients || [];
      saveState();

      renderWeekStrip();
      renderPiano();
      alert('Importazione completata.');
    } catch {
      alert('File non valido. Assicurati di usare un backup esportato da questa app.');
    }
  };
  reader.readAsText(file);
}

/* ── BACKUP REMINDER ─────────────────────────────────────────────────────────── */
function checkBackupReminder() {
  const banner      = document.getElementById('backup-banner');
  const bannerText  = document.getElementById('backup-banner-text');
  const lastExport  = localStorage.getItem(STORAGE.lastExport);

  if (!lastExport) {
    bannerText.textContent = 'Nessun backup ancora. Esporta i tuoi dati per non perderli.';
    banner.classList.remove('hidden');
    return;
  }

  const daysSince = Math.floor((Date.now() - Number(lastExport)) / 86400000);
  if (daysSince >= BACKUP_REMINDER_DAYS) {
    bannerText.textContent = `Ultimo backup: ${daysSince} giorni fa. Esporta per aggiornarlo.`;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

/* ── NAVIGATION ──────────────────────────────────────────────────────────────── */
function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-content').forEach(section => {
    section.classList.toggle('active', section.id === `tab-${tabName}`);
  });
  if (tabName === 'piano')       { renderWeekStrip(); renderPiano(); }
  if (tabName === 'ricette')     renderRecipes();
  if (tabName === 'prep')        renderPrep();
  if (tabName === 'ingredienti') renderIngredients();
}

/* ── INIT ────────────────────────────────────────────────────────────────────── */
function init() {
  loadState();

  // Tab navigation
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Piano view toggle
  document.querySelectorAll('.view-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => switchPianoView(btn.dataset.view));
  });

  // Week navigation
  document.getElementById('week-prev').addEventListener('click', () => {
    state.weekOffset--;
    renderWeekStrip();
  });
  document.getElementById('week-next').addEventListener('click', () => {
    state.weekOffset++;
    renderWeekStrip();
  });

  // Garmin
  document.getElementById('garmin-input').addEventListener('input', e => {
    currentPlan().garmin = parseInt(e.target.value, 10) || 0;
    saveState();
    renderMacroBars();
    renderWeekStrip();
  });

  // Add-to-meal buttons
  document.querySelectorAll('.add-to-meal-btn').forEach(btn => {
    btn.addEventListener('click', () => openRecipePicker(btn.dataset.meal));
  });

  // Picker: close + backdrop
  document.getElementById('picker-close').addEventListener('click', closeRecipePicker);
  document.getElementById('recipe-picker-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeRecipePicker();
  });

  // Picker mode tabs
  document.querySelectorAll('.picker-mode-tab').forEach(tab => {
    tab.addEventListener('click', () => switchPickerMode(tab.dataset.mode));
  });

  // Ingredient picker: live preview + confirm
  document.getElementById('picker-ing-select').addEventListener('change', updateIngredientPickerPreview);
  document.getElementById('picker-ing-grams').addEventListener('input', updateIngredientPickerPreview);
  document.getElementById('picker-ing-confirm').addEventListener('click', confirmIngredientPicker);

  // Recipe builder
  document.getElementById('new-recipe-btn').addEventListener('click', openRecipeBuilder);
  document.getElementById('builder-close').addEventListener('click', closeRecipeBuilder);
  document.getElementById('recipe-builder-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeRecipeBuilder();
  });
  document.getElementById('add-ingredient-row-btn').addEventListener('click', addIngredientRow);
  document.getElementById('save-recipe-btn').addEventListener('click', saveNewRecipe);

  // Builder type toggle
  document.querySelectorAll('.builder-type-btn').forEach(btn => {
    btn.addEventListener('click', () => switchBuilderType(btn.dataset.type));
  });

  // Product macro inputs → live preview
  ['product-cal','product-prot','product-carb','product-fat'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateProductPreview);
  });

  // Product search
  document.getElementById('product-search-input').addEventListener('input', e => {
    clearTimeout(productSearchDebounceTimer);
    const q = e.target.value.trim();
    productSearchDebounceTimer = setTimeout(() => handleProductSearch(q), 500);
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('#builder-prodotto-section')) {
      document.getElementById('product-search-results').classList.add('hidden');
    }
  });

  // Copy day modal
  document.getElementById('copy-day-close').addEventListener('click', closeCopyDayModal);
  document.getElementById('copy-day-confirm').addEventListener('click', applyCopyToDays);
  document.getElementById('copy-day-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeCopyDayModal();
  });

  // Export / Import
  document.getElementById('export-btn').addEventListener('click', exportData);
  document.getElementById('import-input').addEventListener('change', e => {
    importData(e.target.files[0]);
    e.target.value = '';
  });
  document.getElementById('backup-banner-export').addEventListener('click', exportData);
  document.getElementById('backup-banner-dismiss').addEventListener('click', () => {
    document.getElementById('backup-banner').classList.add('hidden');
  });

  // Ingredient builder
  document.getElementById('new-ingredient-btn').addEventListener('click', openIngredientBuilder);
  document.getElementById('ing-builder-close').addEventListener('click', closeIngredientBuilder);
  document.getElementById('ingredient-builder-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeIngredientBuilder();
  });
  document.getElementById('save-ingredient-btn').addEventListener('click', saveCustomIngredient);

  // Ingredient search
  document.getElementById('ing-search-input').addEventListener('input', e => {
    clearTimeout(searchDebounceTimer);
    const q = e.target.value.trim();
    searchDebounceTimer = setTimeout(() => handleIngredientSearch(q), 500);
  });
  // Chiudi risultati ricerca ingrediente cliccando fuori
  document.addEventListener('click', e => {
    if (!e.target.closest('.ing-search-wrapper')) {
      document.getElementById('ing-search-results').classList.add('hidden');
    }
    // Chiudi autocomplete righe ricetta cliccando fuori
    if (!e.target.closest('.builder-ac-wrapper')) {
      document.querySelectorAll('.builder-ac-dropdown').forEach(d => d.classList.add('hidden'));
    }
  });

  // Prep days + reset
  document.getElementById('prep-days').addEventListener('input', renderPrep);
  document.getElementById('prep-reset-btn').addEventListener('click', resetPrepSession);

  // Initial render
  renderWeekStrip();
  renderPiano();
  checkBackupReminder();
}

document.addEventListener('DOMContentLoaded', init);
