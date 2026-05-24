import type { HttpHeaders } from "./HttpTypes.js";

// ── Encoding ──────────────────────────────────────────────────────────────────

export interface EncodeResult {
    body?: string | Uint8Array;
    contentTypeHeader?: string;
}

export function encodeBody(body: unknown, contentType?: string): EncodeResult {
    if (body === undefined || body === null) {
        return {};
    }

    if (body instanceof Uint8Array) {
        return { body, contentTypeHeader: contentType ?? "application/octet-stream" };
    }

    if (typeof body === "string") {
        return { body, contentTypeHeader: contentType ?? "text/plain; charset=utf-8" };
    }

    const ct = contentType ?? "application/json";

    if (ct.startsWith("application/x-www-form-urlencoded") && typeof body === "object") {
        return {
            body: new URLSearchParams(body as Record<string, string>).toString(),
            contentTypeHeader: ct,
        };
    }

    return { body: JSON.stringify(body), contentTypeHeader: ct };
}

export function mergeEncodedHeaders(
    existing: HttpHeaders | undefined,
    contentTypeHeader: string | undefined,
): HttpHeaders {
    const headers: HttpHeaders = { ...(existing ?? {}) };
    if (contentTypeHeader) {
        headers["content-type"] = contentTypeHeader;
    }
    return headers;
}

// ── Decoding ──────────────────────────────────────────────────────────────────

export function extractContentType(headers: HttpHeaders): string {
    const raw = headers["content-type"];
    const str = Array.isArray(raw) ? raw[0] : (raw ?? "");
    return str.split(";")[0].trim().toLowerCase();
}

export function decodeBody(body: string | Uint8Array | undefined, contentType: string): unknown {
    if (body === undefined || body === null) {
        return undefined;
    }
    if (
        (typeof body === "string" && body === "") ||
        (body instanceof Uint8Array && body.length === 0)
    ) {
        return undefined;
    }

    const text = typeof body === "string" ? body : new TextDecoder().decode(body);

    switch (contentType) {
        case "application/json":
        case "text/json":
            try {
                return JSON.parse(text);
            } catch {
                return text;
            }

        case "application/x-www-form-urlencoded":
            return Object.fromEntries(new URLSearchParams(text));

        case "text/plain":
        case "text/html":
        case "text/css":
            return text;

        default:
            // Best-effort: try JSON for any application/* type
            if (contentType.includes("json")) {
                try {
                    return JSON.parse(text);
                } catch {}
            }
            // Return raw bytes for true binary content, text otherwise
            return typeof body === "string" ? body : body;
    }
}
