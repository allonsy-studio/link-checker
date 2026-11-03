/**
 * SPDX-License-Identifier: MPL-2.0
 */

import { createServer, type Server } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

const MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".htm": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".json": "application/json",
	".xml": "application/xml",
	".txt": "text/plain; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".avif": "image/avif",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".mp4": "video/mp4",
	".webm": "video/webm",
	".mp3": "audio/mpeg",
	".pdf": "application/pdf",
};

export interface StaticServer {
	url: string;
	close(): Promise<void>;
}

async function candidates(root: string, pathname: string): Promise<string | undefined> {
	const decoded = decodeURIComponent(pathname);
	const safe = normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, "");
	const target = resolve(root, `.${safe}`);
	if (!target.startsWith(root + sep) && target !== root) return undefined;
	const tries = decoded.endsWith("/") ? [join(target, "index.html")] : [target, `${target}.html`, join(target, "index.html")];
	for (const file of tries) {
		try {
			const info = await stat(file);
			if (info.isFile()) return file;
		} catch {
			// keep looking
		}
	}
	return undefined;
}

/**
 * Serve a built site from disk on 127.0.0.1 with Eleventy-style clean URLs
 * (`/about` → `/about/index.html` or `/about.html`). HEAD is supported.
 */
export async function serveDirectory(dir: string): Promise<StaticServer> {
	const root = resolve(dir);
	const info = await stat(root).catch(() => undefined);
	if (!info?.isDirectory()) throw new Error(`\`path\` is not a directory: ${root}`);

	const server: Server = createServer(async (req, res) => {
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		const file = await candidates(root, url.pathname);
		if (!file) {
			res.writeHead(404, { "content-type": "text/plain" });
			res.end("Not found");
			return;
		}
		const size = (await stat(file)).size;
		res.writeHead(200, { "content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream", "content-length": size });
		if (req.method === "HEAD") {
			res.end();
			return;
		}
		createReadStream(file).pipe(res);
	});

	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	const address = server.address();
	const port = typeof address === "object" && address ? address.port : 0;
	return {
		url: `http://127.0.0.1:${port}/`,
		close: () => new Promise((done) => server.close(() => done())),
	};
}
