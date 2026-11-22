import { Card } from './Card.jsx';
import { calculateRoundScore, getNumberCards } from '../game/scoring.js';

export function PlayerBoard({
  player,
  isCurrentTurn,
  isDealer,
  isSelectableTarget,
  onSelectTarget,
}) {
    const roundScore = calculateRoundScore(
    player.hand,
    player.status === 'busted'
  );
  const numberCount = getNumberCards(player.hand).length;

  const statusLabels = {
    active: 'Em jogo',
    stayed: 'Parou (Salvo)',
    frozen: 'Congelado (Salvo)',
    busted: 'Estourou (0 pts)',
  };

  return (
    <div
      className={`player-board status-${player.status} ${
        isCurrentTurn ? 'current-turn' : ''
      } ${isSelectableTarget ? 'selectable-target' : ''}`}
      onClick={() => isSelectableTarget && onSelectTarget(player.id)}
    >
      <div className="player-header">
        <div className="player-title">
          <strong>{player.name}</strong>
          {isDealer && <span className="badge badge-dealer">Dealer</span>}
          {isCurrentTurn && <span className="badge badge-turn">Vez</span>}
          {player.hasSecondChance && (
            <span className="badge badge-shield" title="Second Chance ativa">
              🛡️ 2nd Chance
            </span>
          )}
        </div>

        <div className="player-scores">
          <span className="round-pts">Rodada: +{roundScore}</span>
          <span className="total-pts">Total: {player.totalScore} / 200</span>
        </div>
      </div>

      <div className="player-meta">
        <span className={`status-tag tag-${player.status}`}>
          {statusLabels[player.status]}
        </span>
        <span className="cards-counter">
          Números únicos: {numberCount} / 7
        </span>
      </div>

      <div className="player-hand">
        {player.hand.length === 0 ? (
          <span className="empty-hand">Sem cartas na mesa</span>
        ) : (
          player.hand.map((card) => <Card key={card.id} card={card} />)
        )}
      </div>

      {isSelectableTarget && (
        <div className="target-overlay">Clique para escolher este alvo</div>
      )}
    </div>
  );
}