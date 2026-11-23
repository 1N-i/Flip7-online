export function Card({ card }) {
  const getCardStyleClass = () => {
    if (card.type === 'modifier') return 'card-modifier';
    if (card.type === 'action') return `card-action action-${card.value}`;
    return `card-number num-${card.value}`;
  };

  // Mapeia ícones visuais limpos para cartas de ação sem poluir o espaço da carta
  const getDisplaySymbol = () => {
    if (card.type === 'action') {
      if (card.value === 'second_chance') return { corner: '🛡️', center: '🛡️' };
      if (card.value === 'freeze') return { corner: '❄️', center: '❄️' };
      if (card.value === 'flip_three') return { corner: '+3', center: '⚡3' };
    }
    return { corner: card.label, center: card.label };
  };

  const { corner, center } = getDisplaySymbol();

  return (
    <div
      className={`flip-card ${getCardStyleClass()}`}
      title={card.label}
    >
      <span className="card-corner top-left">{corner}</span>
      <span className="card-center">{center}</span>
      <span className="card-corner bottom-right">{corner}</span>
    </div>
  );
}