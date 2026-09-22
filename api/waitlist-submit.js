const TAG_GROUP_ID = '6a0c9e30923e612330369d32';
const REQUIRED_TAGS_BY_SOURCE = {
  default: {
    'Listing Amplified': '6a0c9e38923e612330369dfa'
  },
  'amplified-agents-directory-form': {
    'Amplified Agents Directory': null
  },
  'larina-matrix-directory-form': {
    'Larina Matrix Directory': null
  }
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

async function ensureRequiredTags(gccApiKey, signupSource = '') {
  const sourceTags = REQUIRED_TAGS_BY_SOURCE[signupSource] || REQUIRED_TAGS_BY_SOURCE.default;
  const tagIds = { ...sourceTags };
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

    if (currentId) {
      tagIds[name] = currentId;
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

/**
 * NEW: Use GCC's tags/fire endpoint to create contact + apply tag in one call.
 * This replaces the broken two-step contact creation + tag attachment.
 */
async function fireTagForContact(gccApiKey, record, tagIds) {
  const payload = {
    phone: record.phone || '',
    email: record.email,
    firstName: record.firstName || '',
    lastName: record.lastName || '',
    tagIds: tagIds
  };

  const result = await fetchJson(`${GCC_BASE}/tags/fire`, {
    method: 'POST',
    headers: {
      'X-API-KEY': gccApiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  return result?.data || result;
}

/**
 * Log sync failures to a file for Robin to review.
 * Failures are silent to the user but tracked for debugging.
 */
function logFailure(record, error, tagIds) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    email: record.email,
    name: `${record.firstName} ${record.lastName}`.trim(),
    signupSource: record.signupSource,
    tagIds,
    error: error?.message || String(error),
    stack: error?.stack || null
  };

  try {
    const fs = require('fs');
    const path = require('path');
    const logPath = path.join('/tmp', 'listing-amplified-gcc-failures.jsonl');
    fs.appendFileSync(logPath, JSON.stringify(logEntry) + '\n');
  } catch (e) {
    console.error('Failed to write failure log:', e);
  }

  console.error('[GCC SYNC FAILURE]', logEntry);
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
    // Get tag IDs (ensures tag exists, looks up by name if needed)
    const requiredTagIds = await ensureRequiredTags(gccApiKey, record.signupSource);

    // Use the new tags/fire endpoint: creates contact + applies tag in one call
    const contactResult = await fireTagForContact(gccApiKey, record, requiredTagIds);

    sendJson(res, 200, {
      ok: true,
      redirected: true,
      syncStatus: 'synced',
      action: contactResult?._id ? 'created_or_updated' : 'fired'
    });
  } catch (error) {
    // Silent failure: user still goes to thank-you page
    // But log it so Robin knows
    logFailure(record, error, []);

    sendJson(res, 200, {
      ok: true,
      redirected: true,
      syncStatus: 'failed',
      warning: 'CRM sync failed, but the signup form completed successfully.'
    });
  }
};
