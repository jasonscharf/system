import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";

const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? "unknown-service",
    traceExporter: new OTLPTraceExporter({
        url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318"}/v1/traces`,
    }),
    metricReader: new PrometheusExporter({
        port: Number(process.env.OTEL_PROMETHEUS_PORT ?? 9464),
    }),
    instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

process.on("SIGTERM", () => {
    sdk.shutdown().catch(console.error);
});
