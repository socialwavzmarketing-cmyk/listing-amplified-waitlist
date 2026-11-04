/**
 * Error Logging Endpoint for Listing Amplified
 * 
 * Captures client-side errors (e.g., Partnero failures) for monitoring.
 * 
 * Usage from browser:
 *   fetch('/api/log-error', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({
 *       type: 'partnero_signup_failed',
 *       error: error.message,
 *       email: userEmail,
 *       timestamp: new Date().toISOString()
 *     })
 *   });
 */

export default async function handler(req, res) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { type, error, email, timestamp, ...extra } = req.body;

    // Validate required fields
    if (!type) {
      return res.status(400).json({ error: 'Missing required field: type' });
    }

    // Build log entry
    const logEntry = {
      type,
      error: error || 'No error message provided',
      email: email || null,
      timestamp: timestamp || new Date().toISOString(),
      userAgent: req.headers['user-agent'] || null,
      ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null,
      ...extra
    };

    // Log to console (visible in Vercel logs)
    console.error('[LISTING_AMPLIFIED_ERROR]', JSON.stringify(logEntry));

    // Optional: Write to a persistent log file or external service
    // For now, we rely on Vercel's log retention

    return res.status(200).json({ 
      ok: true, 
      message: 'Error logged successfully' 
    });

  } catch (err) {
    // Even logging failed — log this too
    console.error('[LOG_ERROR_FAILED]', err.message);
    
    return res.status(500).json({ 
      error: 'Failed to log error',
      details: err.message 
    });
  }
}
