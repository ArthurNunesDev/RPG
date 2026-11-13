import { useMemo } from "react";

const OP_ATTRIBUTES = ["Agilidade", "Força", "Intelecto", "Presença", "Vigor"];
const OP_SKILLS = [
  ["Acrobacia", "AGI"], ["Adestramento", "PRE"], ["Artes", "PRE"], ["Atletismo", "FOR"],
  ["Atualidades", "INT"], ["Ciências", "INT"], ["Crime", "AGI"], ["Diplomacia", "PRE"],
  ["Enganação", "PRE"], ["Fortitude", "VIG"], ["Furtividade", "AGI"], ["Iniciativa", "AGI"],
  ["Intimidação", "PRE"], ["Intuição", "PRE"], ["Investigação", "INT"], ["Luta", "FOR"],
  ["Medicina", "INT"], ["Ocultismo", "INT"], ["Percepção", "PRE"], ["Pilotagem", "AGI"],
  ["Pontaria", "AGI"], ["Profissão", "INT"], ["Reflexos", "AGI"], ["Religião", "PRE"],
  ["Sobrevivência", "INT"], ["Tática", "INT"], ["Tecnologia", "INT"], ["Vontade", "PRE"],
];

export function createCharacterSheet(systemName = "") {
  const system = systemName.toLocaleLowerCase("pt-BR");
  if (system.includes("ordem")) {
    return {
      template: "ordem-paranormal",
      agent: { player: "", age: "", origin: "", class: "", track: "", nex: "5", rank: "Recruta", affinity: "", appearance: "", history: "" },
      attributes: { AGI: 1, FOR: 1, INT: 1, PRE: 1, VIG: 1 },
      skills: Object.fromEntries(OP_SKILLS.map(([name]) => [name, { training: 0, bonus: 0, other: 0 }])),
      vitals: { hp: 0, hpMax: 0, pe: 0, peMax: 0, pd: 0, pdMax: 0, pePerRound: 1, san: 0, sanMax: 0, defense: 10, displacement: "9m", protection: "", resistances: "" },
      progression: { prestige: 0, credit: "", maxItems: "", loadLimit: "", ritualDT: 0 },
      attacks: [],
      abilities: [],
      rituals: "",
      inventory: "",
      notes: "",
    };
  }
  if (system.includes("dungeons") || system.includes("dragons")) {
    return {
      template: "dnd5e",
      identity: { player: "", race: "", class: "", subclass: "", level: 1, background: "", alignment: "", experience: 0 },
      attributes: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
      proficiencies: { proficiencyBonus: 2, savingThrows: "", skills: "" },
      vitals: { hp: 0, hpMax: 0, temporaryHp: 0, armorClass: 10, initiative: 0, speed: "9m", hitDice: "1d8", deathSaves: "" },
      attacks: "",
      features: "",
      spells: "",
      equipment: "",
      personality: { traits: "", ideals: "", bonds: "", flaws: "", appearance: "", backstory: "" },
      notes: "",
    };
  }
  return {
    template: "tormenta20",
    identity: { player: "", race: "", origin: "", class: "", level: 1, deity: "", size: "Médio", destiny: "" },
    attributes: { FOR: 0, DES: 0, CON: 0, INT: 0, SAB: 0, CAR: 0 },
    proficiencies: { skills: "", defenses: "", resistances: "" },
    vitals: { pv: 0, pvMax: 0, pm: 0, pmMax: 0, defense: 10, displacement: "9m" },
    attacks: "",
    powers: "",
    spells: "",
    equipment: "",
    history: "",
    notes: "",
  };
}

function Field({ label, value, onChange, type = "text", placeholder = "", min, max, step, disabled = false }) {
  return <label className="sheet-field"><span>{label}</span><input type={type} value={value ?? ""} placeholder={placeholder} min={min} max={max} step={step ?? (type === "number" ? 1 : undefined)} disabled={disabled} onChange={(event) => {
    const rawValue = event.target.value;
    onChange(type === "number" ? (rawValue === "" ? "" : Number(rawValue)) : rawValue);
  }} /></label>;
}

function TextField({ label, value, onChange, rows = 3, placeholder = "", disabled = false }) {
  return <label className="sheet-field sheet-field-wide"><span>{label}</span><textarea rows={rows} value={value ?? ""} placeholder={placeholder} disabled={disabled} onChange={(event) => onChange(event.target.value)} /></label>;
}

function normalizeCombatActions(value, kind) {
  if (Array.isArray(value)) return value.map((item, index) => typeof item === "string"
    ? { id: `${kind}-${index}`, name: item, description: "", testFormula: "1d20", damageFormula: kind === "attack" ? "2d10" : "", criticalExtraFormula: "", peCost: 0, actionCost: "padrão", range: "" }
    : { id: item.id || `${kind}-${index}`, name: item.name || "", description: item.description || "", testFormula: item.testFormula || "1d20", damageFormula: item.damageFormula || "", criticalExtraFormula: item.criticalExtraFormula || "", healingFormula: item.healingFormula || "", effectType: item.effectType || (kind === "attack" ? "damage" : "utility"), statusEffect: item.statusEffect || "", peCost: Number(item.peCost) || 0, actionCost: item.actionCost || "padrão", range: item.range || "", skill: item.skill || "Luta" })
    .filter((item) => item.name || item.description);
  if (typeof value === "string" && value.trim()) return value.split("\n").filter(Boolean).map((name, index) => ({
    id: `${kind}-legacy-${index}`, name, description: "", testFormula: "1d20", damageFormula: kind === "attack" ? "2d10" : "", criticalExtraFormula: "", healingFormula: "", effectType: kind === "attack" ? "damage" : "utility", statusEffect: "", peCost: 0, actionCost: "padrão", range: "", skill: "Luta",
  }));
  return [];
}

function CombatActionEditor({ title, actions, kind, onChange }) {
  const update = (index, key, value) => onChange(actions.map((item, i) => i === index ? { ...item, [key]: value } : item));
  const add = () => onChange([...actions, {
    id: `${kind}-${Date.now()}`, name: "", description: "", testFormula: "1d20",
    damageFormula: kind === "attack" ? "2d10" : "", criticalExtraFormula: "", healingFormula: "", effectType: kind === "attack" ? "damage" : "utility", statusEffect: "", peCost: 0,
    actionCost: "padrão", range: "", skill: "Luta",
  }]);
  return <Section title={title} variant="combat-actions">
    {actions.map((action, index) => <div className="sheet-combat-action" key={action.id || index}>
      <div className="sheet-combat-action-heading"><strong>{action.name || `${kind === "attack" ? "Novo ataque" : "Nova habilidade"} ${index + 1}`}</strong><button type="button" className="button button-secondary" onClick={() => onChange(actions.filter((_, i) => i !== index))}>Remover</button></div>
      <div className="character-sheet-grid">
        <Field label="Nome" value={action.name} onChange={(v) => update(index, "name", v)} />
        <Field label="Perícia / teste" value={action.skill} onChange={(v) => update(index, "skill", v)} placeholder="Luta, Pontaria, Ocultismo..." />
        <Field label="Rolagem para acertar" value={action.testFormula} onChange={(v) => update(index, "testFormula", v)} placeholder="1d20" />
        {kind === "attack" && <Field label="Dano" value={action.damageFormula} onChange={(v) => update(index, "damageFormula", v)} placeholder="2d10" />}
        {kind === "attack" && <Field label="Dano adicional no crítico" value={action.criticalExtraFormula} onChange={(v) => update(index, "criticalExtraFormula", v)} placeholder="1d4" />}
        {kind === "ability" && <Field label="Tipo de efeito (damage, healing, utility)" value={action.effectType} onChange={(v) => update(index, "effectType", v)} placeholder="utility" />}
        {kind === "ability" && <Field label="Fórmula de cura" value={action.healingFormula} onChange={(v) => update(index, "healingFormula", v)} placeholder="2d6" />}
        {kind === "ability" && <Field label="Condição / efeito aplicado" value={action.statusEffect} onChange={(v) => update(index, "statusEffect", v)} placeholder="Atordoado, vulnerável..." />}
        <Field label="Custo em PE" type="number" min={0} value={action.peCost} onChange={(v) => update(index, "peCost", v)} />
        <Field label="Custo de ação" value={action.actionCost} onChange={(v) => update(index, "actionCost", v)} placeholder="padrão, movimento, livre..." />
        <Field label="Alcance" value={action.range} onChange={(v) => update(index, "range", v)} />
        <TextField label="Descrição e efeitos" value={action.description} onChange={(v) => update(index, "description", v)} rows={2} />
      </div>
    </div>)}
    <button type="button" className="button button-secondary" onClick={add}>Adicionar {kind === "attack" ? "ataque" : "habilidade"}</button>
  </Section>;
}

function Section({ title, children, variant = "" }) {
  const className = variant ? `character-sheet-section character-sheet-section--${variant}` : "character-sheet-section";
  return <section className={className}><h3>{title}</h3><div className="character-sheet-grid">{children}</div></section>;
}

export default function CharacterSheetEditor({ systemName, value, onChange, disabled = false }) {
  const sheet = value && typeof value === "object" && !Array.isArray(value) && value.template
    ? value
    : createCharacterSheet(systemName);
  const template = useMemo(() => createCharacterSheet(systemName), [systemName]);
  const isOrder = template.template === "ordem-paranormal";
  const isDnd = template.template === "dnd5e";
  const update = (path, next) => {
    const keys = path.split(".");
    onChange((currentValue) => {
      const base = currentValue && typeof currentValue === "object" && !Array.isArray(currentValue) && currentValue.template
        ? currentValue
        : createCharacterSheet(systemName);
      const nextSheet = { ...base };
      let source = base;
      let target = nextSheet;
      for (const key of keys.slice(0, -1)) {
        const sourceChild = source[key];
        const nextChild = sourceChild && typeof sourceChild === "object" && !Array.isArray(sourceChild) ? { ...sourceChild } : {};
        target[key] = nextChild;
        source = sourceChild ?? {};
        target = nextChild;
      }
      target[keys[keys.length - 1]] = next;
      return nextSheet;
    });
  };
  const attrs = isOrder
    ? [["AGI", "Agilidade"], ["FOR", "Força"], ["INT", "Intelecto"], ["PRE", "Presença"], ["VIG", "Vigor"]]
    : isDnd
      ? [["STR", "Força"], ["DEX", "Destreza"], ["CON", "Constituição"], ["INT", "Inteligência"], ["WIS", "Sabedoria"], ["CHA", "Carisma"]]
      : [["FOR", "Força"], ["DES", "Destreza"], ["CON", "Constituição"], ["INT", "Inteligência"], ["SAB", "Sabedoria"], ["CAR", "Carisma"]];

  return <div className="character-sheet-editor" aria-disabled={disabled}>
    <div className="character-sheet-intro"><span className="eyebrow">MODELO DE FICHA</span><strong>{isOrder ? "Ordem Paranormal · Ficha de Agente" : isDnd ? "D&D 5ª edição · Ficha de Aventureiro" : "Tormenta20 · Ficha de Herói"}</strong><p>Preencha os dados do personagem. As informações serão salvas junto com a ficha.</p></div>
    {isOrder ? <>
      <Section title="Identificação do agente">
        <Field label="Jogador" value={sheet.agent?.player} onChange={(v) => update("agent.player", v)} />
        <Field label="Idade" value={sheet.agent?.age} onChange={(v) => update("agent.age", v)} />
        <Field label="Origem" value={sheet.agent?.origin} onChange={(v) => update("agent.origin", v)} />
        <Field label="Classe" value={sheet.agent?.class} onChange={(v) => update("agent.class", v)} />
        <Field label="Trilha" value={sheet.agent?.track} onChange={(v) => update("agent.track", v)} />
        <Field label="NEX (%)" type="number" min={5} max={99} value={sheet.agent?.nex} onChange={(v) => update("agent.nex", v)} />
        <Field label="Patente" value={sheet.agent?.rank} onChange={(v) => update("agent.rank", v)} />
        <Field label="Afinidade" value={sheet.agent?.affinity} onChange={(v) => update("agent.affinity", v)} />
        <TextField label="Aparência" value={sheet.agent?.appearance} onChange={(v) => update("agent.appearance", v)} />
        <TextField label="História do agente" value={sheet.agent?.history} onChange={(v) => update("agent.history", v)} />
      </Section>
    </> : isDnd ? <>
      <Section title="Identidade e progressão">
        <Field label="Jogador" value={sheet.identity?.player} onChange={(v) => update("identity.player", v)} />
        <Field label="Raça / espécie" value={sheet.identity?.race} onChange={(v) => update("identity.race", v)} />
        <Field label="Classe" value={sheet.identity?.class} onChange={(v) => update("identity.class", v)} />
        <Field label="Subclasse" value={sheet.identity?.subclass} onChange={(v) => update("identity.subclass", v)} />
        <Field label="Nível" type="number" min={1} max={20} value={sheet.identity?.level} onChange={(v) => update("identity.level", v)} />
        <Field label="Antecedente" value={sheet.identity?.background} onChange={(v) => update("identity.background", v)} />
        <Field label="Tendência" value={sheet.identity?.alignment} onChange={(v) => update("identity.alignment", v)} />
        <Field label="Experiência (XP)" type="number" min={0} value={sheet.identity?.experience} onChange={(v) => update("identity.experience", v)} />
      </Section>
    </> : <>
      <Section title="Identidade e progressão">
        <Field label="Jogador" value={sheet.identity?.player} onChange={(v) => update("identity.player", v)} />
        <Field label="Raça" value={sheet.identity?.race} onChange={(v) => update("identity.race", v)} />
        <Field label="Origem" value={sheet.identity?.origin} onChange={(v) => update("identity.origin", v)} />
        <Field label="Classe" value={sheet.identity?.class} onChange={(v) => update("identity.class", v)} />
        <Field label="Nível" type="number" min={1} value={sheet.identity?.level} onChange={(v) => update("identity.level", v)} />
        <Field label="Divindade" value={sheet.identity?.deity} onChange={(v) => update("identity.deity", v)} />
        <Field label="Tamanho" value={sheet.identity?.size} onChange={(v) => update("identity.size", v)} />
        <Field label="Destino" value={sheet.identity?.destiny} onChange={(v) => update("identity.destiny", v)} />
      </Section>
    </>}
    <Section title="Atributos" variant="attributes">
      {attrs.map(([key, label]) => <Field key={key} label={label} type="number" min={0} max={isOrder ? 5 : 30} value={sheet.attributes?.[key]} onChange={(v) => update("attributes." + key, v)} />)}
    </Section>
    {isOrder && <Section title="Perícias do agente" variant="skills">
      {OP_SKILLS.map(([name, attr]) => <div className="character-skill-row" key={name}>
        <div><strong>{name}</strong><small>{attr}</small></div>
        <label><span>Treino</span><select value={sheet.skills?.[name]?.training ?? 0} onChange={(event) => update("skills." + name + ".training", Number(event.target.value))}><option value={0}>Destreinado</option><option value={5}>Treinado (+5)</option><option value={10}>Veterano (+10)</option><option value={15}>Expert (+15)</option></select></label>
        <label><span>Outros bônus</span><input type="number" value={sheet.skills?.[name]?.other ?? 0} onChange={(event) => update("skills." + name + ".other", Number(event.target.value))} /></label>
      </div>)}
    </Section>}
    {isOrder ? <Section title="Pontos e defesas" variant="vitals">
      <Field label="PV atuais" type="number" min={0} value={sheet.vitals?.hp} onChange={(v) => update("vitals.hp", v)} />
      <Field label="PV máximos" type="number" min={0} value={sheet.vitals?.hpMax} onChange={(v) => update("vitals.hpMax", v)} />
      <Field label="PE atuais" type="number" min={0} value={sheet.vitals?.pe} onChange={(v) => update("vitals.pe", v)} />
      <Field label="PE máximos" type="number" min={0} value={sheet.vitals?.peMax} onChange={(v) => update("vitals.peMax", v)} />
      <Field label="PE por rodada" type="number" min={0} value={sheet.vitals?.pePerRound} onChange={(v) => update("vitals.pePerRound", v)} />
      <Field label="PD atuais" type="number" min={0} value={sheet.vitals?.pd} onChange={(v) => update("vitals.pd", v)} />
      <Field label="PD máximos" type="number" min={0} value={sheet.vitals?.pdMax} onChange={(v) => update("vitals.pdMax", v)} />
      <Field label="Sanidade atual" type="number" min={0} value={sheet.vitals?.san} onChange={(v) => update("vitals.san", v)} />
      <Field label="Sanidade máxima" type="number" min={0} value={sheet.vitals?.sanMax} onChange={(v) => update("vitals.sanMax", v)} />
      <Field label="Defesa" type="number" min={0} value={sheet.vitals?.defense} onChange={(v) => update("vitals.defense", v)} />
      <Field label="DT de rituais" type="number" min={0} value={sheet.progression?.ritualDT} onChange={(v) => update("progression.ritualDT", v)} />
      <Field label="Deslocamento" value={sheet.vitals?.displacement} onChange={(v) => update("vitals.displacement", v)} />
      <TextField label="Proteção" value={sheet.vitals?.protection} onChange={(v) => update("vitals.protection", v)} />
      <TextField label="Resistências" value={sheet.vitals?.resistances} onChange={(v) => update("vitals.resistances", v)} />
    </Section> : isDnd ? <>
      <Section title="Testes, perícias e proficiências">
        <Field label="Bônus de proficiência" type="number" value={sheet.proficiencies?.proficiencyBonus} onChange={(v) => update("proficiencies.proficiencyBonus", v)} />
        <TextField label="Testes de resistência proficientes" value={sheet.proficiencies?.savingThrows} onChange={(v) => update("proficiencies.savingThrows", v)} />
        <TextField label="Perícias e proficiências" value={sheet.proficiencies?.skills} onChange={(v) => update("proficiencies.skills", v)} />
      </Section>
      <Section title="Pontos vitais e combate">
        {[[ "hp", "PV atuais" ],[ "hpMax", "PV máximos" ],[ "temporaryHp", "PV temporários" ],[ "armorClass", "Classe de Armadura" ],[ "initiative", "Iniciativa" ]].map(([key,label]) => <Field key={key} label={label} type="number" value={sheet.vitals?.[key]} onChange={(v) => update("vitals." + key, v)} />)}
        <Field label="Deslocamento" value={sheet.vitals?.speed} onChange={(v) => update("vitals.speed", v)} />
        <Field label="Dados de vida" value={sheet.vitals?.hitDice} onChange={(v) => update("vitals.hitDice", v)} />
        <Field label="Salvaguardas contra a morte" value={sheet.vitals?.deathSaves} onChange={(v) => update("vitals.deathSaves", v)} />
      </Section>
    </> : <>
      <Section title="Perícias e resistências">
        <TextField label="Perícias e bônus" value={sheet.proficiencies?.skills} onChange={(v) => update("proficiencies.skills", v)} />
        <TextField label="Defesas" value={sheet.proficiencies?.defenses} onChange={(v) => update("proficiencies.defenses", v)} />
        <TextField label="Resistências" value={sheet.proficiencies?.resistances} onChange={(v) => update("proficiencies.resistances", v)} />
      </Section>
      <Section title="Pontos vitais e combate">
        <Field label="PV atuais" type="number" min={0} value={sheet.vitals?.pv} onChange={(v) => update("vitals.pv", v)} />
        <Field label="PV máximos" type="number" min={0} value={sheet.vitals?.pvMax} onChange={(v) => update("vitals.pvMax", v)} />
        <Field label="PM atuais" type="number" min={0} value={sheet.vitals?.pm} onChange={(v) => update("vitals.pm", v)} />
        <Field label="PM máximos" type="number" min={0} value={sheet.vitals?.pmMax} onChange={(v) => update("vitals.pmMax", v)} />
        <Field label="Defesa" type="number" min={0} value={sheet.vitals?.defense} onChange={(v) => update("vitals.defense", v)} />
        <Field label="Deslocamento" value={sheet.vitals?.displacement} onChange={(v) => update("vitals.displacement", v)} />
      </Section>
    </>}
    {isOrder ? <>
      <Section title="Progressão, carga e recursos">
        <Field label="Pontos de prestígio" type="number" min={0} value={sheet.progression?.prestige} onChange={(v) => update("progression.prestige", v)} />
        <Field label="Crédito máximo" value={sheet.progression?.credit} onChange={(v) => update("progression.credit", v)} />
        <Field label="Limite de itens" value={sheet.progression?.maxItems} onChange={(v) => update("progression.maxItems", v)} />
        <Field label="Limite de carga" value={sheet.progression?.loadLimit} onChange={(v) => update("progression.loadLimit", v)} />
      </Section>\n      <CombatActionEditor title="Ataques" kind="attack" actions={normalizeCombatActions(sheet.attacks, "attack")} onChange={(v) => update("attacks", v)} />
      <CombatActionEditor title="Habilidades e poderes" kind="ability" actions={normalizeCombatActions(sheet.abilities, "ability")} onChange={(v) => update("abilities", v)} />
      <Section title="Recursos e anotações">
        <TextField label="Rituais" value={sheet.rituals} onChange={(v) => update("rituals", v)} />
        <TextField label="Inventário e carga" value={sheet.inventory} onChange={(v) => update("inventory", v)} />
        <TextField label="Anotações" value={sheet.notes} onChange={(v) => update("notes", v)} />
      </Section>
    </> : isDnd ? <>
      <Section title="Combate, recursos e interpretação">
        <TextField label="Ataques e magias de ataque" value={sheet.attacks} onChange={(v) => update("attacks", v)} />
        <TextField label="Características, talentos e habilidades" value={sheet.features} onChange={(v) => update("features", v)} />
        <TextField label="Magias (truques, espaços e descrição)" value={sheet.spells} onChange={(v) => update("spells", v)} />
        <TextField label="Equipamentos e tesouro" value={sheet.equipment} onChange={(v) => update("equipment", v)} />
        <TextField label="Traços de personalidade" value={sheet.personality?.traits} onChange={(v) => update("personality.traits", v)} />
        <TextField label="Ideais, vínculos e defeitos" value={[sheet.personality?.ideals, sheet.personality?.bonds, sheet.personality?.flaws].filter(Boolean).join("\n")} onChange={(v) => { const [ideals = "", bonds = "", flaws = ""] = v.split("\n"); update("personality.ideals", ideals); update("personality.bonds", bonds); update("personality.flaws", flaws); }} />
        <TextField label="Aparência e história" value={[sheet.personality?.appearance, sheet.personality?.backstory].filter(Boolean).join("\n")} onChange={(v) => { const [appearance = "", ...backstory] = v.split("\n"); update("personality.appearance", appearance); update("personality.backstory", backstory.join("\n")); }} />
        <TextField label="Anotações" value={sheet.notes} onChange={(v) => update("notes", v)} />
      </Section>
    </> : <>
      <Section title="Combate, poderes e recursos">
        <TextField label="Ataques" value={sheet.attacks} onChange={(v) => update("attacks", v)} />
        <TextField label="Poderes e habilidades" value={sheet.powers} onChange={(v) => update("powers", v)} />
        <TextField label="Magias" value={sheet.spells} onChange={(v) => update("spells", v)} />
        <TextField label="Equipamentos e tesouro" value={sheet.equipment} onChange={(v) => update("equipment", v)} />
        <TextField label="História do personagem" value={sheet.history} onChange={(v) => update("history", v)} />
        <TextField label="Anotações" value={sheet.notes} onChange={(v) => update("notes", v)} />
      </Section>
    </>}
  </div>;
}
