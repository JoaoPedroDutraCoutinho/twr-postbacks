import { FastifyInstance } from 'fastify';
import { reportQuerySchema } from '../schemas/report.schema.js';
import { ReportService } from '../services/report.service.js';

export async function reportRoutes(app: FastifyInstance) {
  const servico_relatorio = new ReportService();

  app.get('/reports/sales', {
    config: {
      // Rate limit especifico: relatorios sao consumo humano/dashboard,
      // limite mais restrito para proteger queries pesadas no banco
      rateLimit: {
        max: 60,
        timeWindow: '1 minute',
        errorResponseBuilder: (_request, contexto) => ({
          statusCode: 429,
          error: 'Too Many Requests',
          message: `Limite de consultas excedido. Tente novamente em ${contexto.after}.`,
        }),
      },
    },
  }, async (request, reply) => {
    const resultado_validacao = reportQuerySchema.safeParse(request.query);

    if (!resultado_validacao.success) {
      return reply.status(422).send({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: 'Parametros de consulta invalidos para o relatorio',
        issues: resultado_validacao.error.format(),
      });
    }

    const relatorio_gerado = await servico_relatorio.obter_relatorio_vendas(resultado_validacao.data);
    return reply.status(200).send(relatorio_gerado);
  });
}
