const express = require('express');
const { Readable } = require('stream');
const shared = require('../lib/shared');
const { store, ah, auth } = shared;
const router = express.Router();

// =====================================================================
//  Arquivos compartilhados — gerenciador de arquivos no Google Drive.
//  Conta única conectada (GOOGLE_DRIVE_USER, padrão 'admin'); todos os
//  perfis autenticados listam/enviam/baixam/renomeiam; excluir é só
//  tecnico/admin. Pasta: GOOGLE_DRIVE_FOLDER_ID.
// =====================================================================

function escNomeArquivo(s) {
  return String(s || 'arquivo').replace(/["\\\r\n]/g, '').slice(0, 200) || 'arquivo';
}

// GET /api/arquivos/status — diagnostico de conexão
router.get('/api/arquivos/status', auth(), shared.ah(async (req, res) => {
  const cfg = shared.getGoogleConfig();
  const driveUser = shared.getDriveUser();
  let tokens = null;
  try { if (cfg) tokens = await store.googleTokens.get(driveUser); } catch (e) {}
  const scope = String((tokens && tokens.scope) || '');
  res.json({
    configured: !!cfg,
    driveUser,
    folderId: shared.getDriveFolderId(),
    connected: !!tokens,
    hasDriveScope: /(^|\s)https:\/\/www\.googleapis\.com\/auth\/drive(\s|$)/.test(scope),
    hasRefresh: !!(tokens && tokens.refresh_token)
  });
}));

// GET /api/arquivos — lista arquivos da pasta (?q=busca)
router.get('/api/arquivos', auth(), ah(async (req, res) => {
  let drive;
  try { drive = await shared.getDriveClient(); }
  catch (e) { throw shared.mapDriveError(e); }
  const folderId = shared.getDriveFolderId();
  let q = `'${folderId}' in parents and trashed = false`;
  const busca = String(req.query.q || '').trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  if (busca) q += ` and name contains '${busca}'`;
  let r;
  try {
    r = await drive.files.list({
      q,
      fields: 'files(id,name,mimeType,size,modifiedTime,createdTime,webViewLink)',
      orderBy: 'modifiedTime desc',
      pageSize: 100,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });
  } catch (e) { throw shared.mapDriveError(e); }
  const files = (r.data.files || []).map(f => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    size: f.size != null ? Number(f.size) : null,
    modifiedTime: f.modifiedTime,
    createdTime: f.createdTime,
    webViewLink: f.webViewLink
  }));
  res.json({ folderId, total: files.length, files, geradoEm: new Date().toISOString() });
}));

// POST /api/arquivos/upload — envia 1 arquivo para a pasta
router.post('/api/arquivos/upload', auth(), shared.uploadLarge.single('arquivo'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Selecione um arquivo para enviar' });
  let drive;
  try { drive = await shared.getDriveClient(); }
  catch (e) { throw shared.mapDriveError(e); }
  const folderId = shared.getDriveFolderId();
  let r;
  try {
    r = await drive.files.create({
      requestBody: { name: req.file.originalname || 'arquivo', parents: [folderId] },
      media: {
        mimeType: req.file.mimetype || 'application/octet-stream',
        body: Readable.from(req.file.buffer)
      },
      fields: 'id,name,mimeType,size,modifiedTime,webViewLink',
      supportsAllDrives: true
    });
  } catch (e) { throw shared.mapDriveError(e); }
  const f = r.data || {};
  try {
    await store.audit.insert({
      kind: 'arquivos', action: 'upload',
      personName: f.name || req.file.originalname, ticketId: null,
      ref: 'drive:' + (f.id || ''),
      byUser: req.auth.user, byName: req.auth.name,
      summary: `Upload: ${f.name || req.file.originalname} (${req.file.size || 0} bytes)`
    });
  } catch (e) {}
  try { shared.broadcast({ type: 'arquivos' }); } catch (e) {}
  res.status(201).json({
    id: f.id, name: f.name,
    mimeType: f.mimeType, size: f.size != null ? Number(f.size) : null,
    modifiedTime: f.modifiedTime, webViewLink: f.webViewLink
  });
}));

// GET /api/arquivos/:id/download — baixa o arquivo (stream)
router.get('/api/arquivos/:id/download', auth(), ah(async (req, res) => {
  const fileId = String(req.params.id || '').trim();
  if (!fileId) return res.status(400).json({ error: 'Informe o id do arquivo' });
  let drive;
  try { drive = await shared.getDriveClient(); }
  catch (e) { throw shared.mapDriveError(e); }
  let meta;
  try {
    meta = await drive.files.get({
      fileId, fields: 'id,name,mimeType,size', supportsAllDrives: true
    });
  } catch (e) { throw shared.mapDriveError(e); }
  const mt = String((meta.data && meta.data.mimeType) || '');
  if (mt.startsWith('application/vnd.google-apps.')) {
    return res.status(400).json({
      error: 'Arquivo nativo do Google (Docs/Planilhas) — abra pelo link no Drive.',
      webViewLink: meta.data.webViewLink || null
    });
  }
  res.setHeader('Content-Type', mt || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${escNomeArquivo(meta.data.name)}"`);
  if (meta.data.size != null) res.setHeader('Content-Length', String(meta.data.size));
  let dl;
  try {
    dl = await drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'stream' });
  } catch (e) { throw shared.mapDriveError(e); }
  dl.data.on('error', () => { try { res.end(); } catch (_) {} });
  dl.data.pipe(res);
}));

// PATCH /api/arquivos/:id — renomeia
router.patch('/api/arquivos/:id', auth(), ah(async (req, res) => {
  const fileId = String(req.params.id || '').trim();
  const name = String((req.body && req.body.name) || '').trim().slice(0, 200);
  if (!fileId) return res.status(400).json({ error: 'Informe o id do arquivo' });
  if (!name) return res.status(400).json({ error: 'Informe o novo nome' });
  let drive;
  try { drive = await shared.getDriveClient(); }
  catch (e) { throw shared.mapDriveError(e); }
  let r;
  try {
    r = await drive.files.update({
      fileId, requestBody: { name },
      fields: 'id,name,mimeType,size,modifiedTime',
      supportsAllDrives: true
    });
  } catch (e) { throw shared.mapDriveError(e); }
  try {
    await store.audit.insert({
      kind: 'arquivos', action: 'renomear',
      personName: name, ticketId: null, ref: 'drive:' + fileId,
      byUser: req.auth.user, byName: req.auth.name, summary: 'Renomeado para: ' + name
    });
  } catch (e) {}
  try { shared.broadcast({ type: 'arquivos' }); } catch (e) {}
  const f = r.data || {};
  res.json({ id: f.id, name: f.name, mimeType: f.mimeType, size: f.size != null ? Number(f.size) : null, modifiedTime: f.modifiedTime });
}));

// DELETE /api/arquivos/:id — move para a lixeira (recuperável no Drive)
router.delete('/api/arquivos/:id', auth(['tecnico', 'admin']), ah(async (req, res) => {
  const fileId = String(req.params.id || '').trim();
  if (!fileId) return res.status(400).json({ error: 'Informe o id do arquivo' });
  let drive;
  try { drive = await shared.getDriveClient(); }
  catch (e) { throw shared.mapDriveError(e); }
  try {
    await drive.files.update({
      fileId, requestBody: { trashed: true },
      fields: 'id,trashed', supportsAllDrives: true
    });
  } catch (e) { throw shared.mapDriveError(e); }
  try {
    await store.audit.insert({
      kind: 'arquivos', action: 'excluir',
      personName: fileId, ticketId: null, ref: 'drive:' + fileId,
      byUser: req.auth.user, byName: req.auth.name, summary: 'Movido para a lixeira do Drive'
    });
  } catch (e) {}
  try { shared.broadcast({ type: 'arquivos' }); } catch (e) {}
  res.json({ ok: true, id: fileId });
}));

module.exports = router;
