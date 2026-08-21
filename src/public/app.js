const $ = selector => document.querySelector(selector);
let groups = [];
let editingMessageId = null;

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
    $('#whatsapp-status').innerHTML = `<p><strong>Instância:</strong> ${escapeHtml(status.instanceName)} <span class="badge">${escapeHtml(status.state)}</span> <span class="badge">Envio bloqueado</span></p>`;
    $('#show-qrcode').disabled = connected;
    $('#import-groups').disabled = !connected;
    if (connected) {
      $('#qrcode').innerHTML = '<p class="connected">WhatsApp Business conectado com segurança.</p>';
    }
  } catch (error) {
    $('#whatsapp-status').textContent = `Evolution indisponível: ${error.message}`;
  }
}

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

async function loadGroups() {
  groups = await request('/api/groups');
  renderGroups();
  const authorized = groups.filter(group => group.authorized && group.active && group.sendable);
  $('#group-options').innerHTML = authorized.length ? authorized.map(group => `
    <label class="check"><input type="checkbox" name="groupIds" value="${group.id}"> ${escapeHtml(group.displayName)}</label>`).join('') : 'Nenhum grupo autorizado.';
}

const groupKindLabels = {
  group: 'Grupo comum',
  community: 'Comunidade',
  community_announcement: 'Avisos da comunidade',
  community_subgroup: 'Subgrupo da comunidade',
};

function renderGroups() {
  const search = ($('#group-search')?.value ?? '').trim().toLocaleLowerCase('pt-BR');
  const filter = $('#group-filter')?.value ?? 'all';
  const nameCounts = new Map();
  for (const group of groups) {
    const key = group.displayName.trim().toLocaleLowerCase('pt-BR');
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  const visible = groups.filter(group => {
    const matchesSearch = !search || `${group.displayName} ${group.groupJid}`.toLocaleLowerCase('pt-BR').includes(search);
    const matchesFilter = filter === 'all'
      || group.groupKind === filter
      || (filter === 'authorized' && group.authorized)
      || (filter === 'pending' && !group.authorized);
    return matchesSearch && matchesFilter;
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
          <span class="badge">${group.authorized ? 'Autorizado' : 'Aguardando autorização'}</span>
          ${!group.sendable ? '<span class="badge warning">Contêiner de comunidade — não enviável</span>' : ''}
          ${group.authorized || !group.sendable ? '' : `<button data-authorize="${group.id}">Autorizar conscientemente</button>`}
        </div>
      </div>`;
  }).join('') : '<p>Nenhum grupo corresponde aos filtros.</p>';
}

$('#group-search').addEventListener('input', renderGroups);
$('#group-filter').addEventListener('change', renderGroups);

async function loadMessages() {
  const messages = await request('/api/messages');
  $('#messages').innerHTML = messages.length ? messages.map(message => `
    <article class="schedule-card ${escapeHtml(message.status)}">
      <div class="schedule-head">
        <div><span class="schedule-id">Agendamento #${message.id}</span> <span class="badge status-${escapeHtml(message.status)}">${escapeHtml(statusLabels[message.status] ?? message.status)}</span></div>
        <div class="schedule-date">${new Date(message.scheduledAt).toLocaleString('pt-BR')}</div>
      </div>
      <p><strong>${message.groupCount} grupo(s) de destino</strong></p>
      <div class="message-preview">${escapeHtml(message.content)}</div>
      <div class="card-actions">
        <button class="secondary" data-details="${message.id}">Ver detalhes</button>
        ${['draft','confirmed'].includes(message.status) ? `<button class="secondary" data-edit="${message.id}">Editar</button>` : ''}
        ${message.status === 'draft' ? `<button data-confirm="${message.id}">Confirmar agendamento</button>` : ''}
        ${['draft','confirmed'].includes(message.status) ? `<button class="danger" data-cancel="${message.id}">Cancelar</button>` : ''}
        ${['draft','confirmed','cancelled'].includes(message.status) ? `<button class="danger" data-delete="${message.id}">Apagar</button>` : ''}
      </div>
    </article>`).join('') : '<p>Nenhum agendamento criado.</p>';
}

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
    </div>
    <h3>Mensagem</h3><div class="message-preview">${escapeHtml(message.content)}</div>
    <h3>Grupos e entregas (${message.deliveries.length})</h3>
    ${message.deliveries.map(delivery => `
      <div class="delivery"><strong>${escapeHtml(delivery.groupName)}</strong>
        <span class="badge">${escapeHtml(statusLabels[delivery.status] ?? delivery.status)}</span><br>
        <span class="muted">${escapeHtml(delivery.groupJid)} — tentativas: ${delivery.attemptCount}/${delivery.maxAttempts}</span>
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
  const selected = new Set(message.deliveries.map(delivery => String(delivery.groupId)));
  form.querySelectorAll('input[name="groupIds"]').forEach(input => { input.checked = selected.has(input.value); });
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
}

$('#group-form').addEventListener('submit', async event => {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.target));
  try { await request('/api/groups', { method:'POST', body:JSON.stringify(data) }); event.target.reset(); await loadGroups(); notify('Grupo cadastrado. Autorize-o antes de usar.'); } catch (error) { notify(error.message); }
});
$('#message-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = new FormData(event.target);
  try {
    const data = { content:form.get('content'), scheduledAt:new Date(form.get('scheduledAt')).toISOString(), groupIds:form.getAll('groupIds').map(Number) };
    const editing = editingMessageId;
    await request(editing ? `/api/messages/${editing}` : '/api/messages', {
      method: editing ? 'PUT' : 'POST', body:JSON.stringify(data),
    });
    cancelEditing();
    await loadMessages();
    notify(editing ? 'Alterações salvas. Confirme novamente o agendamento.' : 'Rascunho salvo. Revise e confirme.');
  } catch (error) { notify(error.message); }
});
$('#cancel-edit').addEventListener('click', cancelEditing);
$('#close-details').addEventListener('click', () => $('#details-dialog').close());
document.addEventListener('click', async event => {
  const button = event.target.closest('button[data-authorize],button[data-confirm],button[data-cancel],button[data-details],button[data-edit],button[data-delete]'); if (!button) return;
  try {
    if (button.dataset.details) return await showMessageDetails(button.dataset.details);
    if (button.dataset.edit) return await editMessage(button.dataset.edit);
    if (button.dataset.authorize && confirm('Confirma que este grupo pode receber mensagens?')) await request(`/api/groups/${button.dataset.authorize}/authorize`, {method:'POST'});
    if (button.dataset.confirm && confirm('Confirma conteúdo, grupos, data e horário?')) await request(`/api/messages/${button.dataset.confirm}/confirm`, {method:'POST'});
    if (button.dataset.cancel && confirm('Cancelar este agendamento?')) await request(`/api/messages/${button.dataset.cancel}/cancel`, {method:'POST'});
    if (button.dataset.delete) {
      if (!confirm('Apagar este agendamento da lista? O registro de auditoria será preservado.')) return;
      await request(`/api/messages/${button.dataset.delete}`, {method:'DELETE'});
      if (String(editingMessageId) === String(button.dataset.delete)) cancelEditing();
    }
    await Promise.all([loadGroups(), loadMessages()]); notify('Operação concluída.');
  } catch (error) { notify(error.message); }
});

await Promise.all([loadWhatsappStatus(), loadGroups(), loadMessages()]);
setInterval(loadWhatsappStatus, 15_000);
