const { spawn } = require('child_process');
const readline = require('readline');
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const rtl433 = spawn('rtl_433', ['-F', 'json']);
rtl433.stderr.on('data', (data) => {
  console.error(`rtl_433 error: ${data}`);
});

const rl = readline.createInterface({ input: rtl433.stdout });

let lastWritten = null;
let lastWriteTime = 0;
let dailyWriteCount = 0;

// Cached fields to persist non-null values
let lastHumidity = null;
let lastWindSpeed = null;
let lastWindDir = null;

function hasSignificantChange(current, previous) {
  if (!previous) return true;

  const deltaTemp = Math.abs(current.temperature - previous.temperature);
  const deltaWind = Math.abs(current.windSpeed - previous.windSpeed);
  const deltaDir = Math.abs(current.windDir - previous.windDir);

  return (
    deltaTemp >= 0.5 ||
    deltaWind >= 0.5 ||
    deltaDir >= 10
  );
}

function isOn3HourSchedule() {
  const now = new Date();
  return now.getMinutes() === 0 && [1, 4, 7, 10, 13, 16, 19, 22].includes(now.getHours());
}

function shouldWrite(currentData) {
  const now = Date.now();

  const nowDate = new Date().toISOString().split('T')[0];
  const lastDate = new Date(lastWriteTime).toISOString().split('T')[0];
  if (nowDate !== lastDate) {
    dailyWriteCount = 0;
  }

  if (dailyWriteCount >= 20) return false;

  const scheduled = isOn3HourSchedule();
  const changed = hasSignificantChange(currentData, lastWritten);

  return scheduled || changed;
}

rl.on('line', async (line) => {
  try {
    const data = JSON.parse(line);

    if (data.model === "LaCrosse-TX141Bv3") {
      // Update cached values if present
      if (data.humidity != null) lastHumidity = data.humidity;
      if (data.windSpeed != null) lastWindSpeed = data.windSpeed;
      if (data.wind_dir_deg != null) lastWindDir = data.wind_dir_deg;

      const weatherData = {
        timestamp: new Date(data.time),
        temperature: data.temperature_C ?? null,
        humidity: lastHumidity,
        windSpeed: lastWindSpeed,
        windDir: lastWindDir,
        battery_ok: data.battery_ok ?? null,
        sensor_id: data.id ?? null,
        model: data.model
      };

      if (shouldWrite(weatherData)) {
        await db.collection('weather_logs').add(weatherData);
        lastWritten = weatherData;
        lastWriteTime = Date.now();
        dailyWriteCount++;
        console.log("✅ Logged to Firebase:", weatherData);
      } else {
        console.log("⏭️ Skipped (no significant change or outside schedule)");
      }
    }

  } catch (err) {
    console.error("❌ Error parsing or uploading:", err);
  }
});
