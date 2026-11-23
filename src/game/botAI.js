import { calculateRoundScore, getNumberCards } from './scoring.js';

const BOT_PROFILES = {
  conservative: {
    label: 'Conservador',
    maxBustRisk: 0.18, // Para cedo se o risco de estourar passar de 18%
    targetRoundScore: 18,
  },
  balanced: {
    label: 'Equilibrado',
    maxBustRisk: 0.30, // Aceita até 30% de risco
    targetRoundScore: 26,
  },
  aggressive: {
    label: 'Arriscado',
    maxBustRisk: 0.45, // Busca Flip 7 e pontuações altas
    targetRoundScore: 36,
  },
};

// Calcula a probabilidade (0 a 1) de a próxima carta comprada causar Bust.
function estimateBustProbability(gameState, botPlayer) {
  if (botPlayer.hasSecondChance) {
    return 0; // Está protegido nesta compra
  }

  const myNumbers = new Set(
    getNumberCards(botPlayer.hand).map((c) => c.value)
  );

  if (myNumbers.size === 0) {
    return 0; // Sem números na mão, impossível estourar
  }

  // Se o monte de compras acabou, o próximo monte será o descarte reembaralhado
  const activePool =
    gameState.drawPile.length > 0
      ? gameState.drawPile
      : gameState.discardPile;

  if (activePool.length === 0) return 0;

  const dangerousCards = activePool.filter(
    (card) => card.type === 'number' && myNumbers.has(card.value)
  ).length;

  return dangerousCards / activePool.length;
}

// Decide a jogada do Bot no turno normal: 'hit' ou 'stay'.
export function decideBotTurnAction(gameState, botPlayer) {
  const profile =
    BOT_PROFILES[botPlayer.botProfile] || BOT_PROFILES.balanced;

  const numberCards = getNumberCards(botPlayer.hand);
  const currentRoundPts = calculateRoundScore(botPlayer.hand, false);
  const bustRisk = estimateBustProbability(gameState, botPlayer);

  // Se ainda não tem nenhuma carta numérica ou risco zero, sempre compra
  if (numberCards.length === 0 || bustRisk === 0) {
    return 'hit';
  }

  // Se está a 1 carta de fazer Flip 7 (6 números) e o risco não é absurdo, arrisca!
  if (numberCards.length === 6 && bustRisk <= 0.5) {
    return 'hit';
  }

  // Se o risco ultrapassa o limite da personalidade OU já atingiu a meta de pontos da rodada
  if (bustRisk > profile.maxBustRisk || currentRoundPts >= profile.targetRoundScore) {
    return 'stay';
  }

  return 'hit';
}

// Decide qual jogador alvo o Bot escolhe ao ativar Freeze, Flip Three ou doar Second Chance.
export function decideBotActionTarget(gameState, pendingAction) {
  const { type, sourcePlayerId } = pendingAction;
  const activePlayers = gameState.players.filter((p) => p.status === 'active');
  const opponents = activePlayers.filter((p) => p.id !== sourcePlayerId);

  if (type === 'give_second_chance') {
    const eligible = opponents.filter((p) => !p.hasSecondChance);
    if (eligible.length === 0) return null;
    // Doa para quem tem menos pontos totais (ajuda o mais fraco)
    eligible.sort((a, b) => a.totalScore - b.totalScore);
    return eligible[0].id;
  }

  // Para Freeze e Flip Three, se não houver oponentes ativos, mira em si mesmo
  if (opponents.length === 0) {
    return sourcePlayerId;
  }

  if (type === 'freeze') {
    // Congela o oponente com maior soma (pontos totais + pontos da rodada atual)
    const ranked = [...opponents].sort((a, b) => {
      const scoreA = a.totalScore + calculateRoundScore(a.hand, false);
      const scoreB = b.totalScore + calculateRoundScore(b.hand, false);
      return scoreB - scoreA;
    });
    return ranked[0].id;
  }

  if (type === 'flip_three') {
    // Usa Flip Three no oponente que tem mais cartas numéricas na mão (maior chance de estourar)
    const ranked = [...opponents].sort((a, b) => {
      const numsA = getNumberCards(a.hand).length;
      const numsB = getNumberCards(b.hand).length;
      return numsB - numsA;
    });
    return ranked[0].id;
  }

  return opponents[0].id;
}
