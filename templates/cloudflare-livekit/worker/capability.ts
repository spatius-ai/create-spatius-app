const encoder = new TextEncoder();
function encode(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(
    atob(value.replaceAll('-', '+').replaceAll('_', '/')),
    (character) => character.charCodeAt(0),
  );
}
async function key(secret: string) {
  if (!secret) throw new Error('Session signing secret is missing');
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}
export async function signCapability(
  secret: string,
  claims: Record<string, unknown>,
  seconds = 3600,
): Promise<string> {
  const payload = encode(
    encoder.encode(
      JSON.stringify({
        ...claims,
        exp: Math.floor(Date.now() / 1000) + seconds,
      }),
    ),
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    await key(secret),
    encoder.encode(payload),
  );
  return `${payload}.${encode(new Uint8Array(signature))}`;
}
export async function verifyCapability(
  secret: string,
  token: string,
  purpose: string,
): Promise<Record<string, unknown>> {
  if (typeof token !== 'string' || token.length > 8192)
    throw new Error('Invalid session authorization');
  const parts = token.split('.');
  if (
    parts.length !== 2 ||
    !(await crypto.subtle.verify(
      'HMAC',
      await key(secret),
      decode(parts[1]),
      encoder.encode(parts[0]),
    ))
  )
    throw new Error('Invalid session authorization');
  const value = JSON.parse(
    new TextDecoder().decode(decode(parts[0])),
  ) as Record<string, unknown>;
  if (
    value.purpose !== purpose ||
    typeof value.exp !== 'number' ||
    value.exp <= Date.now() / 1000
  )
    throw new Error('Expired session authorization');
  return value;
}
