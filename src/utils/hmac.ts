import crypto from 'node:crypto';

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

export function generateHmacSignature(payload: string | Buffer, segredo: string): string {
  const buffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf-8');
  return crypto.createHmac('sha256', segredo).update(buffer).digest('hex');
}

export const gerar_assinatura_hmac = generateHmacSignature;
