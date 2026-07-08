const storageKeys = {
  url: "pft_supabase_url",
  anonKey: "pft_supabase_anon_key",
};

const state = {
  client: null,
  session: null,
  authSubscription: null,
  configSource: "manual",
  openOperations: [],
  events: [],
  pendingMessagesCount: 0,
};

const priceFormat = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 5,
});

const pointsFormat = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 1,
});

const dateTimeFormat = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});

const els = {};

document.addEventListener("DOMContentLoaded", async () => {
  cacheElements();
  bindEvents();
  hydrateInitialValues();
  await initializeSupabase();
  updateOperationPreview();
});

function cacheElements() {
  for (const id of [
    "accessScreen",
    "appShell",
    "configForm",
    "supabaseUrl",
    "supabaseAnonKey",
    "configStatus",
    "connectionDot",
    "connectionLabel",
    "authForm",
    "authStatus",
    "email",
    "password",
    "signOutButton",
    "signedUser",
    "operationForm",
    "operationPreview",
    "pair",
    "side",
    "entryPrice",
    "stopLoss",
    "takeProfit",
    "notes",
    "resetOperationForm",
    "refreshOperations",
    "openOperations",
    "dashboardMonth",
    "statClosed",
    "statPoints",
    "statWins",
    "statLosses",
    "statWinRate",
    "closedOperations",
    "sendQueuedMessages",
    "refreshEvents",
    "eventList",
    "toast",
  ]) {
    els[id] = document.getElementById(id);
  }
}

function bindEvents() {
  els.configForm.addEventListener("submit", handleConfigSubmit);
  els.authForm.addEventListener("submit", handleSignIn);
  els.signOutButton.addEventListener("click", handleSignOut);
  els.operationForm.addEventListener("submit", handleOperationSubmit);
  els.resetOperationForm.addEventListener("click", () => {
    els.operationForm.reset();
    updateOperationPreview();
  });
  els.refreshOperations.addEventListener("click", loadOpenOperations);
  els.refreshEvents.addEventListener("click", loadEvents);
  els.sendQueuedMessages.addEventListener("click", handleSendQueuedMessages);
  els.openOperations.addEventListener("submit", handleOperationAction);
  els.openOperations.addEventListener("input", handleOperationActionInput);
  els.dashboardMonth.addEventListener("change", loadDashboard);

  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => setActiveTab(button.dataset.tab));
  });

  for (const input of [els.pair, els.side, els.entryPrice, els.stopLoss, els.takeProfit]) {
    input.addEventListener("input", updateOperationPreview);
  }

  els.pair.addEventListener("blur", () => {
    els.pair.value = normalizePair(els.pair.value);
    updateOperationPreview();
  });
}

function hydrateInitialValues() {
  els.supabaseUrl.value = localStorage.getItem(storageKeys.url) || "";
  els.supabaseAnonKey.value = localStorage.getItem(storageKeys.anonKey) || "";
  els.dashboardMonth.value = getCurrentMonthValue();
  setAppDisabled(true);
  showSignedOutView();
}

async function getSupabaseConfig(preferManual = false) {
  const manualConfig = {
    url: localStorage.getItem(storageKeys.url) || "",
    anonKey: localStorage.getItem(storageKeys.anonKey) || "",
    source: "manual",
  };

  if (preferManual && hasUsableSupabaseConfig(manualConfig)) {
    return manualConfig;
  }

  const runtimeConfig = await fetchRuntimeConfig();
  if (
    hasUsableSupabaseConfig({
      url: runtimeConfig.supabaseUrl,
      anonKey: runtimeConfig.supabaseAnonKey,
    })
  ) {
    return {
      url: normalizeProjectUrl(runtimeConfig.supabaseUrl),
      anonKey: runtimeConfig.supabaseAnonKey,
      source: "env",
    };
  }

  const normalizedManual = {
    ...manualConfig,
    url: normalizeProjectUrl(manualConfig.url),
  };

  return hasUsableSupabaseConfig(normalizedManual)
    ? normalizedManual
    : { url: "", anonKey: "", source: "manual" };
}

async function fetchRuntimeConfig() {
  if (window.location.protocol === "file:") {
    return {};
  }

  try {
    const response = await fetch("/api/config", { cache: "no-store" });
    if (!response.ok) return {};
    return response.json();
  } catch (_error) {
    return {};
  }
}

function updateConfigFields(config) {
  const usingEnv = config.source === "env";
  els.configForm.hidden = usingEnv;
  els.supabaseUrl.value = config.url || "";
  els.supabaseAnonKey.value = config.anonKey || "";
  els.supabaseUrl.disabled = usingEnv;
  els.supabaseAnonKey.disabled = usingEnv;
  els.configForm.querySelector("button").disabled = usingEnv;

  if (!config.url || !config.anonKey) {
    els.configStatus.textContent = "Pendente";
    els.configStatus.className = "tag neutral";
    return;
  }

  els.configStatus.textContent = usingEnv ? ".env" : "Salvo";
  els.configStatus.className = "tag open";
}

function hasUsableSupabaseConfig(config) {
  return (
    Boolean(config.url) &&
    Boolean(config.anonKey) &&
    !isPlaceholder(config.url) &&
    !isPlaceholder(config.anonKey)
  );
}

function isPlaceholder(value) {
  return /^(cole_aqui|sua-|seu-|https:\/\/seu-projeto)/i.test(String(value || "").trim());
}

async function initializeSupabase(options = {}) {
  const config = await getSupabaseConfig(options.preferManual);
  const { url, anonKey, source } = config;
  state.configSource = source;
  updateConfigFields(config);

  if (!url || !anonKey) {
    clearSupabaseClient();
    updateConnection("missing");
    return;
  }

  if (!window.supabase) {
    clearSupabaseClient();
    els.configStatus.textContent = "SDK offline";
    els.configStatus.className = "tag loss";
    updateConnection("error");
    return;
  }

  if (state.authSubscription) {
    state.authSubscription.unsubscribe();
  }

  state.client = window.supabase.createClient(url, anonKey);
  updateConnection("configured");

  state.client.auth.getSession().then(({ data, error }) => {
    if (error) {
      showToast(error.message);
      return;
    }
    state.session = data.session;
    handleSessionChange();
  });

  const { data } = state.client.auth.onAuthStateChange((_event, session) => {
    state.session = session;
    handleSessionChange();
  });
  state.authSubscription = data.subscription;
}

function clearSupabaseClient() {
  if (state.authSubscription) {
    state.authSubscription.unsubscribe();
    state.authSubscription = null;
  }

  state.client = null;
  state.session = null;
  setAppDisabled(true);
  showSignedOutView();
}

async function handleConfigSubmit(event) {
  event.preventDefault();
  localStorage.setItem(storageKeys.url, normalizeProjectUrl(els.supabaseUrl.value.trim()));
  localStorage.setItem(storageKeys.anonKey, els.supabaseAnonKey.value.trim());
  await initializeSupabase({ preferManual: true });
  showToast("Conexão salva.");
}

async function handleSignIn(event) {
  event.preventDefault();
  if (!requireClient()) return;

  const { error } = await state.client.auth.signInWithPassword({
    email: els.email.value.trim(),
    password: els.password.value,
  });

  if (error) {
    showToast(error.message);
    return;
  }

  els.password.value = "";
  showToast("Acesso liberado.");
}

async function handleSignOut() {
  if (!requireClient()) return;
  await state.client.auth.signOut();
  showToast("Sessão encerrada.");
}

function handleSessionChange() {
  const signedIn = Boolean(state.session);
  els.authStatus.textContent = signedIn ? "Online" : "Aguardando login";
  els.authStatus.className = signedIn ? "tag open" : "tag neutral";

  if (signedIn) {
    showSignedInView();
    loadAllData({ retryQueued: true });
    return;
  }

  state.openOperations = [];
  state.events = [];
  state.pendingMessagesCount = 0;
  showSignedOutView();
  renderOpenOperations();
  renderEvents();
  updateSendQueuedButton();
  renderDashboard([]);
}

function showSignedInView() {
  els.accessScreen.hidden = true;
  els.appShell.hidden = false;
  els.signOutButton.disabled = false;
  els.signedUser.textContent = state.session?.user?.email || "Usuário";
  setAppDisabled(false);
  updateConnection("online");
}

function showSignedOutView() {
  els.accessScreen.hidden = false;
  els.appShell.hidden = true;
  els.signOutButton.disabled = true;
  els.signedUser.textContent = "";
  state.pendingMessagesCount = 0;
  updateSendQueuedButton();
  setAppDisabled(true);
}

function setAppDisabled(disabled) {
  for (const field of els.operationForm.elements) {
    field.disabled = disabled;
  }
  els.refreshOperations.disabled = disabled;
  els.refreshEvents.disabled = disabled;
  els.sendQueuedMessages.disabled = disabled;
  els.dashboardMonth.disabled = disabled;
}

async function loadAllData(options = {}) {
  await Promise.all([loadOpenOperations(), loadDashboard(), loadEvents(), loadPendingMessages()]);

  if (options.retryQueued) {
    const dispatchResult = await triggerQueuedMessageDispatch();
    if (dispatchResult.ok && dispatchResult.processed > 0) {
      showToast(`${dispatchResult.processed} mensagem(ns) pendente(s) enviada(s).`);
      await Promise.all([loadEvents(), loadPendingMessages()]);
    }
  }
}

async function handleSendQueuedMessages() {
  if (!requireSession()) return;

  const dispatchResult = await triggerQueuedMessageDispatch();
  if (!dispatchResult.ok) {
    showToast(`Envio pendente: ${dispatchResult.error}`);
    await loadPendingMessages();
    return;
  }

  showToast(
    dispatchResult.processed > 0
      ? `${dispatchResult.processed} mensagem(ns) enviada(s).`
      : "Nenhuma mensagem pendente.",
  );
  await Promise.all([loadEvents(), loadPendingMessages()]);
}

async function handleOperationSubmit(event) {
  event.preventDefault();
  if (!requireSession()) return;

  const operation = getOperationFormData();
  const validation = validatePlannedOperation(operation);
  if (!validation.ok) {
    showToast(validation.message);
    return;
  }

  const { data, error } = await state.client
    .from("operations")
    .insert(operation)
    .select()
    .single();

  if (error) {
    showToast(error.message);
    return;
  }

  const eventError = await createEvent({
    operationId: data.id,
    type: "opened",
    price: data.entry_price,
    points: null,
    closePercent: null,
    messageText: buildOpenedMessage(data),
  });

  if (eventError) {
    showToast(eventError.message);
    return;
  }

  const dispatchResult = await triggerQueuedMessageDispatch();
  els.operationForm.reset();
  updateOperationPreview();
  showToast(dispatchResult.ok ? "Operação enviada." : `Operação salva. Envio pendente: ${dispatchResult.error}`);
  await loadAllData();
}

async function handleOperationAction(event) {
  const form = event.target.closest("[data-operation-action]");
  if (!form) return;
  event.preventDefault();
  if (!requireSession()) return;

  const operation = state.openOperations.find((item) => item.id === form.dataset.operationId);
  if (!operation) {
    showToast("Operação não encontrada.");
    return;
  }

  const action = form.dataset.operationAction;
  const formData = new FormData(form);
  const actionValues = getActionValues(operation, action, formData);
  const { eventType, price, points, closePercent } = actionValues;

  const validation = validateAction(action, price, closePercent);
  if (!validation.ok) {
    showToast(validation.message);
    return;
  }

  const eventError = await createEvent({
    operationId: operation.id,
    type: eventType,
    price,
    points,
    closePercent,
    messageText: buildActionMessage(operation, action, price, points, closePercent),
  });

  if (eventError) {
    showToast(eventError.message);
    return;
  }

  const updateError = await updateOperationFromAction(operation.id, action, price, points);
  if (updateError) {
    showToast(updateError.message);
    return;
  }

  const dispatchResult = await triggerQueuedMessageDispatch();
  showToast(
    dispatchResult.ok
      ? actionToast(action)
      : `${actionToast(action)} Envio pendente: ${dispatchResult.error}`,
  );
  await loadAllData();
}

function handleOperationActionInput(event) {
  const form = event.target.closest("[data-operation-action]");
  if (!form) return;

  const action = form.dataset.operationAction;
  if (!["partial", "closed"].includes(action)) return;

  const operation = state.openOperations.find((item) => item.id === form.dataset.operationId);
  const pointsInput = form.querySelector('[name="points"]');
  if (!operation || !pointsInput) return;

  const price = parseOptionalNumber(new FormData(form).get("price"));
  if (!Number.isFinite(price) || price <= 0) {
    pointsInput.value = "";
    return;
  }

  pointsInput.value = formatNumberInput(calculateResultPoints(operation, price));
}

function getActionValues(operation, action, formData) {
  if (action === "take") {
    const price = Number(operation.take_profit);
    return {
      eventType: "closed",
      price,
      points: calculateResultPoints(operation, price),
      closePercent: null,
    };
  }

  if (action === "stopped") {
    const price = Number(operation.stop_loss);
    return {
      eventType: "stopped",
      price,
      points: calculateResultPoints(operation, price),
      closePercent: null,
    };
  }

  if (action === "canceled") {
    return {
      eventType: "canceled",
      price: null,
      points: null,
      closePercent: null,
    };
  }

  const price = parseOptionalNumber(formData.get("price"));
  return {
    eventType: action,
    price,
    points: Number.isFinite(price) ? calculateResultPoints(operation, price) : null,
    closePercent: action === "partial" ? parseOptionalNumber(formData.get("closePercent")) : null,
  };
}

function validateAction(action, price, closePercent) {
  if (action === "canceled") {
    return { ok: true };
  }

  if (!Number.isFinite(price) || price <= 0) {
    return { ok: false, message: "Informe o preço da ação." };
  }

  if (
    action === "partial" &&
    (!Number.isFinite(closePercent) || closePercent <= 0 || closePercent > 100)
  ) {
    return { ok: false, message: "Informe quanto será fechado na parcial." };
  }

  return { ok: true };
}

async function createEvent({ operationId, type, price, points, closePercent, messageText }) {
  const { error } = await state.client.from("operation_events").insert({
    operation_id: operationId,
    type,
    price,
    points,
    close_percent: closePercent,
    message_text: messageText,
  });

  return error;
}

async function triggerQueuedMessageDispatch() {
  if (window.location.protocol === "file:" || !state.session?.access_token) {
    return { ok: false, error: "abra pelo servidor local" };
  }

  try {
    const response = await fetch("/api/send-queued", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${state.session.access_token}`,
      },
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      return {
        ok: false,
        error: formatDispatchError(response.status, payload.error),
      };
    }

    const notSent = (payload.results || []).find((item) => item.status !== "sent");
    if (notSent) {
      return {
        ok: false,
        error: notSent.error || "falha na Evolution",
        processed: Number(payload.processed || 0),
      };
    }

    return {
      ok: true,
      processed: Number(payload.processed || 0),
      results: payload.results || [],
    };
  } catch (_error) {
    return { ok: false, error: "rota de envio indisponível" };
  }
}

function formatDispatchError(status, message) {
  if (status === 404 || status === 405) {
    return "abra pelo servidor do projeto, não pelo Live Server/porta 5500";
  }

  return message || `erro ${status}`;
}

async function updateOperationFromAction(operationId, action, price, points) {
  const patch = { updated_at: new Date().toISOString() };

  if (action === "partial") {
    patch.status = "partial";
  }

  if (action === "closed" || action === "take" || action === "stopped") {
    patch.status = "closed";
    patch.close_price = price;
    patch.closed_at = new Date().toISOString();
  }

  if (action === "canceled") {
    patch.status = "canceled";
    patch.closed_at = new Date().toISOString();
  }

  const { error } = await state.client.from("operations").update(patch).eq("id", operationId);
  return error;
}

async function loadOpenOperations() {
  if (!state.client || !state.session) return;

  const { data, error } = await state.client
    .from("operations")
    .select("*")
    .in("status", ["open", "partial"])
    .order("created_at", { ascending: false });

  if (error) {
    showToast(error.message);
    return;
  }

  state.openOperations = data || [];
  renderOpenOperations();
}

async function loadDashboard() {
  if (!state.client || !state.session) return;

  const { start, end } = getMonthRange(els.dashboardMonth.value);
  const { data, error } = await state.client
    .from("operations")
    .select("*")
    .eq("status", "closed")
    .gte("closed_at", start)
    .lt("closed_at", end)
    .order("closed_at", { ascending: false });

  if (error) {
    showToast(error.message);
    return;
  }

  renderDashboard(data || []);
}

async function loadEvents() {
  if (!state.client || !state.session) return;

  const { data, error } = await state.client
    .from("operation_events")
    .select("*, operations(pair, side, operation_number)")
    .order("created_at", { ascending: false })
    .limit(80);

  if (error) {
    showToast(error.message);
    return;
  }

  state.events = data || [];
  renderEvents();
}

async function loadPendingMessages() {
  if (!state.client || !state.session) {
    state.pendingMessagesCount = 0;
    updateSendQueuedButton();
    return;
  }

  const { count, error } = await state.client
    .from("message_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "queued");

  if (error) {
    state.pendingMessagesCount = 0;
    updateSendQueuedButton();
    return;
  }

  state.pendingMessagesCount = count || 0;
  updateSendQueuedButton();
}

function updateSendQueuedButton() {
  if (!els.sendQueuedMessages) return;

  const hasPending = state.pendingMessagesCount > 0;
  els.sendQueuedMessages.hidden = !hasPending;
  els.sendQueuedMessages.disabled = !state.session || !hasPending;
  els.sendQueuedMessages.textContent = hasPending
    ? `Enviar pendentes (${state.pendingMessagesCount})`
    : "Enviar pendentes";
}

function renderOpenOperations() {
  if (!state.openOperations.length) {
    els.openOperations.innerHTML = '<div class="empty">Nenhuma operação aberta.</div>';
    return;
  }

  els.openOperations.innerHTML = state.openOperations.map(renderOperationCard).join("");
}

function renderOperationCard(operation) {
  const sideLabel = operation.side === "buy" ? "Compra" : "Venda";
  const statusLabel = operation.status === "partial" ? "Parcial" : "Aberta";
  const stopPoints = calculateResultPoints(operation, operation.stop_loss);
  const takePoints = calculateResultPoints(operation, operation.take_profit);

  return `
    <article class="operation-card">
      <header>
        <div class="operation-title">
          <strong>${escapeHtml(operation.pair)}</strong>
          <span class="tag neutral">${sideLabel}</span>
          <span class="tag ${operation.status}">${statusLabel}</span>
        </div>
        <span class="tag neutral">${formatDateTime(operation.created_at)}</span>
      </header>
      <p class="operation-number">Operação n°: ${formatOperationNumber(operation)}</p>
      <div class="meta-grid">
        <div class="metric">
          <span>Entrada</span>
          <strong>${formatPrice(operation.entry_price)}</strong>
        </div>
        <div class="metric">
          <span>Stop loss</span>
          <strong>${formatPrice(operation.stop_loss)} / ${formatSignedPoints(stopPoints)} pts</strong>
        </div>
        <div class="metric">
          <span>Take profit</span>
          <strong>${formatPrice(operation.take_profit)} / ${formatSignedPoints(takePoints)} pts</strong>
        </div>
        <div class="metric">
          <span>Status</span>
          <strong>${statusLabel}</strong>
        </div>
      </div>
      <div class="action-grid">
        <form data-operation-action="partial" data-operation-id="${operation.id}">
          <input name="price" type="number" step="0.00001" min="0" placeholder="Preço parcial" required />
          <input name="closePercent" type="number" step="1" min="1" max="100" placeholder="% fechar" required />
          <input name="points" type="text" placeholder="Pontos" readonly />
          <button class="secondary" type="submit">Parcial</button>
        </form>
        <form data-operation-action="closed" data-operation-id="${operation.id}">
          <input name="price" type="number" step="0.00001" min="0" placeholder="Preço final" required />
          <input name="points" type="text" placeholder="Pontos" readonly />
          <button type="submit">Fechar</button>
        </form>
        <form class="quick-action-form" data-operation-action="take" data-operation-id="${operation.id}">
          <button class="gain-button" type="submit">Take profit ${formatSignedPoints(takePoints)} pts</button>
        </form>
        <form data-operation-action="stopped" data-operation-id="${operation.id}">
          <button class="loss-button" type="submit">Stop loss ${formatSignedPoints(stopPoints)} pts</button>
        </form>
        <form class="cancel-form" data-operation-action="canceled" data-operation-id="${operation.id}">
          <button class="ghost" type="submit">Cancelar</button>
        </form>
      </div>
    </article>
  `;
}

function renderDashboard(closedOperations) {
  const closed = closedOperations.length;
  const totalPoints = closedOperations.reduce(
    (sum, operation) => sum + Number(operation.result_points || 0),
    0,
  );
  const wins = closedOperations.filter((operation) => Number(operation.result_points || 0) > 0).length;
  const losses = closedOperations.filter((operation) => Number(operation.result_points || 0) < 0).length;
  const winRate = closed ? Math.round((wins / closed) * 100) : 0;

  els.statClosed.textContent = closed;
  els.statPoints.textContent = formatPoints(totalPoints);
  els.statWins.textContent = wins;
  els.statLosses.textContent = losses;
  els.statWinRate.textContent = `${winRate}%`;
  els.statPoints.className = totalPoints >= 0 ? "gain-text" : "loss-text";

  if (!closedOperations.length) {
    els.closedOperations.innerHTML = `
      <tr>
        <td colspan="7">Nenhuma operação fechada neste mês.</td>
      </tr>
    `;
    return;
  }

  els.closedOperations.innerHTML = closedOperations
    .map((operation) => {
      const result = Number(operation.result_points || 0);
      const resultClass = result >= 0 ? "gain-text" : "loss-text";
      return `
        <tr>
          <td>${formatOperationNumber(operation)}</td>
          <td>${escapeHtml(operation.pair)}</td>
          <td>${operation.side === "buy" ? "Compra" : "Venda"}</td>
          <td>${formatPrice(operation.entry_price)}</td>
          <td>${formatPrice(operation.close_price)}</td>
          <td class="${resultClass}">${formatSignedPoints(result)} pts</td>
          <td>${formatDateTime(operation.closed_at)}</td>
        </tr>
      `;
    })
    .join("");
}

function renderEvents() {
  if (!state.events.length) {
    els.eventList.innerHTML = '<div class="empty">Nenhuma mensagem registrada.</div>';
    return;
  }

  els.eventList.innerHTML = state.events
    .map((event) => {
      const operationLabel = event.operations
        ? `Operação n° ${formatOperationNumber(event.operations)} · ${event.operations.pair} / ${
            event.operations.side === "buy" ? "Compra" : "Venda"
          }`
        : "Operação";
      return `
        <article class="event-item">
          <div class="event-topline">
            <span>${escapeHtml(operationLabel)} · ${eventTypeLabel(event.type)}</span>
            <span>${formatDateTime(event.created_at)}</span>
          </div>
          <div class="event-message">${escapeHtml(event.message_text || "")}</div>
        </article>
      `;
    })
    .join("");
}

function getOperationFormData() {
  const pair = normalizePair(els.pair.value);

  return {
    pair,
    side: els.side.value,
    entry_price: Number(els.entryPrice.value),
    stop_loss: Number(els.stopLoss.value),
    take_profit: Number(els.takeProfit.value),
    point_size: inferPointSize(pair),
    notes: els.notes.value.trim() || null,
  };
}

function updateOperationPreview() {
  const pair = normalizePair(els.pair.value);
  if (!pair) {
    els.operationPreview.textContent = "Pronta para envio";
    els.operationPreview.className = "tag neutral";
    return;
  }

  els.operationPreview.textContent = `${els.side.value === "buy" ? "Compra" : "Venda"} · ${pair}`;
  els.operationPreview.className = "tag open";
}

function validatePlannedOperation(operation) {
  if (!operation.pair || operation.pair.length < 3) {
    return { ok: false, message: "Informe o par da operação." };
  }

  for (const field of ["entry_price", "stop_loss", "take_profit"]) {
    if (!Number.isFinite(operation[field]) || operation[field] <= 0) {
      return { ok: false, message: "Revise os preços da operação." };
    }
  }

  if (operation.side === "buy" && operation.stop_loss >= operation.entry_price) {
    return { ok: false, message: "Em compra, o stop precisa ficar abaixo da entrada." };
  }

  if (operation.side === "buy" && operation.take_profit <= operation.entry_price) {
    return { ok: false, message: "Em compra, o take precisa ficar acima da entrada." };
  }

  if (operation.side === "sell" && operation.stop_loss <= operation.entry_price) {
    return { ok: false, message: "Em venda, o stop precisa ficar acima da entrada." };
  }

  if (operation.side === "sell" && operation.take_profit >= operation.entry_price) {
    return { ok: false, message: "Em venda, o take precisa ficar abaixo da entrada." };
  }

  return { ok: true };
}

function buildOpenedMessage(operation) {
  const sideLabel = operation.side === "buy" ? "COMPRA" : "VENDA";

  return [
    `*${sideLabel}*`,
    `Ativo: *${operation.pair}*`,
    `Operação n°: ${formatOperationNumber(operation)}`,
    "",
    `Preço de entrada: ${formatMessagePrice(operation.entry_price)}`,
    `Stop Loss: ${formatMessagePrice(operation.stop_loss)}`,
    `Take Profit: ${formatMessagePrice(operation.take_profit)}`,
  ].join("\n");
}

function buildActionMessage(operation, action, price, points, closePercent) {
  if (action === "partial") {
    return [
      `Operação n°: ${formatOperationNumber(operation)}`,
      "*PARCIAL*",
      "",
      `Preço da Parcial: ${formatMessagePrice(price)}`,
      `Fechar ${formatMessagePercent(closePercent)}`,
      `Pontos da parcial: ${formatMessageSignedPoints(points)} pts`,
    ].join("\n");
  }

  if (action === "closed") {
    return [
      `Operação n°: ${formatOperationNumber(operation)}`,
      "*FECHADA*",
      "",
      `Preço de fechamento: ${formatMessagePrice(price)}`,
      `Resultado: ${formatMessageSignedPoints(points)} pts`,
    ].join("\n");
  }

  if (action === "take") {
    return [
      `Operação n°: ${formatOperationNumber(operation)}`,
      "*TAKE PROFIT*",
      "",
      `Preço do take: ${formatMessagePrice(price)}`,
      `Resultado: ${formatMessageSignedPoints(points)} pts`,
    ].join("\n");
  }

  if (action === "stopped") {
    return [
      `Operação n°: ${formatOperationNumber(operation)}`,
      "*STOP LOSS*",
      "",
      `Preço do stop: ${formatMessagePrice(price)}`,
      `Resultado: ${formatMessageSignedPoints(points)} pts`,
    ].join("\n");
  }

  return [
    `Operação n°: ${formatOperationNumber(operation)}`,
    "*CANCELADA*",
    "",
    "Operação encerrada sem resultado.",
  ].join("\n");
}

function requireClient() {
  if (!state.client) {
    showToast("Configure o Supabase primeiro.");
    return false;
  }
  return true;
}

function requireSession() {
  if (!requireClient()) return false;
  if (!state.session) {
    showToast("Entre com sua conta primeiro.");
    return false;
  }
  return true;
}

function setActiveTab(tabName) {
  document.querySelectorAll(".tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabName);
  });

  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `${tabName}Tab`);
  });
}

function updateConnection(status) {
  els.connectionDot.className = "dot";

  if (status === "online") {
    els.connectionDot.classList.add("online");
    els.connectionLabel.textContent = "Online";
    return;
  }

  if (status === "configured") {
    els.connectionLabel.textContent = "Supabase pronto";
    return;
  }

  if (status === "error") {
    els.connectionDot.classList.add("error");
    els.connectionLabel.textContent = "Erro";
    return;
  }

  els.connectionLabel.textContent = "Configuração pendente";
}

function normalizeProjectUrl(value) {
  return value.trim().replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
}

function normalizePair(value) {
  const normalized = value.trim().replace(/\s+/g, "").replace("-", "/").toUpperCase();
  if (/^[A-Z]{6}$/.test(normalized)) {
    return `${normalized.slice(0, 3)}/${normalized.slice(3)}`;
  }

  return normalized;
}

function inferPointSize(pair) {
  const normalized = normalizePair(pair);
  if (!normalized) return 0.0001;
  if (normalized.includes("JPY")) return 0.01;
  if (normalized.includes("XAU") || normalized.includes("GOLD")) return 0.1;
  if (normalized.includes("BTC") || normalized.includes("ETH")) return 1;
  return 0.0001;
}

function calculateResultPoints(operation, price) {
  const entry = Number(operation.entry_price);
  const actionPrice = Number(price);
  const pointSize = Number(operation.point_size || inferPointSize(operation.pair));
  const diff = operation.side === "buy" ? actionPrice - entry : entry - actionPrice;
  return roundPoints(diff / pointSize);
}

function roundPoints(value) {
  return Math.round(Number(value) * 10) / 10;
}

function formatNumberInput(value) {
  if (!Number.isFinite(value)) return "";
  return String(roundPoints(value));
}

function parseOptionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  return Number(value);
}

function getCurrentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthRange(monthValue) {
  const [year, month] = monthValue.split("-").map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

function formatPrice(value) {
  if (value === null || value === undefined || value === "") return "-";
  return priceFormat.format(Number(value));
}

function formatMessagePrice(value) {
  return formatMessageNumber(value, 8);
}

function formatMessagePercent(value) {
  return `${formatMessageNumber(value, 1)}%`;
}

function formatMessageSignedPoints(value) {
  const numeric = Number(value || 0);
  return `${numeric > 0 ? "+" : ""}${formatMessageNumber(numeric, 1)}`;
}

function formatMessageNumber(value, maximumFractionDigits) {
  if (value === null || value === undefined || value === "") return "-";

  return Number(value).toLocaleString("en-US", {
    useGrouping: false,
    maximumFractionDigits,
  });
}

function formatPoints(value) {
  return pointsFormat.format(Number(value || 0));
}

function formatPercent(value) {
  return `${pointsFormat.format(Number(value || 0))}%`;
}

function formatOperationNumber(operation) {
  return operation.operation_number || "-";
}

function formatSignedPoints(value) {
  const numeric = Number(value || 0);
  return `${numeric > 0 ? "+" : ""}${formatPoints(numeric)}`;
}

function formatDateTime(value) {
  if (!value) return "-";
  return dateTimeFormat.format(new Date(value));
}

function eventTypeLabel(type) {
  const labels = {
    opened: "Abertura",
    partial: "Parcial",
    closed: "Fechamento",
    stopped: "Stop Loss",
    canceled: "Cancelamento",
    note: "Nota",
  };

  return labels[type] || type;
}

function actionToast(action) {
  const labels = {
    partial: "Parcial registrada.",
    closed: "Operação fechada.",
    take: "Take profit registrado.",
    stopped: "Stop loss registrado.",
    canceled: "Operação cancelada.",
  };

  return labels[action] || "Operação atualizada.";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

let toastTimer = null;
function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.classList.remove("visible");
  }, 3400);
}
