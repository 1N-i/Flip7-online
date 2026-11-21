import { createDeck, shuffleDeck } from './deck.js';
import {
  calculateRoundScore,
  hasDuplicateNumber,
  hasFlip7,
} from './scoring.js';

// Cria o estado inicial de uma partida com a lista de nomes/ids dos jogadores.
export function createInitialGameState(playersList) {
  const deck = shuffleDeck(createDeck());

  const players = playersList.map((p, index) => ({
    id: p.id || `player-${index}`,
    name: p.name,
    isBot: Boolean(p.isBot),
    totalScore: 0,
    hand: [], // Cartas numéricas e modificadoras na rodada
    hasSecondChance: false, // Se possui escudo Second Chance ativo
    status: 'active', // 'active' | 'stayed' | 'busted' | 'frozen'
  }));

  const state = {
    phase: 'playing', // 'playing' | 'round_over' | 'game_over'
    roundNumber: 1,
    dealerIndex: 0,
    currentTurnIndex: 0,
    drawPile: deck,
    discardPile: [],
    players,
    // Quando uma carta exige escolha de alvo: { type: 'freeze' | 'flip_three' | 'give_second_chance', sourcePlayerId }
    pendingAction: null,
    // Controle interno de compras obrigatórias (ex: Flip Three)
    forcedDraws: null, // { targetPlayerId, remaining, queuedActions: [] }
    winnerIds: [],
    logs: ['Partida iniciada! Rodada 1.'],
  };

  return dealInitialCards(state);
}

// Compra 1 carta do topo do baralho. Se acabar, reembaralha o descarte.
function drawSingleCard(state) {
  let drawPile = [...state.drawPile];
  let discardPile = [...state.discardPile];

  if (drawPile.length === 0) {
    if (discardPile.length === 0) {
      // Caso extremo com 18 jogadores e todas as 94 cartas na mesa
      return { card: null, drawPile, discardPile };
    }
    drawPile = shuffleDeck(discardPile);
    discardPile = [];
  }

  const card = drawPile.shift();
  return { card, drawPile, discardPile };
}

/**
 * Distribui 1 carta inicial para cada jogador no início da rodada,
 * começando pelo dealer e resolvendo cartas de ação caso saiam na distribuição.
 */
function dealInitialCards(initialState) {
  let state = { ...initialState };
  const totalPlayers = state.players.length;

  for (let i = 0; i < totalPlayers; i++) {
    const playerIndex = (state.dealerIndex + i) % totalPlayers;
    const player = state.players[playerIndex];

    // Se uma ação anterior já encerrou a rodada ou pausou para escolha
    if (state.phase !== 'playing' || state.pendingAction) {
      // Marca quem ainda não recebeu carta inicial se necessário, mas no Flip 7
      // a distribuição inicial ocorre um a um; para simplificar o fluxo online,
      // cada jogador começa com 1 carta já na mesa ou compra no seu turno se interrompido.
      break;
    }

    if (player.status === 'active') {
      state = resolveCardDrawForPlayer(state, player.id, true);
    }
  }

  // Garante que o turno atual aponte para o primeiro jogador ativo a partir do dealer
  if (state.phase === 'playing' && !state.pendingAction) {
    state.currentTurnIndex = findNextActivePlayerIndex(state, state.dealerIndex - 1);
  }

  return state;
}

// Ação do jogador: Pedir carta ("Hit")
export function playerHit(state, playerId) {
  if (state.phase !== 'playing' || state.pendingAction || state.forcedDraws) {
    return state;
  }

  const currentPlayer = state.players[state.currentTurnIndex];
  if (!currentPlayer || currentPlayer.id !== playerId || currentPlayer.status !== 'active') {
    return state;
  }

  let nextState = resolveCardDrawForPlayer(state, playerId, false);

  // Se não houve pausa para ação pendente e a rodada não acabou, passa o turno
  if (nextState.phase === 'playing' && !nextState.pendingAction && !nextState.forcedDraws) {
    nextState = advanceTurn(nextState);
  }

  return nextState;
}

// Ação do jogador: Parar e garantir os pontos da rodada ("Stay")
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
  let nextState = {
    ...state,
    players: updatedPlayers,
    logs: [...state.logs, `${currentPlayer.name} parou e garantiu ${pts} pontos.`],
  };

  return advanceTurn(nextState);
}

// Resolve a escolha de alvo quando uma carta de ação (Freeze, Flip Three, Second Chance extra) é ativada.
export function resolvePendingAction(state, targetPlayerId) {
  if (!state.pendingAction) return state;

  const { type, sourcePlayerId } = state.pendingAction;
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
    nextState.players = nextState.players.map((p) =>
      p.id === targetPlayerId ? { ...p, status: 'frozen' } : p
    );
    nextState.logs = [
      ...nextState.logs,
      `${sourcePlayer.name} usou Freeze em ${targetPlayer.name} (garantiu ${pts} pts)!`,
    ];

    return checkQueuedOrAdvance(nextState);
  }

  if (type === 'give_second_chance') {
    if (targetPlayer.hasSecondChance || targetPlayer.id === sourcePlayerId) {
      return state; // Alvo inválido
    }
    nextState.players = nextState.players.map((p) =>
      p.id === targetPlayerId ? { ...p, hasSecondChance: true } : p
    );
    nextState.logs = [
      ...nextState.logs,
      `${sourcePlayer.name} entregou uma Second Chance para ${targetPlayer.name}.`,
    ];

    return checkQueuedOrAdvance(nextState);
  }

  if (type === 'flip_three') {
    nextState.logs = [
      ...nextState.logs,
      `${sourcePlayer.name} usou Flip Three em ${targetPlayer.name}!`,
    ];
    nextState.forcedDraws = {
      targetPlayerId,
      remaining: 3,
      queuedActions: [],
    };

    return processForcedDraws(nextState);
  }

  return nextState;
}

// Processa as compras obrigatórias de um Flip Three uma a uma.
function processForcedDraws(state) {
  let current = { ...state };

  while (current.forcedDraws && current.forcedDraws.remaining > 0) {
    const { targetPlayerId } = current.forcedDraws;
    const target = current.players.find((p) => p.id === targetPlayerId);

    // Se o alvo estourou ou fez Flip 7 no meio das 3 cartas, interrompe as compras restantes
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

  // Após terminar as 3 compras (ou interromper por Bust), verifica se há ações enfileiradas
  const queued = current.forcedDraws?.queuedActions || [];
  current.forcedDraws = null;

  if (queued.length > 0) {
    const [nextAction, ...rest] = queued;
    // Se houver mais ações na fila, guardamos no estado para processar em sequência
    current = triggerActionCard(current, nextAction.sourcePlayerId, nextAction.card, rest);
    return current;
  }

  return advanceTurn(current);
}

// Lógica central de comprar 1 carta para um jogador e aplicar seus efeitos imediatos.
function resolveCardDrawForPlayer(state, playerId, isInitialDeal = false, isDuringFlipThree = false) {
  const { card, drawPile, discardPile } = drawSingleCard(state);
  if (!card) return state;

  let nextState = {
    ...state,
    drawPile,
    discardPile,
  };

  const player = nextState.players.find((p) => p.id === playerId);

  // 1- Carta Numérica
  if (card.type === 'number') {
    const isDuplicate = hasDuplicateNumber(player.hand, card);

    if (isDuplicate) {
      if (player.hasSecondChance) {
        // Consome Second Chance e descarta a carta repetida
        nextState.players = nextState.players.map((p) =>
          p.id === playerId ? { ...p, hasSecondChance: false } : p
        );
        nextState.discardPile = [...nextState.discardPile, card];
        nextState.logs = [
          ...nextState.logs,
          `${player.name} tirou ${card.label} repetido, mas usou Second Chance e sobreviveu!`,
        ];
        return nextState;
      } else {
        // Bust! Perde todos os pontos da rodada
        nextState.players = nextState.players.map((p) =>
          p.id === playerId ? { ...p, hand: [...p.hand, card], status: 'busted' } : p
        );
        nextState.logs = [
          ...nextState.logs,
          `💥 ${player.name} tirou ${card.label} repetido e ESTOUROU (Bust)!`,
        ];
        return checkRoundEnd(nextState);
      }
    }

    // Carta numérica válida
    const newHand = [...player.hand, card];
    const achievedFlip7 = hasFlip7(newHand);

    nextState.players = nextState.players.map((p) =>
      p.id === playerId ? { ...p, hand: newHand } : p
    );
    nextState.logs = [
      ...nextState.logs,
      `${player.name} comprou o número ${card.label}.`,
    ];

    if (achievedFlip7) {
      nextState.logs = [
        ...nextState.logs,
        `🎉 FLIP 7! ${player.name} completou 7 números diferentes (+15 pts) e encerrou a rodada!`,
      ];
      return endRound(nextState);
    }

    return nextState;
  }

  // 2- Carta Modificadora (+2..+10, x2)
  if (card.type === 'modifier') {
    nextState.players = nextState.players.map((p) =>
      p.id === playerId ? { ...p, hand: [...p.hand, card] } : p
    );
    nextState.logs = [
      ...nextState.logs,
      `${player.name} comprou o modificador ${card.label}.`,
    ];
    return nextState;
  }

  // 3- Carta de Ação (Freeze, Flip Three, Second Chance)
  if (card.type === 'action') {
    if (isDuringFlipThree && (card.value === 'freeze' || card.value === 'flip_three')) {
      // Durante Flip Three, Freeze e Flip Three ficam na fila para resolver após as 3 cartas
      nextState.discardPile = [...nextState.discardPile, card];
      nextState.forcedDraws = {
        ...nextState.forcedDraws,
        queuedActions: [
          ...nextState.forcedDraws.queuedActions,
          { sourcePlayerId: playerId, card },
        ],
      };
      nextState.logs = [
        ...nextState.logs,
        `${player.name} revelou ${card.label} durante o Flip Three (será resolvido ao final).`,
      ];
      return nextState;
    }

    return triggerActionCard(nextState, playerId, card);
  }

  return nextState;
}

// Ativa o efeito de uma carta de ação ou coloca em pendingAction se precisar escolher alvo.
function triggerActionCard(state, playerId, card, remainingQueue = []) {
  const player = state.players.find((p) => p.id === playerId);
  const activePlayers = state.players.filter((p) => p.status === 'active');

  if (card.value === 'second_chance') {
    if (!player.hasSecondChance) {
      const updatedPlayers = state.players.map((p) =>
        p.id === playerId ? { ...p, hasSecondChance: true } : p
      );
      return {
        ...state,
        players: updatedPlayers,
        logs: [...state.logs, `${player.name} ganhou uma Second Chance!`],
      };
    } else {
      // Já possui Second Chance: precisa doar para outro jogador ativo sem ela
      const eligibleTargets = activePlayers.filter(
        (p) => p.id !== playerId && !p.hasSecondChance
      );
      if (eligibleTargets.length === 0) {
        return {
          ...state,
          discardPile: [...state.discardPile, card],
          logs: [
            ...state.logs,
            `${player.name} tirou outra Second Chance, mas ninguém pode receber (descartada).`,
          ],
        };
      }
      return {
        ...state,
        pendingAction: {
          type: 'give_second_chance',
          sourcePlayerId: playerId,
          remainingQueue,
        },
        logs: [
          ...state.logs,
          `${player.name} já tem Second Chance e deve escolher alguém para recebê-la.`,
        ],
      };
    }
  }

  // Freeze ou Flip Three: descarta a carta e pede escolha de alvo (se só houver 1 ativo, aplica nele mesmo)
  const nextState = {
    ...state,
    discardPile: [...state.discardPile, card],
  };

  if (activePlayers.length === 1) {
    // Só o próprio jogador está ativo: aplica automaticamente nele
    const autoState = {
      ...nextState,
      pendingAction: {
        type: card.value,
        sourcePlayerId: playerId,
        remainingQueue,
      },
    };
    return resolvePendingAction(autoState, activePlayers[0].id);
  }

  return {
    ...nextState,
    pendingAction: {
      type: card.value,
      sourcePlayerId: playerId,
      remainingQueue,
    },
    logs: [
      ...nextState.logs,
      `${player.name} tirou ${card.label}! Escolha um jogador ativo como alvo.`,
    ],
  };
}

function checkQueuedOrAdvance(state) {
  const afterCheck = checkRoundEnd(state);
  if (afterCheck.phase !== 'playing') return afterCheck;
  return advanceTurn(afterCheck);
}

/**
 * Avança o turno para o próximo jogador com status 'active'.
 * Se não houver mais ninguém ativo, encerra a rodada.
 */
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

// Verifica se todos os jogadores já encerraram (stayed, frozen ou busted).
function checkRoundEnd(state) {
  const anyActive = state.players.some((p) => p.status === 'active');
  if (!anyActive) {
    return endRound(state);
  }
  return state;
}

// Encerra a rodada atual, soma os pontos na pontuação total e verifica vencedor (>= 200 pts).
function endRound(state) {
  const updatedPlayers = state.players.map((p) => {
    const roundPts = calculateRoundScore(p.hand, p.status === 'busted');
    return {
      ...p,
      totalScore: p.totalScore + roundPts,
    };
  });

  // Verifica se alguém atingiu 200 pontos ou mais
  const candidates = updatedPlayers.filter((p) => p.totalScore >= 200);

  if (candidates.length > 0) {
    const maxScore = Math.max(...candidates.map((p) => p.totalScore));
    const topPlayers = candidates.filter((p) => p.totalScore === maxScore);

    // Se houver apenas 1 líder isolado >= 200, fim de jogo! (Empate exige rodada extra)
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

// Inicia a próxima rodada: recolhe cartas da mesa para o descarte e passa o dealer.
export function startNextRound(state) {
  if (state.phase !== 'round_over') return state;

  // Recolhe todas as cartas das mãos dos jogadores para o monte de descarte
  const cardsFromHands = state.players.flatMap((p) => p.hand);
  const nextDealerIndex = (state.dealerIndex + 1) % state.players.length;

  const resetPlayers = state.players.map((p) => ({
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
    logs: [...state.logs, `--- Iniciando Rodada ${state.roundNumber + 1} ---`],
  };

  return dealInitialCards(nextState);
}