const fs = require('fs');
const path = require('path');

const distDir = path.resolve(__dirname, 'dist');
const iconsDir = path.resolve(distDir, 'icons');

if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

fs.copyFileSync(
  path.resolve(__dirname, 'manifest.json'),
  path.resolve(distDir, 'manifest.json')
);

fs.copyFileSync(
  path.resolve(__dirname, 'orb-window.html'),
  path.resolve(distDir, 'orb-window.html')
);

const sourceIcons = path.resolve(__dirname, 'icons');
if (fs.existsSync(sourceIcons)) {
  for (const file of fs.readdirSync(sourceIcons)) {
    fs.copyFileSync(
      path.resolve(sourceIcons, file),
      path.resolve(iconsDir, file)
    );
  }
}

console.log('Extension build complete: manifest.json and icons copied to dist/');
