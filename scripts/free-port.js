#!/usr/bin/env node
/**
 * free-port: print a free TCP port that is NOT 3000.
 *
 * Port 3000 is reserved for the human's Conductor "run workspace" flow. Agents booting their
 * own server for testing must use an ephemeral port instead.
 *
 * Usage:
 *   PORT=$(node scripts/free-port.js)
 */
const net = require('net');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    // Port 0 → the OS picks a free ephemeral port (never 3000 in practice, but re-roll
    // defensively so the contract "never prints 3000" holds unconditionally).
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close((err) => {
        if (err) return reject(err);
        if (port === 3000) return resolve(getFreePort());
        resolve(port);
      });
    });
  });
}

module.exports = { getFreePort };

if (require.main === module) {
  getFreePort().then(
    (port) => console.log(port),
    (err) => {
      console.error(`free-port failed: ${err.message}`);
      process.exit(1);
    }
  );
}
