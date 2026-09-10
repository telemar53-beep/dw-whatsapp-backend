export const OFFICIAL_CHANNEL_TYPES = ['meta_cloud', '360dialog'];

export function isOfficialChannelType(type) {
  return OFFICIAL_CHANNEL_TYPES.includes(type);
}

const CHANNEL_TYPE_LABELS = {
  meta_cloud: 'Meta Cloud (oficial)',
  '360dialog': '360dialog (oficial)',
  baileys: 'Baileys (não oficial)',
};

export function channelTypeLabel(type) {
  return CHANNEL_TYPE_LABELS[type] || type;
}
