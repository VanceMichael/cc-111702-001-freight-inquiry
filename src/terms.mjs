export function fingerprint(value) {
  if (Array.isArray(value)) return `[${value.map(fingerprint).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${fingerprint(value[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}

export function validateConditions(conditions, label) {
  if (!conditions || typeof conditions !== 'object' || Array.isArray(conditions)) throw new Error(`${label}须为条件对象`);
  const normalized = {};
  for (const [key, value] of Object.entries(conditions)) {
    if (key === 'address') { if (typeof value !== 'string' || !value) throw new Error(`${label}地址无效`); normalized.address = value; }
    else if (key === 'pieces') { if (!Number.isInteger(value) || value < 1) throw new Error(`${label}件数须为正整数`); normalized.pieces = value; }
    else if (key === 'services') { if (!Array.isArray(value) || !value.length || value.some(item => typeof item !== 'string' || !item)) throw new Error(`${label}服务无效`); normalized.services = [...value].sort(); }
    else if (key === 'floor') { if (!Number.isInteger(value) || value < 0) throw new Error(`${label}楼层无效`); normalized.floor = value; }
    else if (key === 'segments') {
      if (!Array.isArray(value) || !value.length) throw new Error(`${label}分段无效`);
      normalized.segments = value.map(segment => {
        if (!segment || typeof segment !== 'object' || typeof segment.leg !== 'string' || !segment.leg || typeof segment.address !== 'string' || !segment.address) throw new Error(`${label}分段无效`);
        return { leg: segment.leg, address: segment.address };
      });
    } else normalized[key] = value;
  }
  return normalized;
}

export function finalAddress(conditions) {
  return conditions.segments?.length ? conditions.segments[conditions.segments.length - 1].address : conditions.address;
}

export function differentiate(requested, accepted) {
  const differences = [];
  for (const key of new Set([...Object.keys(requested), ...Object.keys(accepted)])) {
    if (key === 'address' && accepted.address === undefined && accepted.segments !== undefined) continue;
    const from = requested[key]; const to = accepted[key];
    if (fingerprint(from) === fingerprint(to)) continue;
    if (key === 'segments') differences.push({ kind: 'addressSplit', field: key, from: requested.address ?? from ?? null, to: to ?? null, sameFinalAddress: finalAddress(accepted) === requested.address });
    else if (key === 'floor') differences.push({ kind: 'floor', field: key, from: from ?? null, to: to ?? null });
    else if (key === 'address') differences.push({ kind: 'address', field: key, from: from ?? null, to: to ?? null });
    else if (key === 'pieces') differences.push({ kind: 'pieces', field: key, from: from ?? null, to: to ?? null });
    else if (key === 'services') differences.push({ kind: 'services', field: key, from: from ?? null, to: to ?? null });
    else differences.push({ kind: 'other', field: key, from: from ?? null, to: to ?? null });
  }
  return differences;
}

export function classify(differences, allow) {
  const rules = new Map((allow ?? []).map(rule => [rule.kind, rule]));
  return differences.map(difference => {
    let authorized = false;
    if (difference.kind === 'floor') authorized = rules.has('floor');
    else if (difference.kind === 'addressSplit') authorized = difference.sameFinalAddress === true && rules.has('addressSplit');
    else if (difference.kind === 'pieces') {
      const rule = rules.get('pieces');
      authorized = Boolean(rule) && Number.isInteger(difference.to) && Number.isInteger(difference.from) && difference.to < difference.from && difference.to >= (rule.min ?? 1);
    }
    return { ...difference, authorized };
  });
}
