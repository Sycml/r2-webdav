import { browserScript } from './browser-script';

export type BrowserEntry =
	| { kind: 'folder'; name: string; href: string }
	| { kind: 'file'; name: string; href: string; size: number; modified: string };

export function escapeXml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}

function sizeLabel(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
	return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

const browserStyles = `
	:root { color-scheme: light; font-family: Inter, system-ui, "PingFang SC", "Microsoft YaHei", sans-serif; color: #172632; background: #f4f7fa; }
	* { box-sizing: border-box; }
	body { margin: 0; }
	[hidden] { display: none !important; }
	button, input { font: inherit; }
	a { color: #155a69; text-decoration: none; }
	a:hover { text-decoration: underline; }
	button { cursor: pointer; }
	:focus-visible { outline: 3px solid #4aa0ad; outline-offset: 3px; }
	button:disabled { opacity: .48; cursor: default; }
	.top { background: #fff; border-bottom: 1px solid #dae4ec; }
	.top-inner, main { width: min(100% - 40px, 1080px); margin-inline: auto; }
	.top-inner { display: flex; align-items: center; height: 64px; }
	.brand { display: inline-flex; align-items: center; gap: 11px; color: #172632; font-weight: 720; }
	.brand:hover { text-decoration: none; }
	.brand-icon { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px; background: #12616d; }
	.brand-icon::before { content: ''; width: 13px; height: 11px; border: 2px solid #fff; border-radius: 3px; background: linear-gradient(transparent 42%, #fff 42% 58%, transparent 58%); }
	main { padding-block: 34px 56px; }
	.page-heading { display: flex; align-items: end; justify-content: space-between; gap: 20px; margin-bottom: 23px; }
	.page-heading > div:first-child { min-width: 0; }
	h1 { font-size: clamp(24px, 4vw, 34px); line-height: 1.2; letter-spacing: -.025em; margin: 0 0 11px; overflow-wrap: anywhere; }
	.crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; color: #496171; font-size: 14px; overflow-wrap: anywhere; }
	.crumb-separator { color: #6f8797; }
	.toolbar, .dialog-buttons { display: flex; flex-wrap: wrap; gap: 9px; }
	.toolbar { flex-shrink: 0; }
	.btn { display: inline-flex; align-items: center; justify-content: center; min-height: 40px; padding: 8px 13px; border: 1px solid #c8d8e1; border-radius: 8px; background: #fff; color: #214355; font-weight: 630; white-space: nowrap; }
	.btn:not(:disabled):hover { background: #edf4f7; }
	.btn.primary { border-color: #12616d; background: #12616d; color: #fff; }
	.btn.primary:not(:disabled):hover { background: #0b505b; }
	.btn.danger { border-color: #b5383e; background: #b5383e; color: #fff; }
	.btn.danger:not(:disabled):hover { background: #962b33; }
	.notice { margin-bottom: 14px; padding: 12px 15px; border: 1px solid #bddde0; border-radius: 9px; background: #eaf6f6; color: #16505a; }
	.notice.error { border-color: #edc7c7; background: #fff0f0; color: #90272f; }
	#notice-text { margin: 0; white-space: pre-line; overflow-wrap: anywhere; }
	progress { display: block; width: 100%; margin-top: 8px; accent-color: #12616d; }
	.list { background: #fff; border: 1px solid #dae4ec; border-radius: 14px; }
	.list-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding: 17px 19px; }
	.list-heading h2 { font-size: 16px; margin: 0; }
	.count, .empty, .file-meta, .hint { color: #526778; font-size: 13px; }
	.file-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 14px; }
	.file-table th { text-align: left; font-size: 12px; color: #526778; font-weight: 640; background: #f4f7fa; }
	.file-table th, .file-table td { padding: 10px 14px; border-top: 1px solid #e3ebf1; }
	.file-table th:first-child, .file-table td:first-child { padding-left: 19px; }
	.file-table th:last-child, .file-table td:last-child { width: 86px; text-align: right; }
	.file-table th.file-size { width: 108px; }
	.file-table th.file-date { width: 172px; }
	.file-table tr:hover td { background: #f8fbfc; }
	.file-table tr:last-child td:first-child { border-bottom-left-radius: 14px; }
	.file-table tr:last-child td:last-child { border-bottom-right-radius: 14px; }
	.entry { display: flex; align-items: center; gap: 10px; min-height: 30px; color: #1c3b4c; overflow-wrap: anywhere; }
	.entry-icon { display: inline-block; position: relative; flex: 0 0 16px; height: 18px; border: 1.5px solid #6d9ea8; border-radius: 3px; background: #e6f1f3; }
	.entry-icon.folder { height: 13px; margin-top: 3px; border-color: #ae7c37; background: #f9e2af; }
	.entry-icon.folder::before { content: ''; position: absolute; left: -1.5px; top: -4px; width: 8px; height: 5px; border-radius: 3px 3px 0 0; background: #ae7c37; }
	.row-button { padding: 4px 8px; border: 1px solid transparent; border-radius: 7px; color: #155a69; background: transparent; font-weight: 630; min-height: 36px; }
	.row-button:hover { background: #e7f3f5; }
	.empty { border-top: 1px solid #e3ebf1; padding: 34px 20px; text-align: center; margin: 0; }
	dialog { width: min(100% - 32px, 450px); max-height: calc(100dvh - 32px); padding: 24px; border: 1px solid #dae4ec; border-radius: 14px; color: #172632; box-shadow: 0 12px 42px #17263230; }
	dialog::backdrop { background: #17304069; }
	dialog h2 { margin: 0 40px 14px 0; font-size: 21px; overflow-wrap: anywhere; }
	.dialog-close { position: absolute; right: 14px; top: 14px; width: 34px; height: 34px; border: 0; border-radius: 7px; background: #edf3f7; color: #294759; font-size: 21px; }
	.dialog-name { margin: 0 0 16px; color: #526778; overflow-wrap: anywhere; }
	.dialog-buttons { justify-content: end; margin-top: 16px; }
	.action-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
	.action-grid .delete-option { color: #a8323c; }
	label { display: block; font-size: 14px; margin-bottom: 6px; }
	input[type="text"] { width: 100%; border: 1px solid #a9c2cf; border-radius: 8px; padding: 9px 10px; color: inherit; background: #fff; }
	.picker-path { display: flex; align-items: center; gap: 8px; justify-content: space-between; margin-bottom: 8px; color: #294759; overflow-wrap: anywhere; }
	.picker-list { border: 1px solid #dae4ec; border-radius: 8px; max-height: 235px; overflow: auto; padding: 5px; }
	.picker-list button { display: block; width: 100%; text-align: left; background: #fff; border: 0; border-radius: 6px; padding: 10px; color: #155a69; overflow-wrap: anywhere; }
	.picker-list button:hover { background: #e7f3f5; }
	.picker-list p { margin: 10px; color: #526778; }
	@media (max-width: 620px) {
		.top-inner, main { width: calc(100% - 24px); }
		.top-inner { height: 55px; }
		main { padding-top: 24px; }
		.page-heading { align-items: start; flex-direction: column; gap: 15px; margin-bottom: 16px; }
		.file-date { display: none; }
		.file-table th.file-size { width: 72px; }
		.file-table th:last-child, .file-table td:last-child { width: 62px; }
		.file-table th, .file-table td { padding-inline: 7px; }
		.file-table th:first-child, .file-table td:first-child { padding-left: 11px; }
		.entry { gap: 7px; }
		.file-meta { font-size: 12px; }
	}
`;

export function renderBrowserPage(
	resourcePath: string,
	entries: BrowserEntry[],
	folderHref: (path: string, isFolder: boolean) => string,
): Response {
	const parts = resourcePath ? resourcePath.split('/') : [];
	const title = escapeXml(parts.at(-1) || '全部文件');
	const crumbs = parts.length
		? [
				'<a href="/">全部文件</a>',
				...parts.map((part, index) => {
					const name = escapeXml(part);
					return index === parts.length - 1
						? `<span aria-current="page">${name}</span>`
						: `<a href="${escapeXml(folderHref(parts.slice(0, index + 1).join('/'), true))}">${name}</a>`;
				}),
			].join('<span class="crumb-separator" aria-hidden="true">/</span>')
		: '';
	const folderCount = entries.filter((entry) => entry.kind === 'folder').length;
	const rows = entries
		.map((entry) => {
			const name = escapeXml(entry.name);
			const href = escapeXml(entry.href);
			if (entry.kind === 'folder') {
				return `<tr><td><a class="entry" href="${href}"><span class="entry-icon folder" aria-hidden="true"></span>${name}</a></td>
				<td class="file-meta">—</td><td class="file-meta file-date">—</td><td></td></tr>`;
			}
			return `<tr><td><a class="entry" href="${href}?download=1" download="${name}"><span class="entry-icon" aria-hidden="true"></span>${name}</a></td>
			<td class="file-meta">${sizeLabel(entry.size)}</td><td class="file-meta file-date"><time datetime="${entry.modified}">${entry.modified.slice(0, 10)}</time></td>
			<td><button class="row-button" type="button" data-file-path="${href}" data-file-name="${name}" aria-label="操作 ${name}">操作</button></td></tr>`;
		})
		.join('');
	const nonce = crypto.randomUUID();
	return new Response(
		`<!doctype html>
<html lang="zh-CN">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>${title} · WebDAV</title>
	<style nonce="${nonce}">${browserStyles}</style>
</head>
<body>
	<header class="top"><div class="top-inner"><a class="brand" href="/"><span class="brand-icon" aria-hidden="true"></span>WebDAV</a></div></header>
	<main>
		<div class="page-heading">
			<div><h1>${title}</h1>${crumbs ? `<nav class="crumbs" aria-label="当前位置">${crumbs}</nav>` : ''}</div>
			<div class="toolbar">
				<input id="file-input" type="file" multiple hidden>
				<button class="btn primary" type="button" id="upload" data-main-action>上传文件</button>
				<button class="btn" type="button" id="new-folder" data-main-action>新建文件夹</button>
			</div>
		</div>
		<div class="notice" id="notice" hidden><p id="notice-text" role="status"></p><progress id="progress" aria-label="上传进度" max="100" hidden></progress></div>
		<section class="list" id="file-list" aria-labelledby="file-list-title">
			<div class="list-heading"><h2 id="file-list-title">文件列表</h2><span class="count">${folderCount} 个文件夹 · ${entries.length - folderCount} 个文件</span></div>
			${rows ? `<table class="file-table"><thead><tr><th scope="col">名称</th><th class="file-size" scope="col">大小</th><th class="file-date" scope="col">修改时间</th><th scope="col">操作</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="empty">此文件夹为空，可以上传文件或新建文件夹。</p>'}
		</section>
	</main>
	<dialog id="action-dialog" aria-labelledby="dialog-title">
		<button class="dialog-close" id="dialog-close" aria-label="关闭" type="button">×</button>
		<h2 id="dialog-title"></h2>
		<p class="dialog-name" id="dialog-name" hidden></p>
		<div class="action-grid" id="file-actions" hidden>
			<a class="btn" id="download-file" download>下载</a>
			<button class="btn" type="button" data-action="rename">重命名</button>
			<button class="btn" type="button" data-action="copy">复制到</button>
			<button class="btn" type="button" data-action="move">移动到</button>
			<button class="btn delete-option" type="button" data-action="delete">删除</button>
		</div>
		<form id="name-form" hidden>
			<label for="new-name">名称</label><input id="new-name" type="text" required autocomplete="off">
			<div class="dialog-buttons"><button class="btn primary" type="submit" id="save-name">保存</button></div>
		</form>
		<div id="folder-picker" hidden>
			<div class="picker-path"><span id="picker-path"></span><button class="row-button" id="picker-up" type="button">上一级</button></div>
			<div id="picker-list" class="picker-list" aria-label="子文件夹"></div>
			<div class="dialog-buttons"><button class="btn primary" id="transfer" type="button"></button></div>
		</div>
		<div id="delete-confirm" hidden>
			<p class="hint">删除后无法在网页中撤销。</p>
			<div class="dialog-buttons"><button class="btn" id="cancel-delete" type="button">取消</button><button class="btn danger" id="delete-file" type="button">删除文件</button></div>
		</div>
	</dialog>
	<script nonce="${nonce}">${browserScript}</script>
</body>
</html>`,
		{
			headers: {
				'Content-Type': 'text/html; charset=utf-8',
				'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
				'X-Content-Type-Options': 'nosniff',
			},
		},
	);
}
