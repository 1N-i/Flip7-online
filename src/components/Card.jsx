export function Card({ card }) {
  // Define uma classe CSS baseada no tipo da carta para dar cores diferentes
  const getCardStyleClass = () => {
    if (card.type === 'modifier') return 'card-modifier';
    if (card.type === 'action') return 'card-action';
    return `card-number num-${card.value}`;
  };

  return (
    <div className={`flip-card ${getCardStyleClass()}`}>
      <span className="card-corner top-left">{card.label}</span>
      <span className="card-center">{card.label}</span>
      <span className="card-corner bottom-right">{card.label}</span>
    </div>
  );
}