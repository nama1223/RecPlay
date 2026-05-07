const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range',
};

function cors(response) {
  const r = new Response(response.body, response);
  Object.entries(CORS_HEADERS).forEach(([k, v]) => r.headers.set(k, v));
  return r;
}

function json(data, status = 200) {
  return cors(
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

// AWS Signature V4 presigned PUT URL (WebCrypto — no npm packages needed)
async function createPresignedPutUrl(env, key, expiresIn = 3600) {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME } = env;
  const region = 'auto';
  const service = 's3';
  const host = `${R2_BUCKET_NAME}.${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

  const now = new Date();
  const dateStr = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dateOnly = dateStr.slice(0, 8);
  const credential = `${R2_ACCESS_KEY_ID}/${dateOnly}/${region}/${service}/aws4_request`;

  const params = new URLSearchParams([
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', credential],
    ['X-Amz-Date', dateStr],
    ['X-Amz-Expires', String(expiresIn)],
    ['X-Amz-SignedHeaders', 'host'],
  ]);

  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  const canonicalRequest = ['PUT', `/${encodedKey}`, params.toString(), `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');

  const sha256hex = async (str) => {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  };

  const hmac = async (keyBytes, data) => {
    const k = keyBytes instanceof Uint8Array ? keyBytes : new TextEncoder().encode(keyBytes);
    const ck = await crypto.subtle.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', ck, new TextEncoder().encode(data)));
  };

  const stringToSign = ['AWS4-HMAC-SHA256', dateStr, `${dateOnly}/${region}/${service}/aws4_request`, await sha256hex(canonicalRequest)].join('\n');
  const sigKey = await hmac(await hmac(await hmac(await hmac(`AWS4${R2_SECRET_ACCESS_KEY}`, dateOnly), region), service), 'aws4_request');
  const signature = Array.from(await hmac(sigKey, stringToSign)).map((b) => b.toString(16).padStart(2, '0')).join('');

  params.append('X-Amz-Signature', signature);
  return `https://${host}/${encodedKey}?${params.toString()}`;
}

function isAdmin(request, env) {
  return request.headers.get('Authorization') === `Bearer ${env.ADMIN_PASSWORD}`;
}

// Binding names match wrangler.jsonc:
//   R2  → env.recplay_audio  (bucket: recplay-audio)
//   KV  → env.RECPLAY_KV

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { method } = request;
    const pathname = url.pathname;

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      // POST /upload — presigned PUT URL for R2 file upload
      if (method === 'POST' && pathname === '/upload') {
        const { filename } = await request.json();
        if (!filename) return json({ error: 'missing filename' }, 400);
        const presignedUrl = await createPresignedPutUrl(env, filename);
        return json({ url: presignedUrl, key: filename });
      }

      // GET /sections?file={key}
      if (method === 'GET' && pathname === '/sections') {
        const fileKey = url.searchParams.get('file');
        if (!fileKey) return json({ error: 'missing file param' }, 400);
        const obj = await env.recplay_audio.get(`sections/${fileKey}.json`);
        if (!obj) return json({ sections: [], updatedAt: null });
        const data = await obj.json();
        return json(data);
      }

      // PUT /sections?file={key}
      if (method === 'PUT' && pathname === '/sections') {
        const fileKey = url.searchParams.get('file');
        if (!fileKey) return json({ error: 'missing file param' }, 400);
        const body = await request.text();
        await env.recplay_audio.put(`sections/${fileKey}.json`, body, {
          httpMetadata: { contentType: 'application/json' },
        });
        return json({ ok: true });
      }

      // GET /orgs — public list (no passwords)
      if (method === 'GET' && pathname === '/orgs') {
        const raw = await env.RECPLAY_KV.get('orgs');
        const orgs = raw ? JSON.parse(raw) : [];
        return json({ orgs: orgs.map((o) => ({ id: o.id, name: o.name })) });
      }

      // POST /auth — パスワードのみで団体を特定
      if (method === 'POST' && pathname === '/auth') {
        const { password } = await request.json();
        const raw = await env.RECPLAY_KV.get('orgs');
        const orgs = raw ? JSON.parse(raw) : [];
        const org = orgs.find((o) => o.password === password);
        if (!org) return json({ error: 'パスワードが違います' }, 401);
        return json({ ok: true, org: { id: org.id, name: org.name } });
      }

      // GET /org?id={orgId} — 団体名を公開取得（URL自動ログイン用）
      if (method === 'GET' && pathname === '/org') {
        const orgId = url.searchParams.get('id');
        if (!orgId) return json({ error: 'missing id' }, 400);
        const raw = await env.RECPLAY_KV.get('orgs');
        const orgs = raw ? JSON.parse(raw) : [];
        const org = orgs.find((o) => o.id === orgId);
        if (!org) return json({ error: 'not found' }, 404);
        return json({ id: org.id, name: org.name });
      }

      // GET /files?org={orgId}
      if (method === 'GET' && pathname === '/files') {
        const orgId = url.searchParams.get('org');
        if (!orgId) return json({ error: 'missing org param' }, 400);
        const list = await env.recplay_audio.list({ prefix: `${orgId}/` });
        const files = list.objects
          .filter((o) => !o.key.startsWith('sections/'))
          .map((o) => ({
            key: o.key,
            name: o.key.replace(`${orgId}/`, '').replace(/^\d+_/, ''),
            size: o.size,
            uploadedAt: o.uploaded,
          }));
        return json({ files });
      }

      // ── Admin ────────────────────────────────────────────────────

      if (method === 'GET' && pathname === '/admin/orgs') {
        if (!isAdmin(request, env)) return json({ error: 'Unauthorized' }, 401);
        const raw = await env.RECPLAY_KV.get('orgs');
        const orgs = raw ? JSON.parse(raw) : [];
        return json({ orgs: orgs.map((o) => ({ id: o.id, name: o.name })) });
      }

      if (method === 'POST' && pathname === '/admin/orgs') {
        if (!isAdmin(request, env)) return json({ error: 'Unauthorized' }, 401);
        const { name, password } = await request.json();
        if (!name || !password) return json({ error: 'name and password required' }, 400);
        const raw = await env.RECPLAY_KV.get('orgs');
        const orgs = raw ? JSON.parse(raw) : [];
        const id = `org_${Date.now()}`;
        orgs.push({ id, name, password });
        await env.RECPLAY_KV.put('orgs', JSON.stringify(orgs));
        return json({ ok: true, org: { id, name } });
      }

      if (method === 'PUT' && pathname.startsWith('/admin/orgs/')) {
        if (!isAdmin(request, env)) return json({ error: 'Unauthorized' }, 401);
        const orgId = pathname.slice('/admin/orgs/'.length);
        const updates = await request.json();
        const raw = await env.RECPLAY_KV.get('orgs');
        const orgs = raw ? JSON.parse(raw) : [];
        const idx = orgs.findIndex((o) => o.id === orgId);
        if (idx === -1) return json({ error: 'not found' }, 404);
        if (updates.name) orgs[idx].name = updates.name;
        if (updates.password) orgs[idx].password = updates.password;
        await env.RECPLAY_KV.put('orgs', JSON.stringify(orgs));
        return json({ ok: true });
      }

      if (method === 'DELETE' && pathname.startsWith('/admin/orgs/')) {
        if (!isAdmin(request, env)) return json({ error: 'Unauthorized' }, 401);
        const orgId = pathname.slice('/admin/orgs/'.length);
        const raw = await env.RECPLAY_KV.get('orgs');
        const orgs = raw ? JSON.parse(raw) : [];
        await env.RECPLAY_KV.put('orgs', JSON.stringify(orgs.filter((o) => o.id !== orgId)));
        return json({ ok: true });
      }

      if (method === 'DELETE' && pathname.startsWith('/admin/files/')) {
        if (!isAdmin(request, env)) return json({ error: 'Unauthorized' }, 401);
        const key = decodeURIComponent(pathname.slice('/admin/files/'.length));
        await Promise.all([
          env.recplay_audio.delete(key),
          env.recplay_audio.delete(`sections/${key}.json`),
        ]);
        return json({ ok: true });
      }

      return new Response('Not Found', { status: 404 });
    } catch (err) {
      return json({ error: String(err) }, 500);
    }
  },
};
