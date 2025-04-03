// log_raw_433.js
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Output file (timestamped)
const logFileName = `rtl433_log_${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
const logPath = path.join(__dirname, logFileName);
const logStream = fs.createWriteStream(logPath, { flags: 'a' });

console.log(`📦 Logging to ${logFileName}`);

const rtl433 = spawn('rtl_433', ['-F', 'json']);
rtl433.stderr.on('data', (data) => {
  console.error(`rtl_433 error: ${data}`);
});

let buffer = '';

rtl433.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop();

  lines.forEach((line) => {
    try {
      const parsed = JSON.parse(line);
      const timestamp = new Date().toISOString();
      const logEntry = { timestamp, data: parsed };

      logStream.write(JSON.stringify(logEntry) + '\n');
      console.log(`🟢 Logged at ${timestamp}`);
    } catch (err) {
      console.warn('⚠️ Skipped malformed line');
    }
  });
});
