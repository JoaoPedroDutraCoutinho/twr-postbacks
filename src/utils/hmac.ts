import crypto from 'node:crypto';

/**
 * Valida a assinatura HMAC-SHA256 recebida no header contra o corpo bruto (Buffer) da requisicao.
 * Utiliza crypto.timingSafeEqual para proteger contra ataques de canal lateral (timing attacks).
 */
export function verifyHmacSignature(
  corpo_bruto: Buffer | undefined,
  cabecalho_assinatura: string | undefined,
  segredo: string
): boolean {
  if (!corpo_bruto || !cabecalho_assinatura) {
    return false;
  }

  try {
    const hash_computado_hex = crypto
      .createHmac('sha256', segredo)
      .update(corpo_bruto)
      .digest('hex');

    const buffer_esperado = Buffer.from(hash_computado_hex, 'hex');
    const buffer_recebido = Buffer.from(cabecalho_assinatura, 'hex');

    if (buffer_esperado.length !== buffer_recebido.length) {
      return false;
    }

    return crypto.timingSafeEqual(buffer_esperado, buffer_recebido);
  } catch (erro) {
    return false;
  }
}

export const verificar_assinatura_hmac = verifyHmacSignature;

/**
 * Utilitario para gerar a assinatura HMAC-SHA256 de um payload (usado no simulador e testes).
 */
export function generateHmacSignature(payload: string | Buffer, segredo: string): string {
  const buffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf-8');
  return crypto.createHmac('sha256', segredo).update(buffer).digest('hex');
}

export const gerar_assinatura_hmac = generateHmacSignature;
