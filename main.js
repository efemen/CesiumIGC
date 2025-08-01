// Final working version of main.js with altitude slider using SampledPositionProperty

Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJkYjc0ODJiOS03NTdhLTRhYzctOTE3NC0yZWY2ZTdhNjBmZjYiLCJpZCI6MzU1MTYsImlhdCI6MTc1MzgwMzI1Nn0.9u3nXPCkP53AMo-oGI6opvfhlOKWSyi6mvq6it-cq94';

const listDiv = document.getElementById("pilotList");
const viewer = new Cesium.Viewer("cesiumContainer", {
  terrain: Cesium.Terrain.fromWorldTerrain(),
  shouldAnimate: true,
});

let launchTimes = [];
let originalPositions = new Map();
let allEntities = [];

function extractTimesFromIgc(igcText) {
  const lines = igcText.split("\n");
  let dateStr = null;
  const timestamps = [];
  for (let line of lines) {
    if ((line.startsWith("HFDTE") || line.startsWith("HFDTEDATE")) && !dateStr) {
      const match = line.match(/HFDTE(?:DATE)?:?(\d{2})(\d{2})(\d{2})/);
      if (match) {
        const [_, day, month, year] = match;
        dateStr = `20${year}-${month}-${day}`;
      }
    }
    if (line.startsWith("B") && line.length >= 35 && dateStr) {
      const timeStr = line.substring(1, 7);
      const hh = timeStr.slice(0, 2);
      const min = timeStr.slice(2, 4);
      const sec = timeStr.slice(4, 6);
      const isoTime = `${dateStr}T${hh}:${min}:${sec}Z`;
      timestamps.push(new Date(isoTime));
    }
  }
  return {
    start: timestamps[0] || null,
    end: timestamps[timestamps.length - 1] || null
  };
}

function createCombinedCzml(fileDataArray, globalStart, globalEnd) {
  const entities = [];
  const t0 = globalStart.getTime();
  launchTimes = [];

  
  fileDataArray.forEach(({ igcText, file, index }) => {
    const entity = parseIgcToEntity(igcText, file.name, index, t0);
    if (entity) {
    
      
      const flat = entity.position.cartographicDegrees;
      const epoch = entity.position.epoch;
      originalPositions.set(entity.id, { data: [...flat], epoch });
      entities.push(entity);
      const launchTime = new Date(t0 + flat[0] * 1000);
      launchTimes.push({
        time: launchTime,
        pilot: entity.name,
        triggered: false
      });
    }
  });
  
  launchTimes.sort((a, b) => a.time - b.time);
  return [
    {
      id: "document",
      version: "1.0",
      clock: {
        interval: `${globalStart.toISOString()}/${globalEnd.toISOString()}`,
        currentTime: globalStart.toISOString(),
        multiplier: 1
      }
    },
    ...entities
  ];
}


function parseIgcToEntity(text, label, id, t0) {
  const lines = text.split("\n");
  let dateStr = null;
  let pilotName = null;
  let points = [];
  const niceColors = [
    [31, 119, 180], [255, 127, 14], [44, 160, 44], [214, 39, 40], [148, 103, 189],
    [140, 86, 75], [227, 119, 194], [127, 127, 127], [188, 189, 34], [23, 190, 207]
  ];
  const trailColor = niceColors[id % niceColors.length];
  for (let line of lines) {
    if (!pilotName && (line.startsWith("HFPLTPILOT") || line.startsWith("HFPLTPILOTINCHARGE"))) {
      const match = line.match(/HFPLTPILOT(?:INCHARGE)?:?(.*)/);
      if (match && match[1].trim()) pilotName = match[1].trim();
    }
    if ((line.startsWith("HFDTE") || line.startsWith("HFDTEDATE")) && !dateStr) {
      const match = line.match(/HFDTE(?:DATE)?:?(\d{2})(\d{2})(\d{2})/);
      if (match) {
        const [_, day, month, year] = match;
        dateStr = `20${year}-${month}-${day}`;
      }
    }
    if (line.startsWith("B") && line.length >= 35 && dateStr) {
      try {
        const hh = line.substr(1, 2);
        const mm = line.substr(3, 2);
        const ss = line.substr(5, 2);
        const lat = parseLatitude(line);
        const lon = parseLongitude(line);
        const alt = parseInt(line.substr(30, 5));
        const iso = `${dateStr}T${hh}:${mm}:${ss}Z`;
        const timeMs = new Date(iso).getTime();
        const seconds = (timeMs - t0) / 1000;
        points.push([seconds, lon, lat, alt]);
      } catch (err) {
        console.warn("Malformed line skipped:", line);
      }
    }
  }
  if (points.length === 0) return null;
  const start = new Date(t0 + points[0][0] * 1000).toISOString();
  const end = new Date(t0 + points[points.length - 1][0] * 1000).toISOString();

  return {
    id: `glider_${id}`,
    name: pilotName || label,
    availability: `${start}/${end}`,
    point: {
      pixelSize: 10,
      color: { rgba: [...trailColor, 255] },
      outlineColor: { rgba: [0, 0, 0, 255] },
      outlineWidth: 2
    },
    label: {
      text: pilotName || label,
      font: "14pt sans-serif",
      fillColor: { rgba: [255, 255, 255, 255] },
      outlineColor: { rgba: [0, 0, 0, 255] },
      outlineWidth: 2,
      style: "FILL_AND_OUTLINE",
      verticalOrigin: "BOTTOM",
      pixelOffset: { cartesian2: [0, -30] }
    },
    position: {
      interpolationAlgorithm: "LAGRANGE",
      interpolationDegree: 1,
      epoch: new Date(t0).toISOString(),
      cartographicDegrees: points.flat()
    },
    path: {
      material: { solidColor: { color: { rgba: [...trailColor, 255] } } },
      width: 2,
      trailTime: 60,
      leadTime: 0,
      resolution: 5
    }
  };
}

function parseLatitude(line) {
  const latDeg = parseInt(line.substr(7, 2));
  const latMin = parseFloat(line.substr(9, 5)) / 1000;
  const latSign = line[14] === "N" ? 1 : -1;
  return latSign * (latDeg + latMin / 60);
}
function parseLongitude(line) {
  const lonDeg = parseInt(line.substr(15, 3));
  const lonMin = parseFloat(line.substr(18, 5)) / 1000;
  const lonSign = line[23] === "E" ? 1 : -1;
  return lonSign * (lonDeg + lonMin / 60);
}

document.getElementById("upload").addEventListener("change", async function (event) {
  const files = Array.from(event.target.files);

  if (!files.length) return;
  viewer.dataSources.removeAll();

  let pending = files.length;
  let fileData = [];


  files.forEach((file, index) => {
    const reader = new FileReader();
    reader.onload = function (e) {
      const igcText = e.target.result;
      const { start, end } = extractTimesFromIgc(igcText);
      if (!start || !end) {
        pending--;
        return;
      }
      fileData.push({ file, igcText, index, start, end });
      pending--;
      if (pending === 0) {
        const globalStart = new Date(Math.min(...fileData.map(f => f.start.getTime())));
        const globalEnd = new Date(Math.max(...fileData.map(f => f.end.getTime())));
        const czml = createCombinedCzml(fileData, globalStart, globalEnd);
        const blob = new Blob([JSON.stringify(czml)], { type: "application/json" });
        const url = URL.createObjectURL(blob);

        Cesium.CzmlDataSource.load(url).then((dataSource) => {
          viewer.dataSources.add(dataSource);

          const firstEntity = dataSource.entities.getById("glider_0");

          if (firstEntity && originalPositions.has("glider_0")) {
            const original = originalPositions.get("glider_0").data;
            if (original.length >= 4) {
              const lon = original[1];
              const lat = original[2];
              const alt = original[3];

              Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, [
                Cesium.Cartographic.fromDegrees(lon, lat)
              ]).then((updatedPositions) => {
                const terrainHeight = updatedPositions[0].height;
                const heightOffset = terrainHeight - alt;
                
                console.log("Auto heightOffset:", heightOffset.toFixed(2));
          
                // Apply offset via synthetic input event
                const heightSlider = document.getElementById("heightOffset");
                heightSlider.value = heightOffset;
                heightSlider.dispatchEvent(new Event("input")); // triggers your logic
              }).catch(err => {
                console.warn("Failed to sample terrain height:", err);
              });
            }
          }

          viewer.trackedEntity = dataSource.entities.getById('glider_0');
          allEntities = dataSource.entities.values;
          viewer.timeline.zoomTo(
            Cesium.JulianDate.fromDate(globalStart),
            Cesium.JulianDate.fromDate(globalEnd)
          );
          setupLaunchMessages(viewer);
          const pilotElements = [];
          allEntities.forEach(entity => {
            if (!entity.position) return;
            const interval = entity.availability.get(0);
            const start = interval.start;
            const end = interval.stop;
            const item = document.createElement("div");
            item.textContent = entity.name || entity.id;
            item.className = "pilot-item";
            item.addEventListener("click", () => {
              if (!item.classList.contains("inactive")) viewer.trackedEntity = entity;
            });
            listDiv.appendChild(item);
            pilotElements.push({ item, entity, start, end });
          });
          viewer.clock.onTick.addEventListener(() => {
            const now = viewer.clock.currentTime;
            pilotElements.forEach(pilot => {
              const active = Cesium.JulianDate.greaterThanOrEquals(now, pilot.start) &&
                             Cesium.JulianDate.lessThanOrEquals(now, pilot.end);
              pilot.item.classList.toggle("inactive", !active);
            });
          });
        });
      }
    };
    reader.readAsText(file);
  });
});



document.getElementById("heightOffset").addEventListener("input", function () {
  const offset = parseFloat(this.value);
  document.getElementById("heightValue").textContent = offset;
  allEntities.forEach(entity => {
    const original = originalPositions.get(entity.id);
    if (!original) return;
    const adjusted = [];
    for (let i = 0; i < original.data.length; i += 4) {
      const t = original.data[i];
      const lon = original.data[i + 1];
      const lat = original.data[i + 2];
      const alt = original.data[i + 3] + offset;
      adjusted.push(t, lon, lat, alt);
    }
    const epoch = Cesium.JulianDate.fromIso8601(original.epoch);
    const spp = new Cesium.SampledPositionProperty();
    for (let i = 0; i < adjusted.length; i += 4) {
      const time = Cesium.JulianDate.addSeconds(epoch, adjusted[i], new Cesium.JulianDate());
      const pos = Cesium.Cartesian3.fromDegrees(adjusted[i + 1], adjusted[i + 2], adjusted[i + 3]);
      spp.addSample(time, pos);
    }
    entity.position = spp;
  });
});

function showLaunchMessage(pilotName) {
  const message = document.createElement('div');
  message.className = 'launch-message';
  message.textContent = `${pilotName} launched!`;
  document.body.appendChild(message);
  setTimeout(() => message.classList.add('show'), 100);
  setTimeout(() => {
    message.classList.add('fade-out');
    setTimeout(() => document.body.removeChild(message), 500);
  }, 3000);
}

function setupLaunchMessages(viewer) {
  viewer.clock.onTick.addEventListener(() => {
    const currentTime = Cesium.JulianDate.toDate(viewer.clock.currentTime);
    launchTimes.forEach(launch => {
      if (!launch.triggered && currentTime >= launch.time) {
        launch.triggered = true;
        showLaunchMessage(launch.pilot);
      }
    });
  });
}