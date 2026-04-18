/* ── CONSTANTS ───────────────────────────────────────────────────────────────── */
const TARGETS = { cal: 2400, prot: 150, carb: 285, fat: 75 };
const MEALS   = ['colazione', 'pranzo', 'cena', 'snack'];
const STORAGE = {
  recipes:     'mealprep_recipes',
  currentPlan: 'mealprep_current_plan',
  garmin:      'mealprep_garmin',
};
const CAT_LABELS = {
  colazione: 'COLAZIONE',
  pranzo:    'PRANZO',
  cena:      'CENA',
  snack:     'SNACK',
};

/* ── STATE ───────────────────────────────────────────────────────────────────── */
const state = {
  recipes:         [],
  currentPlan:     { colazione: [], pranzo: [], cena: [], snack: [] },
  garminCalories:  0,
  activeTab:       'piano',
  pickerTargetMeal: null,
};

/* ── UTILS ───────────────────────────────────────────────────────────────────── */
function calcRecipeMacros(recipe) {
  return recipe.ingredients.reduce((acc, item) => {
    const ing = INGREDIENTS.find(i => i.id === item.ingredientId);
    if (!ing) return acc;
    const f = item.grams / 100;
    return {
      cal:  acc.cal  + ing.cal  * f,
      prot: acc.prot + ing.prot * f,
      carb: acc.carb + ing.carb * f,
      fat:  acc.fat  + ing.fat  * f,
    };
  }, { cal: 0, prot: 0, carb: 0, fat: 0 });
}

function calcDayMacros() {
  const t = { cal: 0, prot: 0, carb: 0, fat: 0 };
  MEALS.forEach(meal => {
    (state.currentPlan[meal] || []).forEach(rid => {
      const recipe = state.recipes.find(r => r.id === rid);
      if (!recipe) return;
      const m = calcRecipeMacros(recipe);
      t.cal  += m.cal;
      t.prot += m.prot;
      t.carb += m.carb;
      t.fat  += m.fat;
    });
  });
  return t;
}

function effectiveCalTarget() {
  return TARGETS.cal + (state.garminCalories || 0);
}

function fmt(n) {
  return Math.round(n);
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/* ── STORAGE ─────────────────────────────────────────────────────────────────── */
function saveState() {
  localStorage.setItem(STORAGE.recipes,     JSON.stringify(state.recipes));
  localStorage.setItem(STORAGE.currentPlan, JSON.stringify(state.currentPlan));
  localStorage.setItem(STORAGE.garmin,      String(state.garminCalories));
}

function loadState() {
  const storedRecipes = localStorage.getItem(STORAGE.recipes);
  state.recipes = storedRecipes
    ? JSON.parse(storedRecipes)
    : DEFAULT_RECIPES.map(r => ({ ...r, ingredients: r.ingredients.map(i => ({ ...i })) }));

  const storedPlan = localStorage.getItem(STORAGE.currentPlan);
  state.currentPlan = storedPlan
    ? JSON.parse(storedPlan)
    : { colazione: [], pranzo: [], cena: [], snack: [] };

  const storedGarmin = localStorage.getItem(STORAGE.garmin);
  state.garminCalories = storedGarmin ? Number(storedGarmin) : 0;
}

/* ── RENDER: INGREDIENTI ─────────────────────────────────────────────────────── */
function renderIngredients() {
  const container = document.getElementById('ingredients-table');
  const categories = ['proteine', 'carboidrati', 'grassi', 'verdure', 'frutta'];

  let html = '<table class="ing-table"><thead><tr>'
    + '<th>NOME</th><th>CATEGORIA</th><th>KCAL</th><th>PROT g</th><th>CARB g</th><th>GRAS g</th>'
    + '</tr></thead><tbody>';

  categories.forEach(cat => {
    html += `<tr class="ing-category-row"><td colspan="6">${cat.toUpperCase()}</td></tr>`;
    INGREDIENTS.filter(i => i.category === cat).forEach(ing => {
      html += `<tr>
        <td>${ing.name}</td>
        <td style="color:var(--muted)">${ing.category}</td>
        <td>${ing.cal}</td>
        <td>${ing.prot}</td>
        <td>${ing.carb}</td>
        <td>${ing.fat}</td>
      </tr>`;
    });
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

/* ── RENDER: RICETTE ─────────────────────────────────────────────────────────── */
function renderRecipes() {
  const grid = document.getElementById('recipe-grid');
  if (state.recipes.length === 0) {
    grid.innerHTML = '<p style="color:var(--muted);font-size:12px">Nessuna ricetta. Creane una con "+ NUOVA RICETTA".</p>';
    return;
  }
  grid.innerHTML = state.recipes.map(recipe => {
    const m   = calcRecipeMacros(recipe);
    const cat = recipe.category || 'snack';
    return `<div class="recipe-card">
      <div class="cat-badge cat-${cat}"></div>
      <button class="recipe-card-delete" data-id="${recipe.id}" title="Elimina ricetta">✕</button>
      <div class="recipe-card-name">${recipe.name}</div>
      <div class="recipe-card-category">${CAT_LABELS[cat] || cat}</div>
      <div class="recipe-card-macros">
        <div class="recipe-macro">
          <div class="recipe-macro-val">${fmt(m.cal)}</div>
          <div class="recipe-macro-label">KCAL</div>
        </div>
        <div class="recipe-macro">
          <div class="recipe-macro-val">${fmt(m.prot)}</div>
          <div class="recipe-macro-label">PROT</div>
        </div>
        <div class="recipe-macro">
          <div class="recipe-macro-val">${fmt(m.carb)}</div>
          <div class="recipe-macro-label">CARB</div>
        </div>
        <div class="recipe-macro">
          <div class="recipe-macro-val">${fmt(m.fat)}</div>
          <div class="recipe-macro-label">GRAS</div>
        </div>
      </div>
    </div>`;
  }).join('');

  grid.querySelectorAll('.recipe-card-delete').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.id;
      state.recipes = state.recipes.filter(r => r.id !== id);
      MEALS.forEach(meal => {
        state.currentPlan[meal] = (state.currentPlan[meal] || []).filter(rid => rid !== id);
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
    + INGREDIENTS.map(i => `<option value="${i.id}">${i.name}</option>`).join('');
  select.addEventListener('change', updateBuilderPreview);

  const input = document.createElement('input');
  input.type        = 'number';
  input.className   = 'mono-input';
  input.placeholder = 'g';
  input.min         = '0';
  input.max         = '2000';
  input.addEventListener('input', updateBuilderPreview);

  const removeBtn = document.createElement('button');
  removeBtn.className   = 'remove-row-btn';
  removeBtn.textContent = '✕';
  removeBtn.type        = 'button';
  removeBtn.addEventListener('click', () => { row.remove(); updateBuilderPreview(); });

  row.append(select, input, removeBtn);
  container.appendChild(row);
}

function updateBuilderPreview() {
  const rows   = document.querySelectorAll('.builder-ingredient-row');
  const totals = { cal: 0, prot: 0, carb: 0, fat: 0 };

  rows.forEach(row => {
    const ingId = row.querySelector('select').value;
    const grams = parseFloat(row.querySelector('input').value) || 0;
    if (!ingId || !grams) return;
    const ing = INGREDIENTS.find(i => i.id === ingId);
    if (!ing) return;
    const f = grams / 100;
    totals.cal  += ing.cal  * f;
    totals.prot += ing.prot * f;
    totals.carb += ing.carb * f;
    totals.fat  += ing.fat  * f;
  });

  document.getElementById('builder-preview').innerHTML = `
    <div class="builder-preview-stat">
      <div class="builder-preview-val">${fmt(totals.cal)}</div>
      <div class="builder-preview-label">KCAL</div>
    </div>
    <div class="builder-preview-stat">
      <div class="builder-preview-val">${fmt(totals.prot)}</div>
      <div class="builder-preview-label">PROT</div>
    </div>
    <div class="builder-preview-stat">
      <div class="builder-preview-val">${fmt(totals.carb)}</div>
      <div class="builder-preview-label">CARB</div>
    </div>
    <div class="builder-preview-stat">
      <div class="builder-preview-val">${fmt(totals.fat)}</div>
      <div class="builder-preview-label">GRAS</div>
    </div>`;
}

function saveNewRecipe() {
  const name     = document.getElementById('recipe-name-input').value.trim();
  const category = document.getElementById('recipe-category-input').value;

  if (!name) {
    document.getElementById('recipe-name-input').focus();
    return;
  }

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

/* ── RENDER: PIANO ───────────────────────────────────────────────────────────── */
function renderPiano() {
  const now     = new Date();
  const dateStr = now.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  document.getElementById('piano-date').textContent = dateStr.toUpperCase();
  document.getElementById('garmin-input').value = state.garminCalories || '';
  renderMacroBars();
  renderMealSlots();
}

function renderMealSlots() {
  MEALS.forEach(meal => {
    const container = document.getElementById(`meal-${meal}`);
    const recipeIds = state.currentPlan[meal] || [];
    container.innerHTML = recipeIds.map((rid, idx) => {
      const recipe = state.recipes.find(r => r.id === rid);
      if (!recipe) return '';
      const m = calcRecipeMacros(recipe);
      return `<div class="meal-recipe-card">
        <div>
          <div class="meal-recipe-name">${recipe.name}</div>
          <div class="meal-recipe-macros">${fmt(m.cal)} kcal &middot; ${fmt(m.prot)}g P &middot; ${fmt(m.carb)}g C &middot; ${fmt(m.fat)}g F</div>
        </div>
        <button class="meal-recipe-remove" data-meal="${meal}" data-idx="${idx}" title="Rimuovi">✕</button>
      </div>`;
    }).join('');

    container.querySelectorAll('.meal-recipe-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const m   = btn.dataset.meal;
        const idx = parseInt(btn.dataset.idx, 10);
        state.currentPlan[m].splice(idx, 1);
        saveState();
        renderMacroBars();
        renderMealSlots();
      });
    });
  });
}

function renderMacroBars() {
  const totals  = calcDayMacros();
  const calTgt  = effectiveCalTarget();
  const targets = { cal: calTgt, prot: TARGETS.prot, carb: TARGETS.carb, fat: TARGETS.fat };

  const stats = [
    { key: 'cal',  label: 'KCAL',   val: totals.cal,  target: targets.cal  },
    { key: 'prot', label: 'PROT',   val: totals.prot, target: targets.prot },
    { key: 'carb', label: 'CARB',   val: totals.carb, target: targets.carb },
    { key: 'fat',  label: 'GRASSI', val: totals.fat,  target: targets.fat  },
  ];

  function barClass(pct) {
    if (pct > 1.05) return 'over';
    if (pct >= 0.85) return 'ok';
    if (pct >= 0.5) return 'near';
    return '';
  }

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

/* ── RECIPE PICKER MODAL ─────────────────────────────────────────────────────── */
function openRecipePicker(meal) {
  state.pickerTargetMeal = meal;
  const list = document.getElementById('recipe-picker-list');

  list.innerHTML = state.recipes.map(recipe => {
    const m = calcRecipeMacros(recipe);
    return `<div class="picker-recipe-item" data-id="${recipe.id}">
      <span class="picker-recipe-name">${recipe.name}</span>
      <span class="picker-recipe-cal">${fmt(m.cal)} kcal</span>
    </div>`;
  }).join('');

  list.querySelectorAll('.picker-recipe-item').forEach(item => {
    item.addEventListener('click', () => {
      const rid = item.dataset.id;
      if (!state.currentPlan[state.pickerTargetMeal]) {
        state.currentPlan[state.pickerTargetMeal] = [];
      }
      state.currentPlan[state.pickerTargetMeal].push(rid);
      saveState();
      renderMacroBars();
      renderMealSlots();
      closeRecipePicker();
    });
  });

  document.getElementById('recipe-picker-modal').classList.remove('hidden');
}

function closeRecipePicker() {
  document.getElementById('recipe-picker-modal').classList.add('hidden');
  state.pickerTargetMeal = null;
}

/* ── RENDER: PREP ────────────────────────────────────────────────────────────── */
function renderPrep() {
  const days      = parseInt(document.getElementById('prep-days').value, 10) || 3;
  const container = document.getElementById('prep-content');

  const allIds = MEALS.flatMap(meal => state.currentPlan[meal] || []);
  if (allIds.length === 0) {
    container.innerHTML = '<p class="prep-empty">Nessuna ricetta nel piano.<br>Vai su <strong>PIANO</strong> e aggiungi ricette ai pasti.</p>';
    return;
  }

  // Count how many times each recipe appears × days
  const recipeCounts = {};
  allIds.forEach(rid => { recipeCounts[rid] = (recipeCounts[rid] || 0) + days; });

  // Aggregate ingredient totals
  const ingTotals = {};
  Object.entries(recipeCounts).forEach(([rid, count]) => {
    const recipe = state.recipes.find(r => r.id === rid);
    if (!recipe) return;
    recipe.ingredients.forEach(item => {
      ingTotals[item.ingredientId] = (ingTotals[item.ingredientId] || 0) + item.grams * count;
    });
  });

  // Recipe summary table
  let html = '<p class="prep-section-title">RICETTE DA CUCINARE</p>';
  html += '<table class="prep-table"><thead><tr><th>RICETTA</th><th>PORZIONI</th><th>KCAL TOTALI</th></tr></thead><tbody>';
  Object.entries(recipeCounts).forEach(([rid, count]) => {
    const recipe = state.recipes.find(r => r.id === rid);
    if (!recipe) return;
    const m = calcRecipeMacros(recipe);
    html += `<tr>
      <td>${recipe.name}</td>
      <td>${count}×</td>
      <td>${fmt(m.cal * count)}</td>
    </tr>`;
  });
  html += '</tbody></table>';

  // Shopping list sorted by category
  const sortedIng = Object.entries(ingTotals).sort(([a], [b]) => {
    const ia = INGREDIENTS.find(i => i.id === a);
    const ib = INGREDIENTS.find(i => i.id === b);
    if (!ia || !ib) return 0;
    return ia.category !== ib.category
      ? ia.category.localeCompare(ib.category)
      : ia.name.localeCompare(ib.name);
  });

  html += '<p class="prep-section-title">LISTA SPESA</p>';
  html += '<table class="prep-table"><thead><tr><th>INGREDIENTE</th><th>CATEGORIA</th><th>QUANTITÀ</th></tr></thead><tbody>';
  sortedIng.forEach(([ingId, totalGrams]) => {
    const ing = INGREDIENTS.find(i => i.id === ingId);
    if (!ing) return;
    const display = totalGrams >= 1000
      ? `${(totalGrams / 1000).toFixed(2).replace('.', ',')} kg`
      : `${Math.round(totalGrams)} g`;
    html += `<tr>
      <td>${ing.name}</td>
      <td style="color:var(--muted)">${ing.category}</td>
      <td>${display}</td>
    </tr>`;
  });
  html += '</tbody></table>';

  container.innerHTML = html;
}

/* ── NAVIGATION ──────────────────────────────────────────────────────────────── */
function switchTab(tabName) {
  state.activeTab = tabName;

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-content').forEach(section => {
    section.classList.toggle('active', section.id === `tab-${tabName}`);
  });

  if (tabName === 'piano')       renderPiano();
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

  // Garmin input
  document.getElementById('garmin-input').addEventListener('input', e => {
    state.garminCalories = parseInt(e.target.value, 10) || 0;
    saveState();
    renderMacroBars();
  });

  // Add-to-meal buttons
  document.querySelectorAll('.add-to-meal-btn').forEach(btn => {
    btn.addEventListener('click', () => openRecipePicker(btn.dataset.meal));
  });

  // Recipe picker: close button + backdrop
  document.getElementById('picker-close').addEventListener('click', closeRecipePicker);
  document.getElementById('recipe-picker-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeRecipePicker();
  });

  // Recipe builder: open/close/save
  document.getElementById('new-recipe-btn').addEventListener('click', openRecipeBuilder);
  document.getElementById('builder-close').addEventListener('click', closeRecipeBuilder);
  document.getElementById('recipe-builder-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeRecipeBuilder();
  });
  document.getElementById('add-ingredient-row-btn').addEventListener('click', addIngredientRow);
  document.getElementById('save-recipe-btn').addEventListener('click', saveNewRecipe);

  // Prep days
  document.getElementById('prep-days').addEventListener('input', renderPrep);

  // Initial render
  renderPiano();
}

document.addEventListener('DOMContentLoaded', init);
