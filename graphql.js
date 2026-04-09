/**
 * Vercel Serverless Function: GraphQL Proxy
 *
 * Handles OAuth2 token exchange server-side (bypassing Okta's browser block)
 * and proxies GraphQL requests to the Firstbase API.
 */

const https = require('https');

// ===== CONFIG (from Vercel environment variables) =====
const AUTH_URL = 'https://auth.firstbasehq.com/oauth2/default/v1/token';
const GRAPHQL_URL = 'https://api.firstbasehq.com/graphql';

function getBasicAuth() {
  const id = process.env.FIRSTBASE_CLIENT_ID;
  const secret = process.env.FIRSTBASE_CLIENT_SECRET;
  if (!id || !secret) throw new Error('Missing FIRSTBASE_CLIENT_ID or FIRSTBASE_CLIENT_SECRET env vars');
  return Buffer.from(`${id}:${secret}`).toString('base64');
}

// ===== TOKEN CACHE (persists within a warm function instance) =====
let cachedToken = null;
let tokenExpiresAt = 0;

function httpsRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedToken;
  }

  const postData = 'grant_type=client_credentials&scope=firstbase:m2m:read-only';
  const parsed = new URL(AUTH_URL);

  const result = await httpsRequest({
    hostname: parsed.hostname,
    path: parsed.pathname + parsed.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${getBasicAuth()}`,
      'Content-Length': Buffer.byteLength(postData)
    }
  }, postData);

  const data = JSON.parse(result.body);
  if (data.access_token) {
    cachedToken = data.access_token;
    tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
    return cachedToken;
  }

  throw new Error(`Auth failed: ${result.body}`);
}

// ===== HANDLER =====
module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  try {
    const token = await getToken();
    const queryBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const parsed = new URL(GRAPHQL_URL);

    const result = await httpsRequest({
      hostname: parsed.hostname,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(queryBody)
      }
    }, queryBody);

    res.status(result.status).setHeader('Content-Type', 'application/json').end(result.body);
  } catch (e) {
    console.error('[graphql proxy]', e.message);
    res.status(500).json({ error: e.message });
  }
};
