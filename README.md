# Weatherly — Weather Dashboard (Task 6: API Integration)

A simple weather app that fetches and displays live weather data using the Fetch API.

## What it does
- Search any city or village worldwide and see current conditions
- Shows temperature, humidity, wind, precipitation, UV index, and an 8-hour forecast
- Handles loading and error states (no results, network failure, etc.)

## APIs used (both free, no API key required)
- **Open-Meteo** — weather forecast + geocoding
- **OpenStreetMap Nominatim** — backup geocoding for smaller villages that Open-Meteo's index misses

## How to run
No build step needed. Just open `index.html` in any browser.

## Notes
- Nominatim has a fair-use limit of 1 request/second — fine for personal/demo use, not meant for high production traffic.
- Location data © OpenStreetMap contributors.