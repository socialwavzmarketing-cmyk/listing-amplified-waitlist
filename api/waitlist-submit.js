const TAG_GROUP_ID = '6a0c9e30923e612330369d32';
const REQUIRED_TAGS = {
  'Listing Amplified': '6a0c9e38923e612330369dfa'
};

const CONTROL_BOARD_BASE = 'https://control.clawlauncher.io/api';
const GCC_BASE = 'https://api.globalcontrol.io/api/ai';
const WAITLIST_CATEGORY = 'Listing Amplified Waitlist';
const WAITLIST_RECORD_TAG = 'listing-amplified-waitlist';
const WAITLIST_FAILURE_TAG = 'waitlist-sync-failed';

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

async function verifyTagPersistence(gccApiKey, contactId, requiredTagIds) {
  const saved = await getContactById(gccApiKey, contactId);
  const savedTags = Array.isArray(saved?.tags) ? saved.tags.map(String) : [];
  const missing = requiredTagIds.filter((tagId) => !savedTags.includes(String(tagId)));
  return { saved, missing };
}

async function createOrUpdateGccContact(gccApiKey, record) {
  const requiredTagIds = await ensureRequiredTags(gccApiKey);
  const existingContact = await findExistingContact(gccApiKey, record.email);

  const minimalPayload = (base = {}) => ({
    firstName: record.firstName || base.firstName || '',
    lastName: record.lastName || base.lastName || '',
    name: record.fullName || base.name || '',
    email: record.email,
    phone: record.phone || base.phone || '',
    address: record.address?.formatted || record.serviceArea || base.address || '',
    tags: uniqueStrings([...(base.tags || []), ...requiredTagIds])
  });

  const richPayload = (base = {}) => ({
    ...base,
    ...minimalPayload(base),
    meta: buildMeta(record, base.meta),
    customFields: mergeCustomFields(base.customFields, buildCustomFields(record))
  });

  if (!existingContact) {
    let created;
    try {
      created = await fetchJson(`${GCC_BASE}/contacts`, {
        method: 'POST',
        headers: {
          'X-API-KEY': gccApiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(richPayload())
      });
    } catch (error) {
      if (![400, 422].includes(error.status)) throw error;
      created = await fetchJson(`${GCC_BASE}/contacts`, {
        method: 'POST',
        headers: {
          'X-API-KEY': gccApiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(minimalPayload())
      });
    }

    const contact = created?.data || null;
    if (contact?._id) {
      const verification = await verifyTagPersistence(gccApiKey, contact._id, requiredTagIds);
      if (verification.missing.length) {
        const error = new Error(`GCC contact created, but required tags were not persisted. Missing tag IDs: ${verification.missing.join(', ')}`);
        error.partial = true;
        error.contact = verification.saved || contact;
        throw error;
      }
      return { action: 'created', contact: verification.saved || contact };
    }

    return { action: 'created', contact };
  }

  const fullExisting = await getContactById(gccApiKey, existingContact._id);
  let updated;
  try {
    updated = await fetchJson(`${GCC_BASE}/contacts/${existingContact._id}`, {
      method: 'PUT',
      headers: {
        'X-API-KEY': gccApiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(richPayload(fullExisting || existingContact))
    });
  } catch (error) {
    if (![400, 422].includes(error.status)) throw error;
    updated = await fetchJson(`${GCC_BASE}/contacts/${existingContact._id}`, {
      method: 'PUT',
      headers: {
        'X-API-KEY': gccApiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(minimalPayload(fullExisting || existingContact))
    });
  }

  const contact = updated?.data || null;
  const verification = await verifyTagPersistence(gccApiKey, existingContact._id, requiredTagIds);
  if (verification.missing.length) {
    const error = new Error(`GCC contact updated, but required tags were not persisted. Missing tag IDs: ${verification.missing.join(', ')}`);
    error.partial = true;
    error.contact = verification.saved || contact;
    throw error;
  }

  return { action: 'updated', contact: verification.saved || contact };
}

async function listIdeas(controlBoardToken) {
  const response = await fetchJson(`${CONTROL_BOARD_BASE}/ideas`, {
    headers: { Authorization: `Bearer ${controlBoardToken}` }
  });
  return response?.ideas || [];
}

function buildHistoryLine(record, syncStatus, syncMessage = '') {
  const stamp = new Date().toISOString();
  return [
    `- ${stamp}`,
    `status: ${syncStatus}`,
    `name: ${record.fullName}`,
    `email: ${record.email}`,
    `phone: ${record.phone || '[blank]'}`,
    `role: ${record.role || '[blank]'}`,
    `brokerage: ${record.brokerage || '[blank]'}`,
    `service area: ${record.serviceArea || '[blank]'}`,
    `address: ${record.address?.formatted || '[blank]'}`,
    `source: ${record.signupSource}`,
    `page: ${record.pagePath}`,
    syncMessage ? `note: ${syncMessage}` : ''
  ].filter(Boolean).join('\n');
}

async function upsertSubmissionRecord(controlBoardToken, record, syncStatus, syncMessage = '') {
  if (!controlBoardToken) {
    return { ok: false, skipped: true, reason: 'Missing CONTROLBOARD_API_TOKEN' };
  }

  const title = `Listing Amplified Waitlist - ${record.email}`;
  const ideas = await listIdeas(controlBoardToken);
  const existing = ideas.find((idea) => String(idea.title || '').toLowerCase() === title.toLowerCase());
  const line = buildHistoryLine(record, syncStatus, syncMessage);

  if (!existing) {
    const created = await fetchJson(`${CONTROL_BOARD_BASE}/ideas`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${controlBoardToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title,
        description: line,
        category: WAITLIST_CATEGORY,
        status: 'active',
        priority: syncStatus === 'sync_failed' ? 'high' : 'medium',
        tags: uniqueStrings([
          WAITLIST_RECORD_TAG,
          record.signupSource,
          syncStatus === 'sync_failed' ? WAITLIST_FAILURE_TAG : 'waitlist-synced'
        ])
      })
    });
    return { ok: true, created: true, id: created?.id || null };
  }

  const existingDescription = String(existing.description || '').trim();
  const existingTags = Array.isArray(existing.tags) ? existing.tags : [];
  await fetchJson(`${CONTROL_BOARD_BASE}/ideas`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${controlBoardToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      id: existing.id,
      title: existing.title,
      description: `${existingDescription ? `${existingDescription}\n\n` : ''}${line}`,
      category: existing.category || WAITLIST_CATEGORY,
      status: existing.status || 'active',
      priority: syncStatus === 'sync_failed' ? 'high' : (existing.priority || 'medium'),
      tags: uniqueStrings([
        ...existingTags,
        WAITLIST_RECORD_TAG,
        record.signupSource,
        syncStatus === 'sync_failed' ? WAITLIST_FAILURE_TAG : 'waitlist-synced'
      ])
    })
  });

  return { ok: true, created: false, id: existing.id };
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
  const controlBoardToken = process.env.CONTROLBOARD_API_TOKEN || '';

  let localRecordResult = null;
  try {
    localRecordResult = await upsertSubmissionRecord(controlBoardToken, record, gccApiKey ? 'pending_sync' : 'config_missing', gccApiKey ? 'Initial waitlist submission captured before CRM sync.' : 'Missing GLOBAL_CONTROL_API_KEY / GCC_API_KEY in deployment environment.');
  } catch (error) {
    console.error('Failed to persist waitlist submission record before CRM sync.', error);
  }

  if (!gccApiKey) {
    sendJson(res, 200, {
      ok: true,
      redirected: true,
      syncStatus: 'skipped',
      localRecordSaved: Boolean(localRecordResult?.ok),
      configNeeded: ['GLOBAL_CONTROL_API_KEY (or GCC_API_KEY)', 'CONTROLBOARD_API_TOKEN (recommended for durable submission log + retry queue)']
    });
    return;
  }

  try {
    const syncResult = await createOrUpdateGccContact(gccApiKey, record);
    try {
      await upsertSubmissionRecord(controlBoardToken, record, 'synced', `GCC contact ${syncResult.action}.`);
    } catch (error) {
      console.error('Failed to mark waitlist submission as synced.', error);
    }

    sendJson(res, 200, {
      ok: true,
      redirected: true,
      syncStatus: 'synced',
      action: syncResult.action,
      localRecordSaved: Boolean(localRecordResult?.ok)
    });
  } catch (error) {
    console.error('GCC waitlist sync failed.', error);
    try {
      await upsertSubmissionRecord(controlBoardToken, record, 'sync_failed', error.message || 'Unknown GCC sync failure');
    } catch (logError) {
      console.error('Failed to log GCC sync failure for retry.', logError);
    }

    sendJson(res, 200, {
      ok: true,
      redirected: true,
      syncStatus: 'failed_logged',
      localRecordSaved: Boolean(localRecordResult?.ok),
      retryLogged: Boolean(controlBoardToken),
      warning: 'CRM sync failed, but the signup was logged for retry if Control Board logging is configured.'
    });
  }
};
