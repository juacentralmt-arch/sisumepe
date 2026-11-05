const express = require('express');
const path = require('path');
const shared = require('../lib/shared');
const { store, ah, auth } = shared;
const router = express.Router();

// =====================================================================
//  Proxy autenticado de anexos.
//  O bucket do Supabase é privado: o navegador nunca recebe uma URL
//  pública permanente. O download passa por aqui, com sessão válida,
//  Content-Disposition controlado e suporte a Range (áudio/vídeo).
// =====================================================================

const MIME = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  webp: 'image/webp', gif: 'image/gif', txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};
const INLINE = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'mp3', 'ogg', 'oga', 'wav', 'm4a', 'mp4', 'mov', 'webm', 'txt']);

function safeName(name) {
  return String(name || 'arquivo').replace(/["\\\r\n]/g, '').slice(0, 180) || 'arquivo';
}

router.get('/api/files/anexos/:key', auth(), ah(async (req, res) => {
  const key = String(req.params.key || '');
  // Impede path traversal e nomes fora do padrão gerado pelo upload.
  if (!/^[A-Za-z0-9._-]{1,220}$/.test(key)) return res.status(400).json({ error: 'Arquivo inválido' });
  const url = '/api/files/anexos/' + encodeURIComponent(key);
  let file;
  try {
    file = await store.readStoredFile(url);
  } catch (e) {
    return res.status(e.status || 404).json({ error: 'Arquivo não encontrado' });
  }
  if (!file || !file.buffer) return res.status(404).json({ error: 'Arquivo não encontrado' });
  const ext = path.extname(file.name || key).slice(1).toLowerCase();
  const type = file.mimetype || MIME[ext] || 'application/octet-stream';
  const disposition = INLINE.has(ext) ? 'inline' : 'attachment';
  const total = file.buffer.length;
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `${disposition}; filename="${safeName(file.name || key)}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Accept-Ranges', 'bytes');
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(range));
    if (m) {
      let start = m[1] ? Number(m[1]) : 0;
      let end = m[2] ? Number(m[2]) : total - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) {
        res.setHeader('Content-Range', `bytes */${total}`);
        return res.status(416).end();
      }
      end = Math.min(end, total - 1);
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
      res.setHeader('Content-Length', String(end - start + 1));
      return res.end(file.buffer.slice(start, end + 1));
    }
  }
  res.setHeader('Content-Length', String(total));
  res.end(file.buffer);
}));

module.exports = router;
