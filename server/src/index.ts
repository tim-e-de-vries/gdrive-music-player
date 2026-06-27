import express from 'express';
import { google } from 'googleapis';
import * as dotenv from 'dotenv';
import { encrypt, decrypt } from './utils/crypto';

// Load environment variables for local development
dotenv.config();

const app = express();
const port = process.env.PORT || 8080;

app.use(express.json());

// Lightweight, robust CORS middleware
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

// Redirect users to Google for authentication
app.get('/api/auth/google', (req, res) => {
  const client = getOAuth2Client();
  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // Ensures we always receive a Refresh Token
    scope: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  res.redirect(url);
});

// OAuth Callback Endpoint
app.get('/api/auth/google/callback', async (req, res) => {
  const code = req.query.code as string;
  if (!code) {
    return res.status(400).send('Authorization code missing.');
  }

  try {
    const client = getOAuth2Client();
    const { tokens } = await client.getToken(code);

    if (!tokens.refresh_token) {
      return res.status(400).send(
        'No refresh token received. If you signed in previously, ' +
        'please disconnect this app from Google account settings and try again.'
      );
    }

    // Encrypt the refresh token statelessly
    const encryptedSession = encrypt(tokens.refresh_token);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    // Construct standard redirect back to frontend
    const redirectUrl = new URL('/oauth-callback', frontendUrl);
    redirectUrl.searchParams.set('access_token', tokens.access_token || '');
    redirectUrl.searchParams.set('expires_at', (tokens.expiry_date || Date.now()).toString());
    redirectUrl.searchParams.set('session', encryptedSession);

    res.redirect(redirectUrl.toString());
  } catch (err) {
    console.error('Error during Google authentication callback:', err);
    res.status(500).send('Authentication failed.');
  }
});

// Silent Access Token Refresh Endpoint
app.post('/api/token', async (req, res) => {
  const { session } = req.body;
  if (!session) {
    return res.status(400).json({ error: 'Session token missing.' });
  }

  try {
    const refreshToken = decrypt(session);
    const client = getOAuth2Client();
    client.setCredentials({ refresh_token: refreshToken });

    const response = await client.getAccessToken();
    const accessToken = response.token;
    const expiryDate = client.credentials.expiry_date || (Date.now() + 3600 * 1000);

    if (!accessToken) {
      return res.status(500).json({ error: 'Failed to retrieve access token from Google.' });
    }

    res.status(200).json({
      access_token: accessToken,
      expires_at: expiryDate,
    });
  } catch (err) {
    console.error('Error refreshing access token:', err);
    res.status(401).json({ error: 'Invalid or expired session.' });
  }
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
