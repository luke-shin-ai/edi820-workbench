/**
 * T5.3 - the local web screen.
 *
 * Binds to 127.0.0.1 only: this is a screen for one analyst looking at files that
 * never leave their machine (`docs/guarantees.md` "not guaranteed" - nothing about
 * privacy is claimed here that the transport does not enforce).
 *
 * Routes:
 *   GET  /            the page
 *   GET  /api/samples sample copybooks and data files
 *   GET  /api/run     ?file=&copybook=&bank=&bankFormat=&window=
 *   POST /api/run     same, for dropped files (text in the body)
 *
 * Anything read by path must live under `samples/`; a dropped file is parsed from
 * the request body and is never written anywhere.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { AppError, reconcileSources, repoRoot as defaultRepoRoot, type FileFormat, type SourceInput } from '../core/ops.js';
import { loadGuarantees } from '../core/guarantees.js';
import { buildViewModel, type ViewModel } from './view.js';
import { renderPage } from './page.js';
import { explainFindings } from '../explain/index.js';
import type { SettlementWindow } from '../reconcile/index.js';

export interface WebOptions {
  repoRoot?: string;
  port?: number;
  host?: string;
}

export interface RunRequest {
  filePath?: string;
  copybookPath?: string;
  format?: FileFormat;
  fileText?: string;
  /** Bytes of a dropped file, base64-encoded so COMP-3/binary samples survive the drop. */
  fileBase64?: string;
  fileName?: string;
  copybookText?: string;
  copybookBase64?: string;
  copybookName?: string;
  bankPath?: string;
  bankCopybookPath?: string;
  bankFormat?: FileFormat;
  bankText?: string;
  bankBase64?: string;
  bankFileName?: string;
  window?: SettlementWindow;
  toleranceDays?: number;
  explain?: boolean;
}

/**
 * Decode a base64 body to a latin1 string, which is how `SourceInput.text` carries
 * bytes: one character per byte, exactly as `readFileSync(path, 'latin1')` does.
 * `file.text()` would decode as UTF-8 first and replace every byte above 0x7F with
 * U+FFFD, which silently corrupts a COMP-3 amount (defect found 2026-11-21).
 */
function decodeBase64(value: string): string {
  return Buffer.from(value, 'base64').toString('latin1');
}

function asFormat(value: unknown): FileFormat | undefined {
  if (value === 'bai2') return 'bai2';
  if (value === 'fixed') return 'fixed';
  return undefined;
}

function windowFrom(value: unknown): SettlementWindow | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as { start?: unknown; end?: unknown };
  if (typeof candidate.start !== 'string' || typeof candidate.end !== 'string') return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate.start) || !/^\d{4}-\d{2}-\d{2}$/.test(candidate.end)) {
    throw new AppError('USAGE', 'window must be two ISO dates');
  }
  return { start: candidate.start, end: candidate.end };
}

export interface WebServer {
  server: Server;
  port: () => number;
  url: () => string;
  close: () => Promise<void>;
}

export function createWebServer(options: WebOptions = {}): WebServer {
  const root = options.repoRoot ?? defaultRepoRoot();
  const samplesRoot = resolve(root, 'samples');

  const safeSamplePath = (relative: string): string => {
    const absolute = resolve(root, relative);
    if (!absolute.startsWith(samplesRoot + sep) && absolute !== samplesRoot) {
      throw new AppError('USAGE', `only files under samples/ can be read by path: ${relative}`);
    }
    return absolute;
  };

  const sampleFile = (relative: string): string => {
    try {
      return readFileSync(safeSamplePath(relative), 'latin1');
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('IO', `cannot read sample ${relative}`);
    }
  };

  const listSamples = () => {
    const copybooks = readdirSync(join(samplesRoot, 'copybooks'))
      .filter((name) => extname(name) === '.cpy')
      .sort()
      .map((name) => ({ value: `samples/copybooks/${name}`, label: `copybooks/${name}` }));
    const files = readdirSync(join(samplesRoot, 'data'))
      .filter((name) => extname(name) === '.txt')
      .sort()
      .map((name) => ({ value: `samples/data/${name}`, label: `data/${name}` }));
    return { copybooks, files, guarantees: loadGuarantees() };
  };

  const runCase = async (request: RunRequest): Promise<{ view: ViewModel }> => {
    const droppedPayment = request.fileBase64 !== undefined ? decodeBase64(request.fileBase64) : request.fileText;
    const droppedCopybook =
      request.copybookBase64 !== undefined ? decodeBase64(request.copybookBase64) : request.copybookText;
    let payment: SourceInput;
    if (droppedPayment !== undefined) {
      payment = {
        label: request.fileName ?? '(dropped file)',
        text: droppedPayment,
        format: asFormat(request.format) ?? 'fixed',
        ...(droppedCopybook !== undefined
          ? { copybookText: droppedCopybook, copybookLabel: request.copybookName ?? '(dropped copybook)' }
          : request.copybookPath
            ? { copybookText: sampleFile(request.copybookPath), copybookLabel: request.copybookPath }
            : {}),
      };
    } else {
      if (!request.filePath) throw new AppError('USAGE', 'filePath or fileText is required');
      const format = asFormat(request.format) ?? 'fixed';
      payment = {
        label: request.filePath,
        text: sampleFile(request.filePath),
        format,
        ...(format === 'fixed' && request.copybookPath
          ? { copybookText: sampleFile(request.copybookPath), copybookLabel: request.copybookPath }
          : {}),
      };
      if (format === 'fixed' && !request.copybookPath) throw new AppError('USAGE', 'a fixed-width file needs a copybook');
    }

    let bank: SourceInput | undefined;
    const droppedBank = request.bankBase64 !== undefined ? decodeBase64(request.bankBase64) : request.bankText;
    if (droppedBank !== undefined) {
      const format = asFormat(request.bankFormat) ?? 'fixed';
      bank = {
        label: request.bankFileName ?? '(dropped bank file)',
        text: droppedBank,
        format,
        ...(format === 'fixed' && request.bankCopybookPath
          ? { copybookText: sampleFile(request.bankCopybookPath), copybookLabel: request.bankCopybookPath }
          : format === 'fixed' && request.copybookPath
            ? { copybookText: sampleFile(request.copybookPath), copybookLabel: request.copybookPath }
            : {}),
      };
    } else if (request.bankPath) {
      const format = asFormat(request.bankFormat) ?? 'fixed';
      bank = {
        label: request.bankPath,
        text: sampleFile(request.bankPath),
        format,
        ...(format === 'fixed' && request.bankCopybookPath
          ? { copybookText: sampleFile(request.bankCopybookPath), copybookLabel: request.bankCopybookPath }
          : {}),
      };
      if (format === 'fixed' && !request.bankCopybookPath) throw new AppError('USAGE', 'a fixed-width bank file needs its copybook');
    }

    const window = windowFrom(request.window);
    const run = reconcileSources(payment, bank, {
      ...(window ? { settlementWindow: window } : {}),
      ...(request.toleranceDays !== undefined ? { toleranceDays: request.toleranceDays } : {}),
    });
    const explanations = request.explain === false ? [] : (await explainFindings(run.result.findings)).explanations;
    const view = buildViewModel({
      payment: run.payment,
      ...(run.bank ? { bank: run.bank } : {}),
      result: run.result,
      files: run.files,
      explanations,
      guarantees: loadGuarantees(),
    });
    return { view };
  };

  const readBody = (req: IncomingMessage): Promise<string> =>
    new Promise((resolvePromise, reject) => {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk: string) => {
        body += chunk;
        if (body.length > 8_000_000) {
          reject(new AppError('USAGE', 'request body is larger than 8 MB'));
          req.destroy();
        }
      });
      req.on('end', () => resolvePromise(body));
      req.on('error', reject);
    });

  const sendJson = (res: ServerResponse, status: number, payload: unknown): void => {
    const text = JSON.stringify(payload);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(text);
  };

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      try {
        if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
          res.end(renderPage());
          return;
        }
        if (req.method === 'GET' && url.pathname === '/api/samples') {
          sendJson(res, 200, listSamples());
          return;
        }
        if (req.method === 'GET' && url.pathname === '/api/run') {
          const window = url.searchParams.get('window');
          const request: RunRequest = {
            ...(url.searchParams.get('file') ? { filePath: url.searchParams.get('file')! } : {}),
            ...(url.searchParams.get('copybook') ? { copybookPath: url.searchParams.get('copybook')! } : {}),
            ...(url.searchParams.get('bank') ? { bankPath: url.searchParams.get('bank')! } : {}),
            ...(url.searchParams.get('bankCopybook') ? { bankCopybookPath: url.searchParams.get('bankCopybook')! } : {}),
            ...(asFormat(url.searchParams.get('format')) ? { format: asFormat(url.searchParams.get('format'))! } : {}),
            ...(asFormat(url.searchParams.get('bankFormat')) ? { bankFormat: asFormat(url.searchParams.get('bankFormat'))! } : {}),
            ...(window ? { window: windowFrom(window.split('..').length === 2 ? { start: window.split('..')[0], end: window.split('..')[1] } : undefined) } : {}),
          };
          sendJson(res, 200, await runCase(request));
          return;
        }
        if (req.method === 'POST' && url.pathname === '/api/run') {
          const body = await readBody(req);
          let parsed: RunRequest;
          try {
            parsed = JSON.parse(body) as RunRequest;
          } catch {
            throw new AppError('USAGE', 'request body is not JSON');
          }
          sendJson(res, 200, await runCase(parsed));
          return;
        }
        sendJson(res, 404, { error: `no route for ${req.method} ${url.pathname}` });
      } catch (error) {
        const message = error instanceof AppError ? `${error.kind}: ${error.message}` : (error as Error).message;
        sendJson(res, 400, { error: message });
      }
    })();
  });

  const address = (): { port: number } => {
    const info = server.address();
    if (!info || typeof info === 'string') return { port: 0 };
    return { port: info.port };
  };

  return {
    server,
    port: () => address().port,
    url: () => `http://127.0.0.1:${address().port}`,
    close: () =>
      new Promise<void>((resolvePromise, reject) => {
        server.close((error) => (error ? reject(error) : resolvePromise()));
      }),
  };
}

export async function startWebServer(options: WebOptions = {}): Promise<WebServer> {
  const web = createWebServer(options);
  await new Promise<void>((resolvePromise, reject) => {
    web.server.once('error', reject);
    web.server.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => resolvePromise());
  });
  return web;
}
