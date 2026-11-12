import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, AudioLines, Check, Copy, Eye, ImagePlus, Map, Music2, Play, Plus, Radio, Save, Trash2, Users, Volume2 } from "lucide-react";
import { supabase } from "../lib/supabase.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import DicePage from "./DicePage.jsx";
import "../styles/campaign-detail.css";

const MAX_MAP_SIZE = 15 * 1024 * 1024;
const MAX_AUDIO_SIZE = 50 * 1024 * 1024;

export default function CampaignDetailPage() {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const audioRef = useRef(null);
  const [campaign, setCampaign] = useState(null);
  const [session, setSession] = useState(null);
  const [maps, setMaps] = useState([]);
  const [tracks, setTracks] = useState([]);
  const [playback, setPlayback] = useState(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [activeTab, setActiveTab] = useState("overview");
  const [loading, setLoading] = useState(true);
  const [creatingSession, setCreatingSession] = useState(false);
  const [uploading, setUploading] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mapTitle, setMapTitle] = useState("");
  const [trackTitle, setTrackTitle] = useState("");
  const [selectedTrack, setSelectedTrack] = useState("");
  const [pinCopied, setPinCopied] = useState(false);

  const role = useMemo(() => campaign?.campaign_members?.find((member) => member.user_id === user?.id)?.role ?? null, [campaign?.campaign_members, user?.id]);
  const isGm = role === "gm";

  const loadCampaign = useCallback(async () => {
    if (!supabase || !user?.id || !campaignId) return;
    setLoading(true); setError("");
    try {
      const { data: campaignData, error: campaignError } = await supabase.from("campaigns")
        .select("id, owner_id, title, description, status, game_systems(name), campaign_members(user_id,role)")
        .eq("id", campaignId).single();
      if (campaignError) throw campaignError;
      if (!campaignData.campaign_members?.some((member) => member.user_id === user.id)) throw new Error("Você não participa desta campanha.");
      setCampaign(campaignData);
      const { data: sessionData, error: sessionError } = await supabase.functions.invoke("realm-sessions", { body: { action: "campaign", campaignId } });
      if (sessionError && !sessionData?.error) throw sessionError;
      if (sessionData?.error && !sessionData.error.toLowerCase().includes("ainda não possui")) throw new Error(sessionData.error);
      setSession(sessionData?.session ?? null);

      const [mapResult, trackResult, playbackResult] = await Promise.all([
        supabase.from("campaign_maps").select("id,title,description,storage_path,is_visible,sort_order,created_at").eq("campaign_id",campaignId).order("sort_order").order("created_at"),
        supabase.from("campaign_tracks").select("id,title,storage_path,duration_seconds,is_visible,sort_order,created_at").eq("campaign_id",campaignId).order("sort_order").order("created_at"),
        supabase.from("campaign_playback").select("campaign_id,track_id,is_playing,position_seconds,updated_at").eq("campaign_id",campaignId).maybeSingle(),
      ]);
      if (mapResult.error) throw mapResult.error;
      if (trackResult.error) throw trackResult.error;
      if (playbackResult.error) throw playbackResult.error;
      setMaps(mapResult.data ?? []); setTracks(trackResult.data ?? []); setPlayback(playbackResult.data ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível abrir a campanha.");
    } finally { setLoading(false); }
  }, [campaignId,user?.id]);

  useEffect(() => { loadCampaign(); }, [loadCampaign]);

  useEffect(() => {
    if (!supabase || !campaignId) return undefined;
    const channel = supabase.channel(`campaign-detail:${campaignId}`)
      .on("postgres_changes",{event:"*",schema:"public",table:"campaign_maps",filter:`campaign_id=eq.${campaignId}`},loadCampaign)
      .on("postgres_changes",{event:"*",schema:"public",table:"campaign_tracks",filter:`campaign_id=eq.${campaignId}`},loadCampaign)
      .on("postgres_changes",{event:"*",schema:"public",table:"campaign_playback",filter:`campaign_id=eq.${campaignId}`},(payload)=>setPlayback(payload.new ?? null))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  },[campaignId,loadCampaign]);

  useEffect(() => {
    let alive = true;
    async function resolveAudio() {
      if (!supabase || !playback?.track_id) { setAudioUrl(""); return; }
      const track = tracks.find((item) => item.id === playback.track_id);
      if (!track) { setAudioUrl(""); return; }
      const { data, error: signedError } = await supabase.storage.from("campaign-assets").createSignedUrl(track.storage_path,3600);
      if (alive) setAudioUrl(signedError ? "" : data?.signedUrl ?? "");
    }
    resolveAudio();
    return () => { alive = false; };
  },[playback?.track_id,tracks]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audioUrl) { audio.pause(); audio.removeAttribute("src"); audio.load(); return; }
    if (playback?.is_playing) {
      if (Math.abs(audio.currentTime - Number(playback.position_seconds ?? 0)) > 3) audio.currentTime = Number(playback.position_seconds ?? 0);
      void audio.play().catch(() => setError("O navegador bloqueou a reprodução automática. Use o botão de reprodução."));
    } else audio.pause();
  },[audioUrl,playback?.is_playing,playback?.position_seconds]);

  useEffect(() => {
    if (!isGm || !playback?.is_playing || !playback?.track_id || !supabase) return undefined;
    const syncTimer = window.setInterval(async () => {
      const position = audioRef.current?.currentTime;
      if (!Number.isFinite(position)) return;
      const { error: syncError } = await supabase.from("campaign_playback").update({
        position_seconds: position,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      }).eq("campaign_id", campaignId);
      if (syncError) setError(syncError.message);
    }, 12_000);
    return () => window.clearInterval(syncTimer);
  }, [isGm, playback?.is_playing, playback?.track_id, campaignId, user?.id]);

  async function createSession() {
    if (!supabase || !isGm || creatingSession) return;
    setCreatingSession(true); setError(""); setNotice("");
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("realm-sessions",{body:{action:"create",campaignId}});
      if (invokeError) throw invokeError;
      if (data?.error) throw new Error(data.error);
      setSession(data.session); setNotice("Sessão criada. O PIN já está disponível para compartilhar.");
    } catch (createError) { setError(createError instanceof Error ? createError.message : "Não foi possível criar a sessão."); }
    finally { setCreatingSession(false); }
  }

  async function copyPin() {
    if (!session?.pin) return;
    try { await navigator.clipboard.writeText(session.pin); setPinCopied(true); window.setTimeout(()=>setPinCopied(false),1600); }
    catch { setError("Não foi possível copiar o PIN."); }
  }

  async function uploadMap(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const file = event.currentTarget.elements.namedItem("mapFile")?.files?.[0];
    if (!file || !mapTitle.trim()) { setError("Informe o nome e selecione uma imagem de mapa."); return; }
    if (!["image/jpeg","image/png","image/webp","image/gif"].includes(file.type) || file.size > MAX_MAP_SIZE) { setError("Use JPG, PNG, WebP ou GIF com até 15 MB."); return; }
    setUploading("map"); setError(""); setNotice("");
    const path = `${campaignId}/maps/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,"_")}`;
    try {
      const { error: uploadError } = await supabase.storage.from("campaign-assets").upload(path,file,{contentType:file.type,upsert:false});
      if (uploadError) throw uploadError;
      const { error: insertError } = await supabase.from("campaign_maps").insert({campaign_id:campaignId,created_by:user.id,title:mapTitle.trim(),storage_path:path});
      if (insertError) { await supabase.storage.from("campaign-assets").remove([path]); throw insertError; }
      setMapTitle(""); formElement.reset(); setNotice("Mapa salvo na biblioteca da campanha."); await loadCampaign();
    } catch (uploadError) { setError(uploadError instanceof Error ? uploadError.message : "Não foi possível salvar o mapa."); }
    finally { setUploading(""); }
  }

  async function uploadTrack(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const file = event.currentTarget.elements.namedItem("trackFile")?.files?.[0];
    if (!file || !trackTitle.trim()) { setError("Informe o nome e selecione um arquivo de áudio."); return; }
    if (!file.type.startsWith("audio/") || file.size > MAX_AUDIO_SIZE) { setError("Selecione um áudio compatível de até 50 MB."); return; }
    setUploading("track"); setError(""); setNotice("");
    const path = `${campaignId}/audio/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,"_")}`;
    try {
      const { error: uploadError } = await supabase.storage.from("campaign-assets").upload(path,file,{contentType:file.type,upsert:false});
      if (uploadError) throw uploadError;
      const { error: insertError } = await supabase.from("campaign_tracks").insert({campaign_id:campaignId,created_by:user.id,title:trackTitle.trim(),storage_path:path});
      if (insertError) { await supabase.storage.from("campaign-assets").remove([path]); throw insertError; }
      setTrackTitle(""); formElement.reset(); setNotice("Trilha sonora adicionada."); await loadCampaign();
    } catch (uploadError) { setError(uploadError instanceof Error ? uploadError.message : "Não foi possível salvar a trilha."); }
    finally { setUploading(""); }
  }

  async function toggleVisibility(table,item) {
    const { error: updateError } = await supabase.from(table).update({is_visible:!item.is_visible}).eq("id",item.id);
    if (updateError) setError(updateError.message); else await loadCampaign();
  }

  async function removeAsset(table,item) {
    if (!window.confirm(`Excluir "${item.title}" desta campanha?`)) return;
    const { error: deleteError } = await supabase.from(table).delete().eq("id",item.id);
    if (deleteError) { setError(deleteError.message); return; }
    await supabase.storage.from("campaign-assets").remove([item.storage_path]);
    await loadCampaign();
  }

  async function playTrack(track) {
    if (!isGm || !supabase) return;
    const { error: playError } = await supabase.from("campaign_playback").upsert({
      campaign_id:campaignId,track_id:track.id,is_playing:true,position_seconds:0,updated_by:user.id,updated_at:new Date().toISOString(),
    },{onConflict:"campaign_id"});
    if (playError) setError(playError.message);
    else { setSelectedTrack(track.id); setPlayback({campaign_id:campaignId,track_id:track.id,is_playing:true,position_seconds:0}); }
  }

  async function setPlaybackState(isPlaying) {
    if (!isGm || !supabase) return;
    const { error: updateError } = await supabase.from("campaign_playback").upsert({
      campaign_id:campaignId,track_id:playback?.track_id ?? selectedTrack ?? null,is_playing:isPlaying,
      position_seconds:audioRef.current?.currentTime ?? Number(playback?.position_seconds ?? 0),
      updated_by:user.id,updated_at:new Date().toISOString(),
    },{onConflict:"campaign_id"});
    if (updateError) setError(updateError.message);
  }

  if (loading) return <section className="campaign-detail-page"><div className="panel campaign-detail-loading">Carregando campanha...</div></section>;
  if (!campaign) return <section className="campaign-detail-page"><Link to="/campaigns" className="campaign-detail-back"><ArrowLeft size={15}/> Campanhas</Link><div className="panel campaign-detail-loading" role="alert">{error || "Campanha não encontrada."}</div></section>;

  const visibleMaps = maps.filter((item)=>isGm || item.is_visible);
  const visibleTracks = tracks.filter((item)=>isGm || item.is_visible);
  const currentTrack = tracks.find((item)=>item.id===playback?.track_id);

  return <section className="campaign-detail-page">
    <Link to="/campaigns" className="campaign-detail-back"><ArrowLeft size={15}/> Todas as campanhas</Link>
    <header className="campaign-detail-hero panel"><div className="campaign-detail-emblem"><Map size={29}/></div><div className="campaign-detail-title"><p className="eyebrow">{campaign.game_systems?.name ?? "CAMPANHA"} · {isGm ? "MESTRE" : role === "observer" ? "OBSERVADOR" : "JOGADOR"}</p><h1>{campaign.title}</h1><p>{campaign.description || "Uma nova aventura está prestes a começar."}</p></div><span className="campaign-detail-member-count"><Users size={14}/>{campaign.campaign_members?.length ?? 0}</span></header>
    {notice && <p className="campaign-detail-notice" role="status">{notice}</p>}{error && <p className="campaign-detail-error" role="alert">{error}</p>}
    <audio ref={audioRef} src={audioUrl || undefined} preload="auto" hidden onEnded={()=>isGm&&setPlaybackState(false)} />
    <nav className="campaign-detail-tabs" aria-label="Seções da campanha">
      {["overview","maps","music","dice"].map((tab)=> <button type="button" key={tab} className={activeTab===tab?"campaign-tab active":"campaign-tab"} onClick={()=>setActiveTab(tab)}>{tab==="overview"?"Visão geral":tab==="maps"?"Mapas":tab==="music"?"Trilhas sonoras":"Dados"}</button>)}
    </nav>

    {activeTab==="overview" && <div className="campaign-overview-grid">
      <section className="panel campaign-session-card"><p className="eyebrow">SESSÃO DA CAMPANHA</p><h2>{session ? "Sessão pronta" : "Sessão ainda não criada"}</h2><p>{session ? "O PIN permanece válido até a exclusão da campanha." : "O mestre pode criar a sessão quando estiver pronto. O PIN será gerado nesse momento."}</p>
        {session?.pin && <div className="campaign-detail-pin"><span>{session.pin}</span><button className="button button-secondary" onClick={copyPin}><Copy size={14}/>{pinCopied?"Copiado":"Copiar PIN"}</button></div>}
        {isGm && !session && <button className="button button-primary" type="button" onClick={createSession} disabled={creatingSession}><Plus size={15}/>{creatingSession?"Criando sessão...":"Criar sessão e gerar PIN"}</button>}
        {session && <button className="button button-primary" type="button" onClick={()=>navigate(`/tabletop/${session.id}`)}><Play size={15}/>Abrir sala da sessão</button>}
      </section>
      <section className="panel campaign-overview-card"><p className="eyebrow">RECURSOS PREPARADOS</p><div><strong>{maps.length}</strong><span>Mapas salvos</span></div><div><strong>{tracks.length}</strong><span>Trilhas sonoras</span></div><div><strong>{campaign.campaign_members?.length ?? 0}</strong><span>Participantes</span></div></section>
    </div>}

    {activeTab==="maps" && <section className="campaign-resource-section">
      <div className="campaign-resource-heading"><div><p className="eyebrow">CARTOGRAFIA DA AVENTURA</p><h2>Mapas da campanha</h2><p>{isGm?"Adicione mapas e escolha quando eles ficam visíveis para os jogadores.":"Mapas que o mestre disponibilizou para o grupo."}</p></div></div>
      {isGm && <form className="panel campaign-upload-form" onSubmit={uploadMap}><label><span>Nome do mapa</span><input value={mapTitle} onChange={(event)=>setMapTitle(event.target.value)} maxLength={100} placeholder="Ex.: Floresta dos Sussurros" required/></label><label className="campaign-file-input"><ImagePlus size={17}/><span>Selecionar imagem</span><input name="mapFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif" required/></label><button className="button button-primary" type="submit" disabled={uploading==="map"}>{uploading==="map"?"Enviando...":"Salvar mapa"}</button></form>}
      <div className="campaign-map-grid">{visibleMaps.map((item)=> <CampaignMapCard key={item.id} item={item} isGm={isGm} onVisibility={()=>toggleVisibility("campaign_maps",item)} onDelete={()=>removeAsset("campaign_maps",item)}/>)}</div>
      {!visibleMaps.length && <div className="panel campaign-resource-empty"><Map size={25}/><strong>{isGm?"Nenhum mapa salvo ainda":"O mestre ainda não disponibilizou mapas."}</strong></div>}
    </section>}

    {activeTab==="music" && <section className="campaign-resource-section">
      <div className="campaign-resource-heading"><div><p className="eyebrow">AMBIENTAÇÃO SONORA</p><h2>Trilhas sonoras</h2><p>{isGm?"Prepare as músicas e controle o que toca para os jogadores.":"A trilha sonora escolhida pelo mestre será reproduzida aqui."}</p></div></div>
      {isGm && <form className="panel campaign-upload-form" onSubmit={uploadTrack}><label><span>Nome da trilha</span><input value={trackTitle} onChange={(event)=>setTrackTitle(event.target.value)} maxLength={100} placeholder="Ex.: Exploração da masmorra" required/></label><label className="campaign-file-input"><AudioLines size={17}/><span>Selecionar áudio</span><input name="trackFile" type="file" accept="audio/*" required/></label><button className="button button-primary" type="submit" disabled={uploading==="track"}>{uploading==="track"?"Enviando...":"Adicionar trilha"}</button></form>}
      <div className="campaign-track-list">{visibleTracks.map((track)=> <article className="panel campaign-track-row" key={track.id}><span className="campaign-track-icon"><Music2 size={18}/></span><div className="campaign-track-copy"><strong>{track.title}</strong><small>{playback?.track_id===track.id && playback?.is_playing?"Tocando agora":"Trilha preparada"}</small></div>{isGm && <button className="button button-secondary" type="button" onClick={()=>playTrack(track)}><Play size={14}/> Tocar</button>}{isGm && <button className="icon-button" type="button" title={track.is_visible?"Ocultar dos jogadores":"Liberar para jogadores"} onClick={()=>toggleVisibility("campaign_tracks",track)}><Eye size={15}/></button>}{isGm && <button className="icon-button" type="button" aria-label="Excluir trilha" onClick={()=>removeAsset("campaign_tracks",track)}><Trash2 size={15}/></button>}</article>)}</div>
      {!visibleTracks.length && <div className="panel campaign-resource-empty"><Music2 size={25}/><strong>{isGm?"Nenhuma trilha adicionada ainda":"O mestre ainda não liberou trilhas sonoras."}</strong></div>}
      <div className="panel campaign-audio-player"><div className="campaign-track-icon"><Volume2 size={19}/></div><div className="campaign-track-copy"><strong>{currentTrack?.title ?? "Nenhuma trilha selecionada"}</strong><small>{playback?.is_playing?"Reprodução sincronizada da campanha":"Aguardando o mestre selecionar uma trilha"}</small></div>{isGm && <button className="button button-secondary" type="button" disabled={!playback?.track_id} onClick={()=>setPlaybackState(!playback?.is_playing)}>{playback?.is_playing?"Pausar":"Retomar"}</button>}{playback?.is_playing && <button className="button button-secondary" type="button" onClick={()=>audioRef.current?.play().catch(()=>setError("Não foi possível iniciar o áudio."))}>Ativar áudio</button>}</div>
    </section>}

    {activeTab==="dice" && <DicePage campaignId={campaignId} embedded readOnly={role==="observer"}/>}
    <footer className="campaign-detail-footer"><span><ShieldCheckIcon/> Acesso restrito aos participantes desta campanha</span>{session && <Link className="button button-secondary" to={`/tabletop/${session.id}`}>Abrir chat e participantes <ArrowLeft size={14}/></Link>}</footer>
  </section>;
}

function ShieldCheckIcon(){return <span aria-hidden="true">◆</span>;}

function CampaignMapCard({item,isGm,onVisibility,onDelete}) {
  const [url,setUrl]=useState("");
  const [error,setError]=useState("");
  useEffect(()=>{
    let alive=true;
    supabase.storage.from("campaign-assets").createSignedUrl(item.storage_path,3600).then(({data, error:signError})=>{
      if(!alive)return;
      if(signError)setError("Imagem indisponível."); else setUrl(data?.signedUrl??"");
    });
    return()=>{alive=false;};
  },[item.storage_path]);
  return <article className="panel campaign-map-card">{url?<a href={url} target="_blank" rel="noreferrer"><img src={url} alt={item.title}/></a>:<div className="campaign-map-placeholder">{error||"Carregando mapa..."}</div>}<div className="campaign-map-card-copy"><strong>{item.title}</strong>{item.description&&<p>{item.description}</p>}{isGm&&<div><button type="button" className="button button-secondary" onClick={onVisibility}><Eye size={13}/>{item.is_visible?"Visível aos jogadores":"Oculto dos jogadores"}</button><button type="button" className="icon-button" onClick={onDelete} aria-label="Excluir mapa"><Trash2 size={14}/></button></div>}</div></article>;
}
