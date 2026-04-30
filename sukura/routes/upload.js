const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const Busboy = require('busboy');
const { authUser } = require('../middleware/auth');

const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const IMG_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const AUDIO_EXTS = new Set(['.mp3', '.ogg', '.wav', '.flac', '.m4a', '.aac']);
const IMG_LIMIT = 10 * 1024 * 1024;        // 10MB
const AUDIO_LIMIT = 100 * 1024 * 1024;     // 100MB

// 通用上传处理：流式写盘，避免内存爆炸
function handleUpload({ allowedExts, sizeLimit, defaultExt, label }) {
  return (req, res) => {
    let bb;
    try {
      bb = Busboy({
        headers: req.headers,
        limits: { files: 1, fileSize: sizeLimit }
      });
    } catch (e) {
      return res.status(400).json({ error: '无效的上传请求: ' + e.message });
    }

    let responded = false;
    const respond = (status, body) => {
      if (responded) return;
      responded = true;
      res.status(status).json(body);
    };

    let savedPath = null;
    let writeStream = null;
    let cleanup = () => {
      if (writeStream && !writeStream.destroyed) writeStream.destroy();
      if (savedPath) {
        fs.unlink(savedPath, () => {});
        savedPath = null;
      }
    };

    bb.on('file', (fieldname, fileStream, info) => {
      const origName = info.filename || 'upload' + defaultExt;
      const ext = (path.extname(origName) || defaultExt).toLowerCase();

      if (!allowedExts.has(ext)) {
        fileStream.resume(); // 排空 stream，避免阻塞
        return respond(400, { error: `不支持的${label}格式：${ext}` });
      }

      const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
      savedPath = path.join(uploadsDir, filename);
      writeStream = fs.createWriteStream(savedPath);

      fileStream.on('limit', () => {
        cleanup();
        respond(413, { error: `${label}超过大小限制（${Math.round(sizeLimit/1024/1024)}MB）` });
      });

      fileStream.on('error', (err) => {
        console.error(`[UPLOAD ${label}] file stream error:`, err.message);
        cleanup();
        respond(500, { error: '上传失败: ' + err.message });
      });

      writeStream.on('error', (err) => {
        console.error(`[UPLOAD ${label}] write error:`, err.message);
        cleanup();
        respond(500, { error: '保存失败: ' + err.message });
      });

      writeStream.on('finish', () => {
        if (responded) {
          // 已经因为别的原因（比如超限）回应过了，删掉残留
          fs.unlink(savedPath, () => {});
          return;
        }
        respond(200, { url: '/uploads/' + filename });
      });

      fileStream.pipe(writeStream);
    });

    bb.on('error', (err) => {
      console.error(`[UPLOAD ${label}] busboy error:`, err.message);
      cleanup();
      respond(500, { error: '解析失败: ' + err.message });
    });

    bb.on('finish', () => {
      if (!responded && !savedPath) {
        respond(400, { error: '没有收到文件' });
      }
    });

    req.on('aborted', () => {
      cleanup();
      respond(499, { error: '客户端中断' });
    });

    req.pipe(bb);
  };
}

router.post('/image', authUser, handleUpload({
  allowedExts: IMG_EXTS,
  sizeLimit: IMG_LIMIT,
  defaultExt: '.jpg',
  label: '图片',
}));

router.post('/audio', authUser, handleUpload({
  allowedExts: AUDIO_EXTS,
  sizeLimit: AUDIO_LIMIT,
  defaultExt: '.mp3',
  label: '音频',
}));

module.exports = router;
