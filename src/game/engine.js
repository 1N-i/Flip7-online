import { createDeck, shuffleDeck } from './deck.js';
import {
  calculateRoundScore,
  hasDuplicateNumber,
  hasFlip7,
} from './scoring.js';

export function createInitialGameState(playersList) {
  const deck = shuffleDeck(createDeck());

  const players = playersList.map((p, index) => ({
    id: p.id || `player-${index}`,
    name: p.name,
    isBot: Boolean(p.isBot),
    botProfile: p.botProfile || null,
    totalScore: 0,
    hand: [],
    hasSecondChance: false,
    status: 'active', // 'active' | 'stayed' | 'busted' | 'frozen' | 'disconnected'
  }));

  const state = {
    phase: 'playing', // 'playing' | 'round_over' | 'game_over'
    roundNumber: 1,
    dealerIndex: 0,
    currentTurnIndex: 0,
    drawPile: deck,
    discardPile: [],
    players,
    pendingAction: null,
    forcedDraws: null,
    lastEvent: null, // { card, playerName, description }
    winnerIds: [],
    logs: ['Partida iniciada! Rodada 1.'],
  };

  return dealInitialCards(state);
}

function drawSingleCard(state) {
  let drawPile = [...state.drawPile];
  let discardPile = [...state.discardPile];

  if (drawPile.length === 0) {
    if (discardPile.length === 0) {
      return { card: null, drawPile, discardPile };
    }
    drawPile = shuffleDeck(discardPile);
    discardPile = [];
  }

  const card = drawPile.shift();
  return { card, drawPile, discardPile };
}

function dealInitialCards(initialState) {
  let state = { ...initialState };
  const totalPlayers = state.players.length;

  for (let i = 0; i < totalPlayers; i++) {
    const playerIndex = (state.dealerIndex + i) % totalPlayers;
    const player = state.players[playerIndex];

    if (state.phase !== 'playing' || state.pendingAction) {
      break;
    }

    if (player.status === 'active') {
      state = resolveCardDrawForPlayer(state, player.id, true);
    }
  }

  if (state.phase === 'playing' && !state.pendingAction) {
    state.currentTurnIndex = findNextActivePlayerIndex(state, state.dealerIndex - 1);
  }

  return state;
}

export function playerHit(state, playerId) {
  if (state.phase !== 'playing' || state.pendingAction || state.forcedDraws) {
    return state;
  }

  const currentPlayer = state.players[state.currentTurnIndex];
  if (!currentPlayer || currentPlayer.id !== playerId || currentPlayer.status !== 'active') {
    return state;
  }

  let nextState = resolveCardDrawForPlayer(state, playerId, false);

  if (nextState.phase === 'playing' && !nextState.pendingAction && !nextState.forcedDraws) {
    nextState = advanceTurn(nextState);
  }

  return nextState;
}

export function playerStay(state, playerId) {
  if (state.phase !== 'playing' || state.pendingAction || state.forcedDraws) {
    return state;
  }

  const currentPlayer = state.players[state.currentTurnIndex];
  if (!currentPlayer || currentPlayer.id !== playerId || currentPlayer.status !== 'active') {
    return state;
  }

  const updatedPlayers = state.players.map((p) =>
    p.id === playerId ? { ...p, status: 'stayed' } : p
  );

  const pts = calculateRoundScore(currentPlayer.hand, false);
  const nextState = {
    ...state,
    players: updatedPlayers,
    lastEvent: {
      card: null,
      playerName: currentPlayer.name,
      description: `${currentPlayer.name} parou e garantiu ${pts} pontos.`,
    },
    logs: [...state.logs, `${currentPlayer.name} parou e garantiu ${pts} pontos.`],
  };

  return advanceTurn(nextState);
}

// Remove/pula um jogador que desconectou da sala online para evitar softlock.
export function handlePlayerDisconnect(state, disconnectedPlayerId) {
  const player = state.players.find((p) => p.id === disconnectedPlayerId);
  if (!player || player.status === 'disconnected') return state;

  const updatedPlayers = state.players.map((p) =>
    p.id === disconnectedPlayerId ? { ...p, status: 'disconnected' } : p
  );

  let nextState = {
    ...state,
    players: updatedPlayers,
    lastEvent: {
      card: null,
      playerName: player.name,
      description: `🚪 ${player.name} saiu da partida.`,
    },
    logs: [...state.logs, `🚪 ${player.name} saiu da partida.`],
  };

  // Se havia uma ação pendente aguardando quem saiu, cancela a ação pendente
  if (nextState.pendingAction?.sourcePlayerId === disconnectedPlayerId) {
    nextState.pendingAction = null;
  }

  if (nextState.phase === 'playing') {
    const checked = checkRoundEnd(nextState);
    if (checked.phase !== 'playing') return checked;

    const currentTurnPlayer = checked.players[checked.currentTurnIndex];
    if (!currentTurnPlayer || currentTurnPlayer.status !== 'active') {
      return advanceTurn(checked);
    }
    return checked;
  }

  return nextState;
}

export function resolvePendingAction(state, targetPlayerId) {
  if (!state.pendingAction) return state;

  const { type, sourcePlayerId, card: actionCard } = state.pendingAction;
  const sourcePlayer = state.players.find((p) => p.id === sourcePlayerId);
  const targetPlayer = state.players.find((p) => p.id === targetPlayerId);

  if (!targetPlayer || targetPlayer.status !== 'active') {
    return state;
  }

  let nextState = {
    ...state,
    pendingAction: null,
  };

  if (type === 'freeze') {
    const pts = calculateRoundScore(targetPlayer.hand, false);
    const desc = `${sourcePlayer.name} usou FREEZE em ${targetPlayer.name} (congelado com ${pts} pts)!`;
    nextState.players = nextState.players.map((p) =>
      p.id === targetPlayerId ? { ...p, status: 'frozen' } : p
    );
    nextState.lastEvent = {
      card: actionCard || { type: 'action', value: 'freeze', label: 'Freeze' },
      playerName: sourcePlayer.name,
      description: desc,
    };
    nextState.logs = [...nextState.logs, `❄️ ${desc}`];

    return checkQueuedOrAdvance(nextState);
  }

  if (type === 'give_second_chance') {
    if (targetPlayer.hasSecondChance || targetPlayer.id === sourcePlayerId) {
      return state;
    }
    const desc = `${sourcePlayer.name} entregou uma SECOND CHANCE para ${targetPlayer.name}.`;
    nextState.players = nextState.players.map((p) =>
      p.id === targetPlayerId ? { ...p, hasSecondChance: true } : p
    );
    nextState.lastEvent = {
      card: actionCard || { type: 'action', value: 'second_chance', label: 'Second Chance' },
      playerName: sourcePlayer.name,
      description: desc,
    };
    nextState.logs = [...nextState.logs, `🛡️ ${desc}`];

    return checkQueuedOrAdvance(nextState);
  }

  if (type === 'flip_three') {
    const desc = `${sourcePlayer.name} usou FLIP THREE em ${targetPlayer.name}!`;
    nextState.lastEvent = {
      card: actionCard || { type: 'action', value: 'flip_three', label: 'Flip Three' },
      playerName: sourcePlayer.name,
      description: desc,
    };
    nextState.logs = [...nextState.logs, `⚡ ${desc}`];
    nextState.forcedDraws = {
      targetPlayerId,
      remaining: 3,
      queuedActions: [],
    };

    return processForcedDraws(nextState);
  }

  return nextState;
}

function processForcedDraws(state) {
  let current = { ...state };

  while (current.forcedDraws && current.forcedDraws.remaining > 0) {
    const { targetPlayerId } = current.forcedDraws;
    const target = current.players.find((p) => p.id === targetPlayerId);

    if (!target || target.status !== 'active') {
      break;
    }

    current.forcedDraws = {
      ...current.forcedDraws,
      remaining: current.forcedDraws.remaining - 1,
    };

    current = resolveCardDrawForPlayer(current, targetPlayerId, false, true);

    if (current.phase !== 'playing') {
      current.forcedDraws = null;
      return current;
    }
  }

  const queued = current.forcedDraws?.queuedActions || [];
  current.forcedDraws = null;

  if (queued.length > 0) {
    const [nextAction, ...rest] = queued;
    current = triggerActionCard(current, nextAction.sourcePlayerId, nextAction.card, rest);
    return current;
  }

  return advanceTurn(current);
}

function resolveCardDrawForPlayer(state, playerId, isInitialDeal = false, isDuringFlipThree = false) {
  const { card, drawPile, discardPile } = drawSingleCard(state);
  if (!card) return state;

  let nextState = {
    ...state,
    drawPile,
    discardPile,
  };

  const player = nextState.players.find((p) => p.id === playerId);

  // 1. Carta Numérica
  if (card.type === 'number') {
    const isDuplicate = hasDuplicateNumber(player.hand, card);

    if (isDuplicate) {
      if (player.hasSecondChance) {
        const desc = `${player.name} tirou ${card.label} repetido, mas usou SECOND CHANCE e sobreviveu!`;
        nextState.players = nextState.players.map((p) =>
          p.id === playerId ? { ...p, hasSecondChance: false } : p
        );
        nextState.discardPile = [...nextState.discardPile, card];
        nextState.lastEvent = { card, playerName: player.name, description: desc };
        nextState.logs = [...nextState.logs, `🛡️ ${desc}`];
        return nextState;
      } else {
        const desc = `${player.name} tirou ${card.label} repetido e ESTOUROU (Bust)!`;
        nextState.players = nextState.players.map((p) =>
          p.id === playerId ? { ...p, hand: [...p.hand, card], status: 'busted' } : p
        );
        nextState.lastEvent = { card, playerName: player.name, description: desc };
        nextState.logs = [...nextState.logs, `💥 ${desc}`];
        return checkRoundEnd(nextState);
      }
    }

    const newHand = [...player.hand, card];
    const achievedFlip7 = hasFlip7(newHand);
    const desc = `${player.name} comprou o número ${card.label}.`;

    nextState.players = nextState.players.map((p) =>
      p.id === playerId ? { ...p, hand: newHand } : p
    );
    nextState.lastEvent = { card, playerName: player.name, description: desc };
    nextState.logs = [...nextState.logs, desc];

    if (achievedFlip7) {
      const f7Desc = `🎉 FLIP 7! ${player.name} completou 7 números diferentes (+15 pts)!`;
      nextState.lastEvent = { card, playerName: player.name, description: f7Desc };
      nextState.logs = [...nextState.logs, f7Desc];
      return endRound(nextState);
    }

    return nextState;
  }

  // 2. Carta Modificadora
  if (card.type === 'modifier') {
    const desc = `${player.name} comprou o modificador ${card.label}.`;
    nextState.players = nextState.players.map((p) =>
      p.id === playerId ? { ...p, hand: [...p.hand, card] } : p
    );
    nextState.lastEvent = { card, playerName: player.name, description: desc };
    nextState.logs = [...nextState.logs, desc];
    return nextState;
  }

  // 3. Carta de Ação
  if (card.type === 'action') {
    if (isDuringFlipThree && (card.value === 'freeze' || card.value === 'flip_three')) {
      const desc = `${player.name} revelou ${card.label} durante o Flip Three (será resolvido ao final).`;
      nextState.discardPile = [...nextState.discardPile, card];
      nextState.forcedDraws = {
        ...nextState.forcedDraws,
        queuedActions: [
          ...nextState.forcedDraws.queuedActions,
          { sourcePlayerId: playerId, card },
        ],
      };
      nextState.lastEvent = { card, playerName: player.name, description: desc };
      nextState.logs = [...nextState.logs, desc];
      return nextState;
    }

    return triggerActionCard(nextState, playerId, card);
  }

  return nextState;
}

function triggerActionCard(state, playerId, card, remainingQueue = []) {
  const player = state.players.find((p) => p.id === playerId);
  const activePlayers = state.players.filter((p) => p.status === 'active');

  if (card.value === 'second_chance') {
    if (!player.hasSecondChance) {
      const desc = `${player.name} ganhou uma SECOND CHANCE!`;
      const updatedPlayers = state.players.map((p) =>
        p.id === playerId ? { ...p, hasSecondChance: true } : p
      );
      return {
        ...state,
        players: updatedPlayers,
        lastEvent: { card, playerName: player.name, description: desc },
        logs: [...state.logs, `🛡️ ${desc}`],
      };
    } else {
      const eligibleTargets = activePlayers.filter(
        (p) => p.id !== playerId && !p.hasSecondChance
      );
      if (eligibleTargets.length === 0) {
        const desc = `${player.name} tirou outra Second Chance, mas ninguém pode receber (descartada).`;
        return {
          ...state,
          discardPile: [...state.discardPile, card],
          lastEvent: { card, playerName: player.name, description: desc },
          logs: [...state.logs, desc],
        };
      }
      const desc = `${player.name} tirou uma Second Chance extra e precisa escolher quem vai recebê-la.`;
      return {
        ...state,
        pendingAction: {
          type: 'give_second_chance',
          sourcePlayerId: playerId,
          card,
          remainingQueue,
        },
        lastEvent: { card, playerName: player.name, description: desc },
        logs: [...state.logs, desc],
      };
    }
  }

  const nextState = {
    ...state,
    discardPile: [...state.discardPile, card],
  };

  if (activePlayers.length === 1) {
    const autoState = {
      ...nextState,
      pendingAction: {
        type: card.value,
        sourcePlayerId: playerId,
        card,
        remainingQueue,
      },
    };
    return resolvePendingAction(autoState, activePlayers[0].id);
  }

  const desc = `${player.name} comprou ${card.label}! Escolha um jogador ativo como alvo.`;
  return {
    ...nextState,
    pendingAction: {
      type: card.value,
      sourcePlayerId: playerId,
      card,
      remainingQueue,
    },
    lastEvent: { card, playerName: player.name, description: desc },
    logs: [...state.logs, `🎴 ${desc}`],
  };
}

function checkQueuedOrAdvance(state) {
  const afterCheck = checkRoundEnd(state);
  if (afterCheck.phase !== 'playing') return afterCheck;
  return advanceTurn(afterCheck);
}

function advanceTurn(state) {
  const checked = checkRoundEnd(state);
  if (checked.phase !== 'playing') return checked;

  const nextIndex = findNextActivePlayerIndex(checked, checked.currentTurnIndex);
  if (nextIndex === -1) {
    return endRound(checked);
  }

  return {
    ...checked,
    currentTurnIndex: nextIndex,
  };
}

function findNextActivePlayerIndex(state, fromIndex) {
  const total = state.players.length;
  for (let offset = 1; offset <= total; offset++) {
    const idx = (fromIndex + offset) % total;
    if (state.players[idx].status === 'active') {
      return idx;
    }
  }
  return -1;
}

function checkRoundEnd(state) {
  const anyActive = state.players.some((p) => p.status === 'active');
  if (!anyActive) {
    return endRound(state);
  }
  return state;
}

function endRound(state) {
  const updatedPlayers = state.players.map((p) => {
    const isZero = p.status === 'busted' || p.status === 'disconnected';
    const roundPts = calculateRoundScore(p.hand, isZero);
    return {
      ...p,
      totalScore: p.totalScore + roundPts,
    };
  });

  const candidates = updatedPlayers.filter(
    (p) => p.status !== 'disconnected' && p.totalScore >= 200
  );

  if (candidates.length > 0) {
    const maxScore = Math.max(...candidates.map((p) => p.totalScore));
    const topPlayers = candidates.filter((p) => p.totalScore === maxScore);

    if (topPlayers.length === 1) {
      return {
        ...state,
        phase: 'game_over',
        players: updatedPlayers,
        winnerIds: [topPlayers[0].id],
        logs: [
          ...state.logs,
          `🏆 FIM DE JOGO! ${topPlayers[0].name} venceu com ${topPlayers[0].totalScore} pontos!`,
        ],
      };
    }
  }

  return {
    ...state,
    phase: 'round_over',
    players: updatedPlayers,
    logs: [
      ...state.logs,
      `Fim da Rodada ${state.roundNumber}! Pontuações atualizadas.`,
    ],
  };
}

export function startNextRound(state) {
  if (state.phase !== 'round_over') return state;

  const cardsFromHands = state.players.flatMap((p) => p.hand);
  // Mantém na próxima rodada apenas jogadores conectados (remove quem saiu)
  const remainingPlayers = state.players.filter((p) => p.status !== 'disconnected');
  if (remainingPlayers.length < 2) return state;

  const nextDealerIndex = (state.dealerIndex + 1) % remainingPlayers.length;

  const resetPlayers = remainingPlayers.map((p) => ({
    ...p,
    hand: [],
    hasSecondChance: false,
    status: 'active',
  }));

  const nextState = {
    ...state,
    phase: 'playing',
    roundNumber: state.roundNumber + 1,
    dealerIndex: nextDealerIndex,
    currentTurnIndex: nextDealerIndex,
    discardPile: [...state.discardPile, ...cardsFromHands],
    players: resetPlayers,
    pendingAction: null,
    forcedDraws: null,
    lastEvent: null,
    logs: [...state.logs, `--- Iniciando Rodada ${state.roundNumber + 1} ---`],
  };

  return dealInitialCards(nextState);
}
