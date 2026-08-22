export const normalizeGroupJid = value => String(value ?? '').trim();

export const validateGroup = ({ groupJid, displayName }) => {
  const jid = normalizeGroupJid(groupJid);
  const name = String(displayName ?? '').trim();
  if (!/^[0-9]+(?:-[0-9]+)?@g\.us$/.test(jid)) throw new Error('JID de grupo inválido');
  if (name.length < 2 || name.length > 200) throw new Error('Nome do grupo inválido');
  return { groupJid: jid, displayName: name };
};

export const extractWhatsappInviteCode = rawValue => {
  const value = String(rawValue ?? '').trim();
  let code = value;
  if (/^https?:\/\//i.test(value)) {
    let url;
    try { url = new URL(value); } catch { throw new Error('Link de convite inválido'); }
    if (!['chat.whatsapp.com', 'www.chat.whatsapp.com'].includes(url.hostname.toLowerCase())) {
      throw new Error('Use um link oficial chat.whatsapp.com');
    }
    code = url.pathname.split('/').filter(Boolean)[0] ?? '';
  }
  code = code.split('?')[0].trim();
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(code)) throw new Error('Código de convite inválido');
  return code;
};

export const parseWhatsappInviteLinks = rawValue => {
  const entries = String(rawValue ?? '').split(/[\r\n,;]+/)
    .map(value => value.trim()).filter(Boolean);
  if (!entries.length) throw new Error('Cole ao menos um link de convite');
  if (entries.length > 30) throw new Error('Envie no máximo 30 links por operação');
  return [...new Set(entries)];
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

export const validateRecurrence = ({ recurrenceType, recurrenceCount }) => {
  const type = recurrenceType === 'weekly' ? 'weekly' : 'none';
  if (type === 'none') return { recurrenceType: 'none', recurrenceCount: 1 };
  const count = Number(recurrenceCount);
  if (!Number.isInteger(count) || count < 2 || count > 52) {
    throw new Error('A repetição semanal deve ter entre 2 e 52 envios');
  }
  return { recurrenceType: type, recurrenceCount: count };
};

export const buildOccurrenceDates = (firstScheduledAt, recurrenceCount) => {
  const first = new Date(firstScheduledAt);
  return Array.from({ length: recurrenceCount }, (_, index) =>
    new Date(first.getTime() + (index * 7 * 24 * 60 * 60 * 1000)).toISOString());
};

export const validateLabel = ({ name, color }) => {
  const normalizedName = String(name ?? '').trim();
  const normalizedColor = String(color ?? '#52606d').trim().toLowerCase();
  if (normalizedName.length < 2 || normalizedName.length > 80) {
    throw new Error('A etiqueta deve ter entre 2 e 80 caracteres');
  }
  if (!/^#[0-9a-f]{6}$/.test(normalizedColor)) throw new Error('Cor da etiqueta inválida');
  return { name: normalizedName, color: normalizedColor };
};

export const validateMessageTemplate = ({ name, content }) => {
  const normalizedName = String(name ?? '').trim();
  const normalizedContent = String(content ?? '').trim();
  if (normalizedName.length < 2 || normalizedName.length > 100) {
    throw new Error('O nome do modelo deve ter entre 2 e 100 caracteres');
  }
  if (!normalizedContent || normalizedContent.length > 4096) {
    throw new Error('O texto do modelo deve ter entre 1 e 4096 caracteres');
  }
  return { name: normalizedName, content: normalizedContent };
};
