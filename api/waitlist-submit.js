const TAG_GROUP_ID = '6a0c9e30923e612330369d32';
const REQUIRED_TAGS = {
  'Listing Amplified': '6a0c9e38923e612330369dfa'
};

const GCC_BASE = 'https://api.globalcontrol.io/api/ai';

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function normalizeEmail(value = '') {
  return String(value).trim().toLowerCase();
}

function splitName(firstName = '', lastName = '', fullName = '') {
  const first = String(firstName || '').trim();
  const last = String(lastName || '').trim();
  if (first || last) {
    return { firstName: first, lastName: last, fullName: [first, last].filter(Boolean).join(' ').trim() };
  }

  const clean = String(fullName || '').trim();
  if (!clean) return { firstName: '', lastName: '', fullName: '' };
  const parts = clean.split(/\s+/);
  return {
    firstName: parts.shift() || '',
    lastName: parts.join(' '),
    fullName: clean
  };
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function buildAddress(payload) {
  const address1 = String(payload.address1 || '').trim();
  const address2 = String(payload.address2 || '').trim();
  const city = String(payload.city || '').trim();
  const state = String(payload.state || '').trim();
  const zip = String(payload.zip || payload.postalCode || '').trim();
  const formatted = [address1, address2, [city, state].filter(Boolean).join(', '), zip].filter(Boolean).join(', ');

  return {
    address1,
    address2,
    city,
    state,
    zip,
    formatted
  };
}

function buildSubmissionRecord(payload) {
  const email = normalizeEmail(payload.email);
  const names = splitName(payload.firstName, payload.lastName, payload.fullName);
  const serviceArea = String(payload.serviceArea || payload.market || '').trim();
  const role = String(payload.agentType || payload.role || '').trim();
  const brokerage = String(payload.brokerage || '').trim();
  const phone = String(payload.phone || '').trim();
  const address = buildAddress(payload);
  const signupSource = String(payload.signupSource || '').trim() || 'listing-amplified-waitlist';
  const pagePath = String(payload.pagePath || '').trim() || '/';

  return {
    firstName: names.firstName,
    lastName: names.lastName,
    fullName: names.fullName,
    email,
    phone,
    role,
    brokerage,
    serviceArea,
    address,
    signupSource,
    pagePath,
    submittedAt: new Date().toISOString()
  };
}

function validateSubmission(record) {
  if (!record.firstName) return 'First name is required.';
  if (!record.lastName) return 'Last name is required.';
  if (!record.email) return 'Email is required.';
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email);
  if (!emailOk) return 'Please enter a valid email address.';
  return null;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error('Invalid JSON body.');
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const message = data?.error?.message || data?.message || data?.error || text || `Request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = data;
    throw error;
  }

  return data;
}

function buildMeta(record, existingMeta = []) {
  const additions = [
    record.role ? `role:${record.role}` : '',
    record.brokerage ? `brokerage:${record.brokerage}` : '',
    record.serviceArea ? `service-area:${record.serviceArea}` : '',
    record.address?.city ? `city:${record.address.city}` : '',
    record.address?.state ? `state:${record.address.state}` : '',
    record.signupSource ? `signup-source:${record.signupSource}` : '',
    record.pagePath ? `page:${record.pagePath}` : ''
  ];
  return uniqueStrings([...(Array.isArray(existingMeta) ? existingMeta : []), ...additions]);
}

function buildCustomFields(record) {
  const fields = [];
  if (record.signupSource) fields.push({ name: 'source', value: record.signupSource });
  if (record.role) fields.push({ name: 'role', value: record.role });
  if (record.serviceArea) fields.push({ name: 'service-area', value: record.serviceArea });
  if (record.address?.address1) fields.push({ name: 'address1', value: record.address.address1 });
  if (record.address?.address2) fields.push({ name: 'address2', value: record.address.address2 });
  if (record.address?.city) fields.push({ name: 'city', value: record.address.city });
  if (record.address?.state) fields.push({ name: 'state', value: record.address.state });
  if (record.address?.zip) fields.push({ name: 'zip', value: record.address.zip });
  return fields;
}

function mergeCustomFields(existing = [], incoming = []) {
  const map = new Map();
  for (const f of existing) {
    if (f?.name) map.set(f.name, f);
  }
  for (const f of incoming) {
    if (f?.name) map.set(f.name, f);
  }
  return Array.from(map.values());
}

async function ensureRequiredTags(gccApiKey) {
  const tagIds = { ...REQUIRED_TAGS };
  const existing = await fetchJson(`${GCC_BASE}/tags?limit=2000`, {
    headers: { 'X-API-KEY': gccApiKey }
  });
  const tags = Array.isArray(existing?.data) ? existing.data : [];

  for (const [name, currentId] of Object.entries(tagIds)) {
    const matched = tags.find((tag) => String(tag.name || '').toLowerCase() === name.toLowerCase());
    if (matched?._id) {
      tagIds[name] = matched._id;
      continue;
    }

    const created = await fetchJson(`${GCC_BASE}/tags`, {
      method: 'POST',
      headers: {
        'X-API-KEY': gccApiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name, groupId: TAG_GROUP_ID })
    });

    const createdTag = created?.data;
    if (!createdTag?._id) throw new Error(`Failed to create GCC tag: ${name}`);
    tagIds[name] = createdTag._id;
  }

  return Object.values(tagIds);
}

async function findExistingContact(gccApiKey, email) {
  const response = await fetchJson(`${GCC_BASE}/contacts?search=${encodeURIComponent(email)}`, {
    headers: { 'X-API-KEY': gccApiKey }
  });
  const contacts = response?.data?.contacts || [];
  return contacts.find((contact) => normalizeEmail(contact.email) === email) || null;
}

async function getContactById(gccApiKey, id) {
  const response = await fetchJson(`${GCC_BASE}/contacts/${id}`, {
    headers: { 'X-API-KEY': gccApiKey }
  });
  return response?.data || null;
}

function buildTaggedUpsertPayload(record, tagIds = [], base = {}) {
  return {
    firstName: record.firstName || base.firstName || '',
    lastName: record.lastName || base.lastName || '',
    name: record.fullName || base.name || '',
    email: record.email,
    phone: record.phone || base.phone || '',
    address: record.address?.formatted || record.serviceArea || base.address || '',
    ipAddress: '127.0.0.1',
    tagIds
  };
}

async function createOrUpdateGccContact(gccApiKey, record) {
  const requiredTagIds = await ensureRequiredTags(gccApiKey);
  const existingContact = await findExistingContact(gccApiKey, record.email);
  const existingDetails = existingContact?._id ? await getContactById(gccApiKey, existingContact._id) : null;

  const result = await fetchJson(`${GCC_BASE}/contacts`, {
    method: 'POST',
    headers: {
      'X-API-KEY': gccApiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(buildTaggedUpsertPayload(record, requiredTagIds, existingDetails || existingContact || {}))
  });

  const contact = result?.data || null;
  const action = existingContact ? 'updated' : 'created';
  const saved = contact?._id ? await getContactById(gccApiKey, contact._id) : contact;
  const savedTags = Array.isArray(saved?.tags) ? saved.tags.map(String) : [];
  const missing = requiredTagIds.filter((tagId) => !savedTags.includes(String(tagId)));
  if (missing.length) {
    const error = new Error(`GCC contact ${action}, but required tags were not persisted. Missing tag IDs: ${missing.join(', ')}`);
    error.partial = true;
    error.contact = saved || contact;
    throw error;
  }

  return { action, contact: saved || contact };
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error.message });
    return;
  }

  const record = buildSubmissionRecord(body);
  const validationError = validateSubmission(record);
  if (validationError) {
    sendJson(res, 400, { ok: false, error: validationError });
    return;
  }

  const gccApiKey = process.env.GLOBAL_CONTROL_API_KEY || process.env.GCC_API_KEY || '';

  if (!gccApiKey) {
    sendJson(res, 200, {
      ok: true,
      redirected: true,
      syncStatus: 'skipped',
      configNeeded: ['GLOBAL_CONTROL_API_KEY (or GCC_API_KEY)']
    });
    return;
  }

  try {
    const syncResult = await createOrUpdateGccContact(gccApiKey, record);

    sendJson(res, 200, {
      ok: true,
      redirected: true,
      syncStatus: 'synced',
      action: syncResult.action
    });
  } catch (error) {
    console.error('GCC waitlist sync failed.', error);

    sendJson(res, 200, {
      ok: true,
      redirected: true,
      syncStatus: 'failed',
      warning: 'CRM sync failed, but the signup form completed successfully.'
    });
  }
};
