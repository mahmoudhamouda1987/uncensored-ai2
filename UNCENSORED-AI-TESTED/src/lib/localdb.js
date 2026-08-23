const DB_NAME = 'uncensored-workbench';
const DB_VERSION = 1;

const STORES = {
    projects: { keyPath: 'id', indexes: [{ name: 'updatedAt', keyPath: 'updatedAt' }] },
    conversations: { keyPath: 'id', indexes: [{ name: 'projectId', keyPath: 'projectId' }, { name: 'updatedAt', keyPath: 'updatedAt' }] },
    messages: { keyPath: 'id', indexes: [{ name: 'conversationId', keyPath: 'conversationId' }] },
    artifacts: { keyPath: 'id', indexes: [{ name: 'projectId', keyPath: 'projectId' }, { name: 'kind', keyPath: 'kind' }, { name: 'createdAt', keyPath: 'createdAt' }] },
    files: { keyPath: 'id', indexes: [{ name: 'projectId', keyPath: 'projectId' }] },
    tasks: { keyPath: 'id', indexes: [{ name: 'createdAt', keyPath: 'createdAt' }] },
    settings: { keyPath: 'key' },
};

let dbPromise = null;

function openDb() {
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB unavailable'));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (event) => {
            const db = req.result;
            for (const [name, def] of Object.entries(STORES)) {
                if (!db.objectStoreNames.contains(name)) {
                    const store = db.createObjectStore(name, { keyPath: def.keyPath });
                    for (const idx of def.indexes || []) {
                        store.createIndex(idx.name, idx.keyPath, { unique: false });
                    }
                }
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return dbPromise;
}

async function tx(storeName, mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        let result;
        try {
            result = fn(store);
        } catch (e) {
            reject(e);
            return;
        }
        transaction.oncomplete = () => resolve(result?._req ? result._req.result : result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    });
}

function requestAsPromise(store, method, ...args) {
    return new Promise((resolve, reject) => {
        const req = store[method](...args);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function put(storeName, value) {
    return tx(storeName, 'readwrite', (store) => {
        const p = requestAsPromise(store, 'put', value);
        return { _req: p };
    });
}

export async function get(storeName, key) {
    return tx(storeName, 'readonly', (store) => {
        const p = requestAsPromise(store, 'get', key);
        return { _req: p };
    });
}

export async function remove(storeName, key) {
    return tx(storeName, 'readwrite', (store) => {
        const p = requestAsPromise(store, 'delete', key);
        return { _req: p };
    });
}

export async function getAll(storeName) {
    return tx(storeName, 'readonly', (store) => {
        const p = requestAsPromise(store, 'getAll');
        return { _req: p };
    });
}

export async function getByIndex(storeName, indexName, value) {
    return tx(storeName, 'readonly', (store) => {
        const index = store.index(indexName);
        const p = new Promise((resolve, reject) => {
            const req = index.getAll(value);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        return { _req: p };
    });
}

export function uid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export async function createProject({ name, description = '', instructions = '' }) {
    const now = Date.now();
    const project = {
        id: uid(),
        name,
        description,
        instructions,
        createdAt: now,
        updatedAt: now,
    };
    await put('projects', project);
    return project;
}

export async function createConversation(projectId, title = 'New Chat') {
    const now = Date.now();
    const conversation = {
        id: uid(),
        projectId: projectId || null,
        title,
        createdAt: now,
        updatedAt: now,
    };
    await put('conversations', conversation);
    return conversation;
}

export async function saveMessage(conversationId, message) {
    const record = { id: message.id || uid(), conversationId, createdAt: Date.now(), ...message };
    await put('messages', record);
    const conv = await get('conversations', conversationId);
    if (conv) {
        conv.updatedAt = Date.now();
        if (message.role === 'user' && conv.title === 'New Chat') {
            conv.title = String(message.content || '').slice(0, 48);
        }
        await put('conversations', conv);
    }
    return record;
}

export async function loadMessages(conversationId) {
    const all = await getByIndex('messages', 'conversationId', conversationId);
    return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function deleteConversation(conversationId) {
    const msgs = await loadMessages(conversationId);
    for (const m of msgs) await remove('messages', m.id);
    await remove('conversations', conversationId);
}

export async function saveArtifact(artifact, projectId = null) {
    const record = { id: artifact.id || uid(), projectId, createdAt: Date.now(), updatedAt: Date.now(), ...artifact };
    await put('artifacts', record);
    return record;
}

export async function saveFileMeta(meta, blob) {
    const record = { id: meta.id || uid(), createdAt: Date.now(), ...meta };
    await put('files', { ...record, blob });
    return record;
}

export async function estimateUsage() {
    if (navigator.storage && navigator.storage.estimate) {
        try {
            const est = await navigator.storage.estimate();
            return { usage: est.usage, quota: est.quota };
        } catch { }
    }
    return null;
}
