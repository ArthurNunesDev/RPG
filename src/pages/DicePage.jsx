import { useState } from "react";
import { Dice1, Dice5, Dices, RotateCcw, Sparkles } from "lucide-react";

const diceOptions = [4, 6, 8, 10, 12, 20, 100];

function rollDie(sides) {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Seu navegador não oferece um gerador seguro de números aleatórios.");
  }

  const range = 0x1_0000_0000;
  const limit = range - (range % sides);
  const values = new Uint32Array(1);
  let value;

  do {
    globalThis.crypto.getRandomValues(values);
    value = values[0];
  } while (value >= limit);

  return (value % sides) + 1;
}

export default function DicePage() {
  const [sides, setSides] = useState(20);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState("");

  function handleRoll() {
    try {
      const value = rollDie(sides);
      const entry = {
        id: globalThis.crypto.randomUUID(),
        sides,
        value,
        createdAt: new Date().toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      };

      setResult(entry);
      setHistory((current) => [entry, ...current].slice(0, 8));
      setError("");
    } catch (rollError) {
      setError(rollError instanceof Error ? rollError.message : "Não foi possível rolar o dado.");
    }
  }

  function clearHistory() {
    setHistory([]);
    setResult(null);
    setError("");
  }

  return (
    <section className="module-page dice-page">
      <p className="eyebrow"><Sparkles size={14} /> A SORTE ESTÁ LANÇADA</p>
      <h1>Rolagem de dados</h1>
      <p className="page-lead">Escolha seu dado, respire fundo e deixe o destino decidir.</p>

      <div className="dice-layout">
        <div className="dice-stage panel">
          <div className="dice-stage-top">
            <span className="stage-label">MESA DE ROLAGEM</span>
            <Dices size={19} />
          </div>
          <div className="dice-display" aria-live="polite" aria-atomic="true">
            <div className={`dice-shape ${result ? "dice-shape--rolled" : ""}`}>
              <Dice5 size={48} strokeWidth={1.15} />
              <span>{result ? result.value : "?"}</span>
            </div>
            <p>{result ? `Resultado do d${result.sides}` : "Aguardando sua rolagem"}</p>
          </div>
          <div className="dice-options" role="group" aria-label="Selecionar tipo de dado">
            {diceOptions.map((option) => (
              <button
                className={`dice-option ${sides === option ? "dice-option--active" : ""}`}
                type="button"
                key={option}
                onClick={() => setSides(option)}
                aria-pressed={sides === option}
              >
                d{option}
              </button>
            ))}
          </div>
          <button className="button button-primary dice-roll-button" type="button" onClick={handleRoll}>
            <Dice1 size={19} /> Rolar d{sides}
          </button>
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>

        <aside className="panel dice-history">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">SUAS ÚLTIMAS JOGADAS</p>
              <h2>Histórico</h2>
            </div>
            <button
              className="icon-button"
              type="button"
              onClick={clearHistory}
              disabled={history.length === 0}
              aria-label="Limpar histórico"
              title="Limpar histórico"
            >
              <RotateCcw size={16} />
            </button>
          </div>
          {history.length > 0 ? (
            <ul className="roll-history">
              {history.map((entry) => (
                <li key={entry.id}>
                  <span className="history-die">d{entry.sides}</span>
                  <span className="history-time">{entry.createdAt}</span>
                  <strong>{entry.value}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <div className="history-empty">
              <Dices size={24} />
              <p>Suas rolagens aparecerão aqui.</p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
