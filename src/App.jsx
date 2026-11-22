import { useState } from 'react';
import './App.css';
import {
  createInitialGameState,
  playerHit,
  playerStay,
  resolvePendingAction,
  startNextRound,
} from './game/engine.js';
import { PlayerBoard } from './components/PlayerBoard.jsx';

export function App() {
  // Estado da tela de configuração antes de iniciar a partida
  const [setupPlayers, setSetupPlayers] = useState([
    { id: 'p-1', name: 'Giovani' },
    { id: 'p-2', name: 'Rubens' },
    { id: 'p-3', name: 'Gustavo' },
  ]);
  const [newPlayerName, setNewPlayerName] = useState('');

  // Estado completo da partida (null enquanto estiver no lobby)
  const [gameState, setGameState] = useState(null);

  const handleAddPlayer = (e) => {
    e.preventDefault();
    const trimmed = newPlayerName.trim();
    if (!trimmed || setupPlayers.length >= 18) return;

    setSetupPlayers([
      ...setupPlayers,
      { id: `p-${Date.now()}`, name: trimmed },
    ]);
    setNewPlayerName('');
  };

  const handleRemovePlayer = (id) => {
    if (setupPlayers.length <= 2) return;
    setSetupPlayers(setupPlayers.filter((p) => p.id !== id));
  };

  const handleStartGame = () => {
    if (setupPlayers.length < 2 || setupPlayers.length > 18) return;
    setGameState(createInitialGameState(setupPlayers));
  };

  // Tela inicial (Configuração de 2 a 18 jogadores)
  if (!gameState) {
    return (
      <div className="app-container">
        <div className="setup-screen">
          <h1>FLIP 7</h1>
          <p className="subtitle">Modo Teste Local (2 a 18 jogadores)</p>

          <form onSubmit={handleAddPlayer} className="add-player-form">
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
                    onClick={() => handleRemovePlayer(p.id)}
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
            onClick={handleStartGame}
          >
            Iniciar Partida ({setupPlayers.length} jogadores)
          </button>
        </div>
      </div>
    );
  }

  // Dados da partida em andamento
  const currentPlayer = gameState.players[gameState.currentTurnIndex];
  const pending = gameState.pendingAction;

  // Define quais jogadores podem ser clicados como alvo de uma ação pendente
  const isTargetSelectable = (player) => {
    if (!pending || player.status !== 'active') return false;
    if (pending.type === 'give_second_chance') {
      return player.id !== pending.sourcePlayerId && !player.hasSecondChance;
    }
    return true; // Freeze ou Flip Three pode mirar qualquer jogador ativo (inclusive si mesmo)
  };

  const actionNames = {
    freeze: 'Freeze (Congelar)',
    flip_three: 'Flip Three (Comprar 3)',
    give_second_chance: 'Doar Second Chance',
  };

  return (
    <div className="app-container">
      {/* Cabeçalho */}
      <header className="game-header">
        <div>
          <h2>FLIP 7 — Rodada {gameState.roundNumber}</h2>
        </div>
        <div className="deck-info">
          <span>Baralho: {gameState.drawPile.length} cartas</span>
          <span>Descarte: {gameState.discardPile.length} cartas</span>
          <button
            className="btn btn-primary"
            style={{ padding: '0.35rem 0.8rem', fontSize: '0.85rem' }}
            onClick={() => setGameState(null)}
          >
            Sair para Lobby
          </button>
        </div>
      </header>

      {/* Barra de Controle do Turno / Alertas */}
      {gameState.phase === 'playing' && (
        <div className={`action-bar ${pending ? 'pending-alert' : ''}`}>
          {pending ? (
            <div>
              <strong>⚠️ Ação Pendente: {actionNames[pending.type]}</strong>
              <p>Clique no tabuleiro de um jogador ativo destacado para aplicar o efeito.</p>
            </div>
          ) : (
            <>
              <div>
                <span>Vez de: </span>
                <strong style={{ fontSize: '1.25rem', color: '#38bdf8' }}>
                  {currentPlayer?.name}
                </strong>
              </div>
              <div className="action-buttons">
                <button
                  className="btn btn-hit"
                  onClick={() =>
                    setGameState(playerHit(gameState, currentPlayer.id))
                  }
                >
                  Pedir Carta (Hit)
                </button>
                <button
                  className="btn btn-stay"
                  onClick={() =>
                    setGameState(playerStay(gameState, currentPlayer.id))
                  }
                >
                  Parar (Stay)
                </button>
              </div>
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
          <button
            className="btn btn-success"
            style={{ width: 'auto' }}
            onClick={() => setGameState(startNextRound(gameState))}
          >
            Iniciar Rodada {gameState.roundNumber + 1}
          </button>
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
          <button
            className="btn btn-primary"
            onClick={() => setGameState(createInitialGameState(setupPlayers))}
          >
            Jogar Novamente
          </button>
        </div>
      )}

      {/* Mesa com os Jogadores */}
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
              setGameState(resolvePendingAction(gameState, targetId))
            }
          />
        ))}
      </div>

      {/* Histórico de Jogadas */}
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