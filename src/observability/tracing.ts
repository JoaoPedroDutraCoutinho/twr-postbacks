// Carregado com `node --import` ANTES da aplicacao: http, pg e pino precisam ser
// instrumentados antes de serem importados pela primeira vez.
import 'dotenv/config';
import { register } from 'node:module';

const ROTAS_IGNORADAS = new Set(['/health', '/metrics']);

// Tracing e opcional: so liga quando existe um coletor OTLP configurado (ex: Jaeger do docker-compose).
// Sem a variavel, nenhum pacote do OpenTelemetry e carregado e a aplicacao roda exatamente igual.
if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT && process.env.OTEL_SDK_DISABLED !== 'true') {
  // Necessario em projetos ESM para interceptar os `import` das bibliotecas instrumentadas
  register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);

  const { NodeSDK } = await import('@opentelemetry/sdk-node');
  const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
  const { HttpInstrumentation } = await import('@opentelemetry/instrumentation-http');
  const { PgInstrumentation } = await import('@opentelemetry/instrumentation-pg');
  const { PinoInstrumentation } = await import('@opentelemetry/instrumentation-pino');

  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'twr-postbacks',
    traceExporter: new OTLPTraceExporter(),
    // Metricas ficam no /metrics (Prometheus) e logs no stdout: o SDK cuida apenas dos traces
    metricReaders: [],
    logRecordProcessors: [],
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (requisicao) => ROTAS_IGNORADAS.has(requisicao.url ?? ''),
      }),
      new PgInstrumentation(),
      // Injeta trace_id e span_id em cada linha de log, ligando logs e traces
      new PinoInstrumentation({ disableLogSending: true }),
    ],
  });

  sdk.start();

  process.once('SIGTERM', () => {
    sdk.shutdown().finally(() => process.exit(0));
  });
}
