/* ── CONSTANTS ───────────────────────────────────────────────────────────────── */
const TARGETS = { cal: 2400, prot: 150, carb: 285, fat: 75 };
const MEALS   = ['colazione', 'pranzo', 'cena', 'snack'];
const STORAGE = {
  recipes:    'mealprep_recipes',
  plans:      'mealprep_plans',
  customIngs: 'mealprep_custom_ingredients',
  lastExport: 'mealprep_last_export',
};
const BACKUP_REMINDER_DAYS = 7;
const CAT_LABELS = { colazione: 'COLAZIONE', pranzo: 'PRANZO', cena: 'CENA', snack: 'SNACK' };
const DAY_NAMES  = ['DOM', 'LUN', 'MAR', 'MER', 'GIO', 'VEN', 'SAB'];

/* ── STATE ───────────────────────────────────────────────────────────────────── */
const state = {
  recipes:          [],
  plans:            {},   // { 'YYYY-MM-DD': { colazione:[], pranzo:[], cena:[], snack:[], garmin:0 } }
  customIngredients: [],  // ingredienti aggiunti dall'utente
  selectedDate:     '',
  pickerTargetMeal: null,
  pickerMode:       'ricette',
  weekOffset:       0,    // 0 = current week, -1 = last week, +1 = next week
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
      renderPiano();
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
function openRecipePicker(meal) {
  state.pickerTargetMeal = meal;
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
      currentPlan()[state.pickerTargetMeal].push(item.dataset.id);
      saveState();
      renderMacroBars();
      renderMealSlots();
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

  currentPlan()[state.pickerTargetMeal].push({ type: 'ingredient', ingredientId: ingId, grams });
  saveState();
  renderMacroBars();
  renderMealSlots();
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
    const m   = calcRecipeMacros(recipe);
    const cat = recipe.category || 'snack';
    return `<div class="recipe-card">
      <div class="cat-badge cat-${cat}"></div>
      <button class="recipe-card-delete" data-id="${recipe.id}" title="Elimina">✕</button>
      <div class="recipe-card-name">${recipe.name}</div>
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
  updateBuilderPreview();
  addIngredientRow();
  document.getElementById('recipe-builder-modal').classList.remove('hidden');
}

function closeRecipeBuilder() {
  document.getElementById('recipe-builder-modal').classList.add('hidden');
}

function addIngredientRow() {
  const container = document.getElementById('builder-ingredients');
  const row = document.createElement('div');
  row.className = 'builder-ingredient-row';

  const select = document.createElement('select');
  select.innerHTML = '<option value="">— ingrediente —</option>'
    + allIngredients().map(i => `<option value="${i.id}">${i.name}${i.custom ? ' ★' : ''}</option>`).join('');
  select.addEventListener('change', updateBuilderPreview);

  const input = document.createElement('input');
  input.type = 'number'; input.className = 'mono-input';
  input.placeholder = 'g'; input.min = '0'; input.max = '2000';
  input.addEventListener('input', updateBuilderPreview);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'remove-row-btn'; removeBtn.textContent = '✕'; removeBtn.type = 'button';
  removeBtn.addEventListener('click', () => { row.remove(); updateBuilderPreview(); });

  row.append(select, input, removeBtn);
  container.appendChild(row);
}

function updateBuilderPreview() {
  const totals = { cal: 0, prot: 0, carb: 0, fat: 0 };
  document.querySelectorAll('.builder-ingredient-row').forEach(row => {
    const ingId = row.querySelector('select').value;
    const grams = parseFloat(row.querySelector('input').value) || 0;
    if (!ingId || !grams) return;
    const ing = INGREDIENTS.find(i => i.id === ingId);
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

  const ingredients = [];
  document.querySelectorAll('.builder-ingredient-row').forEach(row => {
    const ingId = row.querySelector('select').value;
    const grams = parseFloat(row.querySelector('input').value) || 0;
    if (ingId && grams > 0) ingredients.push({ ingredientId: ingId, grams });
  });
  if (ingredients.length === 0) return;

  state.recipes.push({ id: uid(), name, category, ingredients });
  saveState();
  renderRecipes();
  closeRecipeBuilder();
}

/* ── RENDER: PREP ────────────────────────────────────────────────────────────── */
function renderPrep() {
  const days      = parseInt(document.getElementById('prep-days').value, 10) || 3;
  const container = document.getElementById('prep-content');
  const plan      = currentPlan();
  const allEntries = MEALS.flatMap(meal => plan[meal] || []);

  if (allEntries.length === 0) {
    container.innerHTML = '<p class="prep-empty">Nessuna ricetta nel piano.<br>Vai su <strong>PIANO</strong> e aggiungi ricette o ingredienti ai pasti.</p>';
    return;
  }

  // Aggregate ingredient totals across all entries × days
  const ingTotals = {};

  allEntries.forEach(entry => {
    let ingredients = [];
    if (typeof entry === 'string') {
      const recipe = state.recipes.find(r => r.id === entry);
      if (recipe) ingredients = recipe.ingredients;
    } else if (entry.type === 'ingredient') {
      ingredients = [{ ingredientId: entry.ingredientId, grams: entry.grams }];
    }
    ingredients.forEach(item => {
      ingTotals[item.ingredientId] = (ingTotals[item.ingredientId] || 0) + item.grams * days;
    });
  });

  // Recipe summary (only for recipe entries)
  const recipeCounts = {};
  allEntries.filter(e => typeof e === 'string').forEach(rid => {
    recipeCounts[rid] = (recipeCounts[rid] || 0) + days;
  });

  let html = '';

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

  const sortedIng = Object.entries(ingTotals).sort(([a], [b]) => {
    const ia = allIngredients().find(i => i.id === a);
    const ib = allIngredients().find(i => i.id === b);
    if (!ia || !ib) return 0;
    return ia.category !== ib.category
      ? ia.category.localeCompare(ib.category)
      : ia.name.localeCompare(ib.name);
  });

  html += '<p class="prep-section-title">LISTA SPESA</p>';
  html += '<table class="prep-table"><thead><tr><th>INGREDIENTE</th><th>CATEGORIA</th><th>QUANTITÀ</th></tr></thead><tbody>';
  sortedIng.forEach(([ingId, totalGrams]) => {
    const ing = allIngredients().find(i => i.id === ingId);
    if (!ing) return;
    const display = totalGrams >= 1000
      ? `${(totalGrams / 1000).toFixed(2).replace('.', ',')} kg`
      : `${Math.round(totalGrams)} g`;
    html += `<tr><td>${ing.name}</td><td style="color:var(--muted)">${ing.category}</td><td>${display}</td></tr>`;
  });
  html += '</tbody></table>';

  container.innerHTML = html;
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

/* ── INGREDIENT BUILDER MODAL ────────────────────────────────────────────────── */
function openIngredientBuilder() {
  ['ing-name-input','ing-cal','ing-prot','ing-carb','ing-fat'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('ing-category-input').value = 'proteine';
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

  // Prep days
  document.getElementById('prep-days').addEventListener('input', renderPrep);

  // Initial render
  renderWeekStrip();
  renderPiano();
  checkBackupReminder();
}

document.addEventListener('DOMContentLoaded', init);
