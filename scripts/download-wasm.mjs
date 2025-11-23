import fs from 'fs';
import path from 'path';
import https from 'https';

const outputDir = path.join(process.cwd(), 'public', 'wasm');

const files = [
  { name: 'tree-sitter-javascript.wasm', url: 'https://github.com/tree-sitter/tree-sitter-javascript/releases/download/v0.25.0/tree-sitter-javascript.wasm' },
  { name: 'tree-sitter-typescript.wasm', url: 'https://github.com/tree-sitter/tree-sitter-typescript/releases/download/v0.23.2/tree-sitter-typescript.wasm' },
  { name: 'tree-sitter-tsx.wasm', url: 'https://github.com/tree-sitter/tree-sitter-typescript/releases/download/v0.23.2/tree-sitter-tsx.wasm' },
];

async function copyLocalWasm() {
  const src = path.join(process.cwd(), 'node_modules', 'web-tree-sitter', 'tree-sitter.wasm');
  const dest = path.join(outputDir, 'tree-sitter.wasm');
  try {
    fs.copyFileSync(src, dest);
    console.log('Copied tree-sitter.wasm from node_modules');
  } catch (err) {
    console.error('Failed to copy tree-sitter.wasm:', err.message);
  }
}

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const request = https.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 302 || response.statusCode === 301) {
        downloadFile(response.headers.location, dest).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download ${url}: ${response.statusCode}`));
        return;
      }

      response.pipe(file);
      file.on('finish', () => {
        file.close();
        console.log(`Downloaded ${path.basename(dest)}`);
        resolve();
      });
    });

    request.on('error', (err) => {
      fs.unlink(dest, () => { });
      reject(err);
    });
  });
}

async function main() {
  await copyLocalWasm();
  for (const file of files) {
    try {
      await downloadFile(file.url, path.join(outputDir, file.name));
    } catch (err) {
      console.error(err.message);
    }
  }
}

main();
