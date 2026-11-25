import { useState, useEffect, useCallback } from 'react';
import './App.css';
import {
  createInitialGameState,
  playerHit,
  playerStay,
  resolvePendingAction,
  startNextRound,
  handlePlayerDisconnect,
} from './game/engine.js';
import {
  decideBotTurnAction,
  decideBotActionTarget,
} from './game/botAI.js';
import {
  isOnlineAvailable,
  createOnlineRoom,
  joinOnlineRoom,
  subscribeToRoom,
  startOnlineMatch,
  promoteSpectatorsAndStart,
  syncGameState,
  normalizeFirebaseGameState,
  addBotToOnlineLobby,
  removePlayerFromOnlineLobby,
  transferHost,
  leaveOnlineRoom,
  deleteOnlineRoom,
} from './game/onlineService.js';
import { PlayerBoard } from './components/PlayerBoard.jsx';
import { Card } from './components/Card.jsx';

const BOT_PRESETS = [
  { name: 'Bot Alfa', profile: 'balanced' },
  { name: 'Bot Cautela', profile: 'conservative' },
  { name: 'Bot Ousado', profile: 'aggressive' },
  { name: 'Bot Cálculo', profile: 'balanced' },
  { name: 'Bot Seguro', profile: 'conservative' },
  { name: 'Bot Turbo', profile: 'aggressive' },
];

function createBotPlayer(existingCount) {
  const preset = BOT_PRESETS[existingCount % BOT_PRESETS.length];
  return {
    id: `bot-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    name: `${preset.name} #${existingCount + 1}`,
    isBot: true,
    botProfile: preset.profile,
  };
}

export function App() {
  const [screen, setScreen] = useState('home');

  // Estados do Modo Local
  const [setupPlayers, setSetupPlayers] = useState([
    { id: 'p-1', name: 'Jogador 1', isBot: false },
    createBotPlayer(0),
  ]);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [localGameState, setLocalGameState] = useState(null);

  // Estados do Modo Online
  const [playerName, setPlayerName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [myPlayerId, setMyPlayerId] = useState('');
  const [roomData, setRoomData] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);

  // Escuta alterações na sala online
  useEffect(() => {
    if (!roomCode) return;
    const unsubscribe = subscribeToRoom(roomCode, (data) => {
      if (!data) {
        setErrorMsg('A sala foi encerrada.');
        setScreen('home');
        setRoomCode('');
        return;
      }
      setRoomData(data);
      if (data.status === 'playing') {
        setScreen('playing');
      }
    });
    return () => unsubscribe();
  }, [roomCode]);

  const isOnline = Boolean(roomCode);
  const gameState = isOnline
    ? normalizeFirebaseGameState(roomData?.gameState)
    : localGameState;

  const dispatchGameState = useCallback(
    async (nextState) => {
      if (isOnline) {
        await syncGameState(roomCode, nextState);
      } else {
        setLocalGameState(nextState);
      }
    },
    [isOnline, roomCode]
  );

  // --- MONITORAMENTO DE DESCONEXÃO E TROCA DE ADMIN ---
  useEffect(() => {
    if (!isOnline || !roomData || !myPlayerId) return;

    const lobbyEntries = Object.values(roomData.lobbyPlayers || {});
    const connectedHumans = lobbyEntries
      .filter((p) => !p.isBot && p.online !== false)
      .sort((a, b) => a.joinedAt - b.joinedAt);

    if (connectedHumans.length === 0) {
      deleteOnlineRoom(roomCode);
      return;
    }

    // 1. Se o anfitrião atual ficou offline, o primeiro humano conectado assume o cargo
    const currentHost = roomData.lobbyPlayers?.[roomData.hostId];
    if (!currentHost || currentHost.online === false) {
      if (connectedHumans[0].id === myPlayerId) {
        transferHost(roomCode, myPlayerId);
      }
      return;
    }

    // 2. Se estamos em partida e o anfitrião sou eu, remove da rodada quem desconectou
    if (
      screen === 'playing' &&
      gameState &&
      roomData.hostId === myPlayerId
    ) {
      const disconnectedInGame = gameState.players.find((p) => {
        if (p.isBot || p.status === 'disconnected') return false;
        const lobbyInfo = roomData.lobbyPlayers?.[p.id];
        return !lobbyInfo || lobbyInfo.online === false;
      });

      if (disconnectedInGame) {
        const cleanedState = handlePlayerDisconnect(
          gameState,
          disconnectedInGame.id
        );
        dispatchGameState(cleanedState);
      }
    }
  }, [
    isOnline,
    roomData,
    myPlayerId,
    roomCode,
    screen,
    gameState,
    dispatchGameState,
  ]);

  // --- AUTOMAÇÃO DOS BOTS ---
  useEffect(() => {
    if (screen !== 'playing' || !gameState || gameState.phase !== 'playing') {
      return;
    }

    if (isOnline && roomData?.hostId !== myPlayerId) {
      return;
    }

    const pending = gameState.pendingAction;
    const currentPlayer = gameState.players[gameState.currentTurnIndex];

    if (pending) {
      const sourcePlayer = gameState.players.find(
        (p) => p.id === pending.sourcePlayerId
      );
      if (sourcePlayer?.isBot) {
        const timer = setTimeout(() => {
          const targetId = decideBotActionTarget(gameState, pending);
          if (targetId) {
            dispatchGameState(resolvePendingAction(gameState, targetId));
          }
        }, 1200);
        return () => clearTimeout(timer);
      }
      return;
    }

    if (currentPlayer?.isBot && currentPlayer.status === 'active') {
      const timer = setTimeout(() => {
        const decision = decideBotTurnAction(gameState, currentPlayer);
        if (decision === 'hit') {
          dispatchGameState(playerHit(gameState, currentPlayer.id));
        } else {
          dispatchGameState(playerStay(gameState, currentPlayer.id));
        }
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, [
    screen,
    gameState,
    isOnline,
    roomData?.hostId,
    myPlayerId,
    dispatchGameState,
  ]);

  // --- AÇÕES ONLINE ---
  const handleCreateRoom = async (e) => {
    e.preventDefault();
    if (!playerName.trim()) return;
    setErrorMsg('');
    setLoading(true);
    try {
      const res = await createOnlineRoom(playerName);
      setRoomCode(res.roomCode);
      setMyPlayerId(res.playerId);
      setScreen('online_lobby');
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleJoinRoom = async (e) => {
    e.preventDefault();
    if (!playerName.trim() || !joinCode.trim()) return;
    setErrorMsg('');
    setLoading(true);
    try {
      const res = await joinOnlineRoom(joinCode, playerName);
      setRoomCode(res.roomCode);
      setMyPlayerId(res.playerId);
      setScreen(res.isSpectator ? 'playing' : 'online_lobby');
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLeaveMatch = async () => {
    if (isOnline && roomCode && myPlayerId) {
      await leaveOnlineRoom(roomCode, myPlayerId);
    }
    setRoomCode('');
    setRoomData(null);
    setLocalGameState(null);
    setScreen('home');
  };

  const handleAddOnlineBot = async () => {
    if (!roomData?.lobbyPlayers) return;
    const list = Object.values(roomData.lobbyPlayers).filter(
      (p) => p.online !== false
    );
    if (list.length >= 18) return;
    const botCount = list.filter((p) => p.isBot).length;
    await addBotToOnlineLobby(roomCode, createBotPlayer(botCount));
  };

  const handleStartOnlineGame = async () => {
    if (!roomData?.lobbyPlayers) return;
    const list = Object.values(roomData.lobbyPlayers)
      .filter((p) => p.online !== false)
      .sort((a, b) => a.joinedAt - b.joinedAt);
    if (list.length < 2) return;
    const initial = createInitialGameState(list);
    await startOnlineMatch(roomCode, initial);
  };

  // --- AÇÕES LOCAIS ---
  const handleAddLocalPlayer = (e) => {
    e.preventDefault();
    const trimmed = newPlayerName.trim();
    if (!trimmed || setupPlayers.length >= 18) return;
    setSetupPlayers([
      ...setupPlayers,
      { id: `p-${Date.now()}`, name: trimmed, isBot: false },
    ]);
    setNewPlayerName('');
  };

  const handleAddLocalBot = () => {
    if (setupPlayers.length >= 18) return;
    const botCount = setupPlayers.filter((p) => p.isBot).length;
    setSetupPlayers([...setupPlayers, createBotPlayer(botCount)]);
  };

  const handleStartLocalGame = () => {
    setLocalGameState(createInitialGameState(setupPlayers));
    setRoomCode('');
    setScreen('playing');
  };

  // --- TELA INICIAL ---
  if (screen === 'home') {
    const onlineReady = isOnlineAvailable();
    return (
      <div className="app-container">
        <div className="setup-screen">
          <h1>FLIP 7</h1>
          <p className="subtitle">Multiplayer Online & Bots (2 a 18 jogadores)</p>

          {errorMsg && (
            <p style={{ color: '#f87171', marginBottom: '1rem' }}>{errorMsg}</p>
          )}

          {!onlineReady && (
            <p
              style={{
                color: '#fbbf24',
                fontSize: '0.85rem',
                marginBottom: '1rem',
              }}
            >
              ⚠️ Configure o arquivo .env.local com as chaves do Firebase para
              ativar o modo online.
            </p>
          )}

          <div style={{ textAlign: 'left', marginBottom: '1.2rem' }}>
            <label style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
              Seu apelido na mesa:
            </label>
            <input
              type="text"
              placeholder="Digite seu nome..."
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              maxLength={20}
              style={{
                width: '100%',
                marginTop: '0.35rem',
                padding: '0.7rem 1rem',
                borderRadius: '8px',
                border: '1px solid #334155',
                background: '#0f172a',
                color: '#fff',
              }}
            />
          </div>

          <button
            className="btn btn-success"
            style={{ marginBottom: '1rem' }}
            disabled={!onlineReady || !playerName.trim() || loading}
            onClick={handleCreateRoom}
          >
            Criar Nova Sala Online
          </button>

          <form onSubmit={handleJoinRoom} className="add-player-form">
            <input
              type="text"
              placeholder="Código (ex: A7X9)"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              maxLength={4}
              style={{ textTransform: 'uppercase', letterSpacing: '2px' }}
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={
                !onlineReady ||
                !playerName.trim() ||
                joinCode.trim().length < 4 ||
                loading
              }
            >
              Entrar
            </button>
          </form>

          <hr style={{ borderColor: '#334155', margin: '1.5rem 0' }} />

          <button
            className="btn"
            style={{ background: '#334155', color: '#e2e8f0', width: '100%' }}
            onClick={() => setScreen('local_setup')}
          >
            Jogar Localmente / Solo vs Bots
          </button>
        </div>
      </div>
    );
  }

  // --- LOBBY DA SALA ONLINE ---
  if (screen === 'online_lobby' && roomData) {
    const lobbyList = Object.values(roomData.lobbyPlayers || {})
      .filter((p) => p.online !== false)
      .sort((a, b) => a.joinedAt - b.joinedAt);
    const isHost = roomData.hostId === myPlayerId;

    return (
      <div className="app-container">
        <div className="setup-screen">
          <p className="subtitle">Código da Sala</p>
          <h1 style={{ letterSpacing: '6px', fontSize: '3rem' }}>{roomCode}</h1>
          <p className="subtitle">
            Compartilhe este código ou adicione Bots ({lobbyList.length}/18)
          </p>

          <ul className="player-list-setup">
            {lobbyList.map((p, idx) => (
              <li key={p.id}>
                <span>
                  {idx + 1}. {p.name}{' '}
                  {p.id === roomData.hostId && '👑 (Anfitrião)'}
                  {p.id === myPlayerId && ' (Você)'}
                  {p.isBot && ' 🤖'}
                </span>
                {isHost && p.isBot && (
                  <button
                    type="button"
                    className="btn-remove"
                    onClick={() => removePlayerFromOnlineLobby(roomCode, p.id)}
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>

          {isHost ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.6rem',
              }}
            >
              <button
                type="button"
                className="btn btn-primary"
                disabled={lobbyList.length >= 18}
                onClick={handleAddOnlineBot}
              >
                + Adicionar Bot na Sala
              </button>
              <button
                className="btn btn-success"
                disabled={lobbyList.length < 2}
                onClick={handleStartOnlineGame}
              >
                {lobbyList.length < 2
                  ? 'Adicione um Bot ou aguarde um jogador...'
                  : `Iniciar Partida (${lobbyList.length} jogadores)`}
              </button>
            </div>
          ) : (
            <p style={{ color: '#38bdf8', fontWeight: 600 }}>
              Aguardando o anfitrião iniciar a partida...
            </p>
          )}

          <button
            type="button"
            className="btn"
            style={{
              marginTop: '1rem',
              background: 'transparent',
              color: '#94a3b8',
            }}
            onClick={handleLeaveMatch}
          >
            ← Sair da Sala
          </button>
        </div>
      </div>
    );
  }

  // --- SETUP LOCAL ---
  if (screen === 'local_setup') {
    return (
      <div className="app-container">
        <div className="setup-screen">
          <h1>FLIP 7</h1>
          <p className="subtitle">Modo Local / Solo vs Bots (2 a 18)</p>

          <form onSubmit={handleAddLocalPlayer} className="add-player-form">
            <input
              type="text"
              placeholder="Nome do jogador humano..."
              value={newPlayerName}
              onChange={(e) => setNewPlayerName(e.target.value)}
              maxLength={20}
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!newPlayerName.trim() || setupPlayers.length >= 18}
            >
              + Humano
            </button>
          </form>

          <button
            type="button"
            className="btn"
            style={{
              background: '#334155',
              color: '#38bdf8',
              width: '100%',
              marginBottom: '1rem',
            }}
            disabled={setupPlayers.length >= 18}
            onClick={handleAddLocalBot}
          >
            + Adicionar Bot 🤖
          </button>

          <ul className="player-list-setup">
            {setupPlayers.map((p, idx) => (
              <li key={p.id}>
                <span>
                  {idx + 1}. {p.name} {p.isBot && '🤖'}
                </span>
                {setupPlayers.length > 2 && (
                  <button
                    type="button"
                    className="btn-remove"
                    onClick={() =>
                      setSetupPlayers(
                        setupPlayers.filter((item) => item.id !== p.id)
                      )
                    }
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>

          <button
            type="button"
            className="btn btn-success"
            onClick={handleStartLocalGame}
          >
            Iniciar Partida ({setupPlayers.length} jogadores)
          </button>

          <button
            type="button"
            className="btn"
            style={{
              marginTop: '0.75rem',
              background: 'transparent',
              color: '#94a3b8',
            }}
            onClick={() => setScreen('home')}
          >
            ← Voltar
          </button>
        </div>
      </div>
    );
  }

  // --- PARTIDA EM ANDAMENTO ---
  if (!gameState) return null;

  const onlineSpectators = isOnline
    ? Object.values(roomData?.lobbyPlayers || {}).filter(
        (p) => p.online !== false && p.isSpectator
      )
    : [];
  const amISpectator = isOnline && Boolean(roomData?.lobbyPlayers?.[myPlayerId]?.isSpectator);

  const currentPlayer = gameState.players[gameState.currentTurnIndex];
  const pending = gameState.pendingAction;
  const activeCount = gameState.players.filter(
    (p) => p.status !== 'disconnected'
  ).length;

  const sourceIsBot = pending
    ? gameState.players.find((p) => p.id === pending.sourcePlayerId)?.isBot
    : false;

  const canActTurn =
    !currentPlayer?.isBot && (!isOnline || currentPlayer?.id === myPlayerId);
  const canResolvePending =
    !sourceIsBot && (!isOnline || pending?.sourcePlayerId === myPlayerId);

  const isTargetSelectable = (player) => {
    if (!pending || !canResolvePending || player.status !== 'active')
      return false;
    if (pending.type === 'give_second_chance') {
      return player.id !== pending.sourcePlayerId && !player.hasSecondChance;
    }
    return true;
  };

  const actionNames = {
    freeze: 'Freeze (Congelar)',
    flip_three: 'Flip Three (Comprar 3)',
    give_second_chance: 'Doar Second Chance',
  };

  return (
    <div className="app-container">
      <header className="game-header">
        <div>
          <h2>
            FLIP 7 — Rodada {gameState.roundNumber}{' '}
            {isOnline && (
              <span style={{ color: '#38bdf8', fontSize: '1rem' }}>
                | Sala: {roomCode}
              </span>
            )}
          </h2>
        </div>
        <div className="deck-info">
          {isOnline && onlineSpectators.length > 0 && (
            <span
              style={{ color: '#c084fc', fontWeight: 600 }}
              title={onlineSpectators.map((s) => s.name).join(', ')}
            >
              👁️ Espectadores: {onlineSpectators.length}
            </span>
          )}
          <span>Baralho: {gameState.drawPile.length} cartas</span>
          <span>Descarte: {gameState.discardPile.length} cartas</span>
          <button
            className="btn btn-primary"
            style={{ padding: '0.35rem 0.8rem', fontSize: '0.85rem' }}
            onClick={handleLeaveMatch}
          >
            Sair
          </button>
        </div>
      </header>
      {amISpectator && (
        <div
          style={{
            background: '#2e1065',
            border: '1px solid #9333ea',
            color: '#e9d5ff',
            padding: '0.7rem 1.2rem',
            borderRadius: '10px',
            marginBottom: '1rem',
            textAlign: 'center',
            fontWeight: 600,
          }}
        >
          👁️ Você está assistindo como Espectador. Você entrará automaticamente como jogador na próxima partida!
        </div>
      )}

      {/* Barra de Controle do Turno (mostra a carta apenas durante ação pendente) */}
      {gameState.phase === 'playing' && (
        <div className={`action-bar ${pending ? 'pending-alert' : ''}`}>
          {pending ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <Card
                  card={
                    pending.card || {
                      type: 'action',
                      value:
                        pending.type === 'give_second_chance'
                          ? 'second_chance'
                          : pending.type,
                      label: actionNames[pending.type],
                    }
                  }
                />
                <div>
                  <strong>⚠️ Ação Pendente: {actionNames[pending.type]}</strong>
                  <p>
                    {canResolvePending
                      ? 'Clique no tabuleiro de um jogador ativo destacado para aplicar o efeito.'
                      : sourceIsBot
                      ? '🤖 O Bot está escolhendo um alvo...'
                      : 'Aguardando o jogador escolher um alvo...'}
                  </p>
                </div>
              </div>
            </>
          ) : (
            <>
              <div>
                <span>Vez de: </span>
                <strong style={{ fontSize: '1.25rem', color: '#facc15' }}>
                  {currentPlayer?.name}
                  {currentPlayer?.isBot && ' 🤖'}
                  {isOnline && currentPlayer?.id === myPlayerId && ' (Sua vez!)'}
                </strong>
              </div>

              {canActTurn ? (
                <div className="action-buttons">
                  <button
                    className="btn btn-hit"
                    onClick={() =>
                      dispatchGameState(
                        playerHit(gameState, currentPlayer.id)
                      )
                    }
                  >
                    Pedir Carta (Hit)
                  </button>
                  <button
                    className="btn btn-stay"
                    onClick={() =>
                      dispatchGameState(
                        playerStay(gameState, currentPlayer.id)
                      )
                    }
                  >
                    Parar (Stay)
                  </button>
                </div>
              ) : (
                <span style={{ color: '#94a3b8' }}>
                  {currentPlayer?.isBot
                    ? `🤖 ${currentPlayer?.name} está calculando a jogada...`
                    : `Aguardando jogada de ${currentPlayer?.name}...`}
                </span>
              )}
            </>
          )}
        </div>
      )}

      {gameState.phase === 'round_over' && (
        <div className="action-bar">
          <div>
            <strong>Fim da Rodada {gameState.roundNumber}!</strong>
            <p>
              {activeCount < 2
                ? 'Menos de 2 jogadores permaneceram na sala.'
                : 'Confira as pontuações atualizadas abaixo.'}
            </p>
          </div>
          {activeCount >= 2 &&
            (!isOnline || roomData?.hostId === myPlayerId ? (
              <button
                className="btn btn-success"
                style={{ width: 'auto' }}
                onClick={() => dispatchGameState(startNextRound(gameState))}
              >
                Iniciar Rodada {gameState.roundNumber + 1}
              </button>
            ) : (
              <span style={{ color: '#94a3b8' }}>
                Aguardando o anfitrião iniciar a próxima rodada...
              </span>
            ))}
        </div>
      )}

      {gameState.phase === 'game_over' && (
        <div className="action-bar" style={{ borderColor: '#facc15' }}>
          <div>
            <strong style={{ fontSize: '1.3rem', color: '#facc15' }}>
              🏆 Partida Encerrada!
            </strong>
            <p>
              Vencedor:{' '}
              {gameState.players
                .filter((p) => gameState.winnerIds.includes(p.id))
                .map((p) => `${p.name} (${p.totalScore} pts)`)
                .join(', ')}
            </p>
          </div>
          {(!isOnline || roomData?.hostId === myPlayerId) && (
            <button
              className="btn btn-primary"
              onClick={async () => {
                if (isOnline) {
                  const nextParticipants = Object.values(
                    roomData?.lobbyPlayers || {}
                  )
                    .filter((p) => p.online !== false)
                    .sort((a, b) => a.joinedAt - b.joinedAt)
                    .slice(0, 18)
                    .map((p) => ({
                      id: p.id,
                      name: p.name,
                      isBot: Boolean(p.isBot),
                      botProfile: p.botProfile || null,
                    }));

                  const newGame = createInitialGameState(nextParticipants);
                  await promoteSpectatorsAndStart(
                    roomCode,
                    roomData.lobbyPlayers,
                    newGame
                  );
                } else {
                  dispatchGameState(
                    createInitialGameState(
                      gameState.players
                        .filter((p) => p.status !== 'disconnected')
                        .map((p) => ({
                          id: p.id,
                          name: p.name,
                          isBot: p.isBot,
                          botProfile: p.botProfile,
                        }))
                    )
                  );
                }
              }}
            >
              Jogar Novamente
            </button>
          )}
        </div>
      )}

      <div className="players-grid">
        {gameState.players.map((player, index) => (
          <PlayerBoard
            key={player.id}
            player={player}
            isCurrentTurn={
              gameState.phase === 'playing' &&
              !pending &&
              index === gameState.currentTurnIndex
            }
            isDealer={index === gameState.dealerIndex}
            isSelectableTarget={isTargetSelectable(player)}
            onSelectTarget={(targetId) =>
              dispatchGameState(resolvePendingAction(gameState, targetId))
            }
          />
        ))}
      </div>

      <div className="game-logs">
        <h3>Histórico da Partida</h3>
        <ul className="logs-list">
          {[...gameState.logs].reverse().map((log, idx) => (
            <li key={idx}>{log}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default App;
