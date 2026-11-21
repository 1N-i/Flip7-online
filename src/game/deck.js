/**
 * Gera o baralho do Flip 7 (94 cartas).
 * Cada carta possui:
 * - id: identificador único da carta
 * - type: 'number' | 'modifier' | 'action'
 * - value: valor numérico ou identificador da ação/modificador
 * - label: texto exibido na carta
 */
export function createDeck() {
  const deck = [];

  // 1- Cartas Numéricas (79 cartas)
  // Uma carta 0
  deck.push({
    id: 'num-0-0',
    type: 'number',
    value: 0,
    label: '0',
  });

  // De 1 a 12: quantidade de cópias igual ao próprio número
  for (let num = 1; num <= 12; num++) {
    for (let copy = 0; copy < num; copy++) {
      deck.push({
        id: `num-${num}-${copy}`,
        type: 'number',
        value: num,
        label: String(num),
      });
    }
  }

  // 2- Cartas Modificadoras (6 cartas)
  const modifiers = [
    { value: 2, label: '+2' },
    { value: 4, label: '+4' },
    { value: 6, label: '+6' },
    { value: 8, label: '+8' },
    { value: 10, label: '+10' },
    { value: 'x2', label: 'x2' },
  ];

  modifiers.forEach((mod, index) => {
    deck.push({
      id: `mod-${mod.label}-${index}`,
      type: 'modifier',
      value: mod.value,
      label: mod.label,
    });
  });

  // 3- Cartas de Ação (9 cartas - 3 de cada)
  const actions = [
    { value: 'freeze', label: 'Freeze' },
    { value: 'flip_three', label: 'Flip Three' },
    { value: 'second_chance', label: 'Second Chance' },
  ];

  actions.forEach((action) => {
    for (let copy = 0; copy < 3; copy++) {
      deck.push({
        id: `act-${action.value}-${copy}`,
        type: 'action',
        value: action.value,
        label: action.label,
      });
    }
  });

  return deck;
}

/**
 * Embaralha um array de cartas usando o algoritmo de Fisher-Yates.
 * Retorna uma nova cópia embaralhada sem alterar o array original.
 */
export function shuffleDeck(deck) {
  const shuffled = [...deck];

  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}
