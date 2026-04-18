const DEFAULT_RECIPES = [
  {
    id: 'couscous_bowl',
    name: 'Couscous Bowl',
    category: 'pranzo',
    ingredients: [
      { ingredientId: 'couscous',     grams: 80  },
      { ingredientId: 'avocado',      grams: 75  },
      { ingredientId: 'uova',         grams: 120 },
      { ingredientId: 'zucchina',     grams: 100 },
    ],
    // macros pre-calcolati (ricalcolati a runtime da calcRecipeMacros)
    macros: { cal: 624, prot: 28.7, carb: 69.6, fat: 25.2 },
  },
  {
    id: 'scrambled_toast',
    name: 'Scrambled Eggs Toast',
    category: 'colazione',
    ingredients: [
      { ingredientId: 'uova',          grams: 180 },
      { ingredientId: 'pane_integrale', grams: 120 },
    ],
    macros: { cal: 575, prot: 33.0, carb: 51.2, fat: 23.4 },
  },
  {
    id: 'snack_carote',
    name: 'Snack Carote & Mandorle',
    category: 'snack',
    ingredients: [
      { ingredientId: 'carota',        grams: 230 },
      { ingredientId: 'mandorle',      grams: 30  },
      { ingredientId: 'parmigiano',    grams: 30  },
      { ingredientId: 'olio_rapeseed', grams: 30  },
    ],
    macros: { cal: 663, prot: 19.8, carb: 28.7, fat: 54.2 },
  },
];
