import { useEffect, useRef, useState } from "react";
import { Crosshair, Hand, MapPin, Pencil, Type, ZoomIn, ZoomOut, UserPlus, Users } from "lucide-react";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export default function SessionMapViewer({ url, title, annotations, tokens = [], availableCharacters = [], isGm, userId, canMoveOwnTokens = false, allowPlayerMovement = false, onTogglePlayerMovement, onAddToken, onMoveToken, viewport, onViewportChange, onCreateAnnotation }) {
  const svgRef = useRef(null);
  const drawingRef = useRef([]);
  const dragRef = useRef(null);
  const tokenDragRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 1000, height: 700 });
  const [tool, setTool] = useState("move");
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [draftPath, setDraftPath] = useState([]);
  const [saving, setSaving] = useState(false);
  const [dragPreview, setDragPreview] = useState(null);
  const [selectedCharacterId, setSelectedCharacterId] = useState("");
  const lastViewportSyncRef = useRef(0);

  useEffect(() => {
    setZoom(viewport?.zoom || 1);
    setOffset({ x: viewport?.x || 0, y: viewport?.y || 0 });
  }, [viewport?.zoom, viewport?.x, viewport?.y]);

  useEffect(() => {
    let active = true;
    const image = new window.Image();
    image.onload = () => {
      if (active) setDimensions({ width: image.naturalWidth || 1000, height: image.naturalHeight || 700 });
    };
    image.src = url;
    return () => { active = false; };
  }, [url]);

  function getPoint(event) {
    const svg = svgRef.current;
    if (!svg) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const matrix = svg.getScreenCTM();
    if (!matrix) return null;
    const local = point.matrixTransform(matrix.inverse());
    return {
      x: clamp(local.x / dimensions.width, 0, 1),
      y: clamp(local.y / dimensions.height, 0, 1),
    };
  }

  async function save(type, payload) {
    setSaving(true);
    try {
      await onCreateAnnotation(type, payload);
    } finally {
      setSaving(false);
    }
  }

  function handlePointerDown(event) {
    if (saving) return;
    const tokenElement = event.target.closest?.("[data-token-id]");
    if (tokenElement) {
      const token = tokens.find((item) => item.id === tokenElement.dataset.tokenId);
      const canMoveToken = Boolean(token && (isGm || (canMoveOwnTokens && token.owner_id === userId)));
      if (!canMoveToken) return;
      tokenDragRef.current = { id: token.id };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (!isGm) return;
    const point = getPoint(event);
    if (!point) return;
    if (tool === "move") {
      dragRef.current = { x: event.clientX, y: event.clientY, offsetX: offset.x, offsetY: offset.y };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (tool === "draw") {
      drawingRef.current = [point];
      setDraftPath([point]);
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }

  function handlePointerMove(event) {
    if (tokenDragRef.current) {
      const point = getPoint(event);
      if (point) setDragPreview({ id: tokenDragRef.current.id, ...point });
      return;
    }
    if (!isGm) return;
    if (tool === "move" && dragRef.current) {
      const deltaX = event.clientX - dragRef.current.x;
      const deltaY = event.clientY - dragRef.current.y;
      const nextOffset = { x: dragRef.current.offsetX + deltaX, y: dragRef.current.offsetY + deltaY };
      setOffset(nextOffset);
      const now = Date.now();
      if (now - lastViewportSyncRef.current >= 120) {
        lastViewportSyncRef.current = now;
        onViewportChange?.({ zoom, ...nextOffset });
      }
      return;
    }
    if (tool === "draw" && drawingRef.current.length) {
      const point = getPoint(event);
      if (!point) return;
      const previous = drawingRef.current[drawingRef.current.length - 1];
      if (Math.hypot(point.x - previous.x, point.y - previous.y) < 0.0015) return;
      const next = drawingRef.current.length >= 400 ? [...drawingRef.current.slice(-399), point] : [...drawingRef.current, point];
      drawingRef.current = next;
      setDraftPath(next);
    }
  }

  async function handlePointerUp(event) {
    if (tokenDragRef.current) {
      const tokenId = tokenDragRef.current.id;
      const point = dragPreview || getPoint(event);
      tokenDragRef.current = null;
      setDragPreview(null);
      if (point) await onMoveToken?.(tokenId, { x: point.x, y: point.y });
      return;
    }
    if (!isGm) return;
    if (dragRef.current) onViewportChange?.({ zoom, x: offset.x, y: offset.y });
    dragRef.current = null;
    if (tool !== "draw" || !drawingRef.current.length) return;
    const points = drawingRef.current;
    drawingRef.current = [];
    setDraftPath([]);
    if (points.length > 1) await save("drawing", { points, color: "#e5b96f", width: 4 });
  }

  async function handleMapClick(event) {
    if (!isGm || tool === "move" || tool === "draw" || saving) return;
    const point = getPoint(event);
    if (!point) return;
    if (tool === "marker") {
      const label = window.prompt("Texto do marcador (opcional):", "");
      if (label === null) return;
      await save("marker", { ...point, label: label.trim().slice(0, 80) });
    } else if (tool === "text") {
      const value = window.prompt("Texto para inserir no mapa:");
      if (!value?.trim()) return;
      await save("text", { ...point, text: value.trim().slice(0, 240), color: "#fff1d6" });
    }
  }

  const tools = [
    { id: "move", label: "Mover", icon: Hand },
    { id: "marker", label: "Marcador", icon: MapPin },
    { id: "text", label: "Texto", icon: Type },
    { id: "draw", label: "Desenhar", icon: Pencil },
  ];

  return (
    <section className="room-map-workspace panel">
      <div className="room-map-workspace-heading">
        <div><span className="eyebrow">{isGm ? "CONTROLE DO MESTRE" : "VISUALIZAÇÃO COMPARTILHADA"}</span><h3>{title}</h3></div>
        {isGm ? <div className="room-map-editor-toolbar">
          {tools.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={tool === id ? "active" : ""} onClick={() => setTool(id)} title={label} aria-label={label}><Icon size={15} /></button>)}
          <span className="room-map-toolbar-divider" />
          <button type="button" onClick={() => { const next = clamp(zoom - 0.15, 0.5, 3); setZoom(next); onViewportChange?.({ zoom: next, x: offset.x, y: offset.y }); }} disabled={zoom <= 0.5} aria-label="Diminuir zoom"><ZoomOut size={15} /></button>
          <span className="room-map-zoom-value">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => { const next = clamp(zoom + 0.15, 0.5, 3); setZoom(next); onViewportChange?.({ zoom: next, x: offset.x, y: offset.y }); }} disabled={zoom >= 3} aria-label="Aumentar zoom"><ZoomIn size={15} /></button>
          <button type="button" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); onViewportChange?.({ zoom: 1, x: 0, y: 0 }); }} title="Centralizar"><Crosshair size={15} /></button>
        </div> : <span className="room-readonly-note"><Crosshair size={14} /> {canMoveOwnTokens ? "Arraste seu personagem para movê-lo" : "Somente visualização"}</span>}
      </div>
      {isGm && <div className="room-map-token-controls">
        <label className="room-field">
          <span>Adicionar personagem ao mapa</span>
          <select value={selectedCharacterId} onChange={(event) => setSelectedCharacterId(event.target.value)}>
            <option value="">Selecione um personagem...</option>
            {availableCharacters.filter((character) => !tokens.some((token) => token.character_id === character.id)).map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
          </select>
        </label>
        <button className="button button-secondary" type="button" disabled={!selectedCharacterId} onClick={() => {
          const character = availableCharacters.find((item) => item.id === selectedCharacterId);
          if (character) onAddToken?.(character);
          setSelectedCharacterId("");
        }}><UserPlus size={14} /> Adicionar</button>
        <button className="button button-secondary" type="button" onClick={() => onTogglePlayerMovement?.(!allowPlayerMovement)}><Users size={14} /> {allowPlayerMovement ? "Bloquear movimento dos jogadores" : "Permitir movimento dos jogadores"}</button>
      </div>}
      <div className={"room-map-canvas" + (isGm ? " editable" : canMoveOwnTokens ? " token-interactive" : " readonly")} style={{ aspectRatio: dimensions.width + " / " + dimensions.height }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={"Mapa " + title}
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onClick={handleMapClick}
        >
          <image href={url} x="0" y="0" width={dimensions.width} height={dimensions.height} />
          {annotations.map((item) => {
            const payload = item.payload || {};
            const x = (payload.x || 0) * dimensions.width;
            const y = (payload.y || 0) * dimensions.height;
            if (item.annotation_type === "marker") return <g key={item.id} transform={`translate(${x} ${y})`}><circle r={Math.max(12, dimensions.width * 0.012)} className="room-map-marker-dot" /><path d={`M 0 ${Math.max(12, dimensions.width * 0.012)} L 0 ${Math.max(25, dimensions.width * 0.025)}`} className="room-map-marker-stem" />{payload.label && <text x="16" y="5" className="room-map-label">{payload.label}</text>}</g>;
            if (item.annotation_type === "text") return <text key={item.id} x={x} y={y} fill={payload.color || "#fff1d6"} className="room-map-text-note">{payload.text}</text>;
            if (item.annotation_type === "drawing" && Array.isArray(payload.points)) return <polyline key={item.id} points={payload.points.map((point) => `${point.x * dimensions.width},${point.y * dimensions.height}`).join(" ")} fill="none" stroke={payload.color || "#e5b96f"} strokeWidth={payload.width || 4} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />;
            return null;
          })}
          {tokens.map((token) => {
            const point = dragPreview?.id === token.id ? dragPreview : token;
            const x = Number(point.x) * dimensions.width;
            const y = Number(point.y) * dimensions.height;
            const label = token.characters?.name || token.character_name || "Personagem";
            const movable = isGm || (canMoveOwnTokens && token.owner_id === userId);
            return <g key={token.id} data-token-id={token.id} transform={`translate(${x} ${y})`} className={movable ? "room-map-token movable" : "room-map-token"}>
              <circle r={Math.max(20, dimensions.width * 0.022)} />
              <text textAnchor="middle" dominantBaseline="central">{label.trim().charAt(0).toUpperCase()}</text>
              <text className="room-map-token-name" textAnchor="middle" y={Math.max(34, dimensions.width * 0.035)}>{label}</text>
            </g>;
          })}
          {draftPath.length > 1 && <polyline points={draftPath.map((point) => `${point.x * dimensions.width},${point.y * dimensions.height}`).join(" ")} fill="none" stroke="#e5b96f" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
        </svg>
      </div>
      <div className="room-map-workspace-footer">{isGm ? "Arraste os personagens para posicioná-los. Você mantém o controle de todos os tokens; a movimentação dos jogadores pode ser liberada ou bloqueada." : canMoveOwnTokens ? "Você pode arrastar somente o seu personagem. O mestre continua podendo mover todos os personagens." : "O mapa acompanha em tempo real as alterações realizadas pelo mestre."}{saving && <span> Salvando anotação…</span>}</div>
    </section>
  );
}
