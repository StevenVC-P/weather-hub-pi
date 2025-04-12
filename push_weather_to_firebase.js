const { spawn } = require('child_process');
const readline = require('readline');
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const rtl433 = spawn('rtl_433', ['-F', 'json']);
const rl = readline.createInterface({ input: rtl433.stdout });

rtl433.stderr.on('data', (data) => {
  console.error(`rtl_433 error: ${data}`);
});

const cache = {};
let lastReading = null;
let lastSent = null;
let sendsToday = 0;

const MAX_SENDS = 20;
const MIN_INTERVAL_MS = 1000 * 60 * 60 * 3; // every 3 hrs = 8/day

const thresholds = {
  temperature_F: 1,
  humidity: 5,
  wind_avg_km_h: 2,
  wind_dir_deg: 15,
  rain_in: 0.05
};

const isSignificantlyDifferent = (a, b) => {
  if (!a || !b) return true;

  for (const key of Object.keys(thresholds)) {
    const delta = Math.abs((a[key] ?? 0) - (b[key] ?? 0));
    if (delta > thresholds[key]) return true;
  }

  return false;
};

const shouldSend = (data) => {
  const now = Date.now();
  const today = new Date().toISOString().split("T")[0];

  if (!lastSent || lastSent.date !== today) {
    sendsToday = 0; // reset daily counter
  }

  const timeElapsed = !lastSent || (now - lastSent.timestamp >= MIN_INTERVAL_MS);
  const significantChange = isSignificantlyDifferent(data, lastReading);

  if ((significantChange && sendsToday < MAX_SENDS) || timeElapsed) {
    lastReading = { ...data };
    lastSent = { timestamp: now, date: today };
    sendsToday++;
    return true;
  }

  return false;
};

const saveToFirebase = async (id) => {
  const entry = cache[id];
  if (!entry || !entry.temperature_F || !entry.rain_in) return;

  if (!shouldSend(entry)) {
    console.log("🟡 Skipped: no change or rate limited.");
    return;
  }

  try {
    await db.collection('weather_logs').add({
      timestamp: new Date(entry.time),
      temperature: entry.temperature_F ?? null,
      humidity: entry.humidity ?? null,
      windSpeed: entry.wind_avg_km_h ?? null,
      windDirection: entry.wind_dir_deg ?? null,
      rainfall: entry.rain_in ?? null,
      battery_ok: entry.battery_ok ?? null,
      model: entry.model ?? 'Unknown',
      sensor_id: id
    });

    console.log("✅ Logged to Firebase:", entry);
    delete cache[id];
  } catch (err) {
    console.error("❌ Upload failed:", err);
  }
};

rl.on('line', (line) => {
  try {
    const data = JSON.parse(line);
    if (data.model !== "Acurite-5n1") return;

    const id = data.id;
    if (!cache[id]) cache[id] = { ...data };
    else cache[id] = { ...cache[id], ...data };

    if ('temperature_F' in cache[id] && 'rain_in' in cache[id]) {
      saveToFirebase(id);
    }
  } catch (err) {
    console.warn("⚠️ Malformed JSON skipped");
  }
});
