import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://arthurnunesdev.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);
const PIN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function response(payload: Record<string, unknown>, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function errorMessage(error: unknown): string {
  return error && typeof error === "object" && "message" in error
    ? String((error as { message: unknown }).message)
    : "";
}

function generatePin(): string {
  const acceptedByteLimit = Math.floor(256 / PIN_ALPHABET.length) * PIN_ALPHABET.length;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const characters: string[] = [];
    for (const byte of bytes) {
      if (byte >= acceptedByteLimit) continue;
      characters.push(PIN_ALPHABET[byte % PIN_ALPHABET.length]);
      if (characters.length === 8) break;
    }
    if (characters.length === 8) {
      const pin = characters.join("");
      if (/[A-Z]/.test(pin) && /[0-9]/.test(pin)) return pin;
    }
  }
  throw new Error("PIN_GENERATION_FAILED");
}

async function fingerprint(secret: string, value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request: Request) => {
  const headers = corsHeaders(request);
  const respond = (payload: Record<string, unknown>, status = 200) => response(payload, status, headers);

  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return respond({ error: "Método não permitido." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return respond({ error: "O serviço de sessões não está configurado." }, 503);
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return respond({ error: "Autenticação necessária." }, 401);

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const token = authorization.slice("Bearer ".length);
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) return respond({ error: "Sessão de usuário inválida." }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const userId = authData.user.id;

  let payload: { action?: unknown; campaignId?: unknown; sessionId?: unknown; pin?: unknown };
  try {
    payload = await request.json();
  } catch {
    return respond({ error: "Corpo da requisição inválido." }, 400);
  }

  const action = typeof payload.action === "string" ? payload.action : "";
  if (!["join", "create", "campaign", "info", "active", "leave"].includes(action)) {
    return respond({ error: "Ação de sessão inválida." }, 400);
  }


  if (action === "join") {
    const pin = typeof payload.pin === "string" ? payload.pin.trim().toUpperCase() : "";
    if (!/^[A-Z0-9]{8}$/.test(pin) || !/[A-Z]/.test(pin) || !/[0-9]/.test(pin)) {
      return respond({ error: "Informe o PIN de 8 letras e números." }, 400);
    }

    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const ip = request.headers.get("cf-connecting-ip")?.trim() || forwarded || "unknown";
    const deviceFingerprint = await fingerprint(serviceRoleKey, `device:${userId}`);
    const ipFingerprint = await fingerprint(serviceRoleKey, ip === "unknown" ? `fallback:${userId}` : `ip:${ip}`);
    const rateArgs = { p_device_fingerprint: deviceFingerprint, p_ip_fingerprint: ipFingerprint };

    const { data: allowed, error: rateError } = await admin.rpc("check_realm_session_pin_attempt", {
      ...rateArgs,
      p_failed: false,
    });
    if (rateError) return respond({ error: "Não foi possível validar a tentativa." }, 500);
    if (allowed !== true) return respond({ error: "Muitas tentativas. Aguarde 15 minutos." }, 429);

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("preferred_role")
      .eq("id", userId)
      .maybeSingle();
    if (profileError) return respond({ error: "Não foi possível identificar seu perfil." }, 500);

    const role = profile?.preferred_role === "observer" ? "observer" : "player";
    const { data: sessionId, error: joinError } = await admin.rpc("join_realm_session", {
      p_user_id: userId,
      p_pin: pin,
      p_role: role,
    });

    if (joinError) {
      const message = errorMessage(joinError);
      if (message.includes("SESSION_NOT_FOUND")) {
        const { data: recorded, error: recordError } = await admin.rpc("check_realm_session_pin_attempt", {
          ...rateArgs,
          p_failed: true,
        });
        if (recordError) return respond({ error: "Não foi possível registrar a tentativa." }, 500);
        if (recorded !== true) return respond({ error: "Muitas tentativas. Aguarde 15 minutos." }, 429);
        return respond({ error: "PIN não encontrado ou sessão encerrada." }, 404);
      }
      if (message.includes("INVALID_SESSION_DETAILS")) return respond({ error: "Não foi possível validar o acesso à sessão." }, 400);
      return respond({ error: "Não foi possível entrar na sessão." }, 500);
    }

    const { data: session, error: infoError } = await admin.rpc("get_realm_session", {
      p_user_id: userId,
      p_session_id: sessionId,
    });
    if (infoError) return respond({ error: "Você entrou, mas não foi possível carregar os dados da sessão." }, 500);
    return respond({ joined: true, session });
  }

  if (action === "create") {
    const campaignId = typeof payload.campaignId === "string" ? payload.campaignId : "";
    if (!/^[0-9a-f-]{36}$/i.test(campaignId)) return respond({ error: "Campanha inválida." }, 400);

    const { data: sessionId, error: createError } = await admin.rpc("create_realm_session", {
      p_user_id: userId,
      p_campaign_id: campaignId,
      p_pin: generatePin(),
    });
    if (createError) {
      const message = errorMessage(createError);
      if (message.includes("CAMPAIGN_GM_REQUIRED")) return respond({ error: "Somente o mestre desta campanha pode criar a sessão." }, 403);
      if (message.includes("CAMPAIGN_SESSION_ACTIVE")) return respond({ error: "Esta campanha já possui uma sessão com PIN ativo." }, 409);
      return respond({ error: "Não foi possível criar a sessão da campanha." }, 500);
    }

    const { data: session, error: infoError } = await admin.rpc("get_realm_session", {
      p_user_id: userId,
      p_session_id: sessionId,
    });
    if (infoError) return respond({ error: "A sessão foi criada, mas não foi possível carregar seus dados." }, 500);
    return respond({ created: true, session });
  }

  if (action === "campaign" || action === "active") {
    const campaignId = typeof payload.campaignId === "string" ? payload.campaignId : "";
    if (!/^[0-9a-f-]{36}$/i.test(campaignId)) return respond({ error: "Campanha inválida." }, 400);
    const rpcName = action === "campaign" ? "get_campaign_realm_session" : "get_active_realm_campaign_session";
    const { data, error } = await admin.rpc(rpcName, {
      p_user_id: userId,
      p_campaign_id: campaignId,
    });
    if (error) {
      const message = errorMessage(error);
      if (message.includes("CAMPAIGN_GM_REQUIRED") || message.includes("CAMPAIGN_MEMBER_REQUIRED")) return respond({ error: "Você não participa desta campanha." }, 403);
      if (message.includes("CAMPAIGN_SESSION_NOT_CREATED")) return respond({ error: "Esta campanha ainda não possui uma sessão. O mestre precisa criá-la." }, 404);
      return respond({ error: "Não foi possível carregar a sessão desta campanha." }, 500);
    }
    return respond({ session: data });
  }

  const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : "";
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return respond({ error: "Sessão inválida." }, 400);

  if (action === "active") {
    const campaignId = typeof payload.campaignId === "string" ? payload.campaignId : "";
    if (!/^[0-9a-f-]{36}$/i.test(campaignId)) return respond({ error: "Campanha inválida." }, 400);
    const { data, error } = await admin.rpc("get_active_realm_campaign_session", {
      p_user_id: userId,
      p_campaign_id: campaignId,
    });
    if (error) {
      const message = errorMessage(error);
      if (message.includes("CAMPAIGN_GM_REQUIRED")) return respond({ error: "Somente o mestre desta campanha pode abrir a mesa." }, 403);
      return respond({ error: "Não foi possível carregar o PIN permanente desta campanha." }, 404);
    }
    return respond({ session: data });
  }

  if (action === "info") {
    const { data, error } = await admin.rpc("get_realm_session", {
      p_user_id: userId,
      p_session_id: sessionId,
    });
    if (error) return respond({ error: errorMessage(error).includes("SESSION_ACCESS_DENIED") ? "Você não participa desta sessão." : "Não foi possível carregar a sessão." }, 403);
    return respond({ session: data });
  }

  if (action === "leave") {
    const { data, error } = await admin.rpc("leave_realm_session", {
      p_user_id: userId,
      p_session_id: sessionId,
    });
    if (error) {
      const message = errorMessage(error);
      if (message.includes("SESSION_CREATOR_MUST_END")) {
        return respond({ error: "Como mestre que abriu a sessão, encerre-a antes de sair." }, 409);
      }
      return respond({ error: "Não foi possível sair da sessão." }, 500);
    }
    if (data !== true) return respond({ error: "Você não participa desta sessão." }, 404);
    return respond({ left: true });
  }

  return respond({ error: "A mesa permanece ativa enquanto a campanha existir." }, 410);
});
