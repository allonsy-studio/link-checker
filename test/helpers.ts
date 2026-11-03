/**
 * SPDX-License-Identifier: MPL-2.0
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export type Route = {
	status?: number;
	body?: string;
	headers?: Record<string, string>;
	/** Delay the response by this many milliseconds. */
	delay?: number;
	/** Called on every hit, for assertions on method or count. */
	onRequest?: (req: IncomingMessage) => void;
} | ((req: IncomingMessage, res: ServerResponse) => void);

export interface Fixture {
	url: string;
	hits: Array<{ method: string; path: string; ua: string }>;
	close(): Promise<void>;
}

/** Start a throwaway HTTP server from a path → route map. HTML bodies get a text/html content type. */
export async function fixture(routes: Record<string, Route>): Promise<Fixture> {
	const hits: Fixture["hits"] = [];
	const server = createServer((req, res) => {
		const path = req.url ?? "/";
		hits.push({ method: req.method ?? "", path, ua: String(req.headers["user-agent"] ?? "") });
		const route = routes[path];
		if (!route) {
			res.writeHead(404, { "content-type": "text/plain" });
			res.end("not found");
			return;
		}
		if (typeof route === "function") return route(req, res);
		route.onRequest?.(req);
		const send = () => {
			const body = route.body ?? "";
			const type = route.headers?.["content-type"] ?? (body.trimStart().startsWith("<") ? "text/html; charset=utf-8" : "text/plain");
			res.writeHead(route.status ?? 200, { "content-type": type, ...route.headers });
			res.end(req.method === "HEAD" ? undefined : body);
		};
		if (route.delay) setTimeout(send, route.delay);
		else send();
	});
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	const address = server.address();
	const port = typeof address === "object" && address ? address.port : 0;
	return {
		url: `http://127.0.0.1:${port}`,
		hits,
		close: () => new Promise((done) => server.close(() => done())),
	};
}

export const html = (body: string) => `<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`;
