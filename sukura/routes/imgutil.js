const https = require('https');
const http = require('http');
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');
const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');

function downloadImg(url, prefix, existingLocalPath) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    if (existingLocalPath && existingLocalPath.startsWith('/uploads/')) {
      const fullPath = path.join(__dirname, '..', 'public', existingLocalPath);
      if (fs.existsSync(fullPath)) return resolve(existingLocalPath);
    }
    try {
      const client = url.startsWith('https') ? https : http;
      const ext = (url.match(/\.(jpg|jpeg|png|gif|webp)/i) || ['.jpg'])[0];
      const filename = prefix + '_' + Date.now() + ext;
      const filepath = path.join(uploadsDir, filename);
      const file = fs.createWriteStream(filepath);
      const req = client.get(url, {
        headers: {
          'Referer': 'https://www.bilibili.com',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }, res => {
        res.pipe(file);
        file.on('finish', () => {
          file.close(() => {
            try {
              execSync(`convert "${filepath}" -resize '720x>' -quality 75 -strip "${filepath}.tmp" && mv "${filepath}.tmp" "${filepath}"`, { stdio: 'ignore' });
            } catch(e) {}
            resolve('/uploads/' + filename);
          });
        });
      });
      req.on('error', () => { try { fs.unlinkSync(filepath); } catch(e) {} resolve(null); });
      req.setTimeout(15000, () => { req.destroy(); resolve(null); });
    } catch(e) { resolve(null); }
  });
}

module.exports = { downloadImg };
