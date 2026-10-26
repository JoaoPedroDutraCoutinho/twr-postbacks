import { FastifyInstance } from 'fastify';
import { reportQuerySchema } from '../schemas/report.schema.js';
import { ReportService } from '../services/report.service.js';

export async function reportRoutes(app: FastifyInstance) {
  const servico_relatorio = new ReportService();

  app.get('/reports/sales', async (request, reply) => {
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
