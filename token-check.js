/**
 * Vercel Serverless Function: Token Check
 *
 * Quick health check that verifies the Firstbase API credentials work.
 */

const https = require('https');

const AUTH_URL = 'https://auth.firstbasehq.com/oauth2/default/v1/token';

function getBasicAuth() {
  const id = process.env.FIRSTBASE_CLIENT_ID;
  const secret = process.env.FIRSTBASE_CLIENT_SECRET;
  if (!id || !secret) throw new Error('Missing FIRSTBASE_CLIENT_ID or FIRSTBASE_CLIENT_SECRET env vars');
  return Buffer.from(`${id}:${secret}`).toString('base64');
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const postData = 'grant_type=client_credentials&scope=firstbase:m2m:read-only';
    const parsed = new URL(AUTH_URL);

    const result = await new Promise((resolve, reject) => {
      const request = https.request({
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${getBasicAuth()}`,
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (response) => {
        let body = '';
        response.on('data', chunk => body += chunk);
        response.on('end', () => resolve({ status: response.statusCode, body }));
      });
      request.on('error', reject);
      request.write(postData);
      request.end();
    });

    const data = JSON.parse(result.body);
    if (data.access_token) {
      res.status(200).json({ ok: true, expiresIn: data.expires_in });
    } else {
      res.status(401).json({ ok: false, error: data.error_description || data.error });
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};
