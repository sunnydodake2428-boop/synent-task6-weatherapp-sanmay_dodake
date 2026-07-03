// Task 6: API Integration Project — Weather Dashboard
// APIs used (both free, no API key required):
//   1. Open-Meteo Geocoding  -> https://geocoding-api.open-meteo.com
//   2. OpenStreetMap Nominatim (fallback, better small-village coverage)
//   3. Open-Meteo Forecast   -> https://api.open-meteo.com

const OM_GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

const WEATHER_CODES = {
  0: { text: "Clear sky", icon: "☀️" },
  1: { text: "Mainly clear", icon: "🌤️" },
  2: { text: "Partly cloudy", icon: "⛅" },
  3: { text: "Overcast", icon: "☁️" },
  45: { text: "Fog", icon: "🌫️" },
  48: { text: "Rime fog", icon: "🌫️" },
  51: { text: "Light drizzle", icon: "🌦️" },
  53: { text: "Moderate drizzle", icon: "🌦️" },
  55: { text: "Dense drizzle", icon: "🌦️" },
  61: { text: "Slight rain", icon: "🌧️" },
  63: { text: "Moderate rain", icon: "🌧️" },
  65: { text: "Heavy rain", icon: "🌧️" },
  71: { text: "Slight snow", icon: "🌨️" },
  73: { text: "Moderate snow", icon: "🌨️" },
  75: { text: "Heavy snow", icon: "🌨️" },
  80: { text: "Rain showers", icon: "🌦️" },
  81: { text: "Rain showers", icon: "🌦️" },
  82: { text: "Violent showers", icon: "⛈️" },
  95: { text: "Thunderstorm", icon: "⛈️" },
  96: { text: "Thunderstorm, hail", icon: "⛈️" },
  99: { text: "Thunderstorm, hail", icon: "⛈️" },
};

// ---------- DOM references ----------
const input = document.getElementById("city-input");
const suggestionsEl = document.getElementById("suggestions");
const locationBtn = document.getElementById("use-location");

const loadingBox = document.getElementById("loading");
const errorBox = document.getElementById("error");
const errorMessage = document.getElementById("error-message");
const emptyBox = document.getElementById("empty");
const dashboard = document.getElementById("dashboard");

const cityNameEl = document.getElementById("city-name");
const dateLabelEl = document.getElementById("date-label");
const sunriseEl = document.getElementById("sunrise");
const sunsetEl = document.getElementById("sunset");
const temperatureEl = document.getElementById("temperature");
const weatherIconEl = document.getElementById("weather-icon");
const conditionEl = document.getElementById("condition");
const conditionTagsEl = document.getElementById("condition-tags");

const hourlyChart = document.getElementById("hourly-chart");
const hourlyRangeEl = document.getElementById("hourly-range");

const humidityEl = document.getElementById("humidity");
const humidityTagEl = document.getElementById("humidity-tag");
const humidityBar = document.querySelector("#humidity-bar span");

const windEl = document.getElementById("wind");
const windDirEl = document.getElementById("wind-dir");

const precipEl = document.getElementById("precipitation");
const precipBar = document.querySelector("#precip-bar span");

const uvValueEl = document.getElementById("uv-value");
const uvTagEl = document.getElementById("uv-tag");
const uvBarSegments = document.querySelectorAll("#uv-bar span");

const feelsLikeEl = document.getElementById("feels-like");
const feelsBar = document.querySelector("#feels-bar span");

const rainChanceEl = document.getElementById("rain-chance");
const rainBar = document.querySelector("#rain-bar span");

// ---------- UI state machine ----------
function setState(state) {
  [loadingBox, errorBox, emptyBox, dashboard].forEach((el) => el.classList.add("hidden"));
  if (state === "loading") loadingBox.classList.remove("hidden");
  if (state === "error") errorBox.classList.remove("hidden");
  if (state === "empty") emptyBox.classList.remove("hidden");
  if (state === "result") dashboard.classList.remove("hidden");
}

function showError(message) {
  errorMessage.textContent = message;
  setState("error");
}

// ---------- Geocoding (search-as-you-type) ----------
let debounceTimer = null;
let activeSuggestionIndex = -1;
let currentSuggestions = [];
let searchRequestId = 0;

input.addEventListener("input", () => {
  const query = input.value.trim();
  clearTimeout(debounceTimer);

  if (query.length < 2) {
    hideSuggestions();
    return;
  }

  debounceTimer = setTimeout(() => runSearch(query), 350);
});

input.addEventListener("keydown", (e) => {
  if (suggestionsEl.classList.contains("hidden")) return;
  const items = [...suggestionsEl.children];

  if (e.key === "ArrowDown") {
    e.preventDefault();
    activeSuggestionIndex = Math.min(activeSuggestionIndex + 1, items.length - 1);
    highlightSuggestion(items);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    activeSuggestionIndex = Math.max(activeSuggestionIndex - 1, 0);
    highlightSuggestion(items);
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (activeSuggestionIndex >= 0) {
      selectPlace(currentSuggestions[activeSuggestionIndex]);
    } else if (currentSuggestions.length > 0) {
      selectPlace(currentSuggestions[0]);
    }
  } else if (e.key === "Escape") {
    hideSuggestions();
  }
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-wrap")) hideSuggestions();
});

function highlightSuggestion(items) {
  items.forEach((el, i) => el.classList.toggle("active", i === activeSuggestionIndex));
}

function hideSuggestions() {
  suggestionsEl.classList.add("hidden");
  suggestionsEl.innerHTML = "";
  activeSuggestionIndex = -1;
  currentSuggestions = [];
}

async function runSearch(query) {
  // Tag this search with an ID. If a newer search finishes first, an older
  // one arriving late won't be allowed to overwrite it.
  const requestId = ++searchRequestId;

  const [omPlaces, nomPlaces] = await Promise.all([
    geocodeOpenMeteo(query),
    geocodeNominatim(query),
  ]);

  if (requestId !== searchRequestId) return; // a newer search has already started

  const places = dedupePlaces([...nomPlaces, ...omPlaces]);

  renderSuggestions(places);
}


function dedupePlaces(places) {
  const seen = new Set();
  const unique = [];

  for (const p of places) {
    // Round coordinates to ~1km precision so the same place from both
    // sources (slightly different lat/lon) collapses into one entry.
    const key = `${p.name.toLowerCase()}|${p.latitude.toFixed(2)}|${p.longitude.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }

  return unique.slice(0, 10);
}

async function geocodeOpenMeteo(query) {
  try {
    const res = await fetch(
      `${OM_GEOCODE_URL}?name=${encodeURIComponent(query)}&count=8&language=en&format=json`
    );
    if (!res.ok) return [];
    const data = await res.json();
    if (!data.results) return [];
    return data.results.map((r) => ({
      name: r.name,
      region: [r.admin1, r.country].filter(Boolean).join(", "),
      latitude: r.latitude,
      longitude: r.longitude,
      timezone: r.timezone,
    }));
  } catch {
    return [];
  }
}

async function geocodeNominatim(query) {
  try {
    const res = await fetch(
      `${NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=json&limit=8&addressdetails=1`
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.map((r) => ({
      name: r.address?.village || r.address?.town || r.address?.city || r.address?.hamlet || r.name || r.display_name.split(",")[0],
      region: r.display_name.split(",").slice(1, 3).join(",").trim(),
      latitude: parseFloat(r.lat),
      longitude: parseFloat(r.lon),
      timezone: "auto",
    }));
  } catch {
    return [];
  }
}
async function reverseGeocode(lat, lon) {
  try {
    const res = await fetch(
      `${NOMINATIM_URL.replace("/search", "/reverse")}?lat=${lat}&lon=${lon}&format=json&addressdetails=1`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const addr = data.address || {};
    return {
      name: addr.village || addr.town || addr.city || addr.hamlet || addr.suburb || data.name || "Current location",
      region: [addr.state, addr.country].filter(Boolean).join(", "),
    };
  } catch {
    return null;
  }
}

function renderSuggestions(places) {
  currentSuggestions = places;
  activeSuggestionIndex = -1;

  if (places.length === 0) {
    suggestionsEl.innerHTML = `<li class="s-empty">No matching places found</li>`;
    suggestionsEl.classList.remove("hidden");
    return;
  }

  suggestionsEl.innerHTML = places
    .map(
      (p, i) => `
      <li data-index="${i}">
        <span class="s-name">${escapeHtml(p.name)}</span>
        <span class="s-region">${escapeHtml(p.region || "")}</span>
      </li>`
    )
    .join("");

  suggestionsEl.classList.remove("hidden");

  [...suggestionsEl.children].forEach((li, i) => {
    li.addEventListener("click", () => selectPlace(places[i]));
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function selectPlace(place) {
  if (!place) return;
  input.value = place.name;
  hideSuggestions();
  fetchWeather(place);
}

// ---------- Geolocation button ----------
locationBtn.addEventListener("click", () => {
  if (!navigator.geolocation) {
    showError("Your browser doesn't support location detection.");
    return;
  }
  setState("loading");
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude, longitude } = pos.coords;
      const place = await reverseGeocode(latitude, longitude);

      fetchWeather({
        name: place?.name || "Current location",
        region: place?.region || "",
        latitude,
        longitude,
      });
    },
    () => showError("Couldn't access your location. Search for a place instead.")
  );
});

// ---------- Weather fetch ----------
async function fetchWeather(place) {
  setState("loading");

  try {
    const url =
      `${FORECAST_URL}?latitude=${place.latitude}&longitude=${place.longitude}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,showers,cloud_cover,weather_code,wind_speed_10m,wind_direction_10m,is_day` +
      `&hourly=temperature_2m,precipitation_probability,weather_code,uv_index` +
      `&daily=sunrise,sunset,uv_index_max,precipitation_sum` +
      `&timezone=auto`;

    const res = await fetch(url);
    if (!res.ok) throw new Error("Weather service is unavailable right now.");

    const data = await res.json();
    renderDashboard(place, data);
  } catch (err) {
    if (err instanceof TypeError) {
      showError("Network error. Check your internet connection and try again.");
    } else {
      showError(err.message);
    }
  }
}

// ---------- Render ----------
function renderDashboard(place, data) {
  const { current, hourly, daily } = data;
  const codeInfo = WEATHER_CODES[current.weather_code] || { text: "Unknown", icon: "❓" };
  const isDay = current.is_day === 1;

  cityNameEl.textContent = [place.name, place.region ? place.region.split(",").pop().trim() : ""]
    .filter(Boolean)
    .join(", ");

  const now = new Date(current.time);
  dateLabelEl.textContent = `Today, ${now.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  })}`;

  sunriseEl.textContent = formatTime(daily.sunrise[0]);
  sunsetEl.textContent = formatTime(daily.sunset[0]);

  temperatureEl.textContent = Math.round(current.temperature_2m);
  weatherIconEl.textContent = (current.weather_code <= 1 && !isDay) ? "🌙" : codeInfo.icon;
  conditionEl.textContent = codeInfo.text;

  conditionTagsEl.innerHTML = buildConditionTags(current)
    .map((tag) => `<span class="tag-pill">${tag}</span>`)
    .join("");

  // Humidity
  const humidity = Math.round(current.relative_humidity_2m);
  humidityEl.textContent = humidity;
  humidityBar.style.width = `${humidity}%`;
  humidityTagEl.textContent = humidity < 30 ? "low" : humidity < 60 ? "normal" : "high";

  // Wind
  windEl.textContent = Math.round(current.wind_speed_10m);
  windDirEl.textContent = compassDirection(current.wind_direction_10m);

  // Precipitation (today's total, scaled against a 5cm reference max)
  const precipToday = daily.precipitation_sum[0] ?? 0;
  precipEl.textContent = precipToday.toFixed(1);
  precipBar.style.width = `${Math.min((precipToday / 5) * 100, 100)}%`;

  // UV index
  const uv = Math.round(daily.uv_index_max[0] ?? 0);
  uvValueEl.textContent = uv;
  uvTagEl.textContent = uvLabel(uv);
  fillUvSegments(uv);

  // Feels like (scaled 0-45°C for the bar)
  const feelsLike = Math.round(current.apparent_temperature);
  feelsLikeEl.textContent = feelsLike;
  feelsBar.style.width = `${Math.min(Math.max((feelsLike / 45) * 100, 0), 100)}%`;

  // Chance of rain — probability at the current hour from the hourly array
  const nowIndex = findCurrentHourIndex(hourly.time, current.time);
  const rainChance = hourly.precipitation_probability[nowIndex] ?? 0;
  rainChanceEl.textContent = rainChance;
  rainBar.style.width = `${rainChance}%`;

  renderHourlyChart(hourly, nowIndex);

  setState("result");
}

function buildConditionTags(current) {
  const tags = [];

  // Precipitation type/intensity, checked ahead of generic weather_code text
  // since 'rain'/'showers' fields reflect what's actually falling right now.
  const rain = current.rain ?? 0;
  const showers = current.showers ?? 0;
  if (showers > 0.5) tags.push("Showery");
  else if (rain > 4) tags.push("Heavy rain");
  else if (rain > 1) tags.push("Rainy");
  else if (rain > 0) tags.push("Light rain");

  // Cloud cover
  const clouds = current.cloud_cover ?? 0;
  if (clouds >= 85) tags.push("Overcast");
  else if (clouds >= 50) tags.push("Cloudy");
  else if (clouds >= 20) tags.push("Partly cloudy");
  else tags.push("Clear sky");

  // Humidity
  const humidity = current.relative_humidity_2m ?? 0;
  if (humidity >= 80) tags.push("Humid");
  else if (humidity <= 30) tags.push("Dry");

  // Wind
  if (current.wind_speed_10m >= 30) tags.push("Windy");

  return tags;
}

function findCurrentHourIndex(times, currentTime) {
  const current = new Date(currentTime).getTime();
  let closest = 0;
  let closestDiff = Infinity;
  times.forEach((t, i) => {
    const diff = Math.abs(new Date(t).getTime() - current);
    if (diff < closestDiff) {
      closestDiff = diff;
      closest = i;
    }
  });
  return closest;
}

function formatTime(isoString) {
  return new Date(isoString).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function compassDirection(deg) {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8];
}

function uvLabel(uv) {
  if (uv <= 2) return "low";
  if (uv <= 5) return "moderate";
  if (uv <= 7) return "high";
  if (uv <= 10) return "very high";
  return "extreme";
}

function fillUvSegments(uv) {
  // Bands: 0-2, 3-5, 6-7, 8-10, 11+ — fill every segment up to the one the value falls in.
  const thresholds = [2, 5, 7, 10, Infinity];
  let bandIndex = thresholds.findIndex((t) => uv <= t);
  if (bandIndex === -1) bandIndex = thresholds.length - 1;
  uvBarSegments.forEach((seg, i) => seg.classList.toggle("filled", i <= bandIndex));
}

function renderHourlyChart(hourly, startIndex) {
  const hoursToShow = 8;
  const times = hourly.time.slice(startIndex, startIndex + hoursToShow);
  const temps = hourly.temperature_2m.slice(startIndex, startIndex + hoursToShow);
  const probs = hourly.precipitation_probability.slice(startIndex, startIndex + hoursToShow);
  const codes = hourly.weather_code.slice(startIndex, startIndex + hoursToShow);

  hourlyRangeEl.textContent = times.length
    ? `${formatTime(times[0])} \u2013 ${formatTime(times[times.length - 1])}`
    : "";

  const width = 900;
  const height = 220;
  const padX = 45;
  const topY = 70;
  const bottomY = 150;

  const minTemp = Math.min(...temps);
  const maxTemp = Math.max(...temps);
  const range = maxTemp - minTemp || 1;

  const stepX = (width - padX * 2) / (hoursToShow - 1);

  const points = temps.map((t, i) => {
    const x = padX + i * stepX;
    const y = bottomY - ((t - minTemp) / range) * (bottomY - topY);
    return { x, y, t, prob: probs[i], time: times[i], code: codes[i] };
  });

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const areaPath =
    `M${points[0].x},${bottomY} ` +
    points.map((p) => `L${p.x},${p.y}`).join(" ") +
    ` L${points[points.length - 1].x},${bottomY} Z`;

  let svg = `
    <defs>
      <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#4a86e0" stop-opacity="0.35" />
        <stop offset="100%" stop-color="#4a86e0" stop-opacity="0" />
      </linearGradient>
    </defs>
    <path d="${areaPath}" fill="url(#areaFill)" stroke="none" />
    <path d="${linePath}" fill="none" stroke="#4a86e0" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
  `;

  points.forEach((p, i) => {
    const label = i === 0 ? "Now" : formatTime(p.time).replace(" ", "");
    const codeInfo = WEATHER_CODES[p.code] || { icon: "❓" };

    svg += `
      <line x1="${p.x}" y1="${p.y}" x2="${p.x}" y2="${bottomY}" stroke="#e7edf7" stroke-width="1" />
      <circle cx="${p.x}" cy="${p.y}" r="4" fill="#ffffff" stroke="#4a86e0" stroke-width="2.5" />
      <text x="${p.x}" y="24" text-anchor="middle" font-size="12" fill="#7d8aa0">${label}</text>
      <text x="${p.x}" y="44" text-anchor="middle" font-size="15">${codeInfo.icon}</text>
      <text x="${p.x}" y="${p.y - 12}" text-anchor="middle" font-size="13" font-weight="600" fill="#1b2430">${Math.round(p.t)}\u00B0</text>
      <text x="${p.x}" y="${bottomY + 22}" text-anchor="middle" font-size="12" fill="#7d8aa0">${Math.round(p.prob)}%</text>
    `;
  });

  hourlyChart.innerHTML = svg;
}