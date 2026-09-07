class SgpTemplatePayloadError extends Error {}

function parseSgpTemplatePayload(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new SgpTemplatePayloadError('content is required');
  }
  const segments = raw.split('||');
  const variablesSegment = segments[0];
  if (!variablesSegment.startsWith('variables=')) {
    throw new SgpTemplatePayloadError('content must start with "variables="');
  }
  const variablesRaw = variablesSegment.slice('variables='.length);
  const variables = variablesRaw.length > 0 ? variablesRaw.split('|') : [];

  const fields = {};
  for (const segment of segments.slice(1)) {
    const eqIndex = segment.indexOf('=');
    if (eqIndex === -1) {
      throw new SgpTemplatePayloadError(`Malformed segment "${segment}" — expected key=value`);
    }
    const key = segment.slice(0, eqIndex);
    const value = segment.slice(eqIndex + 1);
    fields[key] = value;
  }

  if (!fields.template) {
    throw new SgpTemplatePayloadError('content must include "template=<name>"');
  }
  const hasHeaderLink = fields.header_link !== undefined;
  const hasHeaderType = fields.header_type !== undefined;
  if (hasHeaderLink !== hasHeaderType) {
    throw new SgpTemplatePayloadError('header_link and header_type must both be present or both be absent');
  }

  return {
    variables,
    templateName: fields.template,
    headerLink: hasHeaderLink ? fields.header_link : null,
    headerType: hasHeaderType ? fields.header_type : null,
  };
}

module.exports = { parseSgpTemplatePayload, SgpTemplatePayloadError };
