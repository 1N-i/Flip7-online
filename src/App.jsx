import { useState, useEffect } from 'react';
import './App.css';
import {
  createInitialGameState,
  playerHit,
  playerStay,
  resolvePendingAction,
  startNextRound,
} from './game/engine.js';
import {
  isOnlineAvailable,
  createOnlineRoom,
  joinOnlineRoom,
  subscribeToRoom,
  startOnlineMatch,
  syncGameState,
  normalizeFirebaseGameState,
} from './game/onlineService.js';
import { PlayerBoard } from './components/PlayerBoard.jsx';

export function App() {
  // Navegação: 'home' | 'local_setup' | 'online_lobby' | 'playing'
  const [screen, setScreen] = useState('home');

  // Estados do Modo Local
  const [setupPlayers, setSetupPlayers] = useState([
    { id: 'p-1', name: 'Giovani' },
    { id: 'p-2', name: 'Rubens' },
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

  // Escuta alterações na sala online quando conectado
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
      setScreen('online_lobby');
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleStartOnlineGame = async () => {
    if (!roomData?.lobbyPlayers) return;
    const list = Object.values(roomData.lobbyPlayers).sort(
      (a, b) => a.joinedAt - b.joinedAt
    );
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
      { id: `p-${Date.now()}`, name: trimmed },
    ]);
    setNewPlayerName('');
  };

  const handleStartLocalGame = () => {
    setLocalGameState(createInitialGameState(setupPlayers));
    setRoomCode('');
    setScreen('playing');
  };

  // --- TELA INICIAL (ESCOLHA ONLINE OU LOCAL) ---
  if (screen === 'home') {
    const onlineReady = isOnlineAvailable();
    return (
      <div className="app-container">
        <div className="setup-screen">
          <h1>FLIP 7</h1>
          <p className="subtitle">Multiplayer Online (2 a 18 jogadores)</p>

          {errorMsg && (
            <p style={{ color: '#f87171', marginBottom: '1rem' }}>{errorMsg}</p>
          )}

          {!onlineReady && (
            <p style={{ color: '#fbbf24', fontSize: '0.85rem', marginBottom: '1rem' }}>
              ⚠️ Configure o arquivo .env.local com as chaves do Firebase para ativar o modo online.
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
            Jogar Localmente (Mesmo Dispositivo)
          </button>
        </div>
      </div>
    );
  }

  // --- LOBBY DA SALA ONLINE ---
  if (screen === 'online_lobby' && roomData) {
    const lobbyList = Object.values(roomData.lobbyPlayers || {}).sort(
      (a, b) => a.joinedAt - b.joinedAt
    );
    const isHost = roomData.hostId === myPlayerId;

    return (
      <div className="app-container">
        <div className="setup-screen">
          <p className="subtitle">Código da Sala</p>
          <h1 style={{ letterSpacing: '6px', fontSize: '3rem' }}>
            {roomCode}
          </h1>
          <p className="subtitle">
            Compartilhe este código com os jogadores ({lobbyList.length}/18)
          </p>

          <ul className="player-list-setup">
            {lobbyList.map((p, idx) => (
              <li key={p.id}>
                <span>
                  {idx + 1}. {p.name}{' '}
                  {p.id === roomData.hostId && '👑 (Anfitrião)'}
                  {p.id === myPlayerId && ' (Você)'}
                </span>
              </li>
            ))}
          </ul>

          {isHost ? (
            <button
              className="btn btn-success"
              disabled={lobbyList.length < 2}
              onClick={handleStartOnlineGame}
            >
              {lobbyList.length < 2
                ? 'Aguardando pelo menos 2 jogadores...'
                : `Iniciar Partida (${lobbyList.length} jogadores)`}
            </button>
          ) : (
            <p style={{ color: '#38bdf8', fontWeight: 600 }}>
              Aguardando o anfitrião iniciar a partida...
            </p>
          )}
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
          <p className="subtitle">Modo Local (2 a 18 jogadores)</p>

          <form onSubmit={handleAddLocalPlayer} className="add-player-form">
            <input
              type="text"
              placeholder="Nome do jogador..."
              value={newPlayerName}
              onChange={(e) => setNewPlayerName(e.target.value)}
              maxLength={20}
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!newPlayerName.trim() || setupPlayers.length >= 18}
            >
              Adicionar
            </button>
          </form>

          <ul className="player-list-setup">
            {setupPlayers.map((p, idx) => (
              <li key={p.id}>
                <span>
                  {idx + 1}. {p.name}
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

  // --- PARTIDA EM ANDAMENTO (ONLINE OU LOCAL) ---
  const isOnline = Boolean(roomCode);
  const gameState = isOnline
    ? normalizeFirebaseGameState(roomData?.gameState)
    : localGameState;

  if (!gameState) return null;

  // Função única para atualizar estado (localmente ou enviando ao Firebase)
  const dispatchGameState = async (nextState) => {
    if (isOnline) {
      await syncGameState(roomCode, nextState);
    } else {
      setLocalGameState(nextState);
    }
  };

  const currentPlayer = gameState.players[gameState.currentTurnIndex];
  const pending = gameState.pendingAction;

  // No modo online, só permite agir se o turno/ação pertencer a este navegador
  const canActTurn = !isOnline || currentPlayer?.id === myPlayerId;
  const canResolvePending =
    !isOnline || pending?.sourcePlayerId === myPlayerId;

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
          <span>Baralho: {gameState.drawPile.length} cartas</span>
          <span>Descarte: {gameState.discardPile.length} cartas</span>
          <button
            className="btn btn-primary"
            style={{ padding: '0.35rem 0.8rem', fontSize: '0.85rem' }}
            onClick={() => {
              setRoomCode('');
              setRoomData(null);
              setLocalGameState(null);
              setScreen('home');
            }}
          >
            Sair
          </button>
        </div>
      </header>

      {gameState.phase === 'playing' && (
        <div className={`action-bar ${pending ? 'pending-alert' : ''}`}>
          {pending ? (
            <div>
              <strong>⚠️ Ação Pendente: {actionNames[pending.type]}</strong>
              <p>
                {canResolvePending
                  ? 'Clique no tabuleiro de um jogador ativo destacado para aplicar o efeito.'
                  : 'Aguardando o jogador escolher um alvo...'}
              </p>
            </div>
          ) : (
            <>
              <div>
                <span>Vez de: </span>
                <strong style={{ fontSize: '1.25rem', color: '#38bdf8' }}>
                  {currentPlayer?.name}
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
                  Aguardando jogada de {currentPlayer?.name}...
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
            <p>Confira as pontuações atualizadas abaixo.</p>
          </div>
          {(!isOnline || roomData?.hostId === myPlayerId) ? (
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
          )}
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
              onClick={() =>
                dispatchGameState(
                  createInitialGameState(
                    gameState.players.map((p) => ({
                      id: p.id,
                      name: p.name,
                      isBot: p.isBot,
                    }))
                  )
                )
              }
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