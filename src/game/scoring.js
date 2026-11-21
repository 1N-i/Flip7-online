// Filtra apenas as cartas numéricas de uma mão.
export function getNumberCards(hand) {
  return hand.filter((card) => card.type === 'number');
}

// Filtra apenas as cartas modificadoras (+2..+10, x2) de uma mão.
export function getModifierCards(hand) {
  return hand.filter((card) => card.type === 'modifier');
}

/**
 * Verifica se o jogador já possui uma carta numérica com o mesmo valor na mão.
 * Usado para detectar Bust (ou acionar a Second Chance).
 */
export function hasDuplicateNumber(hand, newCard) {
  if (newCard.type !== 'number') return false;

  const numberCards = getNumberCards(hand);
  return numberCards.some((card) => card.value === newCard.value);
}

// Verifica se o jogador completou um "Flip 7".
export function hasFlip7(hand) {
  const numberCards = getNumberCards(hand);
  return numberCards.length >= 7;
}

/**
 * Calcula a pontuação total da mão na rodada seguindo a ordem oficial:
 * 1- Soma das cartas numéricas
 * 2- Aplica 'x2' apenas sobre a soma numérica (se houver)
 * 3- Soma os modificadores '+X'
 * 4- Adiciona +15 de bônus se completou Flip 7
 */
export function calculateRoundScore(hand, isBusted = false) {
  if (isBusted) {
    return 0;
  }

  const numberCards = getNumberCards(hand);
  const modifierCards = getModifierCards(hand);

  // 1- Soma apenas os valores numéricos
  let numberSum = numberCards.reduce((acc, card) => acc + card.value, 0);

  // 2- Verifica se existe o multiplicador x2
  const hasDouble = modifierCards.some((card) => card.value === 'x2');
  if (hasDouble) {
    numberSum *= 2;
  }

  // 3- Soma os modificadores aditivos (+2, +4, +6, +8, +10)
  const flatBonus = modifierCards
    .filter((card) => typeof card.value === 'number')
    .reduce((acc, card) => acc + card.value, 0);

  // 4- Bônus de Flip 7 (+15 pontos por 7 cartas numéricas diferentes)
  const flip7Bonus = hasFlip7(hand) ? 15 : 0;

  return numberSum + flatBonus + flip7Bonus;
}
