// Run after adding photos: node generate-manifest.js
const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PHOTO_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.gif']);
const PHOTOS_DIR = path.join(__dirname, 'photos');
const OUT_FILE   = path.join(PHOTOS_DIR, 'manifest.json');

function getPhotoDate(filePath) {
  try {
    const raw = execSync(`mdls -name kMDItemContentCreationDate -raw "${filePath}" 2>/dev/null`).toString().trim();
    if (raw && raw !== '(null)') {
      const d = new Date(raw);
      if (!isNaN(d)) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
  } catch {}
  try {
    const stat = fs.statSync(filePath);
    return stat.mtime.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {}
  return null;
}

const manifest = {};
const floors = fs.readdirSync(PHOTOS_DIR).filter(f =>
  fs.statSync(path.join(PHOTOS_DIR, f)).isDirectory()
);

for (const floor of floors) {
  const rooms = fs.readdirSync(path.join(PHOTOS_DIR, floor)).filter(f =>
    fs.statSync(path.join(PHOTOS_DIR, floor, f)).isDirectory()
  );
  for (const room of rooms) {
    const dir = path.join(PHOTOS_DIR, floor, room);
    const files = fs.readdirSync(dir)
      .filter(f => PHOTO_EXTS.has(path.extname(f).toLowerCase()))
      .sort();
    if (files.length > 0) {
      manifest[`${floor}/${room}`] = files.map(f => {
        const date = getPhotoDate(path.join(dir, f));
        return date ? { file: f, date } : { file: f };
      });
    }
  }
}

fs.writeFileSync(OUT_FILE, JSON.stringify(manifest, null, 2));
console.log(`✓ manifest.json written — ${Object.keys(manifest).length} rooms indexed`);
Object.entries(manifest).forEach(([k, v]) => console.log(`  ${k}: ${v.length} photo(s)`));
