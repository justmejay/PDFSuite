import { defineConfig } from 'vite';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('Request body is too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON request.'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function sanitizeVideoName(name) {
  return String(name || '').trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/\.+$/g, '') || 'video';
}

function parseTimeToSeconds(value) {
  const match = /(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(value);
  if (!match) return 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function msDownloaderPlugin() {
  return {
    name: 'ms-downloader-local-api',
    configureServer(server) {
      server.middlewares.use('/api/ms-select-folder', (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed.' });
          return;
        }

        const script = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Select MS Downloader destination folder'
$dialog.ShowNewFolderButton = $true
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::WriteLine($dialog.SelectedPath)
}
`;
        const picker = spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', script], {
          windowsHide: false,
        });

        let stdout = '';
        let stderr = '';
        picker.stdout.on('data', chunk => { stdout += chunk; });
        picker.stderr.on('data', chunk => { stderr += chunk; });
        picker.on('error', error => sendJson(res, 500, { error: error.message }));
        picker.on('close', code => {
          if (code !== 0) {
            sendJson(res, 500, { error: stderr.trim() || 'Folder picker failed.' });
            return;
          }

          const folderPath = stdout.trim();
          sendJson(res, 200, { path: folderPath || '' });
        });
      });

      server.middlewares.use('/api/ms-download', async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed.' });
          return;
        }

        try {
          const body = await readJsonBody(req);
          const url = String(body.url || '').trim();
          const destinationFolder = String(body.destinationFolder || '').trim();
          const videoName = sanitizeVideoName(body.videoName);

          if (!url || !destinationFolder || !videoName) {
            sendJson(res, 400, { error: 'URL, video name, and destination folder are required.' });
            return;
          }

          const resolvedFolder = path.resolve(destinationFolder);
          const outputPath = path.join(resolvedFolder, `${videoName}.mp4`);

          if (!fs.existsSync(resolvedFolder) || !fs.statSync(resolvedFolder).isDirectory()) {
            sendJson(res, 400, { error: 'Destination folder does not exist.' });
            return;
          }

          if (fs.existsSync(outputPath)) {
            sendJson(res, 409, { error: `The file already exists: ${outputPath}` });
            return;
          }

          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/x-ndjson');
          res.setHeader('Cache-Control', 'no-cache');
          res.write(JSON.stringify({ percent: 5, status: 'Starting ffmpeg...', outputPath }) + '\n');

          const ffmpeg = spawn('ffmpeg', ['-i', url, '-codec', 'copy', outputPath], {
            windowsHide: true,
          });

          let totalSeconds = 0;
          let stderr = '';

          ffmpeg.stderr.on('data', chunk => {
            const text = chunk.toString();
            stderr += text;

            const durationMatch = /Duration:\s*([0-9:.]+)/.exec(text);
            if (durationMatch) totalSeconds = parseTimeToSeconds(durationMatch[1]);

            const timeMatch = /time=\s*([0-9:.]+)/.exec(text);
            if (timeMatch && totalSeconds > 0) {
              const currentSeconds = parseTimeToSeconds(timeMatch[1]);
              const percent = Math.min(99, Math.max(5, (currentSeconds / totalSeconds) * 100));
              res.write(JSON.stringify({ percent, status: 'Processing download...' }) + '\n');
            }
          });

          ffmpeg.on('error', error => {
            res.write(JSON.stringify({ error: error.message || 'Unable to start ffmpeg.' }) + '\n');
            res.end();
          });

          ffmpeg.on('close', code => {
            if (code === 0) {
              res.write(JSON.stringify({ percent: 100, status: 'Download complete', outputPath }) + '\n');
              res.end();
              return;
            }

            const details = stderr.trim().split(/\r?\n/).slice(-4).join(' ');
            res.write(JSON.stringify({ error: details || `ffmpeg exited with code ${code}.` }) + '\n');
            res.end();
          });
        } catch (error) {
          sendJson(res, 500, { error: error.message || 'Download failed.' });
        }
      });
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [msDownloaderPlugin()],
  server: {
    hmr: false,
  },
  build: {
    rollupOptions: {
      input: fileURLToPath(new URL('./index.html', import.meta.url)),
    },
  },
});
