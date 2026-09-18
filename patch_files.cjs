const fs = require('fs');
const path = require('path');

// 1. Create config.json
const configPath = path.join(__dirname, 'config.json');
if (!fs.existsSync(configPath)) {
  fs.writeFileSync(configPath, JSON.stringify({
    port: 3000,
    concurrencyLimit: 5,
    staggerMinMs: 1000,
    staggerMaxMs: 4000,
    timeouts: {
      playwrightNav: 60000,
      ocrPipe: 7000,
      ocrCli: 15000
    }
  }, null, 2));
}

// 2. Patch server.js
let serverJs = fs.readFileSync('server.js', 'utf8');

if (!serverJs.includes("const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));")) {
  serverJs = serverJs.replace("const PORT = 3000;", `const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const PORT = config.port || 3000;`);
}

serverJs = serverJs.replace(/const pool = new ScraperPool\(5\);/, 'const pool = new ScraperPool(config.concurrencyLimit || 5);');

// Use config for pool concurrency limit
serverJs = serverJs.replace(/pool\.concurrencyLimit = [^\n]+;/g, (match) => {
  if (match.includes('? 5 : 1')) return "pool.concurrencyLimit = tasks.filter(t => t.status === 'queued' || t.status === 'running' || t.status === 'awaiting_captcha' || t.status === 'ocr_solving').length > 1 ? (config.concurrencyLimit || 5) : 1;";
  if (match.includes('= 5;')) return "pool.concurrencyLimit = config.concurrencyLimit || 5;";
  return match;
});

// Use config for timeouts and stagger
serverJs = serverJs.replace(/const staggerMs = Math\.floor\(Math\.random\(\) \* 3000\) \+ 1000;/, 'const staggerMs = Math.floor(Math.random() * ((config.staggerMaxMs || 4000) - (config.staggerMinMs || 1000))) + (config.staggerMinMs || 1000);');
serverJs = serverJs.replace(/timeout: 60000/, 'timeout: config.timeouts?.playwrightNav || 60000');
serverJs = serverJs.replace(/setTimeout\(\(\) => \{[^}]*\}, 7000\)/, (match) => match.replace('7000', 'config.timeouts?.ocrPipe || 7000'));
serverJs = serverJs.replace(/timeout: 15000/, 'timeout: config.timeouts?.ocrCli || 15000');

// Add /api/stop-all
if (!serverJs.includes("app.post('/api/stop-all'")) {
  serverJs = serverJs.replace("// Queue selected items dynamically", `app.post('/api/stop-all', (req, res) => {
  tasks.forEach(t => {
    if (t.status === 'awaiting_captcha') {
      const resolver = solveResolvers.get(t.id);
      if (resolver) {
        resolver('');
        solveResolvers.delete(t.id);
      }
    }
  });
  tasks = tasks.filter(t => t.status !== 'queued' && t.status !== 'awaiting_captcha');
  res.json({ success: true, remaining: tasks.length });
});

// Queue selected items dynamically`);
}
fs.writeFileSync('server.js', serverJs);

// 3. Patch index.html
let indexHtml = fs.readFileSync('public/index.html', 'utf8');

// Add Stop All button
if (!indexHtml.includes("stopAllTasks()")) {
  indexHtml = indexHtml.replace(
    `<button id="queue-btn" class="btn btn-primary" onclick="queueAllTasks()">`,
    `<button class="btn btn-secondary" style="border-color: var(--accent-danger); color: var(--accent-danger);" onclick="stopAllTasks()">Stop All</button>\n          <button id="queue-btn" class="btn btn-primary" onclick="queueAllTasks()">`
  );
}

// Add Stop All JS function
if (!indexHtml.includes("async function stopAllTasks()")) {
  indexHtml = indexHtml.replace("async function queueAllTasks()", `async function stopAllTasks() {
      try {
        const res = await fetch('/api/stop-all', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showToast("Stopped all queued tasks", "success");
          loadTasks();
          loadTreeView();
          document.getElementById('queue-btn').style.display = 'flex';
          document.getElementById('queue-btn').innerText = 'Queue All 3,097 Tasks';
          document.getElementById('queue-btn').disabled = false;
        }
      } catch (err) {
        showToast("Error stopping tasks", "danger");
      }
    }

    async function queueAllTasks()`);
}

// Modify createFolderNode signature and usage
if (!indexHtml.includes("isFullyDownloaded = false")) {
  indexHtml = indexHtml.replace("function createFolderNode(name, type, playAction = null)", "function createFolderNode(name, type, playAction = null, isFullyDownloaded = false, nodePath = '')");
  
  indexHtml = indexHtml.replace("const safeId = name.replace(/[^a-zA-Z0-9]/g, '_');", `const safeId = name.replace(/[^a-zA-Z0-9]/g, '_');
      const tickHtml = isFullyDownloaded ? '<svg class="folder-tick" style="color: var(--accent-success); width: 14px; margin-left: 6px; display: inline-block; vertical-align: middle;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>' : '';`);
      
  indexHtml = indexHtml.replace(/<span class="tree-node-title">\${name}<\/span>/, `<span class="tree-node-title">\${name}</span>\${tickHtml}`);
  indexHtml = indexHtml.replace(/class="tree-header"/, `class="tree-header folder-node" data-path="\${nodePath}"`);
}

// Helper to check fully downloaded
if (!indexHtml.includes("function isNodeFullyDownloaded")) {
  indexHtml = indexHtml.replace("function updateTreeStatusMarkers() {", `function isNodeFullyDownloaded(nodeData) {
      if (Array.isArray(nodeData)) return nodeData.length > 0 && nodeData.every(ps => ps.status === 'downloaded');
      const keys = Object.keys(nodeData);
      if (keys.length === 0) return false;
      for (const key of keys) {
        if (!isNodeFullyDownloaded(nodeData[key])) return false;
      }
      return true;
    }

    function updateTreeStatusMarkers() {`);
}

// Update renderRootTree calls
indexHtml = indexHtml.replace(/const distNode = createFolderNode\(districtName, 'district'\);/, `const distNode = createFolderNode(districtName, 'district', null, isNodeFullyDownloaded(treeData[districtName]), districtName);`);
indexHtml = indexHtml.replace(/const lbNode = createFolderNode\(lbName, 'localbody', \(\) => queueAllInLocalBody\(lBodies\[lbName\]\)\);/, `const lbNode = createFolderNode(lbName, 'localbody', () => queueAllInLocalBody(lBodies[lbName]), isNodeFullyDownloaded(lBodies[lbName]), districtName + '/' + lbName);`);
indexHtml = indexHtml.replace(/const wardNode = createFolderNode\(wardName, 'ward', \(\) => queueAllInWard\(WardsData\[wardName\]\)\);/, `const wardNode = createFolderNode(wardName, 'ward', () => queueAllInWard(WardsData[wardName]), isNodeFullyDownloaded(WardsData[wardName]), wardName);`);

// Modify updateTreeStatusMarkers to also update folder nodes
if (!indexHtml.includes("folderElements.forEach(el => {")) {
  indexHtml = indexHtml.replace("el.querySelector('.tree-leaf-title').className = 'tree-leaf-title';\n            }\n          }\n        }\n      });\n    }", `el.querySelector('.tree-leaf-title').className = 'tree-leaf-title';
            }
          }
        }
      });
      
      const folderElements = document.querySelectorAll('.folder-node[data-path]');
      folderElements.forEach(el => {
        const pathParts = el.dataset.path.split('/');
        let nodeData = treeData;
        for (const p of pathParts) {
           if (nodeData[p]) nodeData = nodeData[p];
           else { nodeData = null; break; }
        }
        if (nodeData) {
          const isFull = isNodeFullyDownloaded(nodeData);
          const wrapper = el.querySelector('.tree-title-wrapper');
          const existingTick = wrapper.querySelector('.folder-tick');
          if (isFull && !existingTick) {
            wrapper.insertAdjacentHTML('beforeend', '<svg class="folder-tick" style="color: var(--accent-success); width: 14px; margin-left: 6px; display: inline-block; vertical-align: middle;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>');
          } else if (!isFull && existingTick) {
            existingTick.remove();
          }
        }
      });
    }`);
}

fs.writeFileSync('public/index.html', indexHtml);
console.log('Patch complete.');
