/**
 * Telegram Web App Data Validation
 * Based on: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */

export async function validateTelegramWebAppData(
  initData: string,
  botToken: string
): Promise<{ valid: boolean; user?: any }> {
  if (!initData) {
    return { valid: false };
  }

  try {
    const encoded = decodeURIComponent(initData);
    const params = new URLSearchParams(encoded);

    const hash = params.get('hash');
    if (!hash) {
      return { valid: false };
    }

    params.delete('hash');

    // Sort parameters alphabetically
    const dataCheckArr: string[] = [];
    for (const [key, value] of Array.from(params.entries()).sort()) {
      dataCheckArr.push(`${key}=${value}`);
    }
    const dataCheckString = dataCheckArr.join('\n');

    // Create secret key using HMAC-SHA256 of bot token with constant
    const encoder = new TextEncoder();
    const secretKeyData = encoder.encode(botToken);
    const constantKey = encoder.encode('WebAppData');

    const secretKey = await crypto.subtle.importKey(
      'raw',
      constantKey,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const secretKeyBytes = await crypto.subtle.sign('HMAC', secretKey, secretKeyData);

    // Create data check hash
    const dataCheckKey = await crypto.subtle.importKey(
      'raw',
      secretKeyBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const dataCheckBytes = await crypto.subtle.sign(
      'HMAC',
      dataCheckKey,
      encoder.encode(dataCheckString)
    );

    // Convert to hex string
    const calculatedHash = Array.from(new Uint8Array(dataCheckBytes))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    const isValid = calculatedHash === hash;

    if (!isValid) {
      return { valid: false };
    }

    // Parse user data if available
    const userParam = params.get('user');
    const user = userParam ? JSON.parse(userParam) : undefined;

    return { valid: true, user };
  } catch (error) {
    console.error('Error validating Telegram Web App data:', error);
    return { valid: false };
  }
}
