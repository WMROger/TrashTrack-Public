/**
 * scripts/patch-ngrok.js
 * Automatically patches @expo/ngrok to support ngrok v3 strict unmarshaling
 * and prevents "field authtoken not found in type config.HTTPv2Tunnel".
 */
const fs = require('fs');
const path = require('path');

const ngrokIndexPath = path.join(__dirname, '..', 'node_modules', '@expo', 'ngrok', 'index.js');
const ngrokProcessPath = path.join(__dirname, '..', 'node_modules', '@expo', 'ngrok', 'src', 'process.js');

try {
  if (fs.existsSync(ngrokIndexPath)) {
    let indexContent = fs.readFileSync(ngrokIndexPath, 'utf8');

    // 1. Strip non-tunnel options before sending to ngrok HTTP API
    if (!indexContent.includes('tunnelOpts')) {
      indexContent = indexContent.replace(
        'const response = await ngrokClient.startTunnel(opts);',
        'const { authtoken, configPath, port, onLogEvent, onStatusChange, ...tunnelOpts } = opts;\n    const response = await ngrokClient.startTunnel(tunnelOpts);'
      );
    }

    // 2. Poll tunnelDetail if tunnel already exists
    if (!indexContent.includes('tunnelDetail(opts.name)')) {
      const targetCatch = '} catch (err) {';
      const replacementCatch = `} catch (err) {
    if (err && err.body && err.body.error_code === 102 && err.body.details && /already exists/.test(err.body.details.err)) {
      for (let i = 0; i < 10; i++) {
        try {
          const detail = await ngrokClient.tunnelDetail(opts.name);
          if (detail && detail.public_url) return detail.public_url;
        } catch (e) {}
        await new Promise((r) => setTimeout(r, 400));
      }
    }`;
      indexContent = indexContent.replace(targetCatch, replacementCatch);
    }

    fs.writeFileSync(ngrokIndexPath, indexContent, 'utf8');
    console.log('✅ [patch-ngrok] @expo/ngrok index.js verified & patched.');
  }

  if (fs.existsSync(ngrokProcessPath)) {
    let processContent = fs.readFileSync(ngrokProcessPath, 'utf8');

    // 3. Ensure process waits for session to establish before resolving API URL
    if (!processContent.includes('sessionEstablished')) {
      processContent = processContent.replace(
        'let resolve, reject;',
        `let resolve, reject;
  let webAddr = null;
  let sessionEstablished = false;
  let resolved = false;

  function doResolve() {
    if (!resolved && webAddr) {
      resolved = true;
      resolve(\`http://\${webAddr}\`);
    }
  }`
      );

      processContent = processContent.replace(
        'if (opts.onStatusChange) {',
        `if (msg.match("client session established")) {
      sessionEstablished = true;
      if (opts.onStatusChange) opts.onStatusChange("connected");
      if (webAddr) doResolve();
    } else if (msg.match("session closed, starting reconnect loop")) {
      if (opts.onStatusChange) opts.onStatusChange("closed");
    }
    if (false && opts.onStatusChange) {`
      );

      processContent = processContent.replace(
        'if (addr) {\n        resolve(`http://${addr}`);',
        'if (addr) {\n        webAddr = addr;\n        if (sessionEstablished) doResolve(); else setTimeout(doResolve, 1200);'
      );

      fs.writeFileSync(ngrokProcessPath, processContent, 'utf8');
      console.log('✅ [patch-ngrok] @expo/ngrok process.js verified & patched.');
    }
  }
} catch (err) {
  console.warn('⚠️ [patch-ngrok] Could not patch @expo/ngrok:', err.message);
}
