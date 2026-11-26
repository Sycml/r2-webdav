import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { DOMParser } from '@xmldom/xmldom';

const base = new URL(process.env.WEBDAV_URL || 'http://127.0.0.1:8787/');
const credentials = process.env.WEBDAV_CREDENTIALS_FILE
	? JSON.parse(await readFile(process.env.WEBDAV_CREDENTIALS_FILE, 'utf8'))
	: { username: process.env.TEST_USERNAME || 'webdav', password: process.env.TEST_PASSWORD || 'local-test-password' };
const authorization = `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`;
const root = `/__webdav_test_${randomUUID()}`;
const path = (value) => value.split('/').map(encodeURIComponent).join('/');
const send = (method, resource, options = {}) =>
	fetch(new URL(path(resource), base), {
		method,
		...options,
		headers: { Authorization: authorization, ...options.headers },
		signal: AbortSignal.timeout(Number(process.env.WEBDAV_TIMEOUT_MS || 900000)),
	});
const destination = (resource) => new URL(path(resource), base).href;
let count = 0;
async function expect(method, resource, status, options) {
	const r = await send(method, resource, options);
	assert.equal(r.status, status, `${method} ${resource}: expected ${status}, received ${r.status}`);
	return r;
}
async function check(name, fn) {
	await fn();
	console.log(`PASS ${name}`);
	count++;
}
const parse = (xml) => new DOMParser().parseFromString(xml, 'application/xml');
let madeRoot = false;
try {
	if (!process.env.WEBDAV_LARGE_ONLY)
		await check('capability discovery and authentication', async () => {
			const options = await expect('OPTIONS', '/', 200, { headers: { Authorization: '' } });
			assert.match(options.headers.get('DAV'), /1.*2/);
			for (const method of ['GET', 'HEAD', 'PROPFIND', 'PUT', 'MKCOL', 'COPY', 'MOVE', 'DELETE', 'LOCK', 'UNLOCK']) {
				await expect(method, `${root}/unauthorized`, 401, { headers: { Authorization: '' } });
				await expect(method, `${root}/unauthorized`, 401, {
					headers: { Authorization: `Basic ${btoa('wrong:wrong')}` },
				});
			}
		});
	await expect('MKCOL', root, 201);
	madeRoot = true;
	if (!process.env.WEBDAV_LARGE_ONLY) {
		await check('nested and empty collections; parent existence', async () => {
			await expect('MKCOL', `${root}/folder`, 201);
			await expect('MKCOL', `${root}/folder/nested`, 201);
			await expect('PUT', `${root}/missing/file`, 409, { body: 'x' });
			const r = await expect('PROPFIND', `${root}/folder/nested/`, 207, { headers: { Depth: '0' } });
			assert.equal(parse(await r.text()).getElementsByTagName('collection').length, 1);
		});
		const file = `${root}/folder/中文 空格#&%.txt`;
		const content = 'WebDAV round trip: 中文 & < > # %\n';
		await check('special filenames, byte content, HEAD and Range', async () => {
			await expect('PUT', file, 201, { body: content });
			assert.equal(await (await expect('GET', file, 200)).text(), content);
			const head = await expect('HEAD', file, 200);
			assert.equal(Number(head.headers.get('content-length')), Buffer.byteLength(content));
			assert.ok(head.headers.get('etag'));
			assert.equal((await head.text()).length, 0);
			assert.equal(await (await expect('GET', file, 206, { headers: { Range: 'bytes=0-5' } })).text(), 'WebDAV');
			await expect('PUT', `${root}/empty`, 201, { body: '' });
			assert.equal((await (await expect('GET', `${root}/empty`, 200)).arrayBuffer()).byteLength, 0);
		});
		await check('PROPFIND depth and XML encoding', async () => {
			const zero = await expect('PROPFIND', `${root}/folder/`, 207, { headers: { Depth: '0' } });
			assert.equal(parse(await zero.text()).getElementsByTagName('response').length, 1);
			const one = await expect('PROPFIND', `${root}/folder/`, 207, { headers: { Depth: '1' } });
			const doc = parse(await one.text());
			assert.equal(doc.getElementsByTagName('response').length, 3);
			assert.ok(
				Array.from(doc.getElementsByTagName('href')).some((node) => decodeURIComponent(node.textContent) === file),
			);
		});
		await check('conditional writes and overwrite', async () => {
			await expect('PUT', file, 412, { body: 'must not replace', headers: { 'If-None-Match': '*' } });
			await expect('PUT', file, 412, { body: 'must not replace', headers: { 'If-Match': '"wrong-etag"' } });
			assert.equal(await (await expect('GET', file, 200)).text(), content);
			await expect('PUT', file, 204, { body: content });
		});
		await check('file and collection COPY/MOVE, overwrite refusal', async () => {
			await expect('COPY', file, 201, { headers: { Destination: destination(`${root}/copied`) } });
			await expect('COPY', file, 412, { headers: { Destination: destination(`${root}/copied`), Overwrite: 'F' } });
			await expect('MOVE', `${root}/copied`, 201, { headers: { Destination: destination(`${root}/moved`) } });
			await expect('GET', `${root}/copied`, 404);
			assert.equal(await (await expect('GET', `${root}/moved`, 200)).text(), content);
			await expect('COPY', `${root}/folder`, 201, { headers: { Destination: destination(`${root}/folder-copy`) } });
			await expect('MOVE', `${root}/folder-copy`, 201, {
				headers: { Destination: destination(`${root}/folder-moved`) },
			});
			await expect('GET', `${root}/folder-copy/`, 404);
			assert.equal(await (await expect('GET', `${root}/folder-moved/中文 空格#&%.txt`, 200)).text(), content);
			await expect('DELETE', `${root}/folder-moved`, 204);
		});
		await check('file lock, locked write denial and unlock', async () => {
			const lock = await expect('LOCK', file, 201, {
				headers: { 'Content-Type': 'application/xml', Depth: '0', Timeout: 'Second-600' },
				body: '<lockinfo xmlns="DAV:"><lockscope><exclusive/></lockscope><locktype><write/></locktype><owner>test</owner></lockinfo>',
			});
			const token = lock.headers.get('lock-token');
			assert.ok(token);
			await expect('PUT', file, 423, { body: 'locked' });
			await expect('PUT', file, 204, { body: content, headers: { If: `(${token})` } });
			await expect('UNLOCK', file, 204, { headers: { 'Lock-Token': token } });
		});
		await check('dead properties round trip', async () => {
			await expect('PROPPATCH', file, 207, {
				body: '<propertyupdate xmlns="DAV:" xmlns:x="urn:test"><set><prop><x:label>测试</x:label></prop></set></propertyupdate>',
			});
			const r = await expect('PROPFIND', file, 207, {
				headers: { Depth: '0' },
				body: '<propfind xmlns="DAV:" xmlns:x="urn:test"><prop><x:label/></prop></propfind>',
			});
			assert.equal(parse(await r.text()).getElementsByTagNameNS('urn:test', 'label')[0].textContent, '测试');
		});
	}
	const largeMB = Number(process.env.WEBDAV_LARGE_MB || 0);
	if (largeMB)
		await check(`${largeMB} MiB streaming upload/download SHA-256`, async () => {
			console.log(`START ${largeMB} MiB transfer`);
			const data = Buffer.alloc(largeMB * 1024 * 1024, 0x5a);
			const hash = createHash('sha256').update(data).digest('hex');
			await expect('PUT', `${root}/large.bin`, 201, { body: data });
			console.log('Large upload complete; downloading and verifying');
			const response = await expect('GET', `${root}/large.bin`, 200);
			const received = createHash('sha256');
			let size = 0;
			let progress = 0;
			for await (const chunk of response.body) {
				received.update(chunk);
				size += chunk.length;
				const step = Math.floor(size / (10 * 1024 * 1024));
				if (step > progress) {
					progress = step;
					console.log(`Verified download stream: ${Math.floor(size / (1024 * 1024))} MiB received`);
				}
			}
			assert.equal(size, data.length);
			assert.equal(received.digest('hex'), hash);
			await expect('DELETE', `${root}/large.bin`, 204);
		});
	console.log(`Completed ${count} WebDAV protocol scenarios against ${base.origin}`);
} finally {
	if (madeRoot) {
		await expect('DELETE', root, 204);
		await expect('PROPFIND', root, 404, { headers: { Depth: '0' } });
		console.log('Temporary test collection removed');
	}
}
