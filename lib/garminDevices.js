const fs = require("fs");
const path = require("path");
const os = require("os");

const COMPATIBLE_GARMIN_DEVICES = [
  // Venu & vívoactive Lifestyle AMOLED Series
  {
    id: "venu2",
    name: "Garmin Venu 2 (45mm)",
    family: "Venu Series",
    releaseYear: "2021–2026",
    displayType: "AMOLED",
    resolution: { width: 416, height: 416 },
    shape: "round",
    touchscreen: true,
    buttons: "2-Button + Touch",
    connectIQVersion: "4.2.4",
    partNumber: "006-B3703-00",
    partNumbers: ["006-B3703-00", "006-B3950-00", "006-B4171-00", "006-B4180-00"],
    memoryLimitKB: 768
  },
  {
    id: "venu2s",
    name: "Garmin Venu 2S (40mm)",
    family: "Venu Series",
    releaseYear: "2021–2026",
    displayType: "AMOLED",
    resolution: { width: 360, height: 360 },
    shape: "round",
    touchscreen: true,
    buttons: "2-Button + Touch",
    connectIQVersion: "4.2.4",
    partNumber: "006-B3704-00",
    partNumbers: ["006-B3704-00", "006-B3949-00", "006-B4175-00", "006-B4181-00"],
    memoryLimitKB: 768
  },
  {
    id: "venu2plus",
    name: "Garmin Venu 2 Plus (43mm Voice)",
    family: "Venu Series",
    releaseYear: "2022–2026",
    displayType: "AMOLED",
    resolution: { width: 416, height: 416 },
    shape: "round",
    touchscreen: true,
    buttons: "3-Button + Touch",
    connectIQVersion: "4.2.4",
    partNumber: "006-B3851-00",
    partNumbers: ["006-B3851-00", "006-B4017-00"],
    memoryLimitKB: 768
  },
  {
    id: "venu3",
    name: "Garmin Venu 3 (45mm Flagship)",
    family: "Venu Series",
    releaseYear: "2024–2026",
    displayType: "AMOLED",
    resolution: { width: 454, height: 454 },
    shape: "round",
    touchscreen: true,
    buttons: "3-Button + Touch",
    connectIQVersion: "5.0.0",
    partNumber: "006-B4260-00",
    memoryLimitKB: 1024
  },
  {
    id: "venu3s",
    name: "Garmin Venu 3S (41mm)",
    family: "Venu Series",
    releaseYear: "2024–2026",
    displayType: "AMOLED",
    resolution: { width: 390, height: 390 },
    shape: "round",
    touchscreen: true,
    buttons: "3-Button + Touch",
    connectIQVersion: "5.0.0",
    partNumber: "006-B4261-00",
    memoryLimitKB: 1024
  },
  {
    id: "vivoactive5",
    name: "Garmin vívoactive 5 / 6 (42mm)",
    family: "vívoactive Series",
    releaseYear: "2024–2026",
    displayType: "AMOLED",
    resolution: { width: 390, height: 390 },
    shape: "round",
    touchscreen: true,
    buttons: "2-Button + Touch",
    connectIQVersion: "5.0.0",
    partNumber: "006-B4426-00",
    memoryLimitKB: 768
  },

  // Forerunner Running AMOLED Series (2024–2026)
  {
    id: "fr165",
    name: "Garmin Forerunner 165 (43mm)",
    family: "Forerunner Series",
    releaseYear: "2024–2026",
    displayType: "AMOLED",
    resolution: { width: 390, height: 390 },
    shape: "round",
    touchscreen: true,
    buttons: "5-Button + Touch",
    connectIQVersion: "5.0.0",
    partNumber: "006-B4432-00",
    memoryLimitKB: 768
  },
  {
    id: "fr165m",
    name: "Garmin Forerunner 165 Music (43mm)",
    family: "Forerunner Series",
    releaseYear: "2024–2026",
    displayType: "AMOLED",
    resolution: { width: 390, height: 390 },
    shape: "round",
    touchscreen: true,
    buttons: "5-Button + Touch",
    connectIQVersion: "5.0.0",
    partNumber: "006-B4433-00",
    memoryLimitKB: 768
  },
  {
    id: "fr265",
    name: "Garmin Forerunner 265 (46mm)",
    family: "Forerunner Series",
    releaseYear: "2024–2026",
    displayType: "AMOLED",
    resolution: { width: 416, height: 416 },
    shape: "round",
    touchscreen: true,
    buttons: "5-Button + Touch",
    connectIQVersion: "5.0.0",
    partNumber: "006-B4257-00",
    memoryLimitKB: 1024
  },
  {
    id: "fr265s",
    name: "Garmin Forerunner 265S (42mm)",
    family: "Forerunner Series",
    releaseYear: "2024–2026",
    displayType: "AMOLED",
    resolution: { width: 360, height: 360 },
    shape: "round",
    touchscreen: true,
    buttons: "5-Button + Touch",
    connectIQVersion: "5.0.0",
    partNumber: "006-B4258-00",
    memoryLimitKB: 1024
  },
  {
    id: "fr965",
    name: "Garmin Forerunner 965 (47mm Titanium)",
    family: "Forerunner Series",
    releaseYear: "2024–2026",
    displayType: "AMOLED",
    resolution: { width: 454, height: 454 },
    shape: "round",
    touchscreen: true,
    buttons: "5-Button + Touch",
    connectIQVersion: "5.0.0",
    partNumber: "006-B4315-00",
    memoryLimitKB: 1024
  },

  // fēnix 8, Enduro 3 & Epix Pro Gen 2 Adventure Flagships (2024–2026)
  {
    id: "fenix843mm",
    name: "Garmin fēnix 8 AMOLED (43mm)",
    family: "fēnix 8 & Enduro Series",
    releaseYear: "2024–2026",
    displayType: "AMOLED",
    resolution: { width: 416, height: 416 },
    shape: "round",
    touchscreen: true,
    buttons: "5-Button + Touch",
    connectIQVersion: "5.0.0",
    partNumber: "006-B4534-00",
    memoryLimitKB: 1024
  },
  {
    id: "fenix847mm",
    name: "Garmin fēnix 8 AMOLED (47mm / 51mm)",
    family: "fēnix 8 & Enduro Series",
    releaseYear: "2024–2026",
    displayType: "AMOLED",
    resolution: { width: 454, height: 454 },
    shape: "round",
    touchscreen: true,
    buttons: "5-Button + Touch",
    connectIQVersion: "5.0.0",
    partNumber: "006-B4536-00",
    partNumbers: ["006-B4536-00", "006-B4775-00"],
    memoryLimitKB: 1024
  },
  {
    id: "fenix8solar47mm",
    name: "Garmin fēnix 8 Solar Sapphire (47mm MIP)",
    family: "fēnix 8 & Enduro Series",
    releaseYear: "2024–2026",
    displayType: "MIP",
    resolution: { width: 260, height: 260 },
    shape: "round",
    touchscreen: true,
    buttons: "5-Button + Touch",
    connectIQVersion: "5.0.0",
    partNumber: "006-B4532-00",
    memoryLimitKB: 1024
  },
  {
    id: "enduro3",
    name: "Garmin Enduro 3 (51mm Ultra-Endurance MIP)",
    family: "fēnix 8 & Enduro Series",
    releaseYear: "2024–2026",
    displayType: "MIP",
    resolution: { width: 280, height: 280 },
    shape: "round",
    touchscreen: true,
    buttons: "5-Button + Touch",
    connectIQVersion: "5.0.0",
    partNumber: "006-B4575-00",
    memoryLimitKB: 1024
  },
  {
    id: "epix2pro42mm",
    name: "Garmin epix Pro (Gen 2) 42mm",
    family: "epix Pro Series",
    releaseYear: "2024–2026",
    displayType: "AMOLED",
    resolution: { width: 390, height: 390 },
    shape: "round",
    touchscreen: true,
    buttons: "5-Button + Touch",
    connectIQVersion: "5.0.0",
    partNumber: "006-B4312-00",
    memoryLimitKB: 1024
  },
  {
    id: "epix2pro47mm",
    name: "Garmin epix Pro (Gen 2) 47mm",
    family: "epix Pro Series",
    releaseYear: "2024–2026",
    displayType: "AMOLED",
    resolution: { width: 416, height: 416 },
    shape: "round",
    touchscreen: true,
    buttons: "5-Button + Touch",
    connectIQVersion: "5.0.0",
    partNumber: "006-B4313-00",
    memoryLimitKB: 1024
  },
  {
    id: "epix2pro51mm",
    name: "Garmin epix Pro (Gen 2) 51mm",
    family: "epix Pro Series",
    releaseYear: "2024–2026",
    displayType: "AMOLED",
    resolution: { width: 454, height: 454 },
    shape: "round",
    touchscreen: true,
    buttons: "5-Button + Touch",
    connectIQVersion: "5.0.0",
    partNumber: "006-B4314-00",
    partNumbers: ["006-B4314-00", "006-B4542-00", "006-B4556-00"],
    memoryLimitKB: 1024
  },

  // Approach Golf Flagship AMOLED Series
  {
    id: "approachs7042mm",
    name: "Garmin Approach S70 (42mm Golf AMOLED)",
    family: "Approach Series",
    releaseYear: "2024–2026",
    displayType: "AMOLED",
    resolution: { width: 390, height: 390 },
    shape: "round",
    touchscreen: true,
    buttons: "3-Button + Touch",
    connectIQVersion: "5.0.0",
    partNumber: "006-B4233-00",
    memoryLimitKB: 1024
  },
  {
    id: "approachs7047mm",
    name: "Garmin Approach S70 (47mm Golf AMOLED)",
    family: "Approach Series",
    releaseYear: "2024–2026",
    displayType: "AMOLED",
    resolution: { width: 454, height: 454 },
    shape: "round",
    touchscreen: true,
    buttons: "3-Button + Touch",
    connectIQVersion: "5.0.0",
    partNumber: "006-B4234-00",
    memoryLimitKB: 1024
  }
];

function getGarminDeviceById(deviceId) {
  const norm = String(deviceId || "venu2").trim().toLowerCase();
  return COMPATIBLE_GARMIN_DEVICES.find((d) => d.id === norm) || COMPATIBLE_GARMIN_DEVICES[0];
}

function getDefaultConnectIqDevicesDir() {
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return path.join(appData, "Garmin", "ConnectIQ", "Devices");
}

function provisionConnectIqDevices(devicesBaseDir = getDefaultConnectIqDevicesDir()) {
  if (!fs.existsSync(devicesBaseDir)) {
    return { provisioned: [], skipped: true };
  }

  const baseVenu2CompilerPath = path.join(devicesBaseDir, "venu2", "compiler.json");
  const baseVenu2SimulatorPath = path.join(devicesBaseDir, "venu2", "simulator.json");
  if (!fs.existsSync(baseVenu2CompilerPath) || !fs.existsSync(baseVenu2SimulatorPath)) {
    return { provisioned: [], skipped: true };
  }

  const baseCompiler = JSON.parse(fs.readFileSync(baseVenu2CompilerPath, "utf8"));
  const baseSimulator = JSON.parse(fs.readFileSync(baseVenu2SimulatorPath, "utf8"));
  const provisioned = [];

  for (const dev of COMPATIBLE_GARMIN_DEVICES) {
    const devDir = path.join(devicesBaseDir, dev.id);
    const compilerPath = path.join(devDir, "compiler.json");
    const simulatorPath = path.join(devDir, "simulator.json");

    if (!fs.existsSync(devDir)) {
      fs.mkdirSync(devDir, { recursive: true });
    }

    const customCompiler = JSON.parse(JSON.stringify(baseCompiler));
    customCompiler.deviceId = dev.id;
    customCompiler.displayName = dev.name;
    customCompiler.deviceFamily = `${dev.shape}-${dev.resolution.width}x${dev.resolution.height}`;
    customCompiler.worldWidePartNumber = dev.partNumber;
    customCompiler.resolution = {
      width: dev.resolution.width,
      height: dev.resolution.height
    };
    if (Array.isArray(customCompiler.partNumbers) && customCompiler.partNumbers.length > 0) {
      const basePartTemplate = JSON.parse(JSON.stringify(customCompiler.partNumbers[0]));
      const targetPartNumbers = Array.isArray(dev.partNumbers) && dev.partNumbers.length > 0
        ? dev.partNumbers
        : [dev.partNumber];
      customCompiler.partNumbers = targetPartNumbers.map((pn) => ({
        ...JSON.parse(JSON.stringify(basePartTemplate)),
        number: pn,
        firmwareVersion: 100,
        connectIQVersion: dev.connectIQVersion || "4.2.4"
      }));
    }
    fs.writeFileSync(compilerPath, JSON.stringify(customCompiler, null, 2), "utf8");

    if (dev.id !== "venu2" || !fs.existsSync(simulatorPath)) {
      fs.writeFileSync(simulatorPath, JSON.stringify(baseSimulator, null, 2), "utf8");
    }

    provisioned.push(dev.id);
  }

  return { provisioned, skipped: false, devicesBaseDir };
}

module.exports = {
  COMPATIBLE_GARMIN_DEVICES,
  getGarminDeviceById,
  getDefaultConnectIqDevicesDir,
  provisionConnectIqDevices
};
