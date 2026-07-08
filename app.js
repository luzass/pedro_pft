const storageKeys = {
  url: "pft_supabase_url",
  anonKey: "pft_supabase_anon_key",
};

const ACCOUNT_BALANCE = 1000;
const ACCOUNT_CURRENCY = "USD";
const DEFAULT_RISK_PERCENT = 0.25;
const STANDARD_LOT_UNITS = 100000;
const MIN_LOT_SIZE = 0.01;
const LOT_STEP = 0.01;

const state = {
  client: null,
  session: null,
  authSubscription: null,
  configSource: "manual",
  openOperations: [],
  events: [],
  pendingMessagesCount: 0,
};

const priceFormat = new Intl.NumberFormat("en-US", {
  useGrouping: false,
  maximumFractionDigits: 5,
});

const pointsFormat = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 1,
});

const percentFormat = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 2,
});

const lotFormat = new Intl.NumberFormat("en-US", {
  useGrouping: false,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const moneyFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: ACCOUNT_CURRENCY,
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
    "riskPercent",
    "conversionRateField",
    "conversionRate",
    "conversionHint",
    "riskPreview",
    "notes",
    "resetOperationForm",
    "refreshOperations",
    "openOperations",
    "dashboardMonth",
    "statClosed",
    "statPoints",
    "statAmount",
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
    els.riskPercent.value = String(DEFAULT_RISK_PERCENT);
    updateOperationPreview();
  });
  els.refreshOperations.addEventListener("click", loadOpenOperations);
  els.refreshEvents.addEventListener("click", loadEvents);
  els.sendQueuedMessages.addEventListener("click", handleSendQueuedMessages);
  els.openOperations.addEventListener("submit", handleOperationAction);
  els.openOperations.addEventListener("input", handleOperationActionInput);
  els.openOperations.addEventListener("focusout", handleOperationActionBlur);
  els.dashboardMonth.addEventListener("change", loadDashboard);

  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => setActiveTab(button.dataset.tab));
  });

  for (const input of [
    els.pair,
    els.side,
    els.entryPrice,
    els.stopLoss,
    els.takeProfit,
    els.riskPercent,
    els.conversionRate,
  ]) {
    input.addEventListener("input", updateOperationPreview);
  }

  els.pair.addEventListener("blur", () => {
    els.pair.value = normalizePair(els.pair.value);
    formatOperationPriceFields();
    updateOperationPreview();
  });

  for (const input of [els.entryPrice, els.stopLoss, els.takeProfit, els.conversionRate]) {
    input.addEventListener("blur", () => {
      formatOperationPriceField(input);
      updateOperationPreview();
    });
  }
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
  const { eventType, price, points, closePercent, lotSize, remainingLotSize, amount } = actionValues;

  const validation = validateAction(actionValues);
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
    lotSize,
    remainingLotSize,
    amount,
    messageText: buildActionMessage(operation, action, price, points, closePercent, lotSize, remainingLotSize, amount),
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
  if (!operation) return;

  updateActionPreview(form, operation, action);
}

function handleOperationActionBlur(event) {
  const input = event.target.closest('input[name="price"]');
  if (!input) return;

  const form = input.closest("[data-operation-action]");
  if (!form) return;

  const operation = state.openOperations.find((item) => item.id === form.dataset.operationId);
  if (!operation) return;

  formatActionPriceField(input, operation);
  updateActionPreview(form, operation, form.dataset.operationAction);
}

function updateActionPreview(form, operation, action) {
  const pointsInput = form.querySelector('[name="points"]');
  const lotInput = form.querySelector('[name="lotSize"]');
  const amountInput = form.querySelector('[name="amount"]');
  if (!pointsInput && !lotInput && !amountInput) return;

  const formData = new FormData(form);
  const pairInfo = getPairInfo(operation.pair);
  const price = parsePriceInput(formData.get("price"), pairInfo);
  if (!Number.isFinite(price) || price <= 0) {
    if (pointsInput) pointsInput.value = "";
    if (lotInput) lotInput.value = "";
    if (amountInput) amountInput.value = "";
    return;
  }

  const closePercent = action === "partial" ? parseOptionalNumber(formData.get("closePercent")) : null;
  const financials = calculateActionFinancials(operation, action, price, closePercent);
  if (pointsInput) pointsInput.value = formatNumberInput(financials.points);
  if (lotInput) lotInput.value = Number.isFinite(financials.lotSize) ? formatLot(financials.lotSize) : "";
  if (amountInput) amountInput.value = Number.isFinite(financials.amount) ? formatSignedMoney(financials.amount) : "";
}

function getActionValues(operation, action, formData) {
  if (action === "take") {
    const price = Number(operation.take_profit);
    const financials = calculateActionFinancials(operation, action, price, null);
    return {
      eventType: "closed",
      price,
      closePercent: null,
      ...financials,
    };
  }

  if (action === "stopped") {
    const price = Number(operation.stop_loss);
    const financials = calculateActionFinancials(operation, action, price, null);
    return {
      eventType: "stopped",
      price,
      closePercent: null,
      ...financials,
    };
  }

  if (action === "canceled") {
    const financials = calculateActionFinancials(operation, action, null, null);
    return {
      eventType: "canceled",
      price: null,
      points: null,
      closePercent: null,
      ...financials,
    };
  }

  const pairInfo = getPairInfo(operation.pair);
  const price = parsePriceInput(formData.get("price"), pairInfo);
  const closePercent = action === "partial" ? parseOptionalNumber(formData.get("closePercent")) : null;
  const financials = Number.isFinite(price)
    ? calculateActionFinancials(operation, action, price, closePercent)
    : { points: null, lotSize: null, remainingLotSize: getRemainingLotSize(operation), amount: null };

  return {
    eventType: action,
    price,
    closePercent,
    ...financials,
  };
}

function validateAction({ eventType, price, closePercent, lotSize, remainingLotSize, amount }) {
  const action = eventType;
  if (action === "canceled") {
    return { ok: true };
  }

  if (!Number.isFinite(price) || price <= 0) {
    return { ok: false, message: "Informe o preço da ação." };
  }

  if (
    action === "partial" &&
    (!Number.isFinite(closePercent) || closePercent <= 0 || closePercent >= 100)
  ) {
    return { ok: false, message: "Informe quanto será fechado na parcial." };
  }

  if (!Number.isFinite(lotSize) || lotSize <= 0) {
    return { ok: false, message: "Nao foi possivel calcular o lote desta acao." };
  }

  if (action === "partial" && (!Number.isFinite(remainingLotSize) || remainingLotSize < MIN_LOT_SIZE)) {
    return { ok: false, message: "Essa parcial fecharia a operacao inteira. Use Fechar." };
  }

  if (!Number.isFinite(amount)) {
    return { ok: false, message: "Nao foi possivel calcular o resultado em USD." };
  }

  return { ok: true };
}

async function createEvent({ operationId, type, price, points, closePercent, lotSize, remainingLotSize, amount, messageText }) {
  const { error } = await state.client.from("operation_events").insert({
    operation_id: operationId,
    type,
    price,
    points,
    close_percent: closePercent,
    lot_size: lotSize,
    remaining_lot_size: remainingLotSize,
    amount,
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
  const remainingLot = getRemainingLotSize(operation);
  const realizedAmount = Number(operation.result_amount || 0);
  const takeFinancials = calculateActionFinancials(operation, "take", Number(operation.take_profit), null);
  const stopFinancials = calculateActionFinancials(operation, "stopped", Number(operation.stop_loss), null);

  return renderOperationCardHtml({
    operation,
    sideLabel,
    statusLabel,
    stopPoints,
    takePoints,
    remainingLot,
    realizedAmount,
    takeFinancials,
    stopFinancials,
  });

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
          <strong>${formatPrice(operation.entry_price, operation.pair)}</strong>
        </div>
        <div class="metric">
          <span>Stop loss</span>
          <strong>${formatPrice(operation.stop_loss, operation.pair)} / ${formatSignedPoints(stopPoints)} pts</strong>
        </div>
        <div class="metric">
          <span>Take profit</span>
          <strong>${formatPrice(operation.take_profit, operation.pair)} / ${formatSignedPoints(takePoints)} pts</strong>
        </div>
        <div class="metric">
          <span>Lote aberto</span>
          <strong>${formatLot(remainingLot)} / ${formatLot(operation.lot_size)}</strong>
        </div>
        <div class="metric">
          <span>Risco</span>
          <strong>${formatPercent(operation.risk_percent)} / ${formatMoney(operation.risk_amount)}</strong>
        </div>
        <div class="metric">
          <span>1 pip</span>
          <strong>${formatMoney(operation.pip_value_account)}</strong>
        </div>
        <div class="metric">
          <span>Realizado</span>
          <strong class="${realizedAmount >= 0 ? "gain-text" : "loss-text"}">${formatSignedMoney(realizedAmount)}</strong>
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

function renderOperationCardHtml({
  operation,
  sideLabel,
  statusLabel,
  stopPoints,
  takePoints,
  remainingLot,
  realizedAmount,
  takeFinancials,
  stopFinancials,
}) {
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
      <p class="operation-number">Operacao n: ${formatOperationNumber(operation)}</p>
      <div class="meta-grid">
        <div class="metric">
          <span>Entrada</span>
          <strong>${formatPrice(operation.entry_price, operation.pair)}</strong>
        </div>
        <div class="metric">
          <span>Stop loss</span>
          <strong>${formatPrice(operation.stop_loss, operation.pair)} / ${formatSignedPoints(stopPoints)} pts</strong>
        </div>
        <div class="metric">
          <span>Take profit</span>
          <strong>${formatPrice(operation.take_profit, operation.pair)} / ${formatSignedPoints(takePoints)} pts</strong>
        </div>
        <div class="metric">
          <span>Lote aberto</span>
          <strong>${formatLot(remainingLot)} / ${formatLot(operation.lot_size)}</strong>
        </div>
        <div class="metric">
          <span>Risco</span>
          <strong>${formatPercent(operation.risk_percent)} / ${formatMoney(operation.risk_amount)}</strong>
        </div>
        <div class="metric">
          <span>1 pip</span>
          <strong>${formatMoney(operation.pip_value_account)}</strong>
        </div>
        <div class="metric">
          <span>Realizado</span>
          <strong class="${realizedAmount >= 0 ? "gain-text" : "loss-text"}">${formatSignedMoney(realizedAmount)}</strong>
        </div>
        <div class="metric">
          <span>Status</span>
          <strong>${statusLabel}</strong>
        </div>
      </div>
      <div class="action-grid">
        <form data-operation-action="partial" data-operation-id="${operation.id}">
          <input name="price" type="text" inputmode="decimal" placeholder="Preco parcial" required />
          <input name="closePercent" type="number" step="1" min="1" max="99" placeholder="% fechar" required />
          <input name="lotSize" type="text" placeholder="Lote" readonly />
          <input name="amount" type="text" placeholder="USD" readonly />
          <input name="points" type="text" placeholder="Pontos" readonly />
          <button class="secondary" type="submit">Parcial</button>
        </form>
        <form data-operation-action="closed" data-operation-id="${operation.id}">
          <input name="price" type="text" inputmode="decimal" placeholder="Preco final" required />
          <input name="lotSize" type="text" value="${formatLot(remainingLot)}" readonly />
          <input name="amount" type="text" placeholder="USD" readonly />
          <input name="points" type="text" placeholder="Pontos" readonly />
          <button type="submit">Fechar</button>
        </form>
        <form class="quick-action-form" data-operation-action="take" data-operation-id="${operation.id}">
          <button class="gain-button" type="submit">Take profit ${formatSignedPoints(takePoints)} pts / ${formatSignedMoney(takeFinancials.amount)}</button>
        </form>
        <form data-operation-action="stopped" data-operation-id="${operation.id}">
          <button class="loss-button" type="submit">Stop loss ${formatSignedPoints(stopPoints)} pts / ${formatSignedMoney(stopFinancials.amount)}</button>
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
  const totalAmount = closedOperations.reduce(
    (sum, operation) => sum + Number(operation.result_amount || 0),
    0,
  );
  const wins = closedOperations.filter((operation) => Number(operation.result_points || 0) > 0).length;
  const losses = closedOperations.filter((operation) => Number(operation.result_points || 0) < 0).length;
  const winRate = closed ? Math.round((wins / closed) * 100) : 0;

  els.statClosed.textContent = closed;
  els.statPoints.textContent = formatPoints(totalPoints);
  els.statAmount.textContent = formatSignedMoney(totalAmount);
  els.statWins.textContent = wins;
  els.statLosses.textContent = losses;
  els.statWinRate.textContent = `${winRate}%`;
  els.statPoints.className = totalPoints >= 0 ? "gain-text" : "loss-text";
  els.statAmount.className = totalAmount >= 0 ? "gain-text" : "loss-text";

  if (!closedOperations.length) {
    els.closedOperations.innerHTML = `
      <tr>
        <td colspan="9">Nenhuma operação fechada neste mês.</td>
      </tr>
    `;
    return;
  }

  els.closedOperations.innerHTML = closedOperations
    .map((operation) => {
      const result = Number(operation.result_points || 0);
      const amount = Number(operation.result_amount || 0);
      const resultClass = result >= 0 ? "gain-text" : "loss-text";
      const amountClass = amount >= 0 ? "gain-text" : "loss-text";
      return `
        <tr>
          <td>${formatOperationNumber(operation)}</td>
          <td>${escapeHtml(operation.pair)}</td>
          <td>${operation.side === "buy" ? "Compra" : "Venda"}</td>
          <td>${formatPrice(operation.entry_price, operation.pair)}</td>
          <td>${formatLot(operation.lot_size)}</td>
          <td>${formatPrice(operation.close_price, operation.pair)}</td>
          <td class="${resultClass}">${formatSignedPoints(result)} pts</td>
          <td class="${amountClass}">${formatSignedMoney(amount)}</td>
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
  const pairInfo = getPairInfo(els.pair.value);
  const conversion = getConversionInfo(pairInfo, els.conversionRate.value);
  const entryPrice = parsePriceInput(els.entryPrice.value, pairInfo);
  const stopLoss = parsePriceInput(els.stopLoss.value, pairInfo);
  const takeProfit = parsePriceInput(els.takeProfit.value, pairInfo);
  const riskPercent = parseOptionalNumber(els.riskPercent.value);
  const plan = calculateTradePlan({
    pairInfo,
    side: els.side.value,
    entryPrice,
    stopLoss,
    takeProfit,
    riskPercent,
    conversion,
  });

  return {
    pair: pairInfo.pair,
    side: els.side.value,
    entry_price: entryPrice,
    stop_loss: stopLoss,
    take_profit: takeProfit,
    point_size: pairInfo.pipSize,
    base_currency: pairInfo.baseCurrency,
    quote_currency: pairInfo.quoteCurrency,
    account_currency: ACCOUNT_CURRENCY,
    account_balance: ACCOUNT_BALANCE,
    risk_percent: riskPercent,
    risk_amount: plan.riskAmount,
    lot_size: plan.lotSize,
    position_units: plan.positionUnits,
    remaining_lot_size: plan.lotSize,
    closed_lot_size: 0,
    pip_value_quote: plan.pipValueQuote,
    pip_value_account: plan.pipValueAccount,
    conversion_pair: conversion.conversionPair,
    conversion_rate: conversion.conversionRate,
    conversion_type: conversion.conversionType,
    price_digits: pairInfo.priceDigits,
    notes: els.notes.value.trim() || null,
  };
}

function updateOperationPreview() {
  const pairInfo = getPairInfo(els.pair.value);
  updateConversionField(pairInfo);
  const pair = pairInfo.pair;
  if (!pair) {
    els.operationPreview.textContent = "Pronta para envio";
    els.operationPreview.className = "tag neutral";
    els.riskPreview.innerHTML = "";
    return;
  }

  els.operationPreview.textContent = `${els.side.value === "buy" ? "Compra" : "Venda"} - ${pair}`;
  els.operationPreview.className = pairInfo.isValid ? "tag open" : "tag loss";

  const entryPrice = parsePriceInput(els.entryPrice.value, pairInfo);
  const stopLoss = parsePriceInput(els.stopLoss.value, pairInfo);
  const takeProfit = parsePriceInput(els.takeProfit.value, pairInfo);
  const riskPercent = parseOptionalNumber(els.riskPercent.value);
  const conversion = getConversionInfo(pairInfo, els.conversionRate.value);

  if (
    !pairInfo.isValid ||
    !Number.isFinite(entryPrice) ||
    !Number.isFinite(stopLoss) ||
    !Number.isFinite(takeProfit) ||
    !Number.isFinite(riskPercent) ||
    (conversion.needsConversion && !Number.isFinite(conversion.conversionRate))
  ) {
    els.riskPreview.innerHTML = "";
    return;
  }

  const plan = calculateTradePlan({
    pairInfo,
    side: els.side.value,
    entryPrice,
    stopLoss,
    takeProfit,
    riskPercent,
    conversion,
  });

  renderRiskPreview(plan);
}

function updateConversionField(pairInfo) {
  const conversion = getConversionInfo(pairInfo, els.conversionRate.value);
  els.conversionRateField.hidden = !conversion.needsConversion;

  if (!conversion.needsConversion) {
    els.conversionHint.textContent = "";
    els.conversionRate.value = "";
    return;
  }

  els.conversionHint.textContent = conversion.conversionPair
    ? `${conversion.conversionPair} (${conversion.conversionType === "direct" ? "multiplica" : "divide"})`
    : "";
}

function renderRiskPreview(plan) {
  if (!plan || !Number.isFinite(plan.lotSize)) {
    els.riskPreview.innerHTML = "";
    return;
  }

  els.riskPreview.innerHTML = [
    renderPreviewMetric("Banca", formatMoney(plan.accountBalance)),
    renderPreviewMetric("Risco", `${formatPercent(plan.riskPercent)} / ${formatMoney(plan.riskAmount)}`),
    renderPreviewMetric("Stop", `${formatPoints(Math.abs(plan.stopPoints))} pips`),
    renderPreviewMetric("Lote", formatLot(plan.lotSize)),
    renderPreviewMetric("1 pip", formatMoney(plan.pipValueAccount)),
    renderPreviewMetric("Risco efetivo", formatMoney(plan.effectiveRiskAmount)),
  ].join("");
}

function renderPreviewMetric(label, value) {
  return `
    <div class="metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function validatePlannedOperation(operation) {
  const pairInfo = getPairInfo(operation.pair);

  if (!pairInfo.isValid) {
    return { ok: false, message: "Informe o par da operação." };
  }

  for (const field of ["entry_price", "stop_loss", "take_profit"]) {
    if (!Number.isFinite(operation[field]) || operation[field] <= 0) {
      return { ok: false, message: "Revise os preços da operação." };
    }
  }

  if (!Number.isFinite(operation.risk_percent) || operation.risk_percent <= 0) {
    return { ok: false, message: "Informe o risco da conta." };
  }

  if (
    operation.quote_currency !== ACCOUNT_CURRENCY &&
    (!Number.isFinite(operation.conversion_rate) || operation.conversion_rate <= 0)
  ) {
    return { ok: false, message: `Informe a cotacao ${operation.conversion_pair} para converter para USD.` };
  }

  if (!Number.isFinite(operation.lot_size) || operation.lot_size < MIN_LOT_SIZE) {
    return { ok: false, message: "Nao foi possivel calcular o lote da operacao." };
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
    `Preço de entrada: ${formatMessagePrice(operation.entry_price, operation.pair)}`,
    `Stop Loss: ${formatMessagePrice(operation.stop_loss, operation.pair)}`,
    `Take Profit: ${formatMessagePrice(operation.take_profit, operation.pair)}`,
    "",
    `Risco: ${formatMessagePercent(operation.risk_percent)} (${formatMessageMoney(operation.risk_amount)})`,
    `Lote sugerido: ${formatMessageLot(operation.lot_size)}`,
    `Valor de 1 pip: ${formatMessageMoney(operation.pip_value_account)}`,
  ].join("\n");
}

function buildActionMessage(operation, action, price, points, closePercent, lotSize, remainingLotSize, amount) {
  if (action === "partial") {
    return [
      `Operação n°: ${formatOperationNumber(operation)}`,
      "*PARCIAL*",
      "",
      `Preço da Parcial: ${formatMessagePrice(price, operation.pair)}`,
      `Fechar ${formatMessagePercent(closePercent)}`,
      `Lote fechado: ${formatMessageLot(lotSize)}`,
      `Lote restante: ${formatMessageLot(remainingLotSize)}`,
      `Pontos da parcial: ${formatMessageSignedPoints(points)} pts`,
      `Resultado parcial: ${formatMessageSignedMoney(amount)}`,
    ].join("\n");
  }

  if (action === "closed") {
    return [
      `Operação n°: ${formatOperationNumber(operation)}`,
      "*FECHADA*",
      "",
      `Preço de fechamento: ${formatMessagePrice(price, operation.pair)}`,
      `Lote encerrado: ${formatMessageLot(lotSize)}`,
      `Lote restante: ${formatMessageLot(remainingLotSize)}`,
      `Lote encerrado: ${formatMessageLot(lotSize)}`,
      `Lote restante: ${formatMessageLot(remainingLotSize)}`,
      `Lote encerrado: ${formatMessageLot(lotSize)}`,
      `Lote restante: ${formatMessageLot(remainingLotSize)}`,
      `Resultado: ${formatMessageSignedPoints(points)} pts`,
      `Financeiro: ${formatMessageSignedMoney(amount)}`,
      `Financeiro: ${formatMessageSignedMoney(amount)}`,
      `Financeiro: ${formatMessageSignedMoney(amount)}`,
    ].join("\n");
  }

  if (action === "take") {
    return [
      `Operação n°: ${formatOperationNumber(operation)}`,
      "*TAKE PROFIT*",
      "",
      `Preço do take: ${formatMessagePrice(price, operation.pair)}`,
      `Resultado: ${formatMessageSignedPoints(points)} pts`,
    ].join("\n");
  }

  if (action === "stopped") {
    return [
      `Operação n°: ${formatOperationNumber(operation)}`,
      "*STOP LOSS*",
      "",
      `Preço do stop: ${formatMessagePrice(price, operation.pair)}`,
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
  return String(value || "")
    .trim()
    .replace(/[\s/_-]+/g, "")
    .toUpperCase();
}

function inferPointSize(pair) {
  return getPairInfo(pair).pipSize;
}

function getPairInfo(value) {
  const pair = normalizePair(value);
  const isValid = /^[A-Z]{6}$/.test(pair);
  const baseCurrency = isValid ? pair.slice(0, 3) : "";
  const quoteCurrency = isValid ? pair.slice(3, 6) : "";
  const isJpy = quoteCurrency === "JPY";

  return {
    pair,
    isValid,
    baseCurrency,
    quoteCurrency,
    isJpy,
    pipSize: isJpy ? 0.01 : 0.0001,
    priceDigits: isJpy ? 3 : 5,
  };
}

function getConversionInfo(pairInfo, rateValue = null) {
  if (!pairInfo?.isValid || pairInfo.quoteCurrency === ACCOUNT_CURRENCY) {
    return {
      needsConversion: false,
      conversionPair: null,
      conversionType: "none",
      conversionRate: 1,
    };
  }

  const quote = pairInfo.quoteCurrency;
  const directQuotes = new Set(["EUR", "GBP", "AUD", "NZD"]);
  const conversionType = directQuotes.has(quote) ? "direct" : "inverse";
  const conversionPair =
    conversionType === "direct" ? `${quote}${ACCOUNT_CURRENCY}` : `${ACCOUNT_CURRENCY}${quote}`;

  return {
    needsConversion: true,
    conversionPair,
    conversionType,
    conversionRate: parseOptionalNumber(rateValue),
  };
}

function calculateTradePlan({ pairInfo, side, entryPrice, stopLoss, takeProfit, riskPercent, conversion }) {
  const stopPoints = calculateSignedPoints({
    side,
    entryPrice,
    exitPrice: stopLoss,
    pipSize: pairInfo.pipSize,
  });
  const takeProfitPoints = calculateSignedPoints({
    side,
    entryPrice,
    exitPrice: takeProfit,
    pipSize: pairInfo.pipSize,
  });
  const stopPips = Math.abs(stopPoints);
  const riskAmount = roundMoney(ACCOUNT_BALANCE * (Number(riskPercent) / 100));
  const pipValuePerLotQuote = STANDARD_LOT_UNITS * pairInfo.pipSize;
  const pipValuePerLotAccount = convertQuoteToAccount(pipValuePerLotQuote, conversion);
  const rawLotSize =
    stopPips > 0 && pipValuePerLotAccount > 0 ? riskAmount / (stopPips * pipValuePerLotAccount) : null;
  const lotSize = roundLotDown(rawLotSize);
  const positionUnits = roundUnits(lotSize * STANDARD_LOT_UNITS);
  const pipValueQuote = positionUnits * pairInfo.pipSize;
  const pipValueAccount = roundMoney(convertQuoteToAccount(pipValueQuote, conversion), 6);

  return {
    accountBalance: ACCOUNT_BALANCE,
    accountCurrency: ACCOUNT_CURRENCY,
    riskPercent: Number(riskPercent),
    riskAmount,
    stopPoints,
    takeProfitPoints,
    stopPips,
    lotSize,
    positionUnits,
    pipValueQuote: roundMoney(pipValueQuote, 6),
    pipValueAccount,
    effectiveRiskAmount: roundMoney(Math.abs(stopPoints) * pipValueAccount),
    takeProfitAmount: roundMoney(Math.abs(takeProfitPoints) * pipValueAccount),
  };
}

function convertQuoteToAccount(value, conversion) {
  if (!Number.isFinite(Number(value))) return null;
  if (!conversion?.needsConversion) return Number(value);
  const rate = Number(conversion.conversionRate);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return conversion.conversionType === "direct" ? Number(value) * rate : Number(value) / rate;
}

function calculateSignedPoints({ side, entryPrice, exitPrice, pipSize }) {
  const entry = Number(entryPrice);
  const exit = Number(exitPrice);
  const size = Number(pipSize);
  if (!Number.isFinite(entry) || !Number.isFinite(exit) || !Number.isFinite(size) || size <= 0) {
    return null;
  }

  const diff = side === "buy" ? exit - entry : entry - exit;
  return roundPoints(diff / size);
}

function calculateResultPoints(operation, price) {
  const entry = Number(operation.entry_price);
  const actionPrice = Number(price);
  const pointSize = Number(operation.point_size || inferPointSize(operation.pair));
  return calculateSignedPoints({
    side: operation.side,
    entryPrice: entry,
    exitPrice: actionPrice,
    pipSize: pointSize,
  });
}

function calculateActionFinancials(operation, action, price, closePercent) {
  if (action === "canceled") {
    return {
      points: null,
      lotSize: null,
      remainingLotSize: getRemainingLotSize(operation),
      amount: null,
    };
  }

  const points = calculateResultPoints(operation, price);
  const remainingLot = getRemainingLotSize(operation);
  const lotSize =
    action === "partial" ? calculatePartialLotSize(remainingLot, closePercent) : roundLot(remainingLot);
  const remainingLotSize =
    action === "partial" ? roundLot(Math.max(remainingLot - lotSize, 0)) : 0;
  const amount = calculateEventAmount(operation, points, lotSize);

  return {
    points,
    lotSize,
    remainingLotSize,
    amount,
  };
}

function calculatePartialLotSize(remainingLot, closePercent) {
  const percent = Number(closePercent);
  if (!Number.isFinite(remainingLot) || remainingLot <= 0 || !Number.isFinite(percent) || percent <= 0) {
    return null;
  }

  const rawLot = remainingLot * (percent / 100);
  const rounded = roundLotToStep(rawLot);
  return Math.min(Math.max(rounded, MIN_LOT_SIZE), roundLot(remainingLot));
}

function calculateEventAmount(operation, points, eventLotSize) {
  const numericPoints = Number(points);
  const eventLot = Number(eventLotSize);
  const operationLot = Number(operation.lot_size || eventLot);
  let pipValueAccount = Number(operation.pip_value_account);
  if (!Number.isFinite(pipValueAccount) || pipValueAccount <= 0) {
    pipValueAccount = estimateOperationPipValueAccount(operation, operationLot);
  }

  if (
    !Number.isFinite(numericPoints) ||
    !Number.isFinite(eventLot) ||
    eventLot <= 0 ||
    !Number.isFinite(operationLot) ||
    operationLot <= 0 ||
    !Number.isFinite(pipValueAccount)
  ) {
    return null;
  }

  return roundMoney(numericPoints * pipValueAccount * (eventLot / operationLot));
}

function estimateOperationPipValueAccount(operation, lotSize) {
  const pairInfo = getPairInfo(operation.pair);
  const operationLot = Number(lotSize);
  if (!pairInfo.isValid || !Number.isFinite(operationLot) || operationLot <= 0) return null;

  const pipValueQuote = operationLot * STANDARD_LOT_UNITS * pairInfo.pipSize;
  const needsConversion = pairInfo.quoteCurrency !== ACCOUNT_CURRENCY;
  const conversionRate = parseOptionalNumber(operation.conversion_rate);
  if (needsConversion && (!Number.isFinite(conversionRate) || conversionRate <= 0)) return null;

  const suggestedConversion = getConversionInfo(pairInfo, conversionRate);
  const conversion = {
    needsConversion,
    conversionType:
      operation.conversion_type && operation.conversion_type !== "none"
        ? operation.conversion_type
        : suggestedConversion.conversionType,
    conversionRate: needsConversion ? conversionRate : 1,
  };

  return roundMoney(convertQuoteToAccount(pipValueQuote, conversion), 6);
}

function getRemainingLotSize(operation) {
  const remaining = Number(operation.remaining_lot_size);
  if (Number.isFinite(remaining) && remaining >= 0) return roundLot(remaining);
  return roundLot(Number(operation.lot_size || 0));
}

function roundPoints(value) {
  if (!Number.isFinite(Number(value))) return null;
  return Math.round(Number(value) * 10) / 10;
}

function roundMoney(value, digits = 2) {
  if (!Number.isFinite(Number(value))) return null;
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function roundLot(value) {
  if (!Number.isFinite(Number(value))) return null;
  return Math.round(Number(value) * 100) / 100;
}

function roundLotToStep(value) {
  if (!Number.isFinite(Number(value))) return null;
  return roundLot(Math.round(Number(value) / LOT_STEP) * LOT_STEP);
}

function roundLotDown(value) {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) return null;
  const rounded = Math.floor((Number(value) + 1e-9) / LOT_STEP) * LOT_STEP;
  return roundLot(Math.max(rounded, MIN_LOT_SIZE));
}

function roundUnits(value) {
  if (!Number.isFinite(Number(value))) return null;
  return Math.round(Number(value));
}

function formatNumberInput(value) {
  if (!Number.isFinite(value)) return "";
  return String(roundPoints(value));
}

function parseOptionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = normalizeDecimalText(value);
  if (!normalized) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeDecimalText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(",", ".");
}

function normalizePriceText(value, pairInfo) {
  const text = String(value || "").trim().replace(/\s+/g, "");
  if (!text) return "";

  if (/[,.]/.test(text)) {
    return normalizeDecimalText(text);
  }

  if (!/^\d+$/.test(text)) {
    return normalizeDecimalText(text);
  }

  const digits = pairInfo?.priceDigits || 5;
  const padded = text.padStart(digits + 1, "0");
  const whole = padded.slice(0, -digits) || "0";
  const fraction = padded.slice(-digits);
  return `${Number(whole)}.${fraction}`;
}

function parsePriceInput(value, pairInfo) {
  const normalized = normalizePriceText(value, pairInfo);
  if (!normalized) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatPriceInput(value, pairInfo) {
  const price = Number(value);
  if (!Number.isFinite(price)) return "";
  return price.toFixed(pairInfo?.priceDigits || 5);
}

function formatOperationPriceFields() {
  for (const input of [els.entryPrice, els.stopLoss, els.takeProfit]) {
    formatOperationPriceField(input);
  }
}

function formatOperationPriceField(input) {
  if (!input || !input.value) return;

  if (input === els.conversionRate) {
    const conversionRate = parseOptionalNumber(input.value);
    if (Number.isFinite(conversionRate)) {
      input.value = formatMessageNumber(conversionRate, 8);
    }
    return;
  }

  const pairInfo = getPairInfo(els.pair.value);
  const price = parsePriceInput(input.value, pairInfo);
  if (Number.isFinite(price)) {
    input.value = formatPriceInput(price, pairInfo);
  }
}

function formatActionPriceField(input, operation) {
  if (!input || !operation || !input.value) return;
  const pairInfo = getPairInfo(operation.pair);
  const price = parsePriceInput(input.value, pairInfo);
  if (Number.isFinite(price)) {
    input.value = formatPriceInput(price, pairInfo);
  }
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

function formatPrice(value, pair = "") {
  if (value === null || value === undefined || value === "") return "-";
  const pairInfo = getPairInfo(pair);
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return pairInfo.isValid ? numeric.toFixed(pairInfo.priceDigits) : priceFormat.format(numeric);
}

function formatMessagePrice(value, pair = "") {
  if (value === null || value === undefined || value === "") return "-";
  const pairInfo = getPairInfo(pair);
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return pairInfo.isValid ? numeric.toFixed(pairInfo.priceDigits) : formatMessageNumber(numeric, 8);
}

function formatMessagePercent(value) {
  return `${formatMessageNumber(value, 2)}%`;
}

function formatMessageSignedPoints(value) {
  const numeric = Number(value || 0);
  return `${numeric > 0 ? "+" : ""}${formatMessageNumber(numeric, 1)}`;
}

function formatMessageMoney(value) {
  if (value === null || value === undefined || value === "") return "-";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return `${ACCOUNT_CURRENCY} ${numeric.toFixed(2)}`;
}

function formatMessageSignedMoney(value) {
  if (value === null || value === undefined || value === "") return "-";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return `${numeric > 0 ? "+" : ""}${formatMessageMoney(numeric)}`;
}

function formatMessageLot(value) {
  if (value === null || value === undefined || value === "") return "-";
  return lotFormat.format(Number(value || 0));
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
  return `${percentFormat.format(Number(value || 0))}%`;
}

function formatMoney(value) {
  if (value === null || value === undefined || value === "") return "-";
  return moneyFormat.format(Number(value || 0));
}

function formatSignedMoney(value) {
  if (value === null || value === undefined || value === "") return "-";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return `${numeric > 0 ? "+" : ""}${formatMoney(numeric)}`;
}

function formatLot(value) {
  if (value === null || value === undefined || value === "") return "-";
  return lotFormat.format(Number(value || 0));
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
