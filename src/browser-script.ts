export const browserScript = String.raw`
(() => {
	const get = (id) => document.getElementById(id);
	const dialog = get('action-dialog');
	const nameInput = get('new-name');
	const pickerList = get('picker-list');
	const uploadInput = get('file-input');
	const progress = get('progress');
	const currentFolder = location.pathname;
	const dateFormat = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
	const sections = ['file-actions', 'name-form', 'folder-picker', 'delete-confirm'];
	let busy = false;
	let selectedFile = null;
	let nameAction = null;
	let transferAction = null;
	let targetFolder = null;
	let pickerRequest = 0;

	const pathIn = (folder, name) => folder + encodeURIComponent(name);
	const displayPath = (path) => path.split('/').map((part) => {
		try { return decodeURIComponent(part); } catch { return part; }
	}).join('/');
	const parentFolder = (path) => path.slice(0, path.lastIndexOf('/', path.length - 2) + 1);

	function notice(message, isError = false) {
		get('notice').hidden = false;
		get('notice').classList.toggle('error', isError);
		get('notice-text').textContent = message;
	}

	function explain(status) {
		const messages = {
			0: '网络连接中断，请重试。',
			400: '名称或目标路径无效。',
			401: '登录已失效，请刷新页面后重试。',
			403: '当前请求被拒绝。',
			404: '文件或文件夹已经不存在。',
			405: '此名称已存在或该操作不可用。',
			409: '目标文件夹不存在，或该名称已被文件夹占用。',
			412: '目标同名文件已存在，或文件刚刚发生变化。',
			413: '文件超过单次上传限制。',
			423: '文件正在被其他客户端使用，请稍后重试。',
			429: '请求过于频繁，请稍后重试。',
		};
		return messages[status] || ('操作失败，请重试（HTTP ' + status + '）。');
	}

	function formatTimes() {
		for (const time of document.querySelectorAll('#file-list time')) {
			time.textContent = dateFormat.format(new Date(time.dateTime));
		}
	}

	function setBusy(value) {
		busy = value;
		for (const button of document.querySelectorAll('[data-main-action], [data-file-path]')) button.disabled = value;
	}

	async function refreshList() {
		const response = await fetch(currentFolder, { credentials: 'same-origin', cache: 'no-store' });
		if (!response.ok) throw new Error(explain(response.status));
		const page = document.createElement('template');
		page.innerHTML = await response.text();
		const list = page.content.querySelector('#file-list');
		if (!list) throw new Error('文件列表加载失败。');
		get('file-list').replaceWith(list);
		formatTimes();
	}

	async function runOperation(action) {
		if (busy) return;
		if (dialog.open) dialog.close();
		setBusy(true);
		try {
			const result = await action();
			if (result.changed) {
				try { await refreshList(); }
				catch { result.message += '\n列表刷新失败，请手动刷新页面。'; result.error = true; }
			}
			notice(result.message, result.error);
		} catch (error) {
			notice(error.message, true);
		} finally {
			progress.hidden = true;
			setBusy(false);
		}
	}

	async function mutate(method, path, headers = {}) {
		const response = await fetch(path, {
			method, credentials: 'same-origin', redirect: 'error',
			headers: { 'X-WebDAV-UI': '1', ...headers },
		});
		if (!response.ok) throw new Error(explain(response.status));
	}

	function sendUpload(path, file, condition) {
		progress.value = 0;
		progress.hidden = false;
		return new Promise((resolve) => {
			const xhr = new XMLHttpRequest();
			xhr.open('PUT', path);
			xhr.setRequestHeader('X-WebDAV-UI', '1');
			xhr.setRequestHeader(condition.name, condition.value);
			if (file.type) xhr.setRequestHeader('Content-Type', file.type);
			xhr.upload.addEventListener('progress', (event) => {
				if (event.lengthComputable && event.total > 0) progress.value = 100 * event.loaded / event.total;
			});
			xhr.addEventListener('loadend', () => resolve(xhr.status));
			xhr.send(file);
		});
	}

	function validName(name) {
		return name.trim() !== '' && name !== '.' && name !== '..' && !/[/\\\u0000-\u001f\u007f]/.test(name);
	}

	async function uploadFiles(files) {
		let succeeded = 0;
		const errors = [];
		for (const [index, file] of files.entries()) {
			if (!validName(file.name)) {
				errors.push(file.name + '：文件名无效。');
				continue;
			}
			if (file.size >= 100000000) {
				errors.push(file.name + '：单个文件需小于 100 MB。');
				continue;
			}
			notice('正在上传 ' + (index + 1) + '/' + files.length + ' · ' + file.name);
			try {
				const path = pathIn(currentFolder, file.name);
				let status = await sendUpload(path, file, { name: 'If-None-Match', value: '*' });
				if (status === 412) {
					const existing = await fetch(path, { method: 'HEAD', credentials: 'same-origin', cache: 'no-store' });
					const etag = existing.headers.get('etag');
					if (existing.ok && etag) {
						if (!window.confirm('已存在同名文件「' + file.name + '」。要替换它吗？')) {
							errors.push(file.name + '：已跳过同名文件。');
							continue;
						}
						status = await sendUpload(path, file, { name: 'If-Match', value: etag });
					}
				}
				if (status < 200 || status >= 300) throw new Error(explain(status));
				succeeded++;
			} catch (error) {
				errors.push(file.name + '：' + error.message);
			}
		}
		return {
			changed: succeeded > 0,
			message: '已上传 ' + succeeded + ' / ' + files.length + ' 个文件。' + (errors.length ? '\n' + errors.join('\n') : ''),
			error: errors.length > 0,
		};
	}

	function showDialog(title, section, name = '') {
		for (const id of sections) get(id).hidden = id !== section;
		get('dialog-title').textContent = title;
		get('dialog-name').textContent = name;
		get('dialog-name').hidden = !name;
		if (!dialog.open) dialog.showModal();
	}

	function editName(action) {
		nameAction = action;
		nameInput.value = action === 'rename' ? selectedFile.name : '';
		nameInput.setCustomValidity('');
		showDialog(action === 'rename' ? '重命名文件' : '新建文件夹', 'name-form');
		nameInput.focus();
		nameInput.select();
	}

	async function pickFolder(path) {
		const request = ++pickerRequest;
		targetFolder = null;
		get('transfer').disabled = true;
		get('picker-up').disabled = true;
		get('picker-path').textContent = displayPath(path);
		pickerList.textContent = '正在读取文件夹…';
		try {
			const response = await fetch(path + '?view=folders', { credentials: 'same-origin', cache: 'no-store' });
			if (!response.ok) throw new Error(explain(response.status));
			const folders = await response.json();
			if (request !== pickerRequest) return;
			targetFolder = path;
			get('picker-up').disabled = path === '/';
			get('transfer').disabled = pathIn(path, selectedFile.name) === selectedFile.path;
			pickerList.replaceChildren();
			if (folders.length === 0) {
				const empty = document.createElement('p');
				empty.textContent = '此处没有子文件夹';
				pickerList.append(empty);
			}
			for (const folder of folders) {
				const button = document.createElement('button');
				button.type = 'button';
				button.textContent = folder.name + ' /';
				button.addEventListener('click', () => pickFolder(folder.href));
				pickerList.append(button);
			}
		} catch (error) {
			if (request !== pickerRequest) return;
			pickerList.textContent = error.message;
			targetFolder = path;
			get('picker-up').disabled = path === '/';
		}
	}

	function transferFile(method, source, destination, message) {
		return runOperation(async () => {
			notice('正在处理文件…');
			await mutate(method, source, { Destination: new URL(destination, location.origin).href, Overwrite: 'F' });
			return { changed: true, message };
		});
	}

	get('upload').addEventListener('click', () => uploadInput.click());
	uploadInput.addEventListener('change', () => {
		const files = Array.from(uploadInput.files);
		uploadInput.value = '';
		if (files.length) void runOperation(() => uploadFiles(files));
	});
	get('new-folder').addEventListener('click', () => editName('mkdir'));
	get('dialog-close').addEventListener('click', () => dialog.close());
	get('cancel-delete').addEventListener('click', () => dialog.close());
	dialog.addEventListener('close', () => { pickerRequest++; });
	document.querySelector('main').addEventListener('click', (event) => {
		const button = event.target.closest('button[data-file-path]');
		if (busy || !button) return;
		selectedFile = { path: button.dataset.filePath, name: button.dataset.fileName };
		get('download-file').href = selectedFile.path + '?download=1';
		get('download-file').download = selectedFile.name;
		showDialog('文件操作', 'file-actions', selectedFile.name);
	});
	get('file-actions').addEventListener('click', (event) => {
		const button = event.target.closest('button[data-action]');
		if (!button) return;
		switch (button.dataset.action) {
			case 'rename': editName('rename'); break;
			case 'delete': showDialog('确认删除', 'delete-confirm', selectedFile.name); break;
			case 'copy':
			case 'move':
				transferAction = button.dataset.action;
				showDialog(transferAction === 'copy' ? '复制到文件夹' : '移动到文件夹', 'folder-picker', selectedFile.name);
				get('transfer').textContent = transferAction === 'copy' ? '复制到这里' : '移动到这里';
				void pickFolder('/');
				break;
		}
	});
	nameInput.addEventListener('input', () => nameInput.setCustomValidity(''));
	get('name-form').addEventListener('submit', (event) => {
		event.preventDefault();
		const name = nameInput.value;
		if (!validName(name)) {
			nameInput.setCustomValidity('请输入有效名称，名称不能包含斜杠。');
			nameInput.reportValidity();
			return;
		}
		const path = pathIn(currentFolder, name);
		if (nameAction === 'rename') {
			if (path === selectedFile.path) { dialog.close(); return; }
			void transferFile('MOVE', selectedFile.path, path, '已重命名为「' + name + '」。');
		} else {
			void runOperation(async () => {
				await mutate('MKCOL', path + '/');
				return { changed: true, message: '已新建文件夹「' + name + '」。' };
			});
		}
	});
	get('picker-up').addEventListener('click', () => {
		if (targetFolder && targetFolder !== '/') void pickFolder(parentFolder(targetFolder));
	});
	get('transfer').addEventListener('click', () => {
		if (!targetFolder) return;
		const copy = transferAction === 'copy';
		void transferFile(copy ? 'COPY' : 'MOVE', selectedFile.path, pathIn(targetFolder, selectedFile.name), copy ? '文件已复制。' : '文件已移动。');
	});
	get('delete-file').addEventListener('click', () => {
		const file = selectedFile;
		void runOperation(async () => {
			await mutate('DELETE', file.path);
			return { changed: true, message: '已删除「' + file.name + '」。' };
		});
	});
	formatTimes();
})();
`;
