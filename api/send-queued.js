const MAX_BATCH_SIZE = 10;
const MAX_ATTEMPTS = 3;

module.exports = async function sendQueued(request, response) {
  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }

  if (!["GET", "POST"].includes(request.method)) {
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  const env = getEnv();
  const missing = getMissingEnv(env);
  if (missing.length) {
    sendJson(response, 500, {
      error: `Missing environment variables: ${missing.join(", ")}`,
    });
    return;
  }

  const authorization = await authorizeRequest(request, env);
  if (!authorization.ok) {
    sendJson(response, authorization.status, { error: authorization.error });
    return;
  }

  try {
    const queued = await supabaseRequest(env, "/rest/v1/message_queue", {
      query: {
        status: "eq.queued",
        select: "id,operation_event_id,payload,attempts",
        order: "created_at.asc",
        limit: String(MAX_BATCH_SIZE),
      },
    });

    const results = [];

    for (const item of queued) {
      const attempts = Number(item.attempts || 0) + 1;

      try {
        const text = item.payload?.text;
        if (!text) {
          throw new Error("Mensagem sem texto no payload.");
        }

        const evolutionResult = await sendEvolutionText(env, text);
        const externalMessageId = getExternalMessageId(evolutionResult);
        const now = new Date().toISOString();

        await supabaseRequest(env, `/rest/v1/message_queue`, {
          method: "PATCH",
          query: { id: `eq.${item.id}` },
          body: {
            status: "sent",
            attempts,
            last_error: null,
            sent_at: now,
          },
        });

        await supabaseRequest(env, `/rest/v1/operation_events`, {
          method: "PATCH",
          query: { id: `eq.${item.operation_event_id}` },
          body: {
            message_sent: true,
            external_message_id: externalMessageId,
          },
        });

        results.push({ id: item.id, status: "sent" });
      } catch (error) {
        const status = attempts >= MAX_ATTEMPTS ? "failed" : "queued";
        await supabaseRequest(env, `/rest/v1/message_queue`, {
          method: "PATCH",
          query: { id: `eq.${item.id}` },
          body: {
            status,
            attempts,
            last_error: error.message,
          },
        });

        results.push({ id: item.id, status, error: error.message });
      }
    }

    sendJson(response, 200, {
      processed: results.length,
      results,
    });
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
};

async function authorizeRequest(request, env) {
  const authHeader = request.headers.authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (env.CRON_SECRET && token === env.CRON_SECRET) {
    return { ok: true };
  }

  if (!token) {
    return { ok: false, status: 401, error: "Missing authorization token" };
  }

  const userResponse = await fetch(`${trimSlash(env.SUPABASE_URL)}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!userResponse.ok) {
    return { ok: false, status: 401, error: "Invalid Supabase session" };
  }

  const user = await userResponse.json();
  const profiles = await supabaseRequest(env, "/rest/v1/profiles", {
    query: {
      id: `eq.${user.id}`,
      select: "role",
      limit: "1",
    },
  });

  if (profiles[0]?.role !== "admin") {
    return { ok: false, status: 403, error: "Admin access required" };
  }

  return { ok: true };
}

async function sendEvolutionText(env, text) {
  const baseUrl = normalizeEvolutionBaseUrl(env.EVOLUTION_API_URL);
  const instance = encodeURIComponent(env.EVOLUTION_INSTANCE);
  const endpoint = `${baseUrl}/message/sendText/${instance}`;

  const evolutionResponse = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.EVOLUTION_API_KEY,
    },
    body: JSON.stringify({
      number: env.EVOLUTION_GROUP_ID,
      text,
      linkPreview: false,
    }),
  });

  const responseText = await evolutionResponse.text();
  const body = parseJsonSafe(responseText);

  if (!evolutionResponse.ok) {
    throw new Error(
      body?.message || body?.error || responseText || `Evolution returned ${evolutionResponse.status}`,
    );
  }

  return body;
}

async function supabaseRequest(env, path, options = {}) {
  const url = new URL(`${trimSlash(env.SUPABASE_URL)}${path}`);

  for (const [key, value] of Object.entries(options.query || {})) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: "return=representation",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const responseText = await response.text();
  const body = parseJsonSafe(responseText);

  if (!response.ok) {
    throw new Error(body?.message || body?.error || responseText || `Supabase returned ${response.status}`);
  }

  return body || [];
}

function getExternalMessageId(result) {
  return (
    result?.key?.id ||
    result?.message?.key?.id ||
    result?.messageId ||
    result?.id ||
    null
  );
}

function getEnv() {
  return {
    SUPABASE_URL: process.env.SUPABASE_URL || "",
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || "",
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    EVOLUTION_API_URL: process.env.EVOLUTION_API_URL || "",
    EVOLUTION_API_KEY: process.env.EVOLUTION_API_KEY || "",
    EVOLUTION_INSTANCE: process.env.EVOLUTION_INSTANCE || "",
    EVOLUTION_GROUP_ID: process.env.EVOLUTION_GROUP_ID || "",
    CRON_SECRET: process.env.CRON_SECRET || "",
  };
}

function getMissingEnv(env) {
  return [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "EVOLUTION_API_URL",
    "EVOLUTION_API_KEY",
    "EVOLUTION_INSTANCE",
    "EVOLUTION_GROUP_ID",
  ].filter((name) => !env[name] || isPlaceholder(env[name]));
}

function isPlaceholder(value) {
  return /^(cole_aqui|sua-|seu-|https:\/\/seu-projeto|troque_por)/i.test(String(value || "").trim());
}

function normalizeEvolutionBaseUrl(value) {
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/manager\/.*$/, "");
  url.search = "";
  url.hash = "";
  return trimSlash(url.toString());
}

function trimSlash(value) {
  return value.replace(/\/+$/, "");
}

function parseJsonSafe(value) {
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function sendJson(response, status, body) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}
