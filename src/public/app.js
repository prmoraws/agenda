const $ = selector => document.querySelector(selector);
let groups = [];
let labels = [];
let templates = [];
let editingMessageId = null;
let editingLabelsGroupId = null;
let selectedDestinationIds = new Set();
let selectedMedia = null;
let mediaMode = 'keep';

const notify = message => {
  const toast = $('#toast'); toast.textContent = message; toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, 3500);
};
const request = async (url, options = {}) => {
  const headers = { ...options.headers };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(url, { ...options, headers });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Operação recusada');
  return data;
};
const escapeHtml = value => String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));

async function loadWhatsappStatus() {
  try {
    const status = await request('/api/whatsapp/status');
    const connected = ['open', 'connected'].includes(String(status.state).toLowerCase());
    const sendingLabel = status.sendingEnabled ? 'Envio automático ativo' : 'Envio automático bloqueado';
    $('#whatsapp-status').innerHTML = `<p><strong>Instância:</strong> ${escapeHtml(status.instanceName)} <span class="badge">${escapeHtml(status.state)}</span> <span class="badge">${sendingLabel}</span></p>`;
    $('#sending-status').textContent = status.sendingEnabled
      ? 'Executor ativo: mensagens confirmadas serão enviadas automaticamente no horário programado.'
      : 'Executor bloqueado: mensagens podem ser preparadas e confirmadas, mas não serão enviadas.';
    $('#header-status').textContent = connected
      ? `WhatsApp conectado · ${sendingLabel}` : `WhatsApp ${status.state}`;
    $('#show-qrcode').disabled = connected;
    $('#import-groups').disabled = !connected;
    if (connected) {
      $('#qrcode').innerHTML = '<p class="connected">WhatsApp Business conectado com segurança.</p>';
    }
  } catch (error) {
    $('#whatsapp-status').textContent = `Evolution indisponível: ${error.message}`;
    $('#header-status').textContent = 'Evolution indisponível';
  }
}

function showPage(pageName) {
  document.querySelectorAll('.page').forEach(page => {
    page.hidden = page.id !== `page-${pageName}`;
    page.classList.toggle('active', !page.hidden);
  });
  document.querySelectorAll('.nav-button').forEach(button => {
    button.classList.toggle('active', button.dataset.page === pageName);
  });
  window.scrollTo({ top:0, behavior:'smooth' });
  if (pageName === 'dashboard') void loadDashboard();
  if (pageName === 'active') void loadMessages('active');
  if (pageName === 'sent') void loadMessages('sent');
  if (pageName === 'cancelled') void loadMessages('cancelled');
}

document.querySelectorAll('.nav-button').forEach(button => {
  button.addEventListener('click', () => showPage(button.dataset.page));
});

$('#create-instance').addEventListener('click', async () => {
  try { const result = await request('/api/whatsapp/instance', { method:'POST' }); await loadWhatsappStatus(); notify(result.status === 'created' ? 'Instância criada.' : 'Instância já existia.'); } catch (error) { notify(error.message); }
});
$('#show-qrcode').addEventListener('click', async () => {
  try {
    const result = await request('/api/whatsapp/qrcode');
    const value = result.base64;
    $('#qrcode').innerHTML = value && String(value).startsWith('data:image')
      ? `<p>Leia o QR Code no WhatsApp Business:</p><img class="qr" src="${value}" alt="QR Code da instância">`
      : result.pairingCode ? `<p>Código de pareamento: <strong>${escapeHtml(result.pairingCode)}</strong></p>`
      : '<p>A instância já pode estar conectada ou o QR Code ainda não foi gerado. Tente novamente.</p>';
  } catch (error) { notify(error.message); }
});
$('#import-groups').addEventListener('click', async () => {
  const button = $('#import-groups');
  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = 'Importando... aguarde';
  try {
    const result = await request('/api/whatsapp/import-groups', { method:'POST' });
    await loadGroups();
    notify(`${result.discovered} grupo(s) encontrado(s). Autorize somente os desejados.`);
  } catch (error) {
    notify(error.message);
  } finally {
    button.textContent = originalText;
    await loadWhatsappStatus();
  }
});

const labelChip = label => `<span class="label-chip" style="background:${escapeHtml(label.color)}">${escapeHtml(label.name)}</span>`;

async function loadLabels() {
  labels = await request('/api/labels');
  $('#labels-list').innerHTML = labels.length
    ? labels.map(label => `${labelChip(label)} <span class="muted">${label.groupCount}</span>`).join('')
    : '<span class="muted">Nenhuma etiqueta criada.</span>';
  const options = labels.map(label => `<option value="${label.id}">${escapeHtml(label.name)}</option>`).join('');
  $('#group-label-filter').innerHTML = `<option value="all">Todas as etiquetas</option>${options}`;
  $('#destination-label-filter').innerHTML = `<option value="all">Todos os grupos autorizados</option>${options}`;
  if (groups.length) { renderGroups(); renderDestinationGroups(); }
}

$('#label-form').addEventListener('submit', async event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  try {
    await request('/api/labels', { method:'POST', body:JSON.stringify(data) });
    event.target.reset();
    await Promise.all([loadLabels(), loadGroups()]);
    notify('Etiqueta criada. Agora associe-a aos grupos desejados.');
  } catch (error) { notify(error.message); }
});

$('#import-labels').addEventListener('click', async () => {
  const button = $('#import-labels');
  button.disabled = true;
  try {
    const result = await request('/api/labels/import', { method:'POST' });
    await loadLabels();
    notify(`${result.discovered} etiqueta(s) encontradas. Associe-as aos grupos dentro do Agenda.`);
  } catch (error) { notify(error.message); }
  finally { button.disabled = false; }
});

async function loadTemplates() {
  templates = await request('/api/templates');
  const current = $('#template-select').value;
  $('#template-select').innerHTML = '<option value="">Selecione um modelo</option>'
    + templates.map(template => `<option value="${template.id}">${escapeHtml(template.name)}</option>`).join('');
  if (templates.some(template => String(template.id) === current)) $('#template-select').value = current;
}

$('#apply-template').addEventListener('click', () => {
  const template = templates.find(item => String(item.id) === $('#template-select').value);
  if (!template) return notify('Selecione um modelo de mensagem.');
  const textarea = $('#message-form').elements.content;
  if (textarea.value.trim() && textarea.value !== template.content
      && !confirm('Substituir o texto atual pelo modelo selecionado?')) return;
  textarea.value = template.content;
  textarea.focus();
  notify(`Modelo “${template.name}” aplicado.`);
});

$('#save-template').addEventListener('click', async () => {
  const name = $('#template-name').value;
  const content = $('#message-form').elements.content.value;
  try {
    await request('/api/templates', { method:'POST', body:JSON.stringify({ name, content }) });
    $('#template-name').value = '';
    await loadTemplates();
    notify('Modelo salvo. Um modelo com o mesmo nome será atualizado.');
  } catch (error) { notify(error.message); }
});

$('#delete-template').addEventListener('click', async () => {
  const template = templates.find(item => String(item.id) === $('#template-select').value);
  if (!template) return notify('Selecione o modelo que deseja excluir.');
  if (!confirm(`Excluir o modelo “${template.name}”?`)) return;
  try {
    await request(`/api/templates/${template.id}`, { method:'DELETE' });
    await loadTemplates();
    notify('Modelo excluído. Agendamentos existentes não foram alterados.');
  } catch (error) { notify(error.message); }
});

async function loadGroups() {
  groups = await request('/api/groups');
  renderGroups();
  renderDestinationGroups();
}

function renderDestinationGroups() {
  const labelId = $('#destination-label-filter')?.value ?? 'all';
  const authorized = groups.filter(group =>
    group.authorized && group.active && group.sendable
      && (labelId === 'all' || group.labels.some(label => String(label.id) === labelId)));
  $('#group-options').innerHTML = authorized.length ? authorized.map(group => `
    <label class="check"><input type="checkbox" name="groupIds" value="${group.id}" ${selectedDestinationIds.has(String(group.id)) ? 'checked' : ''}>
      <span>${escapeHtml(group.displayName)} ${group.labels.map(labelChip).join(' ')}</span>
    </label>`).join('') : 'Nenhum grupo autorizado corresponde à etiqueta.';
}

$('#destination-label-filter').addEventListener('change', renderDestinationGroups);
$('#group-options').addEventListener('change', event => {
  const input = event.target.closest('input[name="groupIds"]');
  if (!input) return;
  if (input.checked) selectedDestinationIds.add(input.value);
  else selectedDestinationIds.delete(input.value);
});
$('#select-visible-groups').addEventListener('click', () => {
  document.querySelectorAll('#group-options input[name="groupIds"]').forEach(input => {
    input.checked = true; selectedDestinationIds.add(input.value);
  });
});
$('#clear-groups').addEventListener('click', () => {
  selectedDestinationIds.clear();
  document.querySelectorAll('#group-options input[name="groupIds"]').forEach(input => { input.checked = false; });
});

const groupKindLabels = {
  group: 'Grupo comum',
  community: 'Comunidade',
  community_announcement: 'Avisos da comunidade',
  community_subgroup: 'Subgrupo da comunidade',
};

function renderGroups() {
  const search = ($('#group-search')?.value ?? '').trim().toLocaleLowerCase('pt-BR');
  const filter = $('#group-filter')?.value ?? 'all';
  const labelFilter = $('#group-label-filter')?.value ?? 'all';
  const nameCounts = new Map();
  for (const group of groups) {
    const key = group.displayName.trim().toLocaleLowerCase('pt-BR');
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  const visible = groups.filter(group => {
    const matchesSearch = !search || `${group.displayName} ${group.groupJid}`.toLocaleLowerCase('pt-BR').includes(search);
    const matchesFilter = filter === 'archived'
      ? !group.active
      : group.active && (filter === 'all'
        || group.groupKind === filter
        || (filter === 'authorized' && group.authorized)
        || (filter === 'pending' && !group.authorized));
    const matchesLabel = labelFilter === 'all'
      || group.labels.some(label => String(label.id) === labelFilter);
    return matchesSearch && matchesFilter && matchesLabel;
  });
  const repeatedNames = [...nameCounts.values()].filter(count => count > 1).length;
  $('#group-summary').textContent = `${visible.length} exibido(s) de ${groups.length} destino(s) — ${repeatedNames} nome(s) repetido(s) com JIDs diferentes.`;
  $('#groups').innerHTML = visible.length ? visible.map(group => {
    const key = group.displayName.trim().toLocaleLowerCase('pt-BR');
    const repeated = (nameCounts.get(key) ?? 0) > 1;
    const kind = groupKindLabels[group.groupKind] ?? 'Grupo';
    return `
      <div class="card">
        <div class="row"><strong>${escapeHtml(group.displayName)}</strong>
          <span class="badge community">${escapeHtml(kind)}</span>
          ${repeated ? '<span class="badge warning">Mesmo nome, JID diferente</span>' : ''}
        </div>
        <div class="row muted"><span>${escapeHtml(group.groupJid)}</span>
          ${group.communityJid ? `<span>Comunidade: ${escapeHtml(group.communityJid)}</span>` : ''}
        </div>
        <div class="row">
          <span class="badge">${!group.active ? 'Arquivado' : group.authorized ? 'Autorizado' : 'Aguardando autorização'}</span>
          ${!group.sendable ? '<span class="badge warning">Contêiner de comunidade — não enviável</span>' : ''}
          ${group.active && !group.authorized && group.sendable ? `<button data-authorize="${group.id}">Autorizar conscientemente</button>` : ''}
          ${group.active ? `<button class="secondary" data-group-edit="${group.id}">Editar nome</button>` : ''}
          ${group.active ? `<button class="secondary" data-group-labels="${group.id}">Gerenciar etiquetas</button>` : ''}
          ${group.active && group.authorized ? `<button class="danger-outline" data-group-revoke="${group.id}">Retirar autorização</button>` : ''}
          ${group.active ? `<button class="danger-outline" data-group-archive="${group.id}">Arquivar</button>` : `<button data-group-restore="${group.id}">Restaurar</button>`}
        </div>
        ${group.labels.length ? `<div class="label-list">${group.labels.map(labelChip).join('')}</div>` : ''}
      </div>`;
  }).join('') : '<p>Nenhum grupo corresponde aos filtros.</p>';
}

function openGroupLabels(groupId) {
  const group = groups.find(item => String(item.id) === String(groupId));
  if (!group) return;
  editingLabelsGroupId = group.id;
  const selected = new Set(group.labels.map(label => String(label.id)));
  $('#labels-group-name').textContent = group.displayName;
  $('#labels-options').innerHTML = labels.length ? labels.map(label => `
    <label class="check"><input type="checkbox" value="${label.id}" ${selected.has(String(label.id)) ? 'checked' : ''}>
      ${labelChip(label)}
    </label>`).join('') : '<p>Nenhuma etiqueta disponível.</p>';
  $('#labels-dialog').showModal();
}

$('#close-labels').addEventListener('click', () => $('#labels-dialog').close());
$('#save-group-labels').addEventListener('click', async () => {
  if (!editingLabelsGroupId) return;
  const labelIds = [...document.querySelectorAll('#labels-options input:checked')].map(input => Number(input.value));
  try {
    await request(`/api/groups/${editingLabelsGroupId}/labels`, {
      method:'PUT', body:JSON.stringify({ labelIds }),
    });
    $('#labels-dialog').close();
    await Promise.all([loadGroups(), loadLabels()]);
    notify('Etiquetas do grupo atualizadas.');
  } catch (error) { notify(error.message); }
});

$('#group-search').addEventListener('input', renderGroups);
$('#group-filter').addEventListener('change', renderGroups);
$('#group-label-filter').addEventListener('change', renderGroups);

const messageCache = { active:[], sent:[], cancelled:[] };

const messageCard = message => `
    <article class="schedule-card ${escapeHtml(message.status)}">
      <div class="schedule-head">
        <div><span class="schedule-id">Agendamento #${message.id}</span> <span class="badge status-${escapeHtml(message.status)}">${escapeHtml(statusLabels[message.status] ?? message.status)}</span>
          ${message.recurrenceType === 'weekly' ? `<span class="badge series-badge">Semanal ${message.occurrenceNumber}/${message.occurrenceCount}</span>` : ''}
        </div>
        <div class="schedule-date">${new Date(message.scheduledAt).toLocaleString('pt-BR')}</div>
      </div>
      <p><strong>${message.groupCount} grupo(s) de destino</strong></p>
      ${message.hasMedia ? `<img class="schedule-image" src="/api/messages/${message.id}/media" alt="Foto do agendamento #${message.id}" loading="lazy">` : ''}
      <div class="message-preview">${escapeHtml(message.content)}</div>
      <div class="card-actions">
        <button class="secondary" data-details="${message.id}">Ver detalhes</button>
        ${['draft','confirmed'].includes(message.status) ? `<button class="secondary" data-edit="${message.id}">Editar</button>` : ''}
        ${message.status === 'draft' && message.recurrenceType === 'weekly' ? `<button data-confirm-series="${message.id}">Confirmar série semanal</button>` : ''}
        ${message.status === 'draft' && message.recurrenceType !== 'weekly' ? `<button data-confirm="${message.id}">Confirmar agendamento</button>` : ''}
        ${['draft','confirmed'].includes(message.status) ? `<button class="danger" data-cancel="${message.id}">Cancelar</button>` : ''}
        ${message.recurrenceType === 'weekly' && ['draft','confirmed'].includes(message.status) ? `<button class="danger" data-cancel-series="${message.id}">Cancelar série</button>` : ''}
        ${['draft','confirmed','cancelled'].includes(message.status) ? `<button class="danger" data-delete="${message.id}">Apagar</button>` : ''}
        ${['completed','partial_failed','failed','cancelled'].includes(message.status) ? `<button data-reuse="${message.id}">Usar novamente</button>` : ''}
      </div>
    </article>`;

async function loadMessages(view = 'active') {
  const messages = await request(`/api/messages?view=${encodeURIComponent(view)}`);
  messageCache[view] = messages;
  renderMessageView(view);
}

function renderMessageView(view) {
  const target = $(`#messages-${view}`);
  if (!target) return;
  const search = view === 'sent' ? ($('#sent-search')?.value ?? '').trim().toLocaleLowerCase('pt-BR') : '';
  const visible = (messageCache[view] ?? []).filter(message =>
    !search || `${message.id} ${message.content}`.toLocaleLowerCase('pt-BR').includes(search));
  target.innerHTML = visible.length ? visible.map(messageCard).join('')
    : `<div class="empty-state"><strong>Nenhum agendamento ${view === 'active' ? 'ativo' : view === 'sent' ? 'enviado' : 'cancelado'}.</strong></div>`;
}

$('#sent-search').addEventListener('input', () => renderMessageView('sent'));

async function loadWorkerStatus() {
  try {
    const worker = await request('/api/worker/status');
    if (worker.enabled && worker.readyDeliveries > 0) {
      $('#sending-status').textContent = `Executor ativo: ${worker.readyDeliveries} entrega(s) vencida(s) aguardando processamento.`;
    }
  } catch { /* o estado principal continua visível */ }
}

async function loadDashboard() {
  try {
    const data = await request('/api/dashboard');
    const metrics = [
      ['Ativos', data.activeMessages, 'info'],
      ['Entregas enviadas', data.sentDeliveries, 'good'],
      ['Entregas pendentes', data.pendingDeliveries, 'warn'],
      ['Entregas com falha', data.failedDeliveries, 'bad'],
      ['Grupos autorizados', `${data.authorizedGroups}/${data.totalGroups}`, 'good'],
      ['Séries semanais', data.weeklyOccurrences, 'info'],
      ['Concluídos', data.completedMessages, 'good'],
      ['Cancelados', data.cancelledMessages, 'warn'],
    ];
    $('#dashboard-metrics').innerHTML = metrics.map(([label,value,tone]) => `
      <div class="metric-card ${tone}"><span class="metric-label">${escapeHtml(label)}</span><span class="metric-value">${escapeHtml(value)}</span></div>
    `).join('');
    $('#dashboard-upcoming').innerHTML = data.upcoming.length ? data.upcoming.map(message => `
      <div class="upcoming-item">
        <strong>${new Date(message.scheduledAt).toLocaleString('pt-BR')}</strong>
        <span>${escapeHtml(message.content.slice(0, 140))}${message.content.length > 140 ? '…' : ''}</span>
        ${message.recurrenceType === 'weekly' ? `<span class="badge series-badge">${message.occurrenceNumber}/${message.occurrenceCount}</span>` : ''}
      </div>`).join('') : '<div class="empty-state">Nenhum envio futuro confirmado.</div>';
  } catch (error) {
    $('#dashboard-metrics').innerHTML = `<p>Não foi possível carregar o dashboard: ${escapeHtml(error.message)}</p>`;
  }
}

$('#refresh-dashboard').addEventListener('click', loadDashboard);

const statusLabels = {
  draft: 'Rascunho', confirmed: 'Confirmado', processing: 'Processando',
  completed: 'Concluído', partial_failed: 'Falha parcial', failed: 'Falhou',
  cancelled: 'Cancelado', pending: 'Pendente', sent: 'Enviado',
};

const toLocalInputValue = value => {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

async function showMessageDetails(id) {
  const message = await request(`/api/messages/${id}`);
  $('#details-content').innerHTML = `
    <div class="detail-grid">
      <div class="detail-item"><strong>Número</strong><br>#${message.id}</div>
      <div class="detail-item"><strong>Situação</strong><br>${escapeHtml(statusLabels[message.status] ?? message.status)}</div>
      <div class="detail-item"><strong>Data programada</strong><br>${new Date(message.scheduledAt).toLocaleString('pt-BR')}</div>
      <div class="detail-item"><strong>Criado em</strong><br>${new Date(message.createdAt).toLocaleString('pt-BR')}</div>
      ${message.recurrenceType === 'weekly' ? `<div class="detail-item"><strong>Repetição</strong><br>Semanal — ocorrência ${message.occurrenceNumber} de ${message.occurrenceCount}</div>` : ''}
    </div>
    ${message.mediaUrl ? `<h3>Foto</h3><img class="detail-image" src="${escapeHtml(message.mediaUrl)}" alt="Foto do agendamento #${message.id}"><p class="muted">${escapeHtml(message.mediaOriginalName ?? '')}</p>` : ''}
    <h3>Mensagem</h3><div class="message-preview">${escapeHtml(message.content)}</div>
    <h3>Grupos e entregas (${message.deliveries.length})</h3>
    ${message.deliveries.map(delivery => `
      <div class="delivery"><strong>${escapeHtml(delivery.groupName)}</strong>
        <span class="badge">${escapeHtml(statusLabels[delivery.status] ?? delivery.status)}</span><br>
        <span class="muted">${escapeHtml(delivery.groupJid)} — tentativas: ${delivery.attemptCount}/${delivery.maxAttempts}</span>
        ${delivery.sentAt ? `<br><span class="muted">Enviado em: ${new Date(delivery.sentAt).toLocaleString('pt-BR')}</span>` : ''}
        ${delivery.errorCode ? `<br><span class="delivery-error">Falha: ${escapeHtml(delivery.errorCode)}${delivery.nextAttemptAt ? ` — nova tentativa em ${new Date(delivery.nextAttemptAt).toLocaleString('pt-BR')}` : ''}</span>` : ''}
      </div>`).join('')}
  `;
  $('#details-dialog').showModal();
}

async function editMessage(id) {
  const message = await request(`/api/messages/${id}`);
  editingMessageId = id;
  const form = $('#message-form');
  form.elements.content.value = message.content;
  form.elements.scheduledAt.value = toLocalInputValue(message.scheduledAt);
  $('#recurrence-type').value = 'none';
  $('#recurrence-type').disabled = true;
  $('#recurrence-count').disabled = true;
  $('#recurrence-count-label').hidden = true;
  selectedMedia = null;
  mediaMode = 'keep';
  if (message.mediaUrl) showImagePreview(message.mediaUrl, message.mediaOriginalName ?? 'Foto atual');
  else hideImagePreview();
  selectedDestinationIds = new Set(message.deliveries.map(delivery => String(delivery.groupId)));
  $('#destination-label-filter').value = 'all';
  renderDestinationGroups();
  $('#save-message').textContent = 'Salvar alterações';
  $('#cancel-edit').hidden = false;
  $('#edit-notice').hidden = false;
  $('#edit-notice').textContent = `Editando o agendamento #${id}. Após salvar, será necessário confirmá-lo novamente.`;
  form.scrollIntoView({ behavior:'smooth', block:'start' });
}

function cancelEditing() {
  editingMessageId = null;
  $('#message-form').reset();
  $('#save-message').textContent = 'Salvar como rascunho';
  $('#cancel-edit').hidden = true;
  $('#edit-notice').hidden = true;
  $('#recurrence-type').disabled = false;
  $('#recurrence-count').disabled = false;
  $('#recurrence-type').value = 'none';
  $('#recurrence-count').value = '4';
  $('#recurrence-count-label').hidden = true;
  $('#recurrence-summary').hidden = true;
  selectedMedia = null;
  selectedDestinationIds.clear();
  mediaMode = 'keep';
  hideImagePreview();
}

function showImagePreview(source, name) {
  $('#image-preview-img').src = source;
  $('#image-preview-name').textContent = name;
  $('#image-preview').hidden = false;
}

function hideImagePreview() {
  $('#image-preview').hidden = true;
  $('#image-preview-img').removeAttribute('src');
  $('#image-preview-name').textContent = '';
  $('#message-image').value = '';
}

const readImage = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1]);
  reader.onerror = () => reject(new Error('Não foi possível ler a foto'));
  reader.readAsDataURL(file);
});

$('#message-image').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Use uma foto JPG, PNG ou WEBP');
    if (file.size > 5 * 1024 * 1024) throw new Error('A foto deve ter no máximo 5 MB');
    selectedMedia = { fileName:file.name, mimeType:file.type, base64:await readImage(file) };
    mediaMode = 'replace';
    showImagePreview(URL.createObjectURL(file), file.name);
  } catch (error) {
    selectedMedia = null;
    hideImagePreview();
    notify(error.message);
  }
});

$('#remove-image').addEventListener('click', () => {
  selectedMedia = null;
  mediaMode = editingMessageId ? 'remove' : 'keep';
  hideImagePreview();
});

function updateRecurrenceSummary() {
  const weekly = $('#recurrence-type').value === 'weekly';
  $('#recurrence-count-label').hidden = !weekly;
  const summary = $('#recurrence-summary');
  if (!weekly || editingMessageId) {
    summary.hidden = true;
    return;
  }
  const count = Number($('#recurrence-count').value);
  const firstValue = $('#message-form').elements.scheduledAt.value;
  if (!Number.isInteger(count) || count < 2 || !firstValue) {
    summary.hidden = true;
    return;
  }
  const first = new Date(firstValue);
  const last = new Date(first.getTime() + ((count - 1) * 7 * 24 * 60 * 60 * 1000));
  summary.textContent = `Serão criados ${count} envios semanais. Primeiro: ${first.toLocaleString('pt-BR')}. Último: ${last.toLocaleString('pt-BR')}.`;
  summary.hidden = false;
}

$('#recurrence-type').addEventListener('change', updateRecurrenceSummary);
$('#recurrence-count').addEventListener('input', updateRecurrenceSummary);
$('#message-form').elements.scheduledAt.addEventListener('change', updateRecurrenceSummary);

$('#group-form').addEventListener('submit', async event => {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.target));
  try { await request('/api/groups', { method:'POST', body:JSON.stringify(data) }); event.target.reset(); await loadGroups(); notify('Grupo cadastrado. Autorize-o antes de usar.'); } catch (error) { notify(error.message); }
});
$('#invite-group-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  const resultBox = $('#invite-group-result');
  button.disabled = true;
  button.textContent = 'Consultando...';
  resultBox.hidden = true;
  resultBox.classList.remove('error');
  try {
    const result = await request('/api/groups/from-invites', {
      method:'POST',
      body:JSON.stringify({ inviteUrls:new FormData(form).get('inviteUrls') }),
    });
    form.reset();
    await loadGroups();
    const lines = result.results.map(item => item.status === 'failed'
      ? `<li class="failed"><strong>Não adicionado:</strong> ${escapeHtml(item.error)}</li>`
      : `<li><strong>${escapeHtml(item.group.displayName)}</strong> — ${escapeHtml(item.group.groupJid)} <span class="muted">${item.status === 'added' ? 'adicionado' : 'já cadastrado'}</span></li>`
    ).join('');
    resultBox.innerHTML = `<strong>Resultado:</strong> ${result.summary.added} adicionado(s), ${result.summary.existing} já cadastrado(s), ${result.summary.failed} recusado(s).<ul>${lines}</ul>`;
    resultBox.hidden = false;
    notify(`${result.summary.added} grupo(s) adicionado(s). Revise e autorize conscientemente.`);
  } catch (error) {
    resultBox.textContent = error.message;
    resultBox.classList.add('error');
    resultBox.hidden = false;
    notify(error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Localizar e adicionar';
  }
});
$('#message-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = new FormData(event.target);
  try {
    const data = {
      content:form.get('content'),
      scheduledAt:new Date(form.get('scheduledAt')).toISOString(),
      groupIds:[...selectedDestinationIds].map(Number),
      ...(!editingMessageId ? {
        recurrenceType:form.get('recurrenceType'),
        recurrenceCount:Number(form.get('recurrenceCount')),
      } : {}),
      ...(selectedMedia ? { media:selectedMedia } : {}),
      ...(editingMessageId ? { mediaMode } : {}),
    };
    const editing = editingMessageId;
    const result = await request(editing ? `/api/messages/${editing}` : '/api/messages', {
      method: editing ? 'PUT' : 'POST', body:JSON.stringify(data),
    });
    cancelEditing();
    await loadMessages();
    showPage('active');
    notify(editing
      ? 'Alterações salvas. Confirme novamente o agendamento.'
      : result.recurrenceType === 'weekly'
        ? `Série com ${result.recurrenceCount} semanas criada. Revise e confirme a série.`
        : 'Rascunho salvo. Revise e confirme.');
  } catch (error) { notify(error.message); }
});
$('#cancel-edit').addEventListener('click', cancelEditing);
$('#close-details').addEventListener('click', () => $('#details-dialog').close());
$('#close-reuse').addEventListener('click', () => $('#reuse-dialog').close());
$('#reuse-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const result = await request(`/api/messages/${form.get('sourceId')}/reuse`, {
      method:'POST',
      body:JSON.stringify({ scheduledAt:new Date(form.get('scheduledAt')).toISOString() }),
    });
    $('#reuse-dialog').close();
    event.currentTarget.reset();
    await Promise.all([loadMessages('active'), loadDashboard()]);
    showPage('active');
    notify(`Novo rascunho #${result.id} criado com ${result.copiedGroups} grupo(s)${result.skippedGroups ? `; ${result.skippedGroups} indisponível(is) foi(ram) ignorado(s)` : ''}.`);
  } catch (error) { notify(error.message); }
});
document.addEventListener('click', async event => {
  const button = event.target.closest('button[data-authorize],button[data-group-labels],button[data-group-edit],button[data-group-revoke],button[data-group-archive],button[data-group-restore],button[data-confirm],button[data-confirm-series],button[data-cancel],button[data-cancel-series],button[data-details],button[data-edit],button[data-delete],button[data-reuse]'); if (!button) return;
  try {
    if (button.dataset.groupLabels) return openGroupLabels(button.dataset.groupLabels);
    if (button.dataset.groupEdit) {
      const group = groups.find(item => String(item.id) === String(button.dataset.groupEdit));
      const displayName = prompt('Nome exibido do grupo:', group?.displayName ?? '');
      if (displayName === null) return;
      await request(`/api/groups/${button.dataset.groupEdit}`, {
        method:'PUT', body:JSON.stringify({ displayName }),
      });
    }
    if (button.dataset.groupRevoke) {
      if (!confirm('Retirar a autorização deste grupo? Ele deixará de receber novos envios.')) return;
      await request(`/api/groups/${button.dataset.groupRevoke}/revoke`, { method:'POST' });
    }
    if (button.dataset.groupArchive) {
      if (!confirm('Arquivar este grupo? O histórico será preservado.')) return;
      await request(`/api/groups/${button.dataset.groupArchive}`, { method:'DELETE' });
    }
    if (button.dataset.groupRestore) {
      await request(`/api/groups/${button.dataset.groupRestore}/restore`, { method:'POST' });
    }
    if (button.dataset.details) return await showMessageDetails(button.dataset.details);
    if (button.dataset.reuse) {
      $('#reuse-source-id').value = button.dataset.reuse;
      const defaultDate = new Date(Date.now() + 60 * 60 * 1000);
      $('#reuse-form').elements.scheduledAt.value = toLocalInputValue(defaultDate);
      $('#reuse-dialog').showModal();
      return;
    }
    if (button.dataset.edit) return await editMessage(button.dataset.edit);
    if (button.dataset.authorize && confirm('Confirma que este grupo pode receber mensagens?')) await request(`/api/groups/${button.dataset.authorize}/authorize`, {method:'POST'});
    if (button.dataset.confirm && confirm('Confirma conteúdo, grupos, data e horário?')) await request(`/api/messages/${button.dataset.confirm}/confirm`, {method:'POST'});
    if (button.dataset.confirmSeries && confirm('Confirmar todos os envios semanais desta série?')) await request(`/api/messages/${button.dataset.confirmSeries}/confirm-series`, {method:'POST'});
    if (button.dataset.cancel && confirm('Cancelar este agendamento?')) await request(`/api/messages/${button.dataset.cancel}/cancel`, {method:'POST'});
    if (button.dataset.cancelSeries && confirm('Cancelar todas as ocorrências futuras desta série?')) await request(`/api/messages/${button.dataset.cancelSeries}/cancel-series`, {method:'POST'});
    if (button.dataset.delete) {
      if (!confirm('Apagar este agendamento da lista? O registro de auditoria será preservado.')) return;
      await request(`/api/messages/${button.dataset.delete}`, {method:'DELETE'});
      if (String(editingMessageId) === String(button.dataset.delete)) cancelEditing();
    }
    await Promise.all([loadGroups(), loadMessages('active'), loadDashboard()]); notify('Operação concluída.');
  } catch (error) { notify(error.message); }
});

await Promise.all([
  loadWhatsappStatus(), loadWorkerStatus(), loadLabels(), loadTemplates(), loadGroups(),
  loadDashboard(), loadMessages('active'),
]);
setInterval(loadWhatsappStatus, 15_000);
setInterval(() => Promise.all([loadWorkerStatus(), loadMessages('active'), loadDashboard()]), 15_000);
