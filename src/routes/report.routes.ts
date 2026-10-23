import { FastifyInstance } from 'fastify';
import { reportQuerySchema } from '../schemas/report.schema.js';
import { ReportService } from '../services/report.service.js';

export async function reportRoutes(app: FastifyInstance) {
  const reportService = new ReportService();

  app.get('/reports/sales', async (request, reply) => {
    const parseResult = reportQuerySchema.safeParse(request.query);

    if (!parseResult.success) {
      return reply.status(422).send({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: 'Parâmetros de consulta inválidos para o relatório',
        issues: parseResult.error.format(),
      });
    }

    const report = await reportService.getSalesReport(parseResult.data);
    return reply.status(200).send(report);
  });
}
