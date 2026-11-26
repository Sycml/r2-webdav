import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/index.js';
const auth = `Basic ${btoa('webdav:test-password')}`;
const env = (bucket) => ({ bucket, USERNAME: 'webdav', PASSWORD: 'test-password' });
const request = (method, path, options = {}) =>
	new Request(`https://dav.example${path}`, {
		method,
		...options,
		headers: { Authorization: auth, ...options.headers },
	});
const object = (key, collection = false) => ({
	key,
	size: 0,
	uploaded: new Date(),
	httpMetadata: {},
	customMetadata: collection ? { resourcetype: '<collection />' } : {},
	body: new ReadableStream({
		start(controller) {
			controller.close();
		},
	}),
});

test('missing credentials fail closed, even for undefined:undefined Basic auth', async () => {
	const r = await worker.fetch(
		request('GET', '/', { headers: { Authorization: `Basic ${btoa('undefined:undefined')}` } }),
		{},
		{},
	);
	assert.equal(r.status, 503);
});

test('PUT streams the request and reports a failed conditional write', async () => {
	let input;
	const bucket = {
		head: async () => null,
		put: async (_key, body) => {
			input = body;
			return null;
		},
	};
	const r = request('PUT', '/file', { body: 'data' });
	r.arrayBuffer = () => {
		throw new Error('must not buffer an upload');
	};
	const response = await worker.fetch(r, env(bucket), {});
	assert.ok(input instanceof ReadableStream);
	assert.equal(response.status, 412);
});

test('MOVE retains the source when destination write fails', async () => {
	const deleted = [];
	const bucket = {
		head: async (key) => (key === 'source' ? object(key) : null),
		get: async (key) => object(key),
		put: async () => null,
		delete: async (key) => deleted.push(key),
	};
	const response = await worker.fetch(
		request('MOVE', '/source', { headers: { Destination: 'https://dav.example/destination' } }),
		env(bucket),
		{},
	);
	assert.equal(response.status, 412);
	assert.deepEqual(deleted, []);
});

test('full GET tolerates undefined optional range fields', async () => {
	const bucket = {
		get: async () => ({
			...object('file'),
			httpEtag: '"empty"',
			range: { suffix: undefined, offset: undefined, length: undefined },
		}),
	};
	const response = await worker.fetch(request('GET', '/file'), env(bucket), {});
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('content-length'), '0');
});

test('browser lists directories from each R2 page and links a marked directory once', async () => {
	const bucket = {
		list: async ({ prefix, delimiter, cursor }) => {
			assert.equal(prefix, '');
			assert.equal(delimiter, '/');
			return cursor
				? { objects: [], delimitedPrefixes: ['照片 & 备份/'], truncated: false }
				: {
						objects: [object('shared', true), object('file.txt')],
						delimitedPrefixes: ['1/', 'shared/'],
						truncated: true,
						cursor: 'next',
					};
		},
	};
	const response = await worker.fetch(request('GET', '/'), env(bucket), {});
	assert.equal(response.status, 200);
	const html = await response.text();
	assert.ok(html.includes('href="/1/"'));
	assert.ok(html.includes('href="/file.txt?download=1"'));
	assert.ok(html.includes(`href="/${encodeURIComponent('照片 & 备份')}/"`));
	assert.ok(html.includes('照片 &amp; 备份'));
	assert.equal([...html.matchAll(/href="\/shared\/"/g)].length, 1);
});

test('browser opens R2 prefix folders and slash-marker-only folders', async () => {
	const bucket = {
		head: async () => null,
		list: async ({ prefix }) => ({
			objects: prefix === '1/' ? [object('1/'), object('1/photo.png')] : prefix === 'empty/' ? [object('empty/')] : [],
			delimitedPrefixes: prefix === '1/' ? ['1/subfolder/'] : [],
			truncated: false,
		}),
	};
	const response = await worker.fetch(request('GET', '/1/?refresh=1'), env(bucket), {});
	assert.equal(response.status, 200);
	const html = await response.text();
	assert.ok(html.includes('href="/1/photo.png?download=1"'));
	assert.ok(html.includes('href="/1/subfolder/"'));
	assert.ok(!html.includes('class="entry" href="/1/"'));
	assert.equal((await worker.fetch(request('GET', '/empty/'), env(bucket), {})).status, 200);
	assert.equal((await worker.fetch(request('GET', '/missing/'), env(bucket), {})).status, 404);
});

test('browser mutation refuses cross-origin requests and recursive deletion', async () => {
	const deleted = [];
	const bucket = {
		head: async (key) => object(key, true),
		list: async () => ({ objects: [], delimitedPrefixes: [], truncated: false }),
		delete: async (key) => deleted.push(key),
	};
	const browserHeaders = { 'X-WebDAV-UI': '1', Origin: 'https://dav.example' };
	const crossOrigin = await worker.fetch(
		request('DELETE', '/folder', { headers: { ...browserHeaders, Origin: 'https://other.example' } }),
		env(bucket),
		{},
	);
	assert.equal(crossOrigin.status, 403);
	assert.equal((await worker.fetch(request('DELETE', '/', { headers: browserHeaders }), env(bucket), {})).status, 405);
	assert.equal(
		(await worker.fetch(request('DELETE', '/folder', { headers: browserHeaders }), env(bucket), {})).status,
		409,
	);
	assert.deepEqual(deleted, []);
});

test('uploaded HTML is sandboxed and browser download forces attachment', async () => {
	const bucket = {
		get: async (key) => ({
			...object(key),
			httpEtag: '"html"',
			httpMetadata: { contentType: 'text/html', contentDisposition: 'inline' },
		}),
	};
	const r = await worker.fetch(request('GET', '/%E7%85%A7%E7%89%87.html?download=1'), env(bucket), {});
	assert.equal(r.status, 200);
	assert.match(r.headers.get('content-security-policy'), /\bsandbox\b/);
	assert.match(r.headers.get('content-disposition'), /^attachment;.*filename\*=UTF-8''%E7%85%A7%E7%89%87.html$/);
});

test('directory COPY bounds concurrency and settles all in-flight operations', async () => {
	let active = 0,
		maxActive = 0;
	const root = object('source', true);
	const children = Array.from({ length: 17 }, (_, index) => object(`source/${index}`));
	const bucket = {
		head: async (key) => (key === 'source' ? root : null),
		list: async () => ({ objects: children, truncated: false }),
		get: async (key) => {
			active++;
			maxActive = Math.max(maxActive, active);
			await new Promise((resolve) => setTimeout(resolve, 2));
			return object(key);
		},
		put: async () => {
			active--;
			return {};
		},
	};
	const r = await worker.fetch(
		request('COPY', '/source', { headers: { Destination: 'https://dav.example/destination' } }),
		env(bucket),
		{},
	);
	assert.equal(r.status, 201);
	assert.equal(maxActive, 4);
	assert.equal(active, 0);
});

test('failed directory MOVE retains its collection and failed child', async () => {
	const deleted = [];
	const root = object('source', true);
	const bucket = {
		head: async (key) => (key === 'source' ? root : null),
		list: async () => ({ objects: [object('source/child')], truncated: false }),
		get: async (key) => object(key),
		put: async () => {
			throw new Error('simulated storage failure');
		},
		delete: async (key) => deleted.push(key),
	};
	const r = await worker.fetch(
		request('MOVE', '/source', { headers: { Destination: 'https://dav.example/destination' } }),
		env(bucket),
		{},
	);
	assert.equal(r.status, 500);
	assert.deepEqual(deleted, []);
});
