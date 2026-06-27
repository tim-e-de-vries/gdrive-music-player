import crypto from 'crypto';

// Ensure the SESSION_SECRET is exactly 32 bytes/characters for AES-256
const getSecretKey = (): Buffer => {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('SESSION_SECRET environment variable is not defined.');
  }
  // Create a 32-byte key from the secret via SHA-256 to guarantee correct key length
  return crypto.createHash('sha256').update(secret).digest();
};

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Standard for GCM
const AUTH_TAG_LENGTH = 16;

/**
 * Encrypts plaintext string using AES-256-GCM
 * Output format: iv_hex:auth_tag_hex:encrypted_hex
 */
export function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = getSecretKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts a ciphertext string using AES-256-GCM
 * Input format: iv_hex:auth_tag_hex:encrypted_hex
 */
export function decrypt(hash: string): string {
  const parts = hash.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted session format.');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encryptedText = Buffer.from(parts[2], 'hex');
  
  const key = getSecretKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encryptedText),
    decipher.final()
  ]);

  return decrypted.toString('utf8');
}
