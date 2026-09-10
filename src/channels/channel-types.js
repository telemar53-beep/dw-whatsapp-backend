const OFFICIAL_CHANNEL_TYPES = ['meta_cloud', '360dialog'];

function isOfficialChannelType(type) {
  return OFFICIAL_CHANNEL_TYPES.includes(type);
}

module.exports = { OFFICIAL_CHANNEL_TYPES, isOfficialChannelType };
