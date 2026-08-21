const $ = selector => document.querySelector(selector);
let groups = [];

const notify = message => {
  const toast = $('#toast'); toast.textContent = message; toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, 3500);
};
const request = async (url, options = {}) => {
  const response = await fetch(url, { ...options, headers: { 'Content-Type':'application/json', ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Operação recusada');
  return data;
};
const escapeHtml = value => String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));

async function loadGroups() {
  groups = await request('/api/groups');
  $('#groups').innerHTML = groups.length ? groups.map(group => `
    <div class="card row"><strong>${escapeHtml(group.displayName)}</strong>
      <span class="badge">${escapeHtml(group.groupJid)}</span>
      <span class="badge">${group.authorized ? 'Autorizado' : 'Aguardando autorização'}</span>
      ${group.authorized ? '' : `<button data-authorize="${group.id}">Autorizar conscientemente</button>`}
    </div>`).join('') : '<p>Nenhum grupo cadastrado.</p>';
  const authorized = groups.filter(group => group.authorized && group.active);
  $('#group-options').innerHTML = authorized.length ? authorized.map(group => `
    <label class="check"><input type="checkbox" name="groupIds" value="${group.id}"> ${escapeHtml(group.displayName)}</label>`).join('') : 'Nenhum grupo autorizado.';
}

async function loadMessages() {
  const messages = await request('/api/messages');
  $('#messages').innerHTML = messages.length ? messages.map(message => `
    <article class="card">
      <div class="row"><strong>#${message.id}</strong><span class="badge">${escapeHtml(message.status)}</span><span>${message.groupCount} grupo(s)</span><span>${new Date(message.scheduledAt).toLocaleString('pt-BR')}</span></div>
      <p>${escapeHtml(message.content)}</p>
      <div class="card-actions">
        ${message.status === 'draft' ? `<button data-confirm="${message.id}">Confirmar agendamento</button>` : ''}
        ${['draft','confirmed'].includes(message.status) ? `<button class="danger" data-cancel="${message.id}">Cancelar</button>` : ''}
      </div>
    </article>`).join('') : '<p>Nenhum agendamento criado.</p>';
}

$('#group-form').addEventListener('submit', async event => {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.target));
  try { await request('/api/groups', { method:'POST', body:JSON.stringify(data) }); event.target.reset(); await loadGroups(); notify('Grupo cadastrado. Autorize-o antes de usar.'); } catch (error) { notify(error.message); }
});
$('#message-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = new FormData(event.target);
  try {
    const data = { content:form.get('content'), scheduledAt:new Date(form.get('scheduledAt')).toISOString(), groupIds:form.getAll('groupIds').map(Number) };
    await request('/api/messages', { method:'POST', body:JSON.stringify(data) }); event.target.reset(); await loadMessages(); notify('Rascunho salvo. Revise e confirme.');
  } catch (error) { notify(error.message); }
});
document.addEventListener('click', async event => {
  const button = event.target.closest('button[data-authorize],button[data-confirm],button[data-cancel]'); if (!button) return;
  try {
    if (button.dataset.authorize && confirm('Confirma que este grupo pode receber mensagens?')) await request(`/api/groups/${button.dataset.authorize}/authorize`, {method:'POST'});
    if (button.dataset.confirm && confirm('Confirma conteúdo, grupos, data e horário?')) await request(`/api/messages/${button.dataset.confirm}/confirm`, {method:'POST'});
    if (button.dataset.cancel && confirm('Cancelar este agendamento?')) await request(`/api/messages/${button.dataset.cancel}/cancel`, {method:'POST'});
    await Promise.all([loadGroups(), loadMessages()]); notify('Operação concluída.');
  } catch (error) { notify(error.message); }
});

await Promise.all([loadGroups(), loadMessages()]);
