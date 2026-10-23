import crypto from 'node:crypto';

/**
 * Valida a assinatura HMAC-SHA256 recebida no header contra o corpo bruto (Buffer) da requisição.
 * Utiliza crypto.timingSafeEqual para proteger contra ataques de canal lateral (timing attacks).
 */
export function verifyHmacSignature(
  rawBody: Buffer | undefined,
  signatureHeader: string | undefined,
  secret: string
): boolean {
  if (!rawBody || !signatureHeader) {
    return false;
  }

  try {
    const computedHex = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    const expectedBuffer = Buffer.from(computedHex, 'hex');
    const providedBuffer = Buffer.from(signatureHeader, 'hex');

    if (expectedBuffer.length !== providedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
  } catch (err) {
    return false;
  }
}

/**
 * Utilitário para gerar a assinatura HMAC-SHA256 de um payload (usado no simulador e testes).
 */
export function generateHmacSignature(payload: string | Buffer, secret: string): string {
  const buffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf-8');
  return crypto.createHmac('sha256', secret).update(buffer).digest('hex');
}
