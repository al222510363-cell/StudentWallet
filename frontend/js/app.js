const navButtons = document.querySelectorAll('[data-view]');
const views = document.querySelectorAll('.view');
const pageTitle = document.getElementById('pageTitle');
const sidebar = document.getElementById('sidebar');
const toast = document.getElementById('toast');
let toastTimer;

const titles = {
  dashboard: 'Dashboard',
  transactions: 'Ingresos y gastos',
  assistant: 'Asistente Gemini AI',
  budgets: 'Presupuestos',
  goals: 'Metas de ahorro',
  achievements: 'Logros e insignias',
  profile: 'Perfil y ajustes'
};

const API_BASE = '/api';
const currencyFormatter = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  minimumFractionDigits: 2
});
const dateFormatter = new Intl.DateTimeFormat('es-MX', {
  day: '2-digit', month: 'short', year: 'numeric'
});
const categoryColors = {
  Alimentación: '#803bdf',
  Transporte: '#4f9ef1',
  Escuela: '#27bb81',
  Entretenimiento: '#ffa94d',
  Beca: '#8c71d8',
  Trabajo: '#16a6a1',
  Otros: '#c7c3d7'
};
const categoryIcons = {
  Alimentación: '🍽️', Transporte: '🚌', Escuela: '📚',
  Entretenimiento: '🎮', Beca: '🎓', Trabajo: '💼', Otros: '📌'
};

// -------------------------
// Historial de conversaciones de Gemini
// -------------------------
const ACTIVE_CHAT_STORAGE_KEY = 'studentwallet_active_conversation_id';
let activeConversationId = null;
let assistantLoadedConversationId = null;
let assistantConversations = [];

function readSavedConversationId() {
  try {
    return window.localStorage.getItem(ACTIVE_CHAT_STORAGE_KEY);
  } catch (_error) {
    return null;
  }
}

function setActiveConversationId(conversationId) {
  activeConversationId = conversationId ? String(conversationId) : null;
  try {
    if (activeConversationId) {
      window.localStorage.setItem(ACTIVE_CHAT_STORAGE_KEY, activeConversationId);
    } else {
      window.localStorage.removeItem(ACTIVE_CHAT_STORAGE_KEY);
    }
  } catch (_error) {
    // El historial sigue funcionando aunque el navegador bloquee localStorage.
  }
  renderAssistantConversationList();
}

function injectAssistantHistoryStyles() {
  if (document.getElementById('assistantHistoryStyles')) return;

  const style = document.createElement('style');
  style.id = 'assistantHistoryStyles';
  style.textContent = `
    .assistant-layout {
      display: grid !important;
      grid-template-columns: minmax(205px, 238px) minmax(0, 1fr) minmax(255px, 292px) !important;
      gap: 18px !important;
      align-items: start !important;
    }
    .assistant-history-panel {
      min-width: 0;
      padding: 18px;
      background: #fff;
      border: 1px solid #ebe7f3;
      border-radius: 18px;
      box-shadow: 0 8px 24px rgba(40, 25, 75, .045);
    }
    .assistant-history-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 8px;
    }
    .assistant-history-heading h3 {
      margin: 0;
      color: #29213b;
      font-size: 1rem;
    }
    .assistant-history-kicker {
      margin: 0 0 4px;
      color: #8a7ba7;
      font-size: .65rem;
      font-weight: 800;
      letter-spacing: .09em;
    }
    .assistant-history-new {
      flex: 0 0 auto;
      padding: 8px 10px;
      color: #fff;
      background: #7542c8;
      border: 0;
      border-radius: 10px;
      font: inherit;
      font-size: .75rem;
      font-weight: 700;
      cursor: pointer;
    }
    .assistant-history-new:hover { background: #6232b4; }
    .assistant-history-description {
      margin: 0 0 14px;
      color: #8a8496;
      font-size: .75rem;
      line-height: 1.45;
    }
    .assistant-history-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: 430px;
      overflow-y: auto;
      padding-right: 2px;
    }
    .assistant-history-empty {
      margin: 0;
      padding: 16px 10px;
      color: #898295;
      background: #faf9fc;
      border: 1px dashed #e5deef;
      border-radius: 12px;
      font-size: .78rem;
      line-height: 1.5;
      text-align: center;
    }
    .assistant-history-item {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 32px;
      align-items: stretch;
      gap: 4px;
      padding: 4px;
      border: 1px solid transparent;
      border-radius: 12px;
      background: #faf9fc;
    }
    .assistant-history-item.is-active {
      background: #f3edff;
      border-color: #d9c8fa;
    }
    .assistant-history-open {
      min-width: 0;
      padding: 8px;
      color: #332b42;
      background: transparent;
      border: 0;
      border-radius: 8px;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .assistant-history-open:hover { background: rgba(117, 66, 200, .07); }
    .assistant-history-title {
      display: block;
      overflow: hidden;
      color: #352b48;
      font-size: .78rem;
      font-weight: 700;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .assistant-history-meta {
      display: block;
      margin-top: 5px;
      color: #91899d;
      font-size: .67rem;
    }
    .assistant-history-delete {
      align-self: center;
      width: 30px;
      height: 30px;
      color: #9b91a8;
      background: transparent;
      border: 0;
      border-radius: 8px;
      font-size: 1.1rem;
      cursor: pointer;
    }
    .assistant-history-delete:hover {
      color: #bd3f68;
      background: #fff0f4;
    }
    .assistant-history-footer {
      margin: 13px 0 0;
      padding-top: 12px;
      color: #9690a0;
      border-top: 1px solid #f0edf4;
      font-size: .68rem;
      line-height: 1.45;
    }
    /* Formato seguro para las respuestas Markdown de Gemini */
    .chat-message-bubble.markdown-rendered {
      white-space: normal;
    }
    .chat-message-bubble.markdown-rendered p {
      margin: 0 0 10px;
    }
    .chat-message-bubble.markdown-rendered p:last-child {
      margin-bottom: 0;
    }
    .chat-message-bubble.markdown-rendered ol,
    .chat-message-bubble.markdown-rendered ul {
      margin: 7px 0 9px;
      padding-left: 1.35rem;
    }
    .chat-message-bubble.markdown-rendered li {
      margin: 4px 0;
      padding-left: 2px;
    }
    .chat-message-bubble.markdown-rendered strong {
      font-weight: 800;
    }
    .chat-message-bubble.markdown-rendered em {
      font-style: italic;
    }
    .chat-message-bubble.markdown-rendered code {
      padding: 1px 5px;
      border-radius: 5px;
      background: rgba(90, 65, 130, .09);
      font-family: Consolas, monospace;
      font-size: .94em;
    }
    .chat-message-bubble.markdown-rendered h3,
    .chat-message-bubble.markdown-rendered h4 {
      margin: 2px 0 8px;
      color: inherit;
      font-size: 1.04em;
      font-weight: 800;
    }
    @media (max-width: 1120px) {
      .assistant-layout {
        grid-template-columns: minmax(195px, 225px) minmax(0, 1fr) !important;
      }
      .assistant-context-column { grid-column: 2; }
    }
    @media (max-width: 760px) {
      .assistant-layout { grid-template-columns: minmax(0, 1fr) !important; }
      .assistant-history-panel { grid-row: auto; }
      .assistant-history-list { max-height: 250px; }
      .assistant-context-column { grid-column: auto; }
    }
  `;
  document.head.appendChild(style);
}

function ensureAssistantHistoryUI() {
  const assistantLayout = document.querySelector('.assistant-layout');
  const assistantChatPanel = assistantLayout?.querySelector('.assistant-chat-panel');
  if (!assistantLayout || !assistantChatPanel) return;

  injectAssistantHistoryStyles();
  if (document.getElementById('assistantHistoryPanel')) return;

  const panel = document.createElement('aside');
  panel.className = 'assistant-history-panel';
  panel.id = 'assistantHistoryPanel';
  panel.setAttribute('aria-label', 'Historial de conversaciones');
  panel.innerHTML = `
    <div class="assistant-history-heading">
      <div>
        <p class="assistant-history-kicker">GEMINI AI</p>
        <h3>Historial</h3>
      </div>
      <button class="assistant-history-new" id="assistantNewChat" type="button">＋ Nuevo</button>
    </div>
    <p class="assistant-history-description">Consulta tus chats anteriores o continúa una conversación.</p>
    <div class="assistant-history-list" id="assistantConversationList" aria-live="polite">
      <p class="assistant-history-empty">Cargando conversaciones...</p>
    </div>
    <p class="assistant-history-footer">Tus preguntas y respuestas se guardan en PostgreSQL.</p>
  `;
  assistantLayout.insertBefore(panel, assistantChatPanel);

  panel.querySelector('#assistantNewChat').addEventListener('click', startNewAssistantConversation);
  panel.querySelector('#assistantConversationList').addEventListener('click', async event => {
    const actionButton = event.target.closest('button[data-action]');
    if (!actionButton) return;

    const conversationId = actionButton.dataset.id;
    if (!conversationId) return;

    if (actionButton.dataset.action === 'open') {
      await openAssistantConversation(conversationId);
    } else if (actionButton.dataset.action === 'delete') {
      await deleteAssistantConversation(conversationId);
    }
  });
}

function formatConversationTimestamp(value) {
  if (!value) return 'Fecha no disponible';
  const parsedDate = new Date(value);
  return Number.isNaN(parsedDate.getTime()) ? 'Fecha no disponible' : dateFormatter.format(parsedDate);
}

function renderAssistantConversationList() {
  const list = document.getElementById('assistantConversationList');
  if (!list) return;

  list.replaceChildren();
  if (!assistantConversations.length) {
    const empty = document.createElement('p');
    empty.className = 'assistant-history-empty';
    empty.textContent = 'Todavía no tienes conversaciones. Pulsa “＋ Nuevo” para comenzar.';
    list.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  assistantConversations.forEach(conversation => {
    const id = String(conversation.id);
    const item = document.createElement('div');
    item.className = `assistant-history-item${id === activeConversationId ? ' is-active' : ''}`;

    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.className = 'assistant-history-open';
    openButton.dataset.action = 'open';
    openButton.dataset.id = id;
    openButton.setAttribute('aria-label', `Abrir conversación: ${conversation.title || 'Sin título'}`);

    const title = document.createElement('span');
    title.className = 'assistant-history-title';
    title.textContent = conversation.title || 'Nueva conversación';

    const meta = document.createElement('span');
    meta.className = 'assistant-history-meta';
    const count = Number(conversation.message_count) || 0;
    meta.textContent = `${count} ${count === 1 ? 'mensaje' : 'mensajes'} · ${formatConversationTimestamp(conversation.updated_at || conversation.created_at)}`;
    openButton.append(title, meta);

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'assistant-history-delete';
    deleteButton.dataset.action = 'delete';
    deleteButton.dataset.id = id;
    deleteButton.textContent = '×';
    deleteButton.title = 'Eliminar conversación';
    deleteButton.setAttribute('aria-label', `Eliminar conversación: ${conversation.title || 'Sin título'}`);

    item.append(openButton, deleteButton);
    fragment.appendChild(item);
  });
  list.appendChild(fragment);
}

async function loadAssistantConversations({ quiet = false } = {}) {
  ensureAssistantHistoryUI();
  const list = document.getElementById('assistantConversationList');
  if (list && !assistantConversations.length) {
    const loading = document.createElement('p');
    loading.className = 'assistant-history-empty';
    loading.textContent = 'Cargando conversaciones...';
    list.replaceChildren(loading);
  }

  try {
    const result = await apiRequest('/assistant/conversations');
    assistantConversations = Array.isArray(result) ? result : [];
    renderAssistantConversationList();
    return assistantConversations;
  } catch (error) {
    console.error('No se pudo cargar el historial de Gemini:', error);
    if (list) {
      const message = document.createElement('p');
      message.className = 'assistant-history-empty';
      message.textContent = 'No fue posible cargar el historial. Comprueba que el backend esté activo.';
      list.replaceChildren(message);
    }
    if (!quiet) showToast(`No se pudo cargar el historial: ${error.message}`);
    return [];
  }
}

async function openAssistantConversation(conversationId, { quiet = false } = {}) {
  const cleanId = String(conversationId);
  try {
    const conversation = await apiRequest(`/assistant/conversations/${encodeURIComponent(cleanId)}`);
    if (!conversation || !Array.isArray(conversation.messages)) {
      throw new Error('La API no devolvió los mensajes de esta conversación.');
    }

    setActiveConversationId(conversation.id);
    const messagesContainer = document.getElementById('assistantMessages');
    messagesContainer.replaceChildren();
    conversation.messages.forEach(message => {
      appendChatMessage(messagesContainer, message.role, message.content || '');
    });
    assistantLoadedConversationId = String(conversation.id);

    const status = document.getElementById('assistantStatus');
    if (status) status.textContent = `Conversación recuperada: ${conversation.title || 'Sin título'}. Puedes continuar con Gemini.`;
    const connectionStatus = document.getElementById('assistantConnectionStatus');
    if (connectionStatus) connectionStatus.innerHTML = '<i></i> Conversación recuperada';
    renderAssistantConversationList();
    if (!quiet) showToast('Conversación recuperada correctamente.');
  } catch (error) {
    console.error('No se pudo abrir la conversación:', error);
    if (!quiet) showToast(`No se pudo abrir la conversación: ${error.message}`);
    throw error;
  }
}

function startNewAssistantConversation() {
  setActiveConversationId(null);
  assistantLoadedConversationId = null;
  const messagesContainer = document.getElementById('assistantMessages');
  if (messagesContainer) {
    messagesContainer.replaceChildren();
    appendChatMessage(
      messagesContainer,
      'assistant',
      '¡Hola! Soy StudentWallet AI. Comencemos una nueva conversación. ¿Qué te gustaría consultar sobre tus finanzas?'
    );
  }
  const status = document.getElementById('assistantStatus');
  if (status) status.textContent = 'Nueva conversación. Tu historial se guardará al enviar el primer mensaje.';
  const connectionStatus = document.getElementById('assistantConnectionStatus');
  if (connectionStatus) connectionStatus.innerHTML = '<i></i> Nueva conversación';
  renderAssistantConversationList();
  showToast('Nueva conversación lista.');
  document.getElementById('assistantChatInput')?.focus();
}

async function deleteAssistantConversation(conversationId) {
  const conversation = assistantConversations.find(item => String(item.id) === String(conversationId));
  const title = conversation?.title || 'esta conversación';
  if (!window.confirm(`¿Deseas eliminar “${title}”? Esta acción no se puede deshacer.`)) return;

  try {
    await apiRequest(`/assistant/conversations/${encodeURIComponent(conversationId)}`, { method: 'DELETE' });
    if (String(activeConversationId) === String(conversationId)) {
      startNewAssistantConversation();
    }
    await loadAssistantConversations({ quiet: true });
    showToast('Conversación eliminada.');
  } catch (error) {
    console.error('No se pudo eliminar la conversación:', error);
    showToast(`No se pudo eliminar: ${error.message}`);
  }
}

async function initializeAssistantHistory() {
  ensureAssistantHistoryUI();
  const savedId = readSavedConversationId();
  activeConversationId = savedId || null;
  await loadAssistantConversations({ quiet: true });

  if (activeConversationId) {
    try {
      await openAssistantConversation(activeConversationId, { quiet: true });
    } catch (_error) {
      setActiveConversationId(null);
      assistantLoadedConversationId = null;
    }
  }
}

async function syncAssistantHistoryOnOpen() {
  ensureAssistantHistoryUI();
  await loadAssistantConversations({ quiet: true });
  if (activeConversationId && assistantLoadedConversationId !== String(activeConversationId)) {
    try {
      await openAssistantConversation(activeConversationId, { quiet: true });
    } catch (_error) {
      setActiveConversationId(null);
    }
  }
}


// Los movimientos ahora se consultan en la API REST y PostgreSQL.
let transactions = [];

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    let detail = `Error HTTP ${response.status}`;
    try {
      const body = await response.json();
      if (typeof body.detail === 'string') detail = body.detail;
      else if (Array.isArray(body.detail)) {
        detail = body.detail.map(item => item.msg || 'Dato inválido').join('; ');
      }
    } catch (_error) {
      // Conserva el mensaje HTTP cuando la respuesta no contiene JSON.
    }
    throw new Error(detail);
  }

  if (response.status === 204) return null;
  return response.json();
}

async function refreshTransactions(showMessage = false) {
  try {
    transactions = await apiRequest('/transactions');
    renderAll();
    return true;
  } catch (error) {
    console.error('No se pudieron cargar los movimientos desde la API:', error);
    transactions = [];
    renderAll();
    if (showMessage) {
      showToast(`No se pudo conectar con StudentWallet API: ${error.message}`);
    }
    return false;
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 3200);
}

function navigate(viewName) {
  views.forEach(view => view.classList.toggle('active-view', view.id === `view-${viewName}`));
  navButtons.forEach(button => button.classList.toggle('active', button.dataset.view === viewName));
  pageTitle.textContent = titles[viewName] || 'StudentWallet';
  sidebar.classList.remove('open');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (viewName === 'assistant') void syncAssistantHistoryOnOpen();
  if (viewName === 'budgets') void loadBudgets();
  if (viewName === 'goals') void loadSavingsGoals();
  if (viewName === 'achievements') void loadAchievements();
}

function formatMoney(amount) {
  return currencyFormatter.format(Number(amount) || 0);
}

function formatDate(dateString) {
  if (!dateString) return 'Sin fecha';
  const date = new Date(`${dateString}T12:00:00`);
  return Number.isNaN(date.getTime()) ? 'Fecha inválida' : dateFormatter.format(date);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function getTotals(items) {
  return items.reduce((totals, transaction) => {
    if (transaction.type === 'income') totals.income += Number(transaction.amount) || 0;
    else totals.expense += Number(transaction.amount) || 0;
    return totals;
  }, { income: 0, expense: 0 });
}

function getFilteredTransactions() {
  const search = document.getElementById('transactionSearch').value.trim().toLowerCase();
  const type = document.getElementById('transactionTypeFilter').value;
  const category = document.getElementById('transactionCategoryFilter').value;

  return [...transactions]
    .filter(item => {
      const matchesSearch = !search || `${item.description} ${item.category} ${item.note || ''}`.toLowerCase().includes(search);
      const matchesType = type === 'all' || item.type === type;
      const matchesCategory = category === 'all' || item.category === category;
      return matchesSearch && matchesType && matchesCategory;
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

function renderTransactionsTable() {
  const tbody = document.getElementById('transactionsTableBody');
  const emptyState = document.getElementById('transactionsEmpty');
  const filtered = getFilteredTransactions();

  document.getElementById('transactionCount').textContent = `${transactions.length} ${transactions.length === 1 ? 'movimiento registrado' : 'movimientos registrados'}`;
  document.getElementById('transactionResults').textContent = `Mostrando ${filtered.length} de ${transactions.length} movimientos`;
  emptyState.hidden = filtered.length > 0;

  tbody.innerHTML = filtered.map(item => {
    const isIncome = item.type === 'income';
    const icon = categoryIcons[item.category] || categoryIcons.Otros;
    const amountClass = isIncome ? 'positive-text' : 'negative-text';
    const amountPrefix = isIncome ? '+' : '−';
    return `
      <tr>
        <td><div class="table-description"><span class="table-category-icon">${icon}</span><div><strong>${escapeHtml(item.description)}</strong><small>${escapeHtml(item.note || 'Sin nota adicional')}</small></div></div></td>
        <td><span class="category-chip">${escapeHtml(item.category)}</span></td>
        <td class="date-cell">${formatDate(item.date)}</td>
        <td><span class="type-chip ${isIncome ? 'type-income' : 'type-expense'}">${isIncome ? '↓ Ingreso' : '↑ Gasto'}</span></td>
        <td class="align-right"><strong class="table-amount ${amountClass}">${amountPrefix}${formatMoney(item.amount)}</strong></td>
        <td class="align-right"><div class="row-actions"><button type="button" class="row-action edit-action" data-action="edit" data-id="${escapeHtml(item.id)}" aria-label="Editar ${escapeHtml(item.description)}" title="Editar">✎</button><button type="button" class="row-action delete-action" data-action="delete" data-id="${escapeHtml(item.id)}" aria-label="Eliminar ${escapeHtml(item.description)}" title="Eliminar">⌫</button></div></td>
      </tr>`;
  }).join('');
}

function renderTransactionStats() {
  const totals = getTotals(transactions);
  const balance = totals.income - totals.expense;
  document.getElementById('transactionsIncomeTotal').textContent = formatMoney(totals.income);
  document.getElementById('transactionsExpenseTotal').textContent = formatMoney(totals.expense);
  document.getElementById('transactionsBalanceTotal').textContent = formatMoney(balance);
  document.getElementById('transactionsBalanceTotal').classList.toggle('negative-text', balance < 0);
  document.getElementById('transactionsBalanceTotal').classList.toggle('positive-text', balance >= 0);
}

function getDashboardMonthKey() {
  const selector = document.getElementById('monthSelect');
  if (selector?.value) return selector.value;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function initializeDashboardMonthSelector() {
  const selector = document.getElementById('monthSelect');
  if (!selector) return;
  const now = new Date();
  const options = [];
  for (let offset = 0; offset < 6; offset += 1) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const value = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;
    const label = new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric' }).format(monthDate);
    options.push(`<option value="${value}">${escapeHtml(label.charAt(0).toUpperCase() + label.slice(1))}</option>`);
  }
  selector.innerHTML = options.join('');
  selector.value = getDashboardMonthKey();
}

function getDashboardSixMonths(referenceMonth) {
  const [year, month] = referenceMonth.split('-').map(Number);
  return Array.from({ length: 6 }, (_, index) => {
    const d = new Date(year, month - 1 - (5 - index), 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = new Intl.DateTimeFormat('es-MX', { month: 'short' }).format(d).replace('.', '');
    return { key, label: label.charAt(0).toUpperCase() + label.slice(1), income: 0, expense: 0 };
  });
}

function renderDashboardMonthlyChart(referenceMonth) {
  const months = getDashboardSixMonths(referenceMonth);
  const byMonth = new Map(months.map(month => [month.key, month]));
  transactions.forEach(item => {
    const key = String(item.date || '').slice(0, 7);
    const bucket = byMonth.get(key);
    if (!bucket) return;
    const amount = Number(item.amount) || 0;
    if (item.type === 'income') bucket.income += amount;
    else if (item.type === 'expense') bucket.expense += amount;
  });

  const chartMaximum = Math.max(100, ...months.map(item => Math.max(item.income, item.expense)));
  const step = chartMaximum <= 500 ? 100 : chartMaximum <= 2500 ? 500 : 1000;
  const axisMaximum = Math.ceil(chartMaximum / step) * step;
  const axis = document.getElementById('dashboardChartAxis');
  const groups = document.getElementById('dashboardBarGroups');
  if (!axis || !groups) return;

  axis.innerHTML = Array.from({ length: 6 }, (_, index) => {
    const value = Math.round(axisMaximum - (axisMaximum / 5) * index);
    return `<span>${formatMoney(value).replace('.00', '')}</span>`;
  }).join('');
  groups.innerHTML = months.map(item => {
    const incomeHeight = axisMaximum ? item.income / axisMaximum * 100 : 0;
    const expenseHeight = axisMaximum ? item.expense / axisMaximum * 100 : 0;
    return `<div class="bar-group" title="${escapeHtml(item.label)} · Ingresos: ${formatMoney(item.income)} · Gastos: ${formatMoney(item.expense)}"><b style="height:${incomeHeight.toFixed(2)}%"></b><i style="height:${expenseHeight.toFixed(2)}%"></i><small>${escapeHtml(item.label)}</small></div>`;
  }).join('');
  const chart = document.getElementById('dashboardMonthlyChart');
  if (chart) chart.setAttribute('aria-label', `Ingresos y gastos reales de los seis meses hasta ${referenceMonth}.`);
}

function renderDashboard() {
  const selectedMonth = getDashboardMonthKey();
  const monthTransactions = transactions.filter(item => String(item.date || '').startsWith(`${selectedMonth}-`));
  const totals = getTotals(monthTransactions);
  const balance = totals.income - totals.expense;
  document.getElementById('balanceValue').textContent = formatMoney(balance);
  document.getElementById('incomeValue').textContent = formatMoney(totals.income);
  document.getElementById('expenseValue').textContent = formatMoney(totals.expense);

  const recent = [...monthTransactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
  document.getElementById('recentTransactions').innerHTML = recent.map(item => {
    const isIncome = item.type === 'income';
    return `<div class="transaction-row"><span class="transaction-symbol ${isIncome ? 'positive' : 'negative'}">${isIncome ? '↓' : '↑'}</span><div class="transaction-info"><strong>${escapeHtml(item.description)}</strong><small>${isIncome ? 'Ingreso' : 'Gasto'} · ${formatDate(item.date)}</small></div><b class="amount ${isIncome ? 'positive-text' : 'negative-text'}">${isIncome ? '+' : '−'}${formatMoney(item.amount)}</b></div>`;
  }).join('') || '<p class="no-recent-transactions">No hay movimientos registrados en este mes.</p>';

  const expenseByCategory = monthTransactions
    .filter(item => item.type === 'expense')
    .reduce((result, item) => {
      result[item.category] = (result[item.category] || 0) + Number(item.amount || 0);
      return result;
    }, {});
  const categoryEntries = Object.entries(expenseByCategory).sort((a, b) => b[1] - a[1]);
  const categoryTotal = categoryEntries.reduce((sum, entry) => sum + entry[1], 0);
  document.getElementById('categoryTotal').textContent = formatMoney(categoryTotal);

  let cumulative = 0;
  const segments = categoryEntries.map(([category, amount]) => {
    const start = cumulative;
    cumulative += categoryTotal ? amount / categoryTotal * 100 : 0;
    return `${categoryColors[category] || categoryColors.Otros} ${start}% ${cumulative}%`;
  });
  const donut = document.querySelector('.donut');
  donut.style.background = segments.length ? `conic-gradient(${segments.join(', ')})` : '#e8e5ef';
  document.getElementById('categoryLegend').innerHTML = categoryEntries.length
    ? categoryEntries.slice(0, 5).map(([category, amount]) => {
      const percentage = categoryTotal ? Math.round(amount / categoryTotal * 100) : 0;
      return `<div><i style="background:${categoryColors[category] || categoryColors.Otros}"></i><span>${escapeHtml(category)}</span><b>${percentage}%</b></div>`;
    }).join('')
    : '<div class="category-empty">Sin gastos registrados</div>';

  renderDashboardMonthlyChart(selectedMonth);
}

function renderAll() {
  renderTransactionsTable();
  renderTransactionStats();
  renderDashboard();
}

const modal = document.getElementById('transactionModal');
const form = document.getElementById('transactionForm');

function openTransactionModal(transaction = null) {
  form.reset();
  document.getElementById('transactionId').value = transaction?.id || '';
  document.getElementById('transactionModalTitle').textContent = transaction ? 'Editar movimiento' : 'Nuevo movimiento';
  document.getElementById('saveTransactionButton').textContent = transaction ? 'Guardar cambios' : 'Guardar movimiento';
  document.getElementById('transactionDescription').value = transaction?.description || '';
  document.getElementById('transactionType').value = transaction?.type || 'expense';
  document.getElementById('transactionCategory').value = transaction?.category || 'Alimentación';
  document.getElementById('transactionAmount').value = transaction?.amount ?? '';
  document.getElementById('transactionDate').value = transaction?.date || new Date().toISOString().slice(0, 10);
  document.getElementById('transactionNote').value = transaction?.note || '';
  modal.hidden = false;
  document.body.classList.add('modal-open');
  window.setTimeout(() => document.getElementById('transactionDescription').focus(), 30);
}

function closeTransactionModal() {
  modal.hidden = true;
  document.body.classList.remove('modal-open');
  form.reset();
}

function createId() {
  return window.crypto?.randomUUID ? window.crypto.randomUUID() : `tx-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!form.reportValidity()) return;

  const id = document.getElementById('transactionId').value;
  const transaction = {
    description: document.getElementById('transactionDescription').value.trim(),
    type: document.getElementById('transactionType').value,
    category: document.getElementById('transactionCategory').value,
    amount: Number(document.getElementById('transactionAmount').value),
    date: document.getElementById('transactionDate').value,
    note: document.getElementById('transactionNote').value.trim()
  };

  if (!transaction.description || !Number.isFinite(transaction.amount) || transaction.amount <= 0) {
    showToast('Revisa la descripción y el importe del movimiento.');
    return;
  }

  const saveButton = document.getElementById('saveTransactionButton');
  const originalText = saveButton.textContent;
  saveButton.disabled = true;
  saveButton.textContent = 'Guardando...';

  try {
    if (id) {
      await apiRequest(`/transactions/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(transaction)
      });
    } else {
      await apiRequest('/transactions', {
        method: 'POST',
        body: JSON.stringify(transaction)
      });
    }

    closeTransactionModal();
    await refreshTransactions();
    await loadAchievements({ quiet: true });
    showToast(id ? 'Movimiento actualizado en PostgreSQL.' : 'Movimiento registrado en PostgreSQL.');
  } catch (error) {
    console.error('No se pudo guardar el movimiento:', error);
    showToast(`No se pudo guardar: ${error.message}`);
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = originalText;
  }
});

document.getElementById('addTransactionButton').addEventListener('click', () => openTransactionModal());
document.getElementById('closeTransactionModal').addEventListener('click', closeTransactionModal);
document.getElementById('cancelTransactionButton').addEventListener('click', closeTransactionModal);
modal.addEventListener('click', event => {
  if (event.target === modal) closeTransactionModal();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !modal.hidden) closeTransactionModal();
});

document.getElementById('transactionsTableBody').addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const transaction = transactions.find(item => String(item.id) === button.dataset.id);
  if (!transaction) return;

  if (button.dataset.action === 'edit') {
    openTransactionModal(transaction);
  } else if (button.dataset.action === 'delete') {
    const confirmed = window.confirm(`¿Deseas eliminar el movimiento "${transaction.description}"?`);
    if (!confirmed) return;

    button.disabled = true;
    try {
      await apiRequest(`/transactions/${encodeURIComponent(transaction.id)}`, { method: 'DELETE' });
      await refreshTransactions();
      await loadAchievements({ quiet: true });
      showToast('Movimiento eliminado de PostgreSQL.');
    } catch (error) {
      console.error('No se pudo eliminar el movimiento:', error);
      showToast(`No se pudo eliminar: ${error.message}`);
      button.disabled = false;
    }
  }
});

['transactionSearch', 'transactionTypeFilter', 'transactionCategoryFilter'].forEach(id => {
  const control = document.getElementById(id);
  control.addEventListener(id === 'transactionSearch' ? 'input' : 'change', renderTransactionsTable);
});

document.getElementById('clearTransactionFilters').addEventListener('click', () => {
  document.getElementById('transactionSearch').value = '';
  document.getElementById('transactionTypeFilter').value = 'all';
  document.getElementById('transactionCategoryFilter').value = 'all';
  renderTransactionsTable();
  showToast('Filtros restablecidos.');
});

navButtons.forEach(button => {
  button.addEventListener('click', () => navigate(button.dataset.view));
});

document.getElementById('mobileMenu').addEventListener('click', () => {
  sidebar.classList.toggle('open');
});

// Convierte un subconjunto seguro de Markdown a elementos DOM.
// No usa innerHTML: todo el contenido de Gemini se inserta como nodos de texto.
function appendInlineMarkdown(parent, text) {
  const source = String(text ?? '');
  const tokenPattern = /(\*\*[^*\n]+?\*\*|__[^_\n]+?__|`[^`\n]+`|\*[^*\n]+?\*|_[^_\n]+?_)/g;
  let cursor = 0;
  let match;

  while ((match = tokenPattern.exec(source)) !== null) {
    if (match.index > cursor) {
      parent.appendChild(document.createTextNode(source.slice(cursor, match.index)));
    }

    const token = match[0];
    let element;
    let value;

    if (token.startsWith('**') && token.endsWith('**')) {
      element = document.createElement('strong');
      value = token.slice(2, -2);
    } else if (token.startsWith('__') && token.endsWith('__')) {
      element = document.createElement('strong');
      value = token.slice(2, -2);
    } else if (token.startsWith('`') && token.endsWith('`')) {
      element = document.createElement('code');
      value = token.slice(1, -1);
    } else {
      element = document.createElement('em');
      value = token.slice(1, -1);
    }

    element.textContent = value;
    parent.appendChild(element);
    cursor = tokenPattern.lastIndex;
  }

  if (cursor < source.length) {
    parent.appendChild(document.createTextNode(source.slice(cursor)));
  }
}

function renderAssistantMarkdown(container, markdown) {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  let paragraphLines = [];
  let activeList = null;
  let activeListType = null;

  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    const paragraph = document.createElement('p');
    paragraphLines.forEach((line, index) => {
      if (index > 0) paragraph.appendChild(document.createElement('br'));
      appendInlineMarkdown(paragraph, line);
    });
    container.appendChild(paragraph);
    paragraphLines = [];
  };

  const flushList = () => {
    activeList = null;
    activeListType = null;
  };

  lines.forEach(rawLine => {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      return;
    }

    const headingMatch = line.match(/^#{1,3}\s+(.+?)\s*#*$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const heading = document.createElement(headingMatch[0].startsWith('# ') ? 'h3' : 'h4');
      appendInlineMarkdown(heading, headingMatch[1]);
      container.appendChild(heading);
      return;
    }

    const orderedMatch = line.match(/^\d+[.)]\s+(.+)$/);
    const unorderedMatch = line.match(/^[-*+]\s+(.+)$/);
    const listMatch = orderedMatch || unorderedMatch;

    if (listMatch) {
      flushParagraph();
      const nextListType = orderedMatch ? 'ol' : 'ul';
      if (activeListType !== nextListType) {
        flushList();
        activeList = document.createElement(nextListType);
        activeListType = nextListType;
        container.appendChild(activeList);
      }
      const item = document.createElement('li');
      appendInlineMarkdown(item, listMatch[1]);
      activeList.appendChild(item);
      return;
    }

    flushList();
    paragraphLines.push(line);
  });

  flushParagraph();
  flushList();
}

function appendChatMessage(container, role, content, pending = false) {
  const row = document.createElement('div');
  row.className = `chat-message ${role === 'user' ? 'chat-message-user' : 'chat-message-ai'}${pending ? ' chat-message-pending' : ''}`;

  if (role !== 'user') {
    const avatar = document.createElement('span');
    avatar.className = 'chat-message-avatar';
    avatar.textContent = '✦';
    row.appendChild(avatar);
  }

  const bubble = document.createElement('div');
  bubble.className = 'chat-message-bubble';
  if (role !== 'user' && !pending) {
    bubble.classList.add('markdown-rendered');
    renderAssistantMarkdown(bubble, content);
  } else {
    bubble.textContent = content;
  }
  row.appendChild(bubble);
  container.appendChild(row);
  container.scrollTop = container.scrollHeight;
  return row;
}

async function sendAssistantQuestion(question, options) {
  const cleanQuestion = String(question || '').trim();
  if (!cleanQuestion) {
    showToast('Escribe una pregunta para continuar.');
    options.input?.focus();
    return;
  }
  if (options.sendButton?.disabled) return;

  const originalButtonText = options.sendButton?.textContent || '➤';
  if (options.input) options.input.disabled = true;
  if (options.sendButton) {
    options.sendButton.disabled = true;
    options.sendButton.textContent = '…';
  }
  if (options.status) options.status.textContent = 'Gemini está analizando tu información…';

  appendChatMessage(options.messages, 'user', cleanQuestion);
  const pendingMessage = appendChatMessage(options.messages, 'assistant', 'Estoy revisando tu resumen financiero y preparando una respuesta…', true);
  if (options.input) options.input.value = '';

  try {
    // Use the month currently selected on the Dashboard as Gemini's financial context.
    const selectedMonth = getDashboardMonthKey();
    const requestBody = {
      question: cleanQuestion,
      period: 'month',
      reference_date: `${selectedMonth}-01`
    };
    if (activeConversationId) requestBody.conversation_id = Number(activeConversationId);

    const result = await apiRequest('/assistant/chat', {
      method: 'POST',
      body: JSON.stringify(requestBody)
    });

    if (result.conversation_id) {
      setActiveConversationId(result.conversation_id);
      assistantLoadedConversationId = options.messages === document.getElementById('assistantMessages')
        ? String(result.conversation_id)
        : null;
    }
    pendingMessage.remove();
    appendChatMessage(options.messages, 'assistant', result.answer || 'Gemini no devolvió texto. Inténtalo nuevamente.');
    if (options.status) options.status.textContent = 'Respuesta generada por Gemini.';
    if (result.financial_context) renderAssistantSummary(result.financial_context);
    await loadAssistantConversations({ quiet: true });
  } catch (error) {
    console.error('No se pudo consultar StudentWallet AI:', error);
    pendingMessage.remove();
    appendChatMessage(options.messages, 'assistant', 'No pude obtener una respuesta en este momento. Comprueba que el servidor esté activo y vuelve a intentarlo.');
    if (options.status) options.status.textContent = 'No se pudo completar la consulta.';
    showToast(`StudentWallet AI: ${error.message}`);
  } finally {
    if (options.input) {
      options.input.disabled = false;
      options.input.focus();
    }
    if (options.sendButton) {
      options.sendButton.disabled = false;
      options.sendButton.textContent = originalButtonText;
    }
  }
}

const quickChatForm = document.getElementById('quickChatForm');
const quickChatInput = document.getElementById('quickChatInput');
const quickChatMessages = document.getElementById('quickChatMessages');
const quickChatSend = document.getElementById('quickChatSend');
const quickChatNotice = document.getElementById('quickChatNotice');

quickChatForm.addEventListener('submit', event => {
  event.preventDefault();
  sendAssistantQuestion(quickChatInput.value, {
    input: quickChatInput,
    sendButton: quickChatSend,
    messages: quickChatMessages,
    status: quickChatNotice
  });
});

document.querySelectorAll('[data-question]').forEach(button => {
  button.addEventListener('click', () => {
    sendAssistantQuestion(button.dataset.question, {
      input: quickChatInput,
      sendButton: quickChatSend,
      messages: quickChatMessages,
      status: quickChatNotice
    });
  });
});

const assistantChatForm = document.getElementById('assistantChatForm');
const assistantChatInput = document.getElementById('assistantChatInput');
const assistantMessages = document.getElementById('assistantMessages');
const assistantSendButton = document.getElementById('assistantSendButton');
const assistantStatus = document.getElementById('assistantStatus');

assistantChatForm.addEventListener('submit', event => {
  event.preventDefault();
  sendAssistantQuestion(assistantChatInput.value, {
    input: assistantChatInput,
    sendButton: assistantSendButton,
    messages: assistantMessages,
    status: assistantStatus
  });
});

assistantChatInput.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    assistantChatForm.requestSubmit();
  }
});

document.querySelectorAll('[data-assistant-question]').forEach(button => {
  button.addEventListener('click', () => {
    sendAssistantQuestion(button.dataset.assistantQuestion, {
      input: assistantChatInput,
      sendButton: assistantSendButton,
      messages: assistantMessages,
      status: assistantStatus
    });
  });
});

function renderAssistantSummary(summary) {
  document.getElementById('assistantIncome').textContent = formatMoney(summary.income);
  document.getElementById('assistantExpenses').textContent = formatMoney(summary.expenses);
  document.getElementById('assistantBalance').textContent = formatMoney(summary.balance);

  const categories = Array.isArray(summary.expenses_by_category) ? summary.expenses_by_category : [];
  const categoryList = document.getElementById('assistantCategoryList');
  categoryList.innerHTML = categories.length
    ? categories.slice(0, 5).map(item => `<div class="assistant-category-row"><span>${escapeHtml(item.category)}</span><strong>${formatMoney(item.total)}</strong></div>`).join('')
    : '<p>Sin gastos registrados por categoría.</p>';
}

async function loadAssistantSummary() {
  try {
    const summary = await apiRequest('/dashboard/summary');
    renderAssistantSummary(summary);
  } catch (error) {
    console.error('No se pudo cargar el resumen para Gemini:', error);
    document.getElementById('assistantCategoryList').textContent = 'No fue posible cargar el resumen.';
  }
}

document.getElementById('refreshAssistantSummary').addEventListener('click', loadAssistantSummary);

document.getElementById('monthSelect').addEventListener('change', () => {
  renderDashboard();
});

document.getElementById('logoutButton').addEventListener('click', () => {
  showToast('El inicio de sesión se implementará cuando construyamos la autenticación.');
});

document.getElementById('profileMenu').addEventListener('click', () => navigate('profile'));


// -------------------------
// Metas de ahorro y aportaciones conectadas a PostgreSQL
// -------------------------
const goalForm = document.getElementById('goalForm');
const goalList = document.getElementById('goalList');
const goalSaveButton = document.getElementById('saveGoalButton');
const goalContributionModal = document.getElementById('goalContributionModal');
const goalContributionForm = document.getElementById('goalContributionForm');
const goalContributionSaveButton = document.getElementById('saveGoalContributionButton');
let currentSavingsGoals = [];

function getLocalDateValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function getGoalStatusText(status) {
  if (status === 'achieved') return 'Meta alcanzada';
  if (status === 'overdue') return 'Fecha objetivo vencida';
  return 'En progreso';
}

function renderGoalsSummary(summary = {}) {
  document.getElementById('goalsTotalTarget').textContent = formatMoney(summary.total_target);
  document.getElementById('goalsTotalSaved').textContent = formatMoney(summary.total_saved);
  document.getElementById('goalsCompletedCount').textContent = String(summary.completed_count || 0);
  document.getElementById('goalsActiveCount').textContent = `${summary.active_count || 0} ${Number(summary.active_count || 0) === 1 ? 'meta en progreso' : 'metas en progreso'}`;
}

function renderDashboardFeaturedGoal(goals = []) {
  const featured = goals.find(goal => goal.status !== 'achieved') || goals[0] || null;
  const title = document.getElementById('dashboardGoalTitle');
  const details = document.getElementById('dashboardGoalDetails');
  const progress = document.getElementById('dashboardGoalProgress');
  const caption = document.getElementById('dashboardGoalCaption');
  const percentLabel = document.getElementById('dashboardGoalPercent');
  if (!title || !details || !progress || !caption || !percentLabel) return;

  if (!featured) {
    title.textContent = 'Aún no tienes metas';
    details.textContent = 'Crea tu primer objetivo de ahorro';
    progress.style.width = '0%';
    caption.textContent = 'Comienza con una meta pequeña';
    percentLabel.textContent = '0%';
    return;
  }

  const percent = Number(featured.percent_complete) || 0;
  title.textContent = featured.title;
  details.textContent = `${formatMoney(featured.saved_amount)} de ${formatMoney(featured.target_amount)}`;
  progress.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  caption.textContent = featured.status === 'achieved'
    ? '¡Objetivo completado!'
    : `Faltan ${formatMoney(featured.remaining_amount)}`;
  percentLabel.textContent = `${Math.round(percent)}%`;
}

function renderSavingsGoalCards(goals = []) {
  document.getElementById('goalCount').textContent = `${goals.length} ${goals.length === 1 ? 'objetivo registrado' : 'objetivos registrados'}`;
  goalList.replaceChildren();

  if (!goals.length) {
    const empty = document.createElement('div');
    empty.className = 'goal-empty-state';
    empty.innerHTML = '<span>◎</span><strong>Aún no tienes metas de ahorro.</strong><p>Crea tu primer objetivo y registra aportaciones para ver cómo avanzas.</p>';
    goalList.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  goals.forEach(goal => {
    const saved = Number(goal.saved_amount) || 0;
    const target = Number(goal.target_amount) || 0;
    const remaining = Number(goal.remaining_amount) || 0;
    const percent = Math.max(0, Number(goal.percent_complete) || 0);
    const status = goal.status || 'in_progress';
    const card = document.createElement('article');
    card.className = `goal-item goal-${status}`;
    const targetDateText = goal.target_date ? `Objetivo: ${formatDate(goal.target_date)}` : 'Sin fecha objetivo';
    const footerText = status === 'achieved'
      ? '¡Has alcanzado tu objetivo!'
      : status === 'overdue'
        ? `Faltan ${formatMoney(remaining)} · actualiza tu fecha objetivo si lo necesitas`
        : `Faltan ${formatMoney(remaining)}`;
    const footerClass = status === 'achieved' ? 'goal-achieved-text' : status === 'overdue' ? 'goal-overdue-text' : '';

    card.innerHTML = `
      <div class="goal-item-top">
        <div class="goal-identity">
          <span class="goal-item-icon">🎯</span>
          <div class="goal-identity-copy"><strong>${escapeHtml(goal.title)}</strong><small>${getGoalStatusText(status)} · ${escapeHtml(targetDateText)}</small></div>
        </div>
        <div class="goal-item-actions">
          <button type="button" class="goal-contribute-button" data-goal-action="contribute" data-goal-id="${escapeHtml(goal.id)}">＋ Aportar</button>
          <button type="button" class="goal-action-button" data-goal-action="history" data-goal-id="${escapeHtml(goal.id)}" aria-label="Ver aportaciones" title="Ver aportaciones">▤</button>
          <button type="button" class="goal-action-button" data-goal-action="edit" data-goal-id="${escapeHtml(goal.id)}" aria-label="Editar meta" title="Editar">✎</button>
          <button type="button" class="goal-action-button goal-delete-action" data-goal-action="delete" data-goal-id="${escapeHtml(goal.id)}" aria-label="Eliminar meta" title="Eliminar">×</button>
        </div>
      </div>
      ${goal.description ? `<p class="goal-item-description">${escapeHtml(goal.description)}</p>` : ''}
      <div class="goal-item-amounts">
        <div><span>Ahorrado</span><strong>${formatMoney(saved)}</strong></div>
        <div><span>Objetivo</span><strong>${formatMoney(target)}</strong></div>
      </div>
      <div class="goal-progress-track" role="progressbar" aria-valuenow="${Math.min(100, Math.round(percent))}" aria-valuemin="0" aria-valuemax="100" aria-label="${Math.round(percent)} por ciento de la meta completado"><span style="width:${Math.min(100, percent)}%"></span></div>
      <div class="goal-item-bottom"><span>${percent.toFixed(1)}% completado · ${Number(goal.contributions_count) || 0} aportaciones</span><strong class="${footerClass}">${escapeHtml(footerText)}</strong></div>
      <div class="goal-history-panel" data-goal-history-panel="${escapeHtml(goal.id)}" hidden></div>
    `;
    fragment.appendChild(card);
  });
  goalList.appendChild(fragment);
}

async function loadSavingsGoals({ showError = true } = {}) {
  if (!goalList) return null;
  goalList.innerHTML = '<div class="goal-empty-state"><span>◎</span><strong>Consultando tus metas...</strong></div>';
  try {
    const result = await apiRequest('/goals');
    currentSavingsGoals = Array.isArray(result.goals) ? result.goals : [];
    renderGoalsSummary(result.summary || {});
    renderSavingsGoalCards(currentSavingsGoals);
    renderDashboardFeaturedGoal(currentSavingsGoals);
    await loadAchievements({ quiet: true });
    return result;
  } catch (error) {
    console.error('No se pudieron cargar las metas de ahorro:', error);
    goalList.innerHTML = '<div class="goal-empty-state"><span>!</span><strong>No fue posible cargar tus metas.</strong><p>Comprueba que FastAPI y PostgreSQL estén activos.</p></div>';
    if (showError) showToast(`Metas de ahorro: ${error.message}`);
    return null;
  }
}

function resetGoalForm() {
  goalForm.reset();
  document.getElementById('goalId').value = '';
  document.getElementById('goalFormTitle').textContent = 'Crear meta de ahorro';
  goalSaveButton.textContent = 'Guardar meta';
  document.getElementById('cancelGoalEdit').hidden = true;
}

function beginGoalEdit(goalId) {
  const goal = currentSavingsGoals.find(item => String(item.id) === String(goalId));
  if (!goal) return;
  document.getElementById('goalId').value = goal.id;
  document.getElementById('goalTitle').value = goal.title || '';
  document.getElementById('goalDescription').value = goal.description || '';
  document.getElementById('goalTargetAmount').value = Number(goal.target_amount).toFixed(2);
  document.getElementById('goalTargetDate').value = goal.target_date || '';
  document.getElementById('goalFormTitle').textContent = 'Editar meta de ahorro';
  goalSaveButton.textContent = 'Guardar cambios';
  document.getElementById('cancelGoalEdit').hidden = false;
  document.getElementById('goalTitle').focus();
  document.querySelector('.goal-form-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

goalForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!goalForm.reportValidity()) return;
  const id = document.getElementById('goalId').value;
  const targetAmount = Number(document.getElementById('goalTargetAmount').value);
  if (!Number.isFinite(targetAmount) || targetAmount <= 0) {
    showToast('Escribe una cantidad objetivo mayor que cero.');
    return;
  }
  const payload = {
    title: document.getElementById('goalTitle').value.trim(),
    description: document.getElementById('goalDescription').value.trim(),
    target_amount: targetAmount,
    target_date: document.getElementById('goalTargetDate').value || null
  };
  goalSaveButton.disabled = true;
  goalSaveButton.textContent = 'Guardando...';
  try {
    await apiRequest(id ? `/goals/${encodeURIComponent(id)}` : '/goals', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(payload)
    });
    resetGoalForm();
    await loadSavingsGoals({ showError: false });
    showToast(id ? 'Meta actualizada correctamente.' : 'Meta guardada en PostgreSQL.');
  } catch (error) {
    console.error('No se pudo guardar la meta:', error);
    showToast(`No se pudo guardar: ${error.message}`);
  } finally {
    goalSaveButton.disabled = false;
    goalSaveButton.textContent = document.getElementById('goalId').value ? 'Guardar cambios' : 'Guardar meta';
  }
});

document.getElementById('cancelGoalEdit').addEventListener('click', resetGoalForm);

function openGoalContributionModal(goal) {
  goalContributionForm.reset();
  document.getElementById('goalContributionGoalId').value = goal.id;
  document.getElementById('goalContributionGoalName').textContent = `Meta: ${goal.title} · Objetivo ${formatMoney(goal.target_amount)}`;
  document.getElementById('goalContributionDate').value = getLocalDateValue();
  goalContributionModal.hidden = false;
  document.body.classList.add('modal-open');
  window.setTimeout(() => document.getElementById('goalContributionAmount').focus(), 30);
}

function closeGoalContributionModal() {
  goalContributionModal.hidden = true;
  document.body.classList.remove('modal-open');
  goalContributionForm.reset();
}

document.getElementById('closeGoalContributionModal').addEventListener('click', closeGoalContributionModal);
document.getElementById('cancelGoalContribution').addEventListener('click', closeGoalContributionModal);
goalContributionModal.addEventListener('click', event => {
  if (event.target === goalContributionModal) closeGoalContributionModal();
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && goalContributionModal && !goalContributionModal.hidden) closeGoalContributionModal();
});

goalContributionForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!goalContributionForm.reportValidity()) return;
  const goalId = document.getElementById('goalContributionGoalId').value;
  const amount = Number(document.getElementById('goalContributionAmount').value);
  if (!Number.isFinite(amount) || amount <= 0) {
    showToast('La aportación debe ser mayor que cero.');
    return;
  }
  const payload = {
    amount,
    contribution_date: document.getElementById('goalContributionDate').value,
    note: document.getElementById('goalContributionNote').value.trim()
  };
  goalContributionSaveButton.disabled = true;
  goalContributionSaveButton.textContent = 'Guardando...';
  try {
    await apiRequest(`/goals/${encodeURIComponent(goalId)}/contributions`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    closeGoalContributionModal();
    await loadSavingsGoals({ showError: false });
    showToast('Aportación guardada. Tu progreso se actualizó.');
  } catch (error) {
    console.error('No se pudo registrar la aportación:', error);
    showToast(`No se pudo registrar la aportación: ${error.message}`);
  } finally {
    goalContributionSaveButton.disabled = false;
    goalContributionSaveButton.textContent = 'Guardar aportación';
  }
});

async function toggleGoalContributionHistory(goalId) {
  const panel = goalList.querySelector(`[data-goal-history-panel="${CSS.escape(String(goalId))}"]`);
  if (!panel) return;
  if (!panel.hidden) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  panel.innerHTML = '<p class="goal-history-empty">Cargando aportaciones...</p>';
  try {
    const contributions = await apiRequest(`/goals/${encodeURIComponent(goalId)}/contributions`);
    if (!contributions.length) {
      panel.innerHTML = '<div class="goal-history-heading">Historial de aportaciones</div><p class="goal-history-empty">Todavía no hay aportaciones para esta meta.</p>';
      return;
    }
    panel.innerHTML = '<div class="goal-history-heading">Historial de aportaciones</div>' + contributions.map(item => `
      <div class="goal-contribution-row">
        <div class="goal-contribution-copy"><strong>+ ${formatMoney(item.amount)}</strong><small>${formatDate(item.contribution_date)}${item.note ? ` · ${escapeHtml(item.note)}` : ''}</small></div>
        <div class="goal-contribution-actions"><button type="button" class="goal-contribution-delete" data-goal-contribution-delete="${escapeHtml(item.id)}" data-goal-id="${escapeHtml(goalId)}" aria-label="Eliminar aportación" title="Eliminar aportación">×</button></div>
      </div>`).join('');
  } catch (error) {
    console.error('No se pudo cargar el historial de aportaciones:', error);
    panel.innerHTML = '<p class="goal-history-empty">No fue posible cargar las aportaciones.</p>';
    showToast(`Historial de ahorro: ${error.message}`);
  }
}

goalList.addEventListener('click', async event => {
  const contributionDeleteButton = event.target.closest('button[data-goal-contribution-delete]');
  if (contributionDeleteButton) {
    const goalId = contributionDeleteButton.dataset.goalId;
    const contributionId = contributionDeleteButton.dataset.goalContributionDelete;
    if (!window.confirm('¿Eliminar esta aportación? El ahorro acumulado de la meta se recalculará.')) return;
    contributionDeleteButton.disabled = true;
    try {
      await apiRequest(`/goals/${encodeURIComponent(goalId)}/contributions/${encodeURIComponent(contributionId)}`, { method: 'DELETE' });
      await loadSavingsGoals({ showError: false });
      await toggleGoalContributionHistory(goalId);
      showToast('Aportación eliminada y progreso actualizado.');
    } catch (error) {
      console.error('No se pudo eliminar la aportación:', error);
      showToast(`No se pudo eliminar: ${error.message}`);
      contributionDeleteButton.disabled = false;
    }
    return;
  }

  const button = event.target.closest('button[data-goal-action]');
  if (!button) return;
  const goalId = button.dataset.goalId;
  const goal = currentSavingsGoals.find(item => String(item.id) === String(goalId));
  if (!goal) return;

  if (button.dataset.goalAction === 'contribute') {
    openGoalContributionModal(goal);
    return;
  }
  if (button.dataset.goalAction === 'history') {
    await toggleGoalContributionHistory(goalId);
    return;
  }
  if (button.dataset.goalAction === 'edit') {
    beginGoalEdit(goalId);
    return;
  }
  if (button.dataset.goalAction === 'delete') {
    if (!window.confirm(`¿Eliminar la meta "${goal.title}" y todas sus aportaciones? Esta acción no modifica tus movimientos financieros.`)) return;
    button.disabled = true;
    try {
      await apiRequest(`/goals/${encodeURIComponent(goalId)}`, { method: 'DELETE' });
      if (String(document.getElementById('goalId').value) === String(goalId)) resetGoalForm();
      await loadSavingsGoals({ showError: false });
      showToast('Meta eliminada. Tus movimientos financieros siguen intactos.');
    } catch (error) {
      console.error('No se pudo eliminar la meta:', error);
      showToast(`No se pudo eliminar: ${error.message}`);
      button.disabled = false;
    }
  }
});


// -------------------------
// Presupuestos mensuales conectados a PostgreSQL
// -------------------------
const budgetMonthInput = document.getElementById('budgetMonth');
const budgetForm = document.getElementById('budgetForm');
const budgetList = document.getElementById('budgetList');
const budgetSaveButton = document.getElementById('saveBudgetButton');
let currentBudgets = [];

function getLocalMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getBudgetPeriodStart() {
  const month = budgetMonthInput.value || getLocalMonthValue();
  return `${month}-01`;
}

function formatBudgetMonth(monthValue) {
  if (!monthValue) return 'mes seleccionado';
  const parsed = new Date(`${monthValue}-01T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? monthValue
    : new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric' }).format(parsed);
}

function updateBudgetMonthLabel() {
  const label = document.getElementById('budgetSelectedMonth');
  if (label) label.textContent = formatBudgetMonth(budgetMonthInput.value);
}

function renderBudgetSummary(summary = {}) {
  document.getElementById('budgetTotalLimit').textContent = formatMoney(summary.total_limit);
  document.getElementById('budgetTotalSpent').textContent = formatMoney(summary.total_spent);
  const available = Number(summary.total_remaining) || 0;
  const availableElement = document.getElementById('budgetTotalRemaining');
  availableElement.textContent = formatMoney(available);
  availableElement.classList.toggle('budget-negative-value', available < 0);
}

function getBudgetStatusText(status) {
  if (status === 'exceeded') return 'Límite superado';
  if (status === 'warning') return 'Cerca del límite';
  return 'Dentro del presupuesto';
}

function renderBudgetCards(items = []) {
  document.getElementById('budgetCount').textContent = `${items.length} ${items.length === 1 ? 'categoría presupuestada' : 'categorías presupuestadas'}`;
  budgetList.replaceChildren();

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'budget-empty-state';
    empty.innerHTML = '<span>◷</span><strong>Aún no hay presupuestos para este mes.</strong><p>Crea uno desde el formulario para comenzar a controlar tus gastos.</p>';
    budgetList.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  items.forEach(budget => {
    const spent = Number(budget.spent) || 0;
    const limit = Number(budget.limit_amount) || 0;
    const remaining = Number(budget.remaining) || 0;
    const percent = Math.max(0, Number(budget.percent_used) || 0);
    const status = budget.status || 'on_track';
    const icon = categoryIcons[budget.category] || categoryIcons.Otros;
    const card = document.createElement('article');
    card.className = `budget-item budget-${status}`;
    card.innerHTML = `
      <div class="budget-item-top">
        <div class="budget-category-identity">
          <span class="budget-category-icon">${icon}</span>
          <div><strong>${escapeHtml(budget.category)}</strong><small>${getBudgetStatusText(status)}</small></div>
        </div>
        <div class="budget-item-actions">
          <button type="button" class="budget-action-button" data-budget-action="edit" data-budget-id="${escapeHtml(budget.id)}" aria-label="Editar presupuesto de ${escapeHtml(budget.category)}" title="Editar">✎</button>
          <button type="button" class="budget-action-button budget-delete-action" data-budget-action="delete" data-budget-id="${escapeHtml(budget.id)}" aria-label="Eliminar presupuesto de ${escapeHtml(budget.category)}" title="Eliminar">×</button>
        </div>
      </div>
      <div class="budget-item-amounts">
        <div><span>Gastado</span><strong>${formatMoney(spent)}</strong></div>
        <div><span>Límite</span><strong>${formatMoney(limit)}</strong></div>
      </div>
      <div class="budget-progress-track" role="progressbar" aria-valuenow="${Math.min(100, Math.round(percent))}" aria-valuemin="0" aria-valuemax="100" aria-label="${Math.round(percent)} por ciento utilizado">
        <span style="width:${Math.min(100, percent)}%"></span>
      </div>
      <div class="budget-item-bottom">
        <span>${percent.toFixed(1)}% utilizado</span>
        <strong class="${remaining < 0 ? 'budget-negative-value' : ''}">${remaining >= 0 ? `Te quedan ${formatMoney(remaining)}` : `Excedido por ${formatMoney(Math.abs(remaining))}`}</strong>
      </div>`;
    fragment.appendChild(card);
  });
  budgetList.appendChild(fragment);
}

async function loadBudgets({ showError = true } = {}) {
  if (!budgetMonthInput || !budgetList) return;
  if (!budgetMonthInput.value) budgetMonthInput.value = getLocalMonthValue();
  updateBudgetMonthLabel();
  budgetList.innerHTML = '<div class="budget-empty-state"><span>◷</span><strong>Consultando tus presupuestos...</strong></div>';
  try {
    const result = await apiRequest(`/budgets?month=${encodeURIComponent(getBudgetPeriodStart())}`);
    currentBudgets = Array.isArray(result.budgets) ? result.budgets : [];
    renderBudgetSummary(result.summary || {});
    renderBudgetCards(currentBudgets);
    await loadAchievements({ quiet: true });
    return result;
  } catch (error) {
    console.error('No se pudieron cargar los presupuestos:', error);
    budgetList.innerHTML = '<div class="budget-empty-state"><span>!</span><strong>No fue posible cargar los presupuestos.</strong><p>Comprueba que FastAPI y PostgreSQL estén activos.</p></div>';
    if (showError) showToast(`Presupuestos: ${error.message}`);
    return null;
  }
}

function resetBudgetForm() {
  budgetForm.reset();
  document.getElementById('budgetId').value = '';
  document.getElementById('budgetFormTitle').textContent = 'Crear presupuesto';
  budgetSaveButton.textContent = 'Guardar presupuesto';
  document.getElementById('cancelBudgetEdit').hidden = true;
  updateBudgetMonthLabel();
}

async function beginBudgetEdit(budgetId) {
  const budget = currentBudgets.find(item => String(item.id) === String(budgetId));
  if (!budget) return;
  budgetMonthInput.value = String(budget.period_start).slice(0, 7);
  if (budgetMonthInput.value !== getLocalMonthValue()) {
    await loadBudgets({ showError: false });
  }
  document.getElementById('budgetId').value = budget.id;
  document.getElementById('budgetCategory').value = budget.category;
  document.getElementById('budgetLimitAmount').value = Number(budget.limit_amount).toFixed(2);
  document.getElementById('budgetFormTitle').textContent = 'Editar presupuesto';
  budgetSaveButton.textContent = 'Guardar cambios';
  document.getElementById('cancelBudgetEdit').hidden = false;
  updateBudgetMonthLabel();
  document.getElementById('budgetLimitAmount').focus();
  document.querySelector('.budget-form-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

budgetForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!budgetForm.reportValidity()) return;

  const id = document.getElementById('budgetId').value;
  const amount = Number(document.getElementById('budgetLimitAmount').value);
  if (!Number.isFinite(amount) || amount <= 0) {
    showToast('Escribe un límite mayor que cero.');
    return;
  }

  const payload = {
    category: document.getElementById('budgetCategory').value,
    limit_amount: amount,
    period_start: getBudgetPeriodStart()
  };
  budgetSaveButton.disabled = true;
  budgetSaveButton.textContent = 'Guardando...';

  try {
    await apiRequest(id ? `/budgets/${encodeURIComponent(id)}` : '/budgets', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(payload)
    });
    resetBudgetForm();
    await loadBudgets({ showError: false });
    showToast(id ? 'Presupuesto actualizado correctamente.' : 'Presupuesto guardado en PostgreSQL.');
  } catch (error) {
    console.error('No se pudo guardar el presupuesto:', error);
    showToast(`No se pudo guardar: ${error.message}`);
  } finally {
    budgetSaveButton.disabled = false;
    budgetSaveButton.textContent = document.getElementById('budgetId').value ? 'Guardar cambios' : 'Guardar presupuesto';
  }
});

document.getElementById('cancelBudgetEdit').addEventListener('click', resetBudgetForm);
budgetMonthInput.addEventListener('change', () => {
  resetBudgetForm();
  void loadBudgets();
});

budgetList.addEventListener('click', async event => {
  const button = event.target.closest('button[data-budget-action]');
  if (!button) return;
  const id = button.dataset.budgetId;
  if (button.dataset.budgetAction === 'edit') {
    await beginBudgetEdit(id);
    return;
  }
  if (button.dataset.budgetAction === 'delete') {
    const budget = currentBudgets.find(item => String(item.id) === String(id));
    if (!budget || !window.confirm(`¿Eliminar el presupuesto de ${budget.category}? Tus movimientos no se eliminarán.`)) return;
    button.disabled = true;
    try {
      await apiRequest(`/budgets/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (String(document.getElementById('budgetId').value) === String(id)) resetBudgetForm();
      await loadBudgets({ showError: false });
      showToast('Presupuesto eliminado. Tus movimientos siguen intactos.');
    } catch (error) {
      console.error('No se pudo eliminar el presupuesto:', error);
      showToast(`No se pudo eliminar: ${error.message}`);
      button.disabled = false;
    }
  }
});


// -------------------------
// Logros, insignias y niveles del cuervo StudentWallet
// -------------------------
let currentAchievements = null;

function ravenMarkMarkup(symbol = '✦', unlocked = false, extraClass = '') {
  return `
    <span class="raven-emblem ${unlocked ? 'is-unlocked' : 'is-locked'} ${extraClass}" aria-hidden="true">
      <svg viewBox="0 0 128 100" focusable="false">
        <path class="raven-silhouette" d="M8 71c8-15 22-25 41-29 2-15 13-26 28-27 12-1 21 6 23 17l18 7-18 7c-3 12-12 20-25 21-15 12-36 15-67 4z"/>
        <path class="raven-wing" d="M28 67c14-13 32-15 49-4-11 15-30 20-49 4z"/>
        <path class="raven-feather-line" d="M34 68c11-7 22-8 34-5M42 73c9-4 17-4 25-2"/>
        <path class="raven-beak" d="M99 31l18 8-18 7 4-7z"/>
        <circle class="raven-eye" cx="88" cy="27" r="2.6"/>
      </svg>
      <span class="raven-emblem-symbol">${escapeHtml(symbol)}</span>
    </span>`;
}

function renderDashboardAchievementSummary(data) {
  if (!data) return;
  const points = document.getElementById('dashboardAchievementPoints');
  const count = document.getElementById('dashboardAchievementCount');
  const level = document.getElementById('dashboardAchievementLevel');
  const mini = document.getElementById('dashboardMiniAchievements');
  if (points) points.textContent = String(data.points || 0);
  if (count) count.textContent = `${data.unlocked_count || 0} / ${data.total_achievements || 7}`;
  if (level) level.textContent = `Nivel ${data.level.number} · ${data.level.name}`;
  if (mini) {
    const featured = (data.achievements || []).slice(0, 3);
    mini.innerHTML = featured.map(item => `
      <div class="mini-achievement-raven ${item.unlocked ? 'is-unlocked' : 'is-locked'}">
        ${ravenMarkMarkup(item.symbol, item.unlocked, 'raven-emblem-mini')}
        <small>${escapeHtml(item.title)}</small>
      </div>`).join('');
  }
}

function renderAchievements(data) {
  currentAchievements = data;
  const level = data.level || {};
  const points = Number(data.points) || 0;
  const unlockedCount = Number(data.unlocked_count) || 0;
  const total = Number(data.total_achievements) || 7;
  const collectionPercent = total ? Math.round(unlockedCount / total * 100) : 0;

  document.getElementById('achievementPoints').textContent = String(points);
  document.getElementById('achievementUnlockedCount').textContent = `${unlockedCount} / ${total}`;
  document.getElementById('achievementCollectionPercent').textContent = `${collectionPercent}%`;
  document.getElementById('achievementLevelName').textContent = level.name || 'Principiante';
  document.getElementById('achievementLevelNumber').textContent = String(level.number || 1).padStart(2, '0');
  document.getElementById('achievementLevelSubtitle').textContent = level.next_level_name
    ? 'Sigue construyendo hábitos financieros para evolucionar.'
    : 'Has alcanzado el nivel máximo de StudentWallet.';
  const levelProgress = Math.max(0, Math.min(100, Number(level.progress_percent) || 0));
  document.getElementById('achievementLevelProgress').style.width = `${levelProgress}%`;
  document.getElementById('achievementLevelProgressLabel').textContent = `${points} puntos acumulados`;
  document.getElementById('achievementLevelNext').textContent = level.next_level_name
    ? `Faltan ${Number(level.points_to_next_level) || 0} para ${level.next_level_name}`
    : 'Nivel máximo alcanzado';
  document.getElementById('achievementNextLevelTitle').textContent = level.next_level_name
    ? `Nivel ${(Number(level.number) || 1) + 1} · ${level.next_level_name}`
    : 'Nivel máximo · Maestro StudentWallet';
  document.getElementById('achievementNextLevelPoints').textContent = level.next_level_name
    ? `${Number(level.points_to_next_level) || 0} puntos restantes`
    : '170 puntos';
  document.getElementById('achievementNextLevelProgress').style.width = `${levelProgress}%`;
  document.getElementById('achievementNextLevelText').textContent = level.next_level_name
    ? `Has completado el ${levelProgress}% del progreso de tu nivel actual.`
    : 'Tu cuervo ha alcanzado su evolución final. ¡Colección completa!';
  document.getElementById('achievementCollectionCount').textContent = `${unlockedCount} de ${total} desbloqueadas`;

  const mascot = document.getElementById('achievementMascotEmblem');
  mascot.innerHTML = ravenMarkMarkup('✦', true, 'raven-emblem-mascot');
  mascot.dataset.level = String(level.number || 1);
  document.getElementById('achievementMascot').dataset.level = String(level.number || 1);

  const grid = document.getElementById('achievementGrid');
  grid.replaceChildren();
  (data.achievements || []).forEach(item => {
    const card = document.createElement('article');
    card.className = `achievement-card ${item.unlocked ? 'is-unlocked' : 'is-locked'}`;
    const current = Number(item.progress?.current) || 0;
    const target = Number(item.progress?.target) || 1;
    const percent = Math.max(0, Math.min(100, Number(item.progress?.percent) || 0));
    const unlockedDate = item.unlocked_at ? formatConversationTimestamp(item.unlocked_at) : '';
    card.innerHTML = `
      <div class="achievement-card-top">
        <span class="achievement-category-label">${escapeHtml(item.category)}</span>
        <span class="achievement-state ${item.unlocked ? 'is-unlocked' : 'is-locked'}">${item.unlocked ? 'Desbloqueada' : 'Bloqueada'}</span>
      </div>
      <div class="achievement-card-main">
        ${ravenMarkMarkup(item.symbol, item.unlocked)}
        <div class="achievement-card-copy">
          <h4>${escapeHtml(item.title)}</h4>
          <p>${escapeHtml(item.description)}</p>
        </div>
      </div>
      <p class="achievement-requirement">${escapeHtml(item.requirement)}</p>
      <div class="achievement-progress-track"><span style="width:${percent}%"></span></div>
      <div class="achievement-card-bottom">
        <span>${escapeHtml(item.progress?.detail || `${Math.min(current, target)} de ${target}`)}</span>
        <strong>+${Number(item.points) || 0} puntos</strong>
      </div>
      ${item.unlocked ? `<p class="achievement-unlocked-date">Conseguida · ${escapeHtml(unlockedDate)}</p>` : ''}
    `;
    grid.appendChild(card);
  });
  renderDashboardAchievementSummary(data);
}

async function loadAchievements({ quiet = false } = {}) {
  const grid = document.getElementById('achievementGrid');
  try {
    const result = await apiRequest('/achievements');
    renderAchievements(result);
    (result.newly_unlocked || []).forEach((item, index) => {
      const message = `¡Insignia desbloqueada: ${item.title}! +${item.points} puntos StudentWallet.`;
      if (index === 0) showToast(message);
      else window.setTimeout(() => showToast(message), index * 3400);
    });
    return result;
  } catch (error) {
    console.error('No se pudieron cargar los logros:', error);
    if (grid && document.getElementById('view-achievements')?.classList.contains('active-view')) {
      grid.innerHTML = '<div class="achievement-loading-card achievement-error">No fue posible cargar tus logros. Comprueba que FastAPI y PostgreSQL estén activos.</div>';
    }
    if (!quiet) showToast(`Logros: ${error.message}`);
    return null;
  }
}


async function initializeApp() {
  initializeDashboardMonthSelector();
  if (budgetMonthInput && !budgetMonthInput.value) budgetMonthInput.value = getLocalMonthValue();
  ensureAssistantHistoryUI();
  const connected = await refreshTransactions();
  if (connected) {
    showToast('Conectado con la API REST y PostgreSQL.');
    await loadAssistantSummary();
    await initializeAssistantHistory();
    await loadSavingsGoals({ showError: false });
  } else {
    showToast('Backend no disponible. Inicia StudentWallet desde FastAPI.');
  }
}

initializeApp();
