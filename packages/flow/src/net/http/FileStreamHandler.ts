import { normalize, join, relative, extname, isAbsolute } from 'node:path';
import { FlowComponent, type FlowComponentOptions } from '../../FlowComponent.js';
import { FlowPort } from '../../FlowPort.js';
import type { HttpHeaders, HttpStreamResponse, ParsedHttpRequest } from './HttpTypes.js';


// ── MIME type map ──────────────────────────────────────────────────────────────

const MIME: Record<string, string> = {
    // Images
    '.apng': 'image/apng',
    '.avif': 'image/avif',
    '.bmp':  'image/bmp',
    '.gif':  'image/gif',
    '.ico':  'image/x-icon',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png':  'image/png',
    '.svg':  'image/svg+xml',
    '.tiff': 'image/tiff',
    '.webp': 'image/webp',
    // Video / Audio
    '.mp4':  'video/mp4',
    '.webm': 'video/webm',
    '.ogg':  'video/ogg',
    '.mp3':  'audio/mpeg',
    '.wav':  'audio/wav',
    '.flac': 'audio/flac',
    // Documents / Archives
    '.pdf':  'application/pdf',
    '.zip':  'application/zip',
    '.tar':  'application/x-tar',
    '.gz':   'application/gzip',
    '.7z':   'application/x-7z-compressed',
    // Web
    '.html': 'text/html; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.js':   'application/javascript',
    '.mjs':  'application/javascript',
    '.json': 'application/json',
    '.wasm': 'application/wasm',
    '.txt':  'text/plain; charset=utf-8',
    '.xml':  'application/xml',
    // Binary
    '.bin':  'application/octet-stream',
    '.dat':  'application/octet-stream',
};

function mimeFor(filename: string): string {
    return MIME[extname(filename).toLowerCase()] ?? 'application/octet-stream';
}

// ── Async file-chunk generator ────────────────────────────────────────────────

async function* fileChunks(filePath: string): AsyncGenerator<Uint8Array> {
    const { createReadStream } = await import('node:fs');
    const stream = createReadStream(filePath);
    for await (const chunk of stream) {
        const buf = chunk as Buffer;
        // Slice to own the memory — avoids sharing pool buffers across ticks.
        yield new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    }
}

// ── Error stream helper ───────────────────────────────────────────────────────

function errorResponse(requestId: string, status: number, message: string): HttpStreamResponse {
    const body = new TextEncoder().encode(message);
    return {
        requestId,
        status,
        headers: {
            'content-type': 'text/plain; charset=utf-8',
            'content-length': String(body.length),
        },
        body: (async function*() { yield body; })(),
    };
}


// ── FileStreamHandler ─────────────────────────────────────────────────────────

export interface FileStreamHandlerOptions extends FlowComponentOptions {
    /**
     * Root directory to serve. All file paths are sandboxed to this directory;
     * path traversal attempts are rejected with 403.
     */
    directory: string;
}

/**
 * Reads the requested filename from an inbound ParsedHttpRequest and streams
 * the matching file as an HttpStreamResponse.
 *
 * The filename is resolved from (in priority order):
 *   1. `?name=<filename>` query parameter
 *   2. The URL pathname, stripped of the leading slash
 *
 * Example:
 *   GET /image.png         →  serves <directory>/image.png
 *   GET /?name=report.pdf  →  serves <directory>/report.pdf
 *
 * Errors:
 *   400 — no filename provided
 *   403 — path traversal attempt
 *   404 — file does not exist or is not a regular file
 */
export class FileStreamHandler extends FlowComponent {
    readonly in: FlowPort<ParsedHttpRequest>;
    readonly out: FlowPort<HttpStreamResponse>;

    private readonly _directory: string;

    constructor(options: FileStreamHandlerOptions) {
        super(options);
        this._directory = normalize(options.directory);
        this.in = this.addPort<ParsedHttpRequest>('in', 'in');
        this.out = this.addPort<HttpStreamResponse>('out', 'out');
    }

    override step(): void {
        let req: ParsedHttpRequest | undefined;
        while ((req = this.in.read()) !== undefined) {
            void this._handle(req);
        }
    }

    private async _handle(req: ParsedHttpRequest): Promise<void> {
        const { stat } = await import('node:fs/promises');

        const reqId = req.requestId ?? '';

        // ── Resolve filename ──────────────────────────────────────────────────
        const rawName =
            req.searchParams.get('name') ??
            req.pathname.replace(/^\/+/, '');

        if (!rawName) {
            this.out.put(errorResponse(reqId, 400, 'Missing filename'));
            return;
        }

        // ── Sandbox check ─────────────────────────────────────────────────────
        const resolved = normalize(join(this._directory, rawName));
        const rel = relative(this._directory, resolved);
        if (rel.startsWith('..') || isAbsolute(rel)) {
            this.out.put(errorResponse(reqId, 403, 'Forbidden'));
            return;
        }

        // ── Stat the file ─────────────────────────────────────────────────────
        let fileSize: number;
        try {
            const info = await stat(resolved);
            if (!info.isFile()) throw new Error('not a file');
            fileSize = info.size;
        } catch {
            this.out.put(errorResponse(reqId, 404, 'Not Found'));
            return;
        }

        // ── Emit streaming response ───────────────────────────────────────────
        const headers: HttpHeaders = {
            'content-type': mimeFor(rawName),
            'content-length': String(fileSize),
            'accept-ranges': 'bytes',
            'cache-control': 'no-cache',
        };

        this.out.put({
            requestId: reqId,
            status: 200,
            headers,
            body: fileChunks(resolved),
        });
    }
}
