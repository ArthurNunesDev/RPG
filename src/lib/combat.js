const MAX_DICE = 100;
const MAX_SIDES = 1000;

export function parseDiceFormula(formula) {
  if (typeof formula !== "string") throw new TypeError("A fórmula de dados deve ser texto.");
  const match = formula.trim().toLowerCase().match(/^(\d{1,3})d(\d{1,4})(?:\s*([+-])\s*(\d{1,5}))?$/);
  if (!match) throw new Error("Fórmula inválida. Use, por exemplo, 2d10 ou 1d6+2.");
  const count = Number(match[1]);
  const sides = Number(match[2]);
  const modifier = match[4] ? Number(match[4]) * (match[3] === "-" ? -1 : 1) : 0;
  if (count < 1 || count > MAX_DICE || sides < 2 || sides > MAX_SIDES) {
    throw new RangeError("A fórmula excede os limites permitidos.");
  }
  return { count, sides, modifier };
}

export function rollDice(formula, random = Math.random) {
  const parsed = parseDiceFormula(formula);
  const rolls = Array.from({ length: parsed.count }, () => Math.floor(random() * parsed.sides) + 1);
  const total = rolls.reduce((sum, value) => sum + value, 0) + parsed.modifier;
  return {
    formula: formula.trim(),
    rolls,
    modifier: parsed.modifier,
    total,
    minimum: rolls.every((value) => value === 1),
    maximum: rolls.every((value) => value === parsed.sides),
    naturalMinimum: Math.min(...rolls),
    naturalMaximum: Math.max(...rolls),
  };
}

export function getOrderInitiative(character, random = Math.random) {
  const sheet = character?.sheet ?? {};
  const agility = Number(sheet.attributes?.AGI ?? 0);
  const skill = sheet.skills?.Iniciativa ?? {};
  const training = Number(skill.training ?? 0);
  const bonus = Number(skill.bonus ?? 0) + Number(skill.other ?? 0);
  const roll = rollDice("1d20", random);
  return { ...roll, total: roll.total + agility + training + bonus, agility, training, bonus };
}

export function getOrderVitals(character) {
  const sheet = character?.sheet ?? {};
  const vitals = sheet.vitals ?? {};
  const current = Number(vitals.hp ?? vitals.pv ?? 0);
  const maximum = Number(vitals.hpMax ?? vitals.pvMax ?? current);
  return {
    hp: Number.isFinite(current) ? Math.max(0, current) : 0,
    hpMax: Number.isFinite(maximum) ? Math.max(0, maximum) : 0,
    pe: Math.max(0, Number(vitals.pe ?? vitals.pm ?? 0) || 0),
    peMax: Math.max(0, Number(vitals.peMax ?? vitals.pmMax ?? 0) || 0),
    pd: Math.max(0, Number(vitals.pd ?? vitals.pdMax ?? 0) || 0),
    pdMax: Math.max(0, Number(vitals.pdMax ?? 0) || 0),
  };
}

export function resolveOrderAttack({ attackRoll, defense, damageFormula, additionalCriticalDamage = "", random = Math.random }) {
  if (!attackRoll || !Array.isArray(attackRoll.rolls)) throw new TypeError("Rolagem de ataque inválida.");
  const targetDefense = Number(defense);
  if (!Number.isFinite(targetDefense) || targetDefense < 0) throw new RangeError("Defesa do alvo inválida.");
  if (attackRoll.rolls.some((value) => value === 1) && attackRoll.rolls.length === 1) {
    return { outcome: "disaster", attackRoll, defense: targetDefense, damage: null, message: "Desastre! O dado mostrou 1. O mestre decide a consequência." };
  }
  if (attackRoll.total < targetDefense) {
    return { outcome: "miss", attackRoll, defense: targetDefense, damage: null, message: "O ataque não atingiu o alvo." };
  }
  const damage = rollDice(damageFormula, random);
  const critical = damage.maximum;
  const additional = critical && additionalCriticalDamage.trim()
    ? rollDice(additionalCriticalDamage, random)
    : null;
  return {
    outcome: critical ? "critical" : "hit",
    attackRoll,
    defense: targetDefense,
    damage,
    additionalCriticalDamage: additional,
    totalDamage: damage.total + (additional?.total ?? 0),
    message: critical ? "Acerto crítico! Dano máximo no dado." : "Ataque acertou.",
  };
}
