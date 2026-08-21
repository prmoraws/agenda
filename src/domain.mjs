export const normalizeGroupJid = value => String(value ?? '').trim();

export const validateGroup = ({ groupJid, displayName }) => {
  const jid = normalizeGroupJid(groupJid);
  const name = String(displayName ?? '').trim();
  if (!/^[0-9]+(?:-[0-9]+)?@g\.us$/.test(jid)) throw new Error('JID de grupo inválido');
  if (name.length < 2 || name.length > 200) throw new Error('Nome do grupo inválido');
  return { groupJid: jid, displayName: name };
};

export const validateDraft = ({ content, scheduledAt, groupIds }) => {
  const message = String(content ?? '').trim();
  if (!message || message.length > 4096) throw new Error('Mensagem deve ter entre 1 e 4096 caracteres');
  const when = new Date(scheduledAt);
  if (Number.isNaN(when.getTime())) throw new Error('Data e horário inválidos');
  if (when.getTime() <= Date.now()) throw new Error('Agendamento deve estar no futuro');
  const ids = [...new Set((Array.isArray(groupIds) ? groupIds : []).map(Number))]
    .filter(id => Number.isSafeInteger(id) && id > 0);
  if (!ids.length) throw new Error('Selecione ao menos um grupo');
  return { content: message, scheduledAt: when.toISOString(), groupIds: ids };
};
