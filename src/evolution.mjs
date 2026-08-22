const baseUrl = process.env.EVOLUTION_URL ?? 'http://evolution:8080';
const apiKey = process.env.EVOLUTION_API_KEY;

const evolutionRequest = async (path, options = {}) => {
  const { timeoutMs = 20_000, ...fetchOptions } = options;
  if (!apiKey) throw new Error('EVOLUTION_API_KEY não configurada');
  const response = await fetch(`${baseUrl}${path}`, {
    ...fetchOptions,
    headers: { apikey: apiKey, 'Content-Type': 'application/json', ...fetchOptions.headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { message: text.slice(0, 300) }; }
  if (!response.ok) {
    const message = payload?.response?.message?.[0] ?? payload?.message ?? `HTTP ${response.status}`;
    throw new Error(`Evolution recusou a operação: ${String(message).slice(0, 300)}`);
  }
  return payload;
};

export const fetchInstances = () => evolutionRequest('/instance/fetchInstances');
export const createInstance = instanceName => evolutionRequest('/instance/create', {
  method: 'POST',
  body: JSON.stringify({ instanceName, qrcode: true, integration: 'WHATSAPP-BAILEYS' }),
});
export const connectInstance = instanceName => evolutionRequest(`/instance/connect/${encodeURIComponent(instanceName)}`);
export const fetchGroups = instanceName => evolutionRequest(
  `/group/fetchAllGroups/${encodeURIComponent(instanceName)}?getParticipants=false`,
  { timeoutMs: 180_000 },
);
export const fetchLabels = instanceName => evolutionRequest(
  `/label/findLabels/${encodeURIComponent(instanceName)}`,
);
export const fetchGroupInviteInfo = (instanceName, inviteCode) => evolutionRequest(
  `/group/inviteInfo/${encodeURIComponent(instanceName)}?inviteCode=${encodeURIComponent(inviteCode)}`,
  { timeoutMs: 45_000 },
);
export const sendTextMessage = (instanceName, number, text) => evolutionRequest(
  `/message/sendText/${encodeURIComponent(instanceName)}`,
  {
    method: 'POST',
    body: JSON.stringify({ number, text, delay: 1_000 }),
    timeoutMs: 45_000,
  },
);
export const sendImageMessage = (instanceName, number, caption, mediaBase64, mimeType, fileName) => evolutionRequest(
  `/message/sendMedia/${encodeURIComponent(instanceName)}`,
  {
    method: 'POST',
    body: JSON.stringify({
      number,
      mediatype: 'image',
      mimetype: mimeType,
      caption,
      media: mediaBase64,
      fileName,
      delay: 1_000,
    }),
    timeoutMs: 60_000,
  },
);

export const findInstance = (payload, instanceName) => {
  const instances = Array.isArray(payload) ? payload : payload?.instances ?? [];
  return instances.find(item =>
    item?.name === instanceName || item?.instance?.instanceName === instanceName || item?.instanceName === instanceName,
  );
};

export const normalizeGroups = payload => {
  const groups = Array.isArray(payload) ? payload : payload?.groups ?? payload?.data ?? [];
  return groups.map(group => {
    const communityJid = String(group?.linkedParent ?? group?.parentGroupJid ?? '').trim() || null;
    const isCommunity = Boolean(group?.isCommunity);
    const isAnnouncement = Boolean(group?.isCommunityAnnounce ?? group?.isCommunityAnnouncement);
    const groupKind = isAnnouncement
      ? 'community_announcement'
      : isCommunity
        ? 'community'
        : communityJid
          ? 'community_subgroup'
          : 'group';
    return {
      groupJid: String(group?.id ?? group?.remoteJid ?? '').trim(),
      displayName: String(group?.subject ?? group?.name ?? '').trim(),
      groupKind,
      communityJid,
      sendable: groupKind !== 'community',
    };
  }).filter(group => /^[0-9]+(?:-[0-9]+)?@g\.us$/.test(group.groupJid) && group.displayName);
};

export const normalizeLabels = payload => {
  const labels = Array.isArray(payload) ? payload : payload?.labels ?? payload?.data ?? [];
  return labels.map(label => ({
    externalId: String(label?.id ?? label?.labelId ?? '').trim(),
    name: String(label?.name ?? label?.labelName ?? '').trim(),
    color: /^#[0-9a-f]{6}$/i.test(String(label?.color ?? ''))
      ? String(label.color).toLowerCase() : '#52606d',
  })).filter(label => label.externalId && label.name);
};

export const normalizeInviteGroup = payload => {
  const group = payload?.group ?? payload?.data?.group ?? payload?.data ?? payload;
  return {
    groupJid: String(group?.id ?? group?.groupJid ?? group?.jid ?? '').trim(),
    displayName: String(group?.subject ?? group?.name ?? '').trim(),
  };
};
