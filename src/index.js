const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, PATCH, OPTIONS',
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


function isAdmin(request, env) {
  return request.headers.get('Authorization') === `Bearer ${env.ADMIN_PASSWORD}`;
}

// ── AWS Sig V4 presigned URL (for R2 S3-compatible direct upload) ──────────
async function hmacSHA256(key, data) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    typeof key === 'string' ? enc.encode(key) : key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, typeof data === 'string' ? enc.encode(data) : data);
}

function toHex(buf) {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function createPresignedPutUrl(env, key, expiresIn = 3600) {
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretKey   = env.R2_SECRET_ACCESS_KEY;
  const accountId   = env.R2_ACCOUNT_ID;
  const bucket      = env.R2_BUCKET_NAME;
  if (!accessKeyId || !secretKey) throw new Error('R2 credentials not configured');

  const region  = 'auto';
  const service = 's3';
  const host    = `${accountId}.r2.cloudflarestorage.com`;
  const now     = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');       // YYYYMMDD
  const timeStr = now.toISOString().replace(/[:\-]/g, '').slice(0, 15) + 'Z'; // YYYYMMDDTHHmmssZ

  const credScope  = `${dateStr}/${region}/${service}/aws4_request`;
  const credential = `${accessKeyId}/${credScope}`;

  // Encode key — preserve slashes
  const encodedKey = key.split('/').map((s) => encodeURIComponent(s)).join('/');

  // Canonical query string (must be sorted)
  const qParams = [
    ['X-Amz-Algorithm',     'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential',    credential],
    ['X-Amz-Date',          timeStr],
    ['X-Amz-Expires',       String(expiresIn)],
    ['X-Amz-SignedHeaders', 'host'],
  ].sort(([a], [b]) => a.localeCompare(b));

  const canonicalQS = qParams
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const canonicalRequest = [
    'PUT',
    `/${bucket}/${encodedKey}`,
    canonicalQS,
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const reqHash = toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalRequest)));

  const stringToSign = ['AWS4-HMAC-SHA256', timeStr, credScope, reqHash].join('\n');

  let signingKey = await hmacSHA256('AWS4' + secretKey, dateStr);
  signingKey = await hmacSHA256(signingKey, region);
  signingKey = await hmacSHA256(signingKey, service);
  signingKey = await hmacSHA256(signingKey, 'aws4_request');
  const signature = toHex(await hmacSHA256(signingKey, stringToSign));

  return `https://${host}/${bucket}/${encodedKey}?${canonicalQS}&X-Amz-Signature=${signature}`;
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
      // POST /presign — 署名付きPUT URLを発行（クライアントがR2へ直接アップロードするため）
      if (method === 'POST' && pathname === '/presign') {
        const body = await request.json();
        let key;
        if (body.key) {
          // Overwrite existing key (used by normalize-in-place)
          key = body.key;
        } else {
          const { filename, orgId } = body;
          if (!filename || !orgId) return json({ error: 'filename and orgId required' }, 400);
          const timestamp = Date.now();
          const safeName = filename.replace(/[/\\#%?&=+<>"'\x00-\x1f]/g, '_');
          key = `${orgId}/${timestamp}_${safeName}`;
        }
        try {
          const uploadUrl = await createPresignedPutUrl(env, key);
          return json({ url: uploadUrl, key });
        } catch (e) {
          return json({ error: String(e) }, 500);
        }
      }

      // PUT /upload?key={key} — ファイルをR2ネイティブバインディングで直接保存（小ファイル用フォールバック）
      if (method === 'PUT' && pathname === '/upload') {
        const key = url.searchParams.get('key');
        if (!key) return json({ error: 'missing key' }, 400);
        const contentType = request.headers.get('Content-Type') ?? 'audio/mpeg';
        await env.recplay_audio.put(key, request.body, {
          httpMetadata: { contentType },
        });
        return json({ ok: true, key });
      }

      // GET /waveform?file={key}
      if (method === 'GET' && pathname === '/waveform') {
        const fileKey = url.searchParams.get('file');
        if (!fileKey) return json({ error: 'missing file param' }, 400);
        const obj = await env.recplay_audio.get(`waveforms/${fileKey}.json`);
        if (!obj) return new Response(null, { status: 404, headers: CORS_HEADERS });
        return new Response(obj.body, {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' },
        });
      }

      // PUT /waveform?file={key}
      if (method === 'PUT' && pathname === '/waveform') {
        const fileKey = url.searchParams.get('file');
        if (!fileKey) return json({ error: 'missing file param' }, 400);
        const body = await request.text();
        await env.recplay_audio.put(`waveforms/${fileKey}.json`, body, {
          httpMetadata: { contentType: 'application/json' },
        });
        return json({ ok: true });
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

      // HEAD /audio?key={key} — ファイルサイズ取得（ダウンロード機能用）
      if (method === 'HEAD' && pathname === '/audio') {
        const key = url.searchParams.get('key');
        if (!key) return new Response(null, { status: 400, headers: CORS_HEADERS });
        const obj = await env.recplay_audio.head(key);
        if (!obj) return new Response(null, { status: 404, headers: CORS_HEADERS });
        return new Response(null, {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': obj.httpMetadata?.contentType ?? 'audio/mpeg',
            'Content-Length': String(obj.size),
            'Accept-Ranges': 'bytes',
          },
        });
      }

      // GET /audio?key={key} — R2から音声を配信（Range対応、duration検出のためバッファ返却）
      if (method === 'GET' && pathname === '/audio') {
        const key = url.searchParams.get('key');
        if (!key) return new Response('missing key', { status: 400, headers: CORS_HEADERS });

        const rangeHeader = request.headers.get('Range');
        const MAX_CHUNK = 2 * 1024 * 1024; // 2MB上限（chunked転送を避けてContent-Lengthを保証）

        if (rangeHeader) {
          const m = rangeHeader.match(/bytes=(\d*)-(\d*)/);
          if (m) {
            const offset = m[1] ? parseInt(m[1]) : 0;
            const endByte = m[2] ? parseInt(m[2]) : undefined;
            const requested = endByte !== undefined ? endByte - offset + 1 : MAX_CHUNK;
            const length = Math.min(requested, MAX_CHUNK);
            const obj = await env.recplay_audio.get(key, { range: { offset, length } });
            if (!obj) return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
            const body = await obj.arrayBuffer();
            const actualOffset = obj.range?.offset ?? offset;
            const rangeEnd = actualOffset + body.byteLength - 1;
            return new Response(body, {
              status: 206,
              headers: {
                ...CORS_HEADERS,
                'Content-Type': obj.httpMetadata?.contentType ?? 'audio/mpeg',
                'Accept-Ranges': 'bytes',
                'Content-Range': `bytes ${actualOffset}-${rangeEnd}/${obj.size}`,
                'Content-Length': String(body.byteLength),
                'Cache-Control': 'public, max-age=3600',
              },
            });
          }
        }

        // Rangeなし: ストリーミング（ブラウザが直接アクセスする場合など）
        const obj = await env.recplay_audio.get(key);
        if (!obj) return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
        return new Response(obj.body, {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': obj.httpMetadata?.contentType ?? 'audio/mpeg',
            'Accept-Ranges': 'bytes',
            'Content-Length': String(obj.size),
            'Cache-Control': 'public, max-age=3600',
          },
        });
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

      // POST /files/copy — ファイルを複製（音声 + sections + waveform）
      if (method === 'POST' && pathname === '/files/copy') {
        const { key } = await request.json();
        if (!key) return json({ error: 'key required' }, 400);
        const orgId = key.split('/')[0];
        const filename = key.slice(orgId.length + 1);
        const baseName = filename.replace(/^\d+_/, '');  // タイムスタンプ prefix を除去
        const dotIdx = baseName.lastIndexOf('.');
        const nameWithoutExt = dotIdx >= 0 ? baseName.slice(0, dotIdx) : baseName;
        const ext = dotIdx >= 0 ? baseName.slice(dotIdx) : '';
        const newBaseName = `${nameWithoutExt}のコピー${ext}`;
        const newTimestamp = Date.now();
        const safeName = newBaseName.replace(/[/\\#%?&=+<>"'\x00-\x1f]/g, '_');
        const newKey = `${orgId}/${newTimestamp}_${safeName}`;
        // 音声ファイルをコピー
        const obj = await env.recplay_audio.get(key);
        if (!obj) return json({ error: 'not found' }, 404);
        await env.recplay_audio.put(newKey, obj.body, { httpMetadata: obj.httpMetadata });
        // sections をコピー（存在する場合）
        const sectObj = await env.recplay_audio.get(`sections/${key}.json`);
        if (sectObj) {
          await env.recplay_audio.put(`sections/${newKey}.json`, sectObj.body, {
            httpMetadata: { contentType: 'application/json' },
          });
        }
        // waveform をコピー（存在する場合）
        const waveObj = await env.recplay_audio.get(`waveforms/${key}.json`);
        if (waveObj) {
          await env.recplay_audio.put(`waveforms/${newKey}.json`, waveObj.body, {
            httpMetadata: { contentType: 'application/json' },
          });
        }
        return json({ ok: true, newKey });
      }

      // DELETE /files?key={key} — ファイル削除（音声 + sections + waveform）
      if (method === 'DELETE' && pathname === '/files') {
        const key = url.searchParams.get('key');
        if (!key) return json({ error: 'key required' }, 400);
        await Promise.all([
          env.recplay_audio.delete(key),
          env.recplay_audio.delete(`sections/${key}.json`),
          env.recplay_audio.delete(`waveforms/${key}.json`),
        ]);
        return json({ ok: true });
      }

      // PATCH /files — ファイル名変更（R2内でコピー→削除）
      if (method === 'PATCH' && pathname === '/files') {
        const { key, newName } = await request.json();
        if (!key || !newName) return json({ error: 'key and newName required' }, 400);
        const orgId = key.split('/')[0];
        const filename = key.slice(orgId.length + 1);
        const timestamp = filename.split('_')[0];
        const safeName = newName.replace(/[/\\#%?&=+<>"'\x00-\x1f]/g, '_');
        const newKey = `${orgId}/${timestamp}_${safeName}`;
        if (newKey === key) return json({ ok: true, newKey });
        const obj = await env.recplay_audio.get(key);
        if (!obj) return json({ error: 'not found' }, 404);
        await env.recplay_audio.put(newKey, obj.body, { httpMetadata: obj.httpMetadata });
        await env.recplay_audio.delete(key);
        const sectObj = await env.recplay_audio.get(`sections/${key}.json`);
        if (sectObj) {
          await env.recplay_audio.put(`sections/${newKey}.json`, sectObj.body, {
            httpMetadata: { contentType: 'application/json' },
          });
          await env.recplay_audio.delete(`sections/${key}.json`);
        }
        return json({ ok: true, newKey });
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

      // GET /ping — 診断用エンドポイント
      if (method === 'GET' && pathname === '/ping') {
        try {
          const list = await env.recplay_audio.list({ limit: 3 });
          return json({
            ok: true,
            bucket_binding: 'recplay_audio',
            objects_count: list.objects.length,
            sample_keys: list.objects.map((o) => o.key),
          });
        } catch (e) {
          return json({ ok: false, error: String(e) });
        }
      }

      return new Response('Not Found', { status: 404 });
    } catch (err) {
      return json({ error: String(err) }, 500);
    }
  },
};
