import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createCityBackdrop, setupBloom, setGroundWet, createFrontBackdrop, setWeatherBackdrop } from "./city-backdrop.js";
import { createExteriorRain } from "./rain-effect.js";
import { initAudio } from "./audio.js";

const VERSION = "20260530033500";
const STT_DINER_PATH = "./assets/models/sttdiner.glb?v=" + VERSION;
const DINER_PATH  = "./assets/models/diners.glb?v=" + VERSION;
const RABBID_PATH = "./assets/models/animations_rabbid.glb?v=" + VERSION;

// ?? Route presets ?????????????????????????????????????????????????
// frontEntry: approach from diner entrance ??walk in ??turn left ??booth tour
const FRONT_ENTRY = [
  { id: "OUT1", x:  1.58, y: -0.7071, z: 16.20, yaw:  0.01,  pitch:  0.00, fov: 59 },
  { id: "OUT2", x:  1.58, y: -0.7071, z:  6.40, yaw:  0.01,  pitch:  0.00, fov: 58 },
  { id: "OUT3", x:  1.54, y: -0.7071, z:  3.85, yaw:  0.03,  pitch:  0.01, fov: 57 },
  { id: "IN1",   x: 1.52, y: -0.7071, z:  1.72, yaw:  0.02,  pitch:  0.02, fov: 56 },
  { id: "LOOKUP", x: 1.50, y: -0.7071, z:  0.32, yaw:  0.03,  pitch: -0.10, fov: 55 },
  { id: "TURN1", x: 1.38, y: -0.7071, z: -0.72, yaw:  0.12,  pitch:  0.04, fov: 55 },
  { id: "TURN2", x: 1.02, y: -0.7071, z: -1.18, yaw:  0.40,  pitch:  0.08, fov: 53 },
  { id: "TURN3", x: 0.52, y: -0.7071, z: -1.34, yaw:  0.66,  pitch:  0.11, fov: 52 },
  { id: "A3",   x:  0.12, y: -0.7071, z: -1.30, yaw:  0.82,  pitch:  0.14, fov: 52 },
  { id: "P01", x:  0.1622, y: -0.7071, z: -1.7685, yaw:  1.552, pitch:  0.196, fov: 52 },
  { id: "P02", x: -3.5636, y: -0.7071, z: -2.0796, yaw:  0.104, pitch:  0.150, fov: 52 },
  { id: "P03", x: -3.5636, y: -0.7071, z: -2.0796, yaw: -0.672, pitch:  0.182, fov: 52 },
  { id: "P04", x: -3.5636, y: -0.7071, z: -2.0796, yaw: -1.412, pitch:  0.196, fov: 52 },
  { id: "P05", x: -3.5636, y: -0.7071, z: -2.0796, yaw: -2.132, pitch:  0.178, fov: 52 },
  { id: "P06", x: -3.5636, y: -0.7071, z: -2.0796, yaw: -1.120, pitch:  0.165, fov: 52 },
  { id: "P07", x: -2.3200, y: -0.7071, z: -1.9700, yaw: -1.080, pitch:  0.158, fov: 52 },
  { id: "P08", x: -1.0600, y: -0.7071, z: -1.8600, yaw: -1.060, pitch:  0.150, fov: 52 },
  { id: "P09", x:  0.0800, y: -0.7071, z: -1.7600, yaw: -1.050, pitch:  0.145, fov: 52 },
  { id: "P10", x:  0.5200, y: -0.7071, z: -1.7200, yaw: -1.050, pitch:  0.145, fov: 52 },
  { id: "P11", x:  0.5200, y: -0.7071, z: -1.7200, yaw: -1.620, pitch:  0.145, fov: 52 },
  { id: "P12", x:  0.5200, y: -0.7071, z: -1.7200, yaw: -2.180, pitch:  0.150, fov: 52 },
];

// backEntry: enter from back of building, walk through
const BACK_ENTRY = [
  { id: "P01", x: 0.2100, y: -0.5670, z: -0.7420, yaw: -4.340, pitch: -0.032, fov: 52 },
  { id: "P02", x: 0.7958, y: -0.0544, z: -5.3106, yaw: -3.118, pitch: -0.218, fov: 52 },
  { id: "P03", x: 0.9104, y: -0.0587, z: -9.9886, yaw: -3.108, pitch: -0.056, fov: 52 },
];

let activeRoute = FRONT_ENTRY;

for (const pt of [...FRONT_ENTRY, ...BACK_ENTRY]) {
  pt.y += 0.65;
}

// ?? Scroll state ??????????????????????????????????????????????????
let scrollTarget = 0;
let scrollSmooth = 0;
const SCROLL_PX    = 5500;
const SMOOTH_SPEED = 8.5;

let rainSystem  = { update() {}, setActive() {} };
let audioSystem = null;
let weatherMode = "sunny";
let _lastInsideState = null; // null = uninitialized

let _interiorLights  = []; // [{ light, rain, sunny }]
let _rabbidLights    = []; // [{ light, rainColor, sunnyColor }]
let _ceilGlowMeshes  = []; // rain-only ceiling glow panels
let _dinerRoot       = null;
const _matOriginals  = new Map(); // uuid → saved sunny-state values

// ?? Scene ?????????????????????????????????????????????????????????
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07091a);

const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.002, 200);
camera.rotation.order = "YXZ";

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.60;
document.body.appendChild(renderer.domElement);

const composer = setupBloom(renderer, scene, camera);

const pmremGenerator = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

const hemLight = new THREE.HemisphereLight(0xffffff, 0x222222, 0.72);
scene.add(hemLight);
const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
keyLight.position.set(4, 7, 6);
scene.add(keyLight);
keyLight.intensity = 1.25;
const fillLight = new THREE.DirectionalLight(0xffdddd, 0.42);
fillLight.position.set(-5, 3, -4);
scene.add(fillLight);

const loader = new GLTFLoader();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath("https://cdn.jsdelivr.net/npm/three@0.164.1/examples/jsm/libs/draco/");
loader.setDRACOLoader(dracoLoader);

let rabbidRoot = null;
let rabbidMixer = null;
let rabbidClips  = [];
let rabbidIdleAction = null;
let rabbidEventAction = null;
let rabbidEventPlaying = false;
let rabbidNextPlayAt = 0;
let rabbidBreathBone = null;
let rabbidBreathBoneBasePos = null;
let rabbidShoulderBreathBones = [];
let rabbidShoulderBreathBasePos = [];
let rabbidUpperArmBreathBones = [];
let rabbidUpperArmBreathBasePos = [];
let rabbidHeadFollowBone = null;
let rabbidHeadFollowBoneBasePos = null;
const RABBID_PLAY_INTERVAL_MS = 5 * 60 * 1000;
const RABBID_IS_IPAD_LIKE = /iPad/i.test(navigator.userAgent)
  || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const RABBID_MIXER_MAX_STEP = RABBID_IS_IPAD_LIKE ? 1 / 10 : 1 / 12;
const RABBID_EVENT_TIME_SCALE = 0.58; // 5-minute interval stays the same; only the one-shot event plays slower
const RABBID_BREATH_DEVICE_BOOST = RABBID_IS_IPAD_LIKE ? 1.16 : 1.0;
const RABBID_BASE_SCALE = 0.038;
const RABBID_BODY_BREATH_SPEED = 0.00092; // slower, heavier inhale/exhale
const RABBID_BODY_BREATH_UP = 0.325;       // belly only: up motion without whole-model scaling
const RABBID_BODY_BREATH_FORWARD = 0.455;  // belly only: forward breathing push
const RABBID_SHOULDER_BREATH_UP = 0.620;   // clavicle/shoulder only: large visible shrug upward
const RABBID_SHOULDER_BREATH_FORWARD = 0.245;
const RABBID_UPPER_ARM_BREATH_UP = 0.255;  // small follow-through so shoulder area looks attached
const RABBID_UPPER_ARM_BREATH_FORWARD = 0.065;
const RABBID_HEAD_STABILIZE_UP = 0.0;     // kept for compatibility; actual head rhythm uses tiny follow values below
const RABBID_HEAD_STABILIZE_FORWARD = 0.0;
const RABBID_FACE_RHYTHM_FOLLOW_UP = 0.032;      // tiny same-rhythm face/head follow, not a big head bob
const RABBID_FACE_RHYTHM_FOLLOW_FORWARD = 0.014; // tiny same-rhythm face/head follow

const clock = new THREE.Clock();

// ?? Scroll height ?????????????????????????????????????????????????
function applyScrollHeight() {
  document.documentElement.style.height = (window.innerHeight + SCROLL_PX) + "px";
}
applyScrollHeight();

window.addEventListener("scroll", () => {
  scrollTarget = Math.min(window.scrollY / SCROLL_PX, 1);
}, { passive: true });

// ?? Camera interpolation ??????????????????????????????????????????
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d >  Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep(t)  { return t * t * (3 - 2 * t); }

function applyCameraFromProgress(p) {
  const route = activeRoute;
  const n = route.length - 1;
  if (n < 1) return;
  const raw  = Math.max(0, Math.min(1, p)) * n;
  const seg  = Math.min(Math.floor(raw), n - 1);
  const st   = smoothstep(raw - seg);
  const from = route[seg];
  const to   = route[seg + 1];
  camera.position.x = lerp(from.x, to.x, st);
  camera.position.y = lerp(from.y, to.y, st);
  camera.position.z = lerp(from.z, to.z, st);
  camera.rotation.x = lerp(from.pitch, to.pitch, st);
  camera.rotation.y = lerpAngle(from.yaw, to.yaw, st);
  camera.rotation.z = 0;
  camera.fov = lerp(from.fov, to.fov, st);
  if (camera.fov !== _lastFov) {
    camera.updateProjectionMatrix();
    _lastFov = camera.fov;
  }
}

// ?? UI: progress bar + waypoint dots + route buttons ?????????????
let progressFillEl = null;
let waypointEls    = [];
let hintEl         = null;
let hintFaded      = false;
let _lastSeg       = -1;
let _lastFillPct   = -1;
let _lastFov       = -1;

function buildProgressUI(route) {
  // Remove old elements
  const old = document.getElementById("progressTrack");
  if (old) old.remove();
  waypointEls  = [];
  _lastSeg     = -1;
  _lastFillPct = -1;

  const track = document.createElement("div");
  track.id = "progressTrack";

  const fill = document.createElement("div");
  fill.id = "progressFill";
  track.appendChild(fill);
  progressFillEl = fill;

  // Waypoint dots along the track
  route.forEach((pt, i) => {
    const dot = document.createElement("div");
    dot.className = "wp-dot";
    dot.style.top = (i / (route.length - 1) * 100) + "%";
    track.appendChild(dot);
    waypointEls.push(dot);
  });

  document.body.appendChild(track);
}

function updateProgressUI(p) {
  if (progressFillEl) {
    const pct = Math.round(p * 10000) / 100;
    if (Math.abs(pct - _lastFillPct) > 0.05) {
      progressFillEl.style.height = pct + "%";
      _lastFillPct = pct;
    }
  }

  const n = activeRoute.length - 1;
  const seg = Math.min(Math.floor(p * n), n);
  if (seg !== _lastSeg) {
    waypointEls.forEach((dot, i) => dot.classList.toggle("active", i <= seg));
    _lastSeg = seg;
  }

  if (!hintFaded && p > 0.02 && hintEl) {
    hintEl.style.opacity = "0";
    hintFaded = true;
  }
}

function createUI() {
  // Route buttons
  const ui = document.createElement("div");
  ui.id = "routeUI";
  ui.innerHTML = `
    <button id="btnFront" class="route-btn active">Entrance</button>
    <button id="btnBack"  class="route-btn">Rear</button>
  `;
  document.body.appendChild(ui);

  function switchRoute(route, activeId, inactiveId) {
    activeRoute  = route;
    scrollTarget = 0;
    scrollSmooth = 0;
    window.scrollTo({ top: 0, behavior: "instant" });
    document.getElementById(activeId).classList.add("active");
    document.getElementById(inactiveId).classList.remove("active");
    hintFaded = false;
    if (hintEl) hintEl.style.opacity = "1";
    applyCameraFromProgress(0);
    buildProgressUI(route);
    _lastInsideState = null;   // force re-evaluate after route change
    _syncAudioLocation();
  }

  document.getElementById("btnFront").onclick = () => switchRoute(FRONT_ENTRY, "btnFront", "btnBack");
  document.getElementById("btnBack").onclick  = () => switchRoute(BACK_ENTRY,  "btnBack",  "btnFront");

  // Scroll hint
  hintEl = document.getElementById("hint");

  // Initial progress track
  buildProgressUI(FRONT_ENTRY);
}

// ?? Model helpers ?????????????????????????????????????????????????
function _syncAudioLocation() {
  if (!audioSystem) return;
  const isRainRear           = weatherMode === "rain" && activeRoute === BACK_ENTRY;
  const isRainEntranceInside = weatherMode === "rain" && activeRoute !== BACK_ENTRY && camera.position.z < 1.0;
  const inside = isRainRear || isRainEntranceInside;
  if (inside !== _lastInsideState) {
    _lastInsideState = inside;
    console.log("[AUDIO ROUTE CHECK]", {
      weatherMode,
      route: activeRoute === BACK_ENTRY ? "BACK" : "FRONT",
      isRainRear,
      inside,
      z: camera.position.z.toFixed(2),
    });
    audioSystem.setLocation(inside);
  }
}

function setWeatherMode(mode) {
  weatherMode = mode;
  const isRain = mode === "rain";

  rainSystem.setActive(isRain);
  setGroundWet(isRain);
  setWeatherBackdrop(isRain);
  if (audioSystem) {
    audioSystem.setMode(mode);
    _lastInsideState = null;   // force re-evaluate after mode change
    _syncAudioLocation();
  }

  // Material-level treatment (fixtures, signs, chrome, glass, floor)
  if (_dinerRoot) {
    if (isRain) _applyRainMaterials(_dinerRoot);
    else        _applySunnyMaterials(_dinerRoot);
  }

  hemLight.color.setHex(isRain ? 0xffeedd : 0xffffff);
  hemLight.groundColor.setHex(isRain ? 0x060304 : 0x222222);
  hemLight.intensity  = isRain ? 0.04 : 0.72;
  keyLight.intensity  = isRain ? 0.00 : 1.25;
  fillLight.intensity = isRain ? 0.00 : 0.42;
  renderer.toneMappingExposure = isRain ? 0.54 : 0.60;

  for (const { light, rain, sunny } of _interiorLights) {
    light.intensity = isRain ? rain : sunny;
  }
  for (const m of _ceilGlowMeshes) m.visible = isRain;
  for (const { light, rainColor, sunnyColor, rainInt, sunnyInt } of _rabbidLights) {
    light.color.setHex(isRain ? rainColor : sunnyColor);
    light.intensity = isRain ? rainInt : sunnyInt;
  }
}

function prepareMaterials(root, opts = {}) {
  root.traverse(obj => {
    if (!obj.isMesh) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.forEach(mat => {
      if (!mat) return;
      if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
      const materialName = ((mat.name || "") + " " + (obj.name || "")).toLowerCase();
      const isGlassLike = /glass|window|pane/.test(materialName);
      const isDoorLike = /door/.test(materialName);
      const isFixtureLight = /lights?|emissor|emissive|lamp|ceiling/.test(materialName);
      const isSignLight = /sign|sing_diner|neon/.test(materialName);
      if (opts.dimEmissive && "emissiveIntensity" in mat) {
        if (isFixtureLight) {
          mat.emissiveIntensity = 1.35;
        } else if (isSignLight) {
          mat.emissiveIntensity = 0.32;
        } else if (isGlassLike || isDoorLike) {
          mat.emissiveIntensity = 0.10;
        } else {
          mat.emissiveIntensity = Math.min(Math.max(mat.emissiveIntensity || 0, 0.08), 0.42);
        }
      }
      if (opts.dimEmissive && mat.emissive) {
        if (isFixtureLight) {
          mat.emissive.lerp(new THREE.Color(0xffd9a4), 0.65);
        } else if (isSignLight) {
          mat.emissive.multiplyScalar(0.50);
        } else if (isGlassLike || isDoorLike) {
          mat.emissive.multiplyScalar(0.14);
        } else {
          mat.emissive.multiplyScalar(0.48);
          mat.emissive.lerp(new THREE.Color(0xffc78a), 0.10);
        }
      }
      if (opts.makeGlassReadable && /glass|window|pane/.test(materialName)) {
        mat.transparent = true;
        mat.opacity = Math.min(mat.opacity ?? 1, 0.48);
        mat.depthWrite = false;
        mat.roughness = Math.max(mat.roughness ?? 0, 0.58);
        mat.metalness = 0;
      } else {
        mat.transparent = false;
        mat.depthWrite = true;
      }

      mat.needsUpdate = true;
    });
  });
}

function centerModel(model) {
  const box = new THREE.Box3().setFromObject(model);
  const c = box.getCenter(new THREE.Vector3());
  model.position.x -= c.x;
  model.position.y -= c.y;
  model.position.z -= c.z;
}

function loadGltf(path, label) {
  return new Promise((resolve, reject) => {
    loader.load(path, resolve, undefined, err =>
      reject(new Error(label + " load failed: " + String(err.message || err)))
    );
  });
}

function loadFirstGltf(paths, label) {
  return paths.reduce(
    (chain, path) => chain.catch(() => loadGltf(path, label)),
    Promise.reject(new Error(label + " fallback chain start"))
  );
}

const loadingEl = document.getElementById("loading");
function showLoading(msg) { if (loadingEl) loadingEl.innerHTML = msg; }

// ── Rabbid: original GLB look + idle breathing loop + 5-minute event ─────────
function findRabbidClip(pattern) {
  return rabbidClips.find(clip => pattern.test(clip.name || ""));
}

function startRabbidIdle() {
  if (!rabbidIdleAction) return;
  rabbidIdleAction.enabled = true;
  rabbidIdleAction.paused = false;
  rabbidIdleAction.setLoop(THREE.LoopRepeat, Infinity);
  rabbidIdleAction.clampWhenFinished = false;
  rabbidIdleAction.timeScale = 0.72;
  rabbidIdleAction.reset().fadeIn(0.18).play();
}

function stopRabbidIdleForEvent() {
  if (!rabbidIdleAction) return;
  rabbidIdleAction.fadeOut(0.12);
}

function playRabbidOnce() {
  if (!rabbidEventAction || rabbidEventPlaying) return;

  rabbidEventPlaying = true;
  resetRabbidBodyBreathing();
  stopRabbidIdleForEvent();

  rabbidEventAction.enabled = true;
  rabbidEventAction.paused = false;
  rabbidEventAction.timeScale = RABBID_EVENT_TIME_SCALE;
  rabbidEventAction.setLoop(THREE.LoopOnce, 1);
  rabbidEventAction.clampWhenFinished = false;
  rabbidEventAction.reset().fadeIn(0.10).play();
}

function setupRabbidBodyBreathingBone(root) {
  rabbidBreathBone = null;
  rabbidBreathBoneBasePos = null;
  rabbidShoulderBreathBones = [];
  rabbidShoulderBreathBasePos = [];
  rabbidUpperArmBreathBones = [];
  rabbidUpperArmBreathBasePos = [];
  rabbidHeadFollowBone = null;
  rabbidHeadFollowBoneBasePos = null;

  // Stomach drives the belly motion.
  // Clavicles make the visible shoulder shrug; upper arms follow slightly so the shoulder area does not look detached.
  // Spine2/Neck/Head are not moved procedurally, so the whole Rabbid does not look taller/shorter.
  root.traverse(obj => {
    const name = obj.name || "";

    if (!rabbidBreathBone && /Stomach/i.test(name)) {
      rabbidBreathBone = obj;
    }

    if (/L_Clavicle|R_Clavicle/i.test(name)) {
      rabbidShoulderBreathBones.push(obj);
    }

    if (/L_UpperArm|R_UpperArm/i.test(name)) {
      rabbidUpperArmBreathBones.push(obj);
    }

    // Prefer neck, because it moves the head/ears/eyes together more naturally.
    // Fallback to Head1/Head if the neck bone name changes in another export.
    if (!rabbidHeadFollowBone && /Neck/i.test(name)) {
      rabbidHeadFollowBone = obj;
    }
  });

  if (!rabbidHeadFollowBone) {
    root.traverse(obj => {
      if (rabbidHeadFollowBone) return;
      const name = obj.name || "";
      if (/Head1|Head/i.test(name)) rabbidHeadFollowBone = obj;
    });
  }

  if (rabbidBreathBone) {
    rabbidBreathBoneBasePos = rabbidBreathBone.position.clone();
    console.log("[RABBID BODY BREATH BONE]", rabbidBreathBone.name);
  } else {
    console.warn("[RABBID BODY BREATH BONE MISSING] Stomach bone not found.");
  }

  if (rabbidShoulderBreathBones.length) {
    rabbidShoulderBreathBasePos = rabbidShoulderBreathBones.map(bone => bone.position.clone());
    console.log("[RABBID SHOULDER BREATH BONES]", rabbidShoulderBreathBones.map(bone => bone.name));
  } else {
    console.warn("[RABBID SHOULDER BREATH BONES MISSING] Clavicle bones not found.");
  }

  if (rabbidUpperArmBreathBones.length) {
    rabbidUpperArmBreathBasePos = rabbidUpperArmBreathBones.map(bone => bone.position.clone());
    console.log("[RABBID UPPER ARM FOLLOW BONES]", rabbidUpperArmBreathBones.map(bone => bone.name));
  }

  if (rabbidHeadFollowBone) {
    rabbidHeadFollowBoneBasePos = rabbidHeadFollowBone.position.clone();
    console.log("[RABBID HEAD FOLLOW BONE]", rabbidHeadFollowBone.name);
  } else {
    console.warn("[RABBID HEAD FOLLOW BONE MISSING] Neck/Head bone not found.");
  }
}

function resetRabbidBodyBreathing() {
  if (rabbidBreathBone && rabbidBreathBoneBasePos) {
    rabbidBreathBone.position.copy(rabbidBreathBoneBasePos);
  }
  if (rabbidShoulderBreathBones.length && rabbidShoulderBreathBasePos.length) {
    rabbidShoulderBreathBones.forEach((bone, i) => {
      if (rabbidShoulderBreathBasePos[i]) bone.position.copy(rabbidShoulderBreathBasePos[i]);
    });
  }
  if (rabbidUpperArmBreathBones.length && rabbidUpperArmBreathBasePos.length) {
    rabbidUpperArmBreathBones.forEach((bone, i) => {
      if (rabbidUpperArmBreathBasePos[i]) bone.position.copy(rabbidUpperArmBreathBasePos[i]);
    });
  }
  if (rabbidHeadFollowBone && rabbidHeadFollowBoneBasePos) {
    rabbidHeadFollowBone.position.copy(rabbidHeadFollowBoneBasePos);
  }
}

function updateRabbidProceduralBreathing() {
  if (!rabbidRoot || rabbidEventPlaying) return;
  if (!rabbidBreathBone || !rabbidBreathBoneBasePos) return;

  // Slower inhale/exhale: belly + clavicles move strongly, but Spine2/Neck/Head stay stable.
  // performance.now() keeps the breathing pace stable even when iPad frame rate drops.
  const t = performance.now() * RABBID_BODY_BREATH_SPEED;
  const pulse = (Math.sin(t) + 1) * 0.5;
  const softPulse = pulse * pulse * (3 - 2 * pulse);
  const boost = RABBID_BREATH_DEVICE_BOOST;

  rabbidBreathBone.position.set(
    rabbidBreathBoneBasePos.x,
    rabbidBreathBoneBasePos.y + softPulse * RABBID_BODY_BREATH_UP * boost,
    rabbidBreathBoneBasePos.z + softPulse * RABBID_BODY_BREATH_FORWARD * boost
  );

  if (rabbidShoulderBreathBones.length && rabbidShoulderBreathBasePos.length) {
    rabbidShoulderBreathBones.forEach((bone, i) => {
      const base = rabbidShoulderBreathBasePos[i];
      if (!base) return;
      bone.position.set(
        base.x,
        base.y + softPulse * RABBID_SHOULDER_BREATH_UP * boost,
        base.z + softPulse * RABBID_SHOULDER_BREATH_FORWARD * boost
      );
    });
  }

  if (rabbidUpperArmBreathBones.length && rabbidUpperArmBreathBasePos.length) {
    rabbidUpperArmBreathBones.forEach((bone, i) => {
      const base = rabbidUpperArmBreathBasePos[i];
      if (!base) return;
      bone.position.set(
        base.x,
        base.y + softPulse * RABBID_UPPER_ARM_BREATH_UP * boost,
        base.z + softPulse * RABBID_UPPER_ARM_BREATH_FORWARD * boost
      );
    });
  }

  // Face/head rhythm: almost fixed, but not rhythmically detached from the body.
  // This uses the exact same softPulse as belly/shoulders, so the face follows the breath timing
  // without creating the old "whole character gets taller/shorter" look.
  if (rabbidHeadFollowBone && rabbidHeadFollowBoneBasePos) {
    rabbidHeadFollowBone.position.set(
      rabbidHeadFollowBoneBasePos.x,
      rabbidHeadFollowBoneBasePos.y + softPulse * RABBID_FACE_RHYTHM_FOLLOW_UP * boost,
      rabbidHeadFollowBoneBasePos.z + softPulse * RABBID_FACE_RHYTHM_FOLLOW_FORWARD * boost
    );
  }
}

function loadRabbid() {
  loadGltf(RABBID_PATH, "rabbid")
    .then(gltf => {
      const rabbid = gltf.scene;
      rabbidRoot = rabbid;
      prepareMaterials(rabbid);
      rabbid.position.set(0.0501, -0.5050, 0.5041);
      rabbid.scale.setScalar(RABBID_BASE_SCALE);
      rabbid.rotation.y = -4.676 + Math.PI - 0.42; // Rabbid looks more to its own right
      scene.add(rabbid);
      setupRabbidBodyBreathingBone(rabbid);
      addRabbidSoftLight(rabbid.position);

      if (gltf.animations && gltf.animations.length) {
        rabbidMixer = new THREE.AnimationMixer(rabbid);
        rabbidClips = gltf.animations;

        const idleClip = findRabbidClip(/Idle1|Idle2|IdleHold|IdleLook|Idle/i) || rabbidClips[0];
        const eventClip = rabbidClips[0] === idleClip
          ? (findRabbidClip(/BWAAAAAH|Hello|Laugh|Dance|Jump|Yes|No/i) || rabbidClips[1] || idleClip)
          : rabbidClips[0];

        rabbidIdleAction = rabbidMixer.clipAction(idleClip);
        rabbidEventAction = rabbidMixer.clipAction(eventClip);
        rabbidEventAction.setLoop(THREE.LoopOnce, 1);
        rabbidEventAction.clampWhenFinished = false;
        rabbidEventAction.enabled = false;

        startRabbidIdle();
        rabbidNextPlayAt = performance.now() + RABBID_PLAY_INTERVAL_MS;

        console.log("[RABBID ORIGINAL GLB READY]", {
          clips: gltf.animations.length,
          idleClip: idleClip.name,
          eventClip: eventClip.name,
          nextPlayMs: RABBID_PLAY_INTERVAL_MS,
        });

        rabbidMixer.addEventListener("finished", event => {
          if (event.action !== rabbidEventAction) return;
          rabbidEventAction.stop();
          rabbidEventAction.enabled = false;
          rabbidEventPlaying = false;
          resetRabbidBodyBreathing();
          rabbidRoot.scale.setScalar(RABBID_BASE_SCALE);
          startRabbidIdle();
        });
      } else {
        console.warn("[RABBID ANIMATION MISSING]", {
          animations: gltf.animations ? gltf.animations.length : 0,
          userAgent: navigator.userAgent,
        });
      }
    })
    .catch(err => console.error("Rabbid:", err));
}

function addRabbidSoftLight(pos) {
  _rabbidLights = [];

  const underFace = new THREE.PointLight(0xffdfbd, 0.88, 2.0);
  underFace.position.set(pos.x + 0.35, pos.y + 0.48, pos.z + 0.15);
  scene.add(underFace);
  _rabbidLights.push({ light: underFace, sunnyColor: 0xffdfbd, rainColor: 0xFF3838, sunnyInt: 0.88, rainInt: 0 });

  const softFill = new THREE.PointLight(0xffffff, 0.28, 1.7);
  softFill.position.set(pos.x - 0.18, pos.y + 0.32, pos.z + 0.50);
  scene.add(softFill);
  _rabbidLights.push({ light: softFill, sunnyColor: 0xffffff, rainColor: 0xFF3838, sunnyInt: 0.28, rainInt: 0 });

  const rim = new THREE.PointLight(0xb8ccff, 0.22, 2.1);
  rim.position.set(pos.x + 0.55, pos.y + 0.85, pos.z - 0.45);
  scene.add(rim);
  _rabbidLights.push({ light: rim, sunnyColor: 0xb8ccff, rainColor: 0xFF3838, sunnyInt: 0.22, rainInt: 0 });

  // 로드 시점에 현재 날씨 즉시 적용
  const isRain = weatherMode === 'rain';
  for (const { light, rainColor, sunnyColor, rainInt, sunnyInt } of _rabbidLights) {
    light.color.setHex(isRain ? rainColor : sunnyColor);
    light.intensity = isRain ? rainInt : sunnyInt;
  }
}

function addCeilingGlowStrips(root) {
  _ceilGlowMeshes.forEach(m => scene.remove(m));
  _ceilGlowMeshes = [];

  const EXCL = /sign|sing|emissor|emissive|neon|menu|letter|logo|billboard|light|glass|window|door|metal|chrome|exterior|outside|stool|chair|booth|floor|tile|counter|railing|trim|frame/;

  const _baseMat = {
    transparent: true,
    blending:    THREE.AdditiveBlending,
    depthWrite:  false,
    depthTest:   true,
    toneMapped:  false,
    side:        THREE.DoubleSide,
  };

  const _box = new THREE.Box3();
  const _sz  = new THREE.Vector3();
  const _ct  = new THREE.Vector3();

  root.traverse(obj => {
    if (!obj.isMesh) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const n = ((obj.name || '') + ' ' + (mats[0]?.name || '')).toLowerCase();
    if (EXCL.test(n)) return;

    _box.setFromObject(obj);
    _box.getSize(_sz);
    _box.getCenter(_ct);

    if (_ct.y < 1.2)          return;
    if (_sz.y > 0.5)          return;
    if (_sz.x < 1.5)          return;
    if (_sz.z < 1.5)          return;
    if (_sz.y > _sz.x * 0.4) return;
    if (_sz.y > _sz.z * 0.4) return;

    const ceilingBottomY = _ct.y - _sz.y * 0.5;
    const panelY = ceilingBottomY - 0.06;
    const pw = _sz.x * 0.95;
    const pd = _sz.z * 0.95;

    const mkMat = (col, op) => new THREE.MeshBasicMaterial({
      ..._baseMat, color: col, opacity: op, depthTest: true, depthWrite: false,
    });

    // Core — strong cherry red
    const core = new THREE.Mesh(new THREE.PlaneGeometry(pw, pd), mkMat(0xFF3A32, 0.55));
    core.rotation.x = -Math.PI / 2;
    core.position.set(_ct.x, panelY + 0.002, _ct.z + 500.0);
    core.renderOrder = 2;
    core.visible = false;
    scene.add(core);
    _ceilGlowMeshes.push(core);

    // Halo — soft wide spread
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(pw * 1.15, pd * 1.15), mkMat(0xB84A42, 0.13));
    halo.rotation.x = -Math.PI / 2;
    halo.position.set(_ct.x, panelY - 0.003, _ct.z + 500.0);
    halo.renderOrder = 1;
    halo.visible = false;
    scene.add(halo);
    _ceilGlowMeshes.push(halo);
  });
}

function addCeilingLightFixtures(root) {
  _ceilGlowMeshes.forEach(m => scene.remove(m));
  _ceilGlowMeshes = [];

  const EXCL = /sign|sing|emissor|emissive|neon|menu|letter|logo|billboard|light|glass|window|door|metal|chrome|exterior|outside|stool|chair|booth|floor|tile|counter|railing|trim|frame/;
  const _b3  = new THREE.Box3();
  const _szV = new THREE.Vector3();
  const _ctV = new THREE.Vector3();

  // Locate ceiling mesh to get anchor X/Z and actual underside Y
  let anchorX = 0, anchorZ = -1.5, ceilingBottomY = 2.4;
  let ceilFound = false;
  root.traverse(obj => {
    if (ceilFound || !obj.isMesh) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const n = ((obj.name || '') + ' ' + (mats[0]?.name || '')).toLowerCase();
    if (EXCL.test(n)) return;
    _b3.setFromObject(obj);
    _b3.getSize(_szV); _b3.getCenter(_ctV);
    if (_ctV.y > 1.2 && _szV.y < 0.5 && _szV.x > 1.5 && _szV.z > 1.5
        && _szV.y < _szV.x * 0.4 && _szV.y < _szV.z * 0.4) {
      anchorX = _ctV.x; anchorZ = _ctV.z;
      ceilingBottomY = _ctV.y - _szV.y * 0.5;
      ceilFound = true;
    }
  });

  // Find Lights / Lights_01 GLB mesh as geometry template
  let tplMesh = null;
  root.traverse(obj => {
    if (tplMesh || !obj.isMesh) return;
    const mat0 = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    if (/^lights(_01)?$/i.test(obj.name) || /^lights(_01)?$/i.test(mat0?.name || '')) {
      tplMesh = obj;
    }
  });
  if (!tplMesh) return;

  // World-space rotation + scale from template (diner has no custom scale so world == local)
  tplMesh.updateWorldMatrix(true, false);
  const wQuat = new THREE.Quaternion();
  const wScale = new THREE.Vector3();
  const tplWorldPos = new THREE.Vector3();
  tplMesh.matrixWorld.decompose(tplWorldPos, wQuat, wScale);

  const baseMat = (Array.isArray(tplMesh.material) ? tplMesh.material[0] : tplMesh.material);
  const placeY  = ceilingBottomY - 0.005;

  // Keep the rear tube as-is, and keep only the middle tube of the
  // entrance-side three connected fluorescent tubes.
  // Removed entrance-side outer tubes: dz 0 and dz 2.8.
  [-1.4, 1.4].forEach(dz => {
    const mat = baseMat.clone();
    const isMiddleEntranceFluorescent = dz === 1.4;
    const rainTubeColor = isMiddleEntranceFluorescent ? 0xFF3838 : 0x48C8D8;
    if (mat.emissive) mat.emissive.setHex(rainTubeColor); else mat.emissive = new THREE.Color(rainTubeColor);
    // The remaining entrance-side tube is one of the two visible start-view red tubes.
    // Make only this tube throw a little more red light into the room.
    mat.emissiveIntensity = isMiddleEntranceFluorescent ? 8.4 : 5.0;
    mat.needsUpdate = true;

    const mesh = new THREE.Mesh(tplMesh.geometry, mat);
    // Move only the adjacent entrance-side tube away from the recently adjusted start-view tube.
    const entranceNeighborOffsetX = isMiddleEntranceFluorescent ? 0.22 : 0;
    const entranceNeighborOffsetZ = isMiddleEntranceFluorescent ? -0.04 : 0;
    mesh.position.set(anchorX + entranceNeighborOffsetX, placeY, anchorZ + dz + entranceNeighborOffsetZ);
    mesh.quaternion.copy(wQuat);
    mesh.scale.copy(wScale);
    if (isMiddleEntranceFluorescent) {
      const geom = tplMesh.geometry;
      if (!geom.boundingBox) geom.computeBoundingBox();
      const tubeSize = new THREE.Vector3();
      geom.boundingBox.getSize(tubeSize);
      const longAxis = tubeSize.x >= tubeSize.y && tubeSize.x >= tubeSize.z
        ? "x"
        : (tubeSize.y >= tubeSize.z ? "y" : "z");
      mesh.scale[longAxis] *= 1.32;
    }
    mesh.frustumCulled = false;
    mesh.visible = false;
    scene.add(mesh);
    _ceilGlowMeshes.push(mesh);

    // PointLight for actual illumination — rain only, sunny=0
    const pt = new THREE.PointLight(rainTubeColor, 0, isMiddleEntranceFluorescent ? 10.5 : 7.5);
    pt.position.set(anchorX + entranceNeighborOffsetX, placeY - 0.12, anchorZ + dz + entranceNeighborOffsetZ);
    scene.add(pt);
    _interiorLights.push({ light: pt, rain: isMiddleEntranceFluorescent ? 0.58 : 0.28, sunny: 0 });

    if (isMiddleEntranceFluorescent) {
      const bounce = new THREE.PointLight(0xff5a48, 0, 8.4);
      bounce.position.set(anchorX + entranceNeighborOffsetX, placeY - 0.58, anchorZ + dz + entranceNeighborOffsetZ + 0.06);
      scene.add(bounce);
      _interiorLights.push({ light: bounce, rain: 0.20, sunny: 0 });
    }
  });

  // Table-set red tubes: one rain-only tube for each armchair + tabletop + armchair set.
  // IMPORTANT:
  // - No extra GLB is loaded. This clones the original Lights / Lights_01 mesh.
  // - Height / flat ceiling attachment comes from the original fluorescent fixture.
  // - X/Z placement comes from each table set center.
  // - If mesh names are not exposed by the GLB, use a conservative diner-layout fallback
  //   so the lights are still visible instead of silently creating nothing.
  const tableTubeColor = 0xFF3838;
  const tableTubeY = placeY;

  function _meshCenterAndSize(obj) {
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    return { center, size };
  }

  function _isUsableInteriorPoint(center) {
    return center.y > 0.05 && center.y < 1.55 && center.z > -5.6 && center.z < 1.8;
  }

  function getTableSetCenters() {
    const tableLike = [];
    const seatLike = [];

    root.traverse(obj => {
      if (!obj.isMesh) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      const matName = mats.map(m => m?.name || '').join(' ');
      const n = ((obj.name || '') + ' ' + matName).toLowerCase();
      const { center, size } = _meshCenterAndSize(obj);
      if (!_isUsableInteriorPoint(center)) return;

      const bad = /wall|ceil|ceiling|floor|tile|window|glass|door|sign|menu|logo|neon|light|lights|lamp|trash|plate|food|condiment|metal|chrome|frame|trim|railing/i.test(n);

      const namedTable = /tabletop|table_top|diner_top|table|tbl/i.test(n) && !bad;
      const flatTableShape = !bad
        && center.y > 0.28 && center.y < 1.15
        && size.y < 0.30
        && ((size.x > 0.55 && size.z > 0.20) || (size.z > 0.55 && size.x > 0.20));

      if (namedTable || flatTableShape) {
        tableLike.push(center.clone());
        return;
      }

      const namedSeat = /armchair|booth|seat|chair/i.test(n) && !/stool|bar/i.test(n);
      const boothShape = !bad
        && center.y > 0.18 && center.y < 1.35
        && size.y > 0.35
        && (size.x > 0.35 || size.z > 0.35);

      if (namedSeat || boothShape) {
        seatLike.push(center.clone());
      }
    });

    function groupCenters(points, zxOnly = false) {
      const groups = [];
      points
        .sort((a, b) => a.z - b.z || a.x - b.x)
        .forEach(p => {
          const g = groups.find(item => {
            const zClose = Math.abs(item.z - p.z) < 0.68;
            const xClose = zxOnly ? true : Math.abs(item.x - p.x) < 1.35;
            return zClose && xClose;
          });
          if (!g) {
            groups.push({ x: p.x, z: p.z, count: 1 });
          } else {
            g.x = (g.x * g.count + p.x) / (g.count + 1);
            g.z = (g.z * g.count + p.z) / (g.count + 1);
            g.count += 1;
          }
        });
      return groups.map(g => ({ x: g.x, z: g.z, count: g.count }));
    }

    let centers = groupCenters(tableLike, false).map(g => ({ x: g.x, z: g.z }));

    // If table names are hidden, infer each set from armchair/booth pairs.
    // This gives the midpoint above armchair + tabletop + armchair.
    if (centers.length < 2 && seatLike.length >= 2) {
      centers = groupCenters(seatLike, true)
        .filter(g => g.count >= 2)
        .map(g => ({ x: g.x, z: g.z }));
    }

    // Dedupe. Keep one fixture per table set.
    const deduped = [];
    centers
      .sort((a, b) => a.z - b.z || a.x - b.x)
      .forEach(c => {
        const exists = deduped.some(d => Math.abs(d.z - c.z) < 0.72 && Math.abs(d.x - c.x) < 1.05);
        if (!exists) deduped.push({ x: c.x, z: c.z });
      });

    // The previous version returned [] when the GLB did not expose table names,
    // so nothing appeared. This fallback is intentional and visible: it uses
    // the same booth/table line visible in this diner scene, not the wall seam.
    if (deduped.length === 0) {
      return [
        { x: 0.08, z: -0.72 },
        { x: 0.08, z: -1.94 },
        { x: 0.08, z: -3.16 },
      ];
    }

    return deduped;
  }

  const tableCenters = getTableSetCenters();

  // Start-view tube: keep only the adjusted entrance-side tube.
  // The lower circled tube at x 0.08 / z 0.50 is intentionally removed below.
  const startViewTubeCenters = [
    // Newly added tube only: moved a tiny amount toward the ENTRANCE start side and strongly toward the removed circled tube side.
    { x: -0.30, z: 1.15, startViewGlow: true },
  ];

  startViewTubeCenters.forEach(target => {
    const existing = tableCenters.find(c =>
      Math.abs(c.x - target.x) < 0.16 && Math.abs(c.z - target.z) < 0.16
    );
    if (existing) {
      existing.startViewGlow = true;
    } else {
      tableCenters.push(target);
    }
  });

  // Remove the circled lower/near start-view tube.
  // It used to stay because it was protected as the first/original start tube.
  // Keep only the adjusted added tube near the entrance side.
  for (let i = tableCenters.length - 1; i >= 0; i--) {
    const c = tableCenters[i];
    const isCircledStartTube = Math.abs(c.x - 0.08) < 0.22 && Math.abs(c.z - 0.50) < 0.28;
    const isMovedAddedTube = Math.abs(c.x + 0.30) < 0.18 && Math.abs(c.z - 1.13) < 0.20;
    const isRabbidBackSideNeighbor = Math.abs(c.x - 0.08) < 0.65 && c.z < 0.10 && c.z > -1.35;
    if (!isMovedAddedTube && (isCircledStartTube || isRabbidBackSideNeighbor)) {
      tableCenters.splice(i, 1);
    }
  }

  tableCenters.forEach(c => {
    const isAddedStartTube = Math.abs(c.x + 0.30) < 0.18 && Math.abs(c.z - 1.13) < 0.20;
    if (isAddedStartTube) {
      c.startViewGlow = true;
    }
  });

  console.log('[TABLE FLUORESCENTS]', tableCenters.length, tableCenters);

  tableCenters.forEach(({ x, z, startViewGlow = false }) => {
    const mat = baseMat.clone();
    if (mat.emissive) mat.emissive.setHex(tableTubeColor);
    else mat.emissive = new THREE.Color(tableTubeColor);
    mat.emissiveIntensity = startViewGlow ? 8.4 : 5.0;
    mat.needsUpdate = true;

    const mesh = new THREE.Mesh(tplMesh.geometry, mat);
    mesh.position.set(x, tableTubeY, z);
    mesh.quaternion.copy(wQuat);
    mesh.scale.copy(wScale);
    if (startViewGlow) {
      const geom = tplMesh.geometry;
      if (!geom.boundingBox) geom.computeBoundingBox();
      const tubeSize = new THREE.Vector3();
      geom.boundingBox.getSize(tubeSize);
      const longAxis = tubeSize.x >= tubeSize.y && tubeSize.x >= tubeSize.z
        ? "x"
        : (tubeSize.y >= tubeSize.z ? "y" : "z");
      mesh.scale[longAxis] *= 1.42;
    }
    mesh.frustumCulled = false;
    mesh.visible = weatherMode === "rain";
    scene.add(mesh);
    _ceilGlowMeshes.push(mesh);

    const pt = new THREE.PointLight(tableTubeColor, 0, startViewGlow ? 10.5 : 4.8);
    pt.position.set(x, tableTubeY - 0.12, z);
    scene.add(pt);
    _interiorLights.push({ light: pt, rain: startViewGlow ? 0.58 : 0.22, sunny: 0 });

    if (startViewGlow) {
      const bounce = new THREE.PointLight(0xff5a48, 0, 8.4);
      bounce.position.set(x, tableTubeY - 0.62, z + 0.10);
      scene.add(bounce);
      _interiorLights.push({ light: bounce, rain: 0.20, sunny: 0 });
    }
  });

  // Rabbid-face-specific red spill removed. The start-view tube lights remain rain-only.

}

function addFixtureLights(root) {
  const seen = new Set();
  root.traverse(obj => {
    if (!obj.isMesh) return;
    if (seen.has(obj.uuid)) return;
    seen.add(obj.uuid);
    const mat0 = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    if (!mat0) return;
    const n = ((mat0.name || '') + ' ' + (obj.name || '')).toLowerCase();
    const isFixture = /light|lamp|bulb|fixture|emissor|fluor|tube/.test(n)
                   || (mat0.emissiveIntensity ?? 0) >= 1.0;
    if (!isFixture) return;

    obj.updateWorldMatrix(true, false);
    const pos = new THREE.Vector3();
    obj.getWorldPosition(pos);

    const isWhiteFixture = /^lights_1[2-7]_/i.test(obj.name);
    const isRedTube = !isWhiteFixture && /^lights(_01)?$/i.test(mat0.name || '');
    const col = isWhiteFixture ? 0xF0F4FF : (isRedTube ? 0xFF3838 : 0x48C8D8);
    const pt = new THREE.PointLight(col, 0, 9.0);
    pt.position.set(pos.x, pos.y - 0.08, pos.z);
    scene.add(pt);
    _interiorLights.push({ light: pt, rain: 1.0, sunny: 0 });
  });
}

function _addInteriorLight(color, x, y, z, distance, rain, sunny) {
  const light = new THREE.PointLight(color, sunny, distance);
  light.position.set(x, y, z);
  scene.add(light);
  _interiorLights.push({ light, rain, sunny });
}

function addDinerInteriorGlow() {
  _interiorLights = [];

  // Main ceiling — warm tungsten overhead (primary light source)
  _addInteriorLight(0xFFD7A0,  0.0, 2.4, -0.6, 7.0, 0.62, 0.18);
  _addInteriorLight(0xFFD7A0,  0.0, 2.4, -2.2, 7.0, 0.58, 0.15);
  _addInteriorLight(0xFFD7A0,  0.0, 2.4, -3.6, 6.5, 0.50, 0.12);

  // Neon sign spill — cherry red, subtle
  _addInteriorLight(0xFF3040,  0.4, 2.2,  0.9, 6.0, 0.20, 0.00);

  // Rainy window reflection — muted steel blue, not electric
  _addInteriorLight(0x4A7FA8,  3.3, 1.5, -0.3, 8.0, 0.16, 0.00);
  _addInteriorLight(0x4A7FA8,  3.3, 1.5, -1.9, 8.0, 0.14, 0.00);

  // Under-counter warm strip
  _addInteriorLight(0xFFB86B,  0.3, 0.7, -0.9, 5.0, 0.34, 0.20);
  _addInteriorLight(0xFFB86B,  0.3, 0.7, -2.3, 5.0, 0.30, 0.16);

  // Left wall seam — magenta/purple accent (low)
  _addInteriorLight(0xC400E8, -3.4, 1.95,  0.1, 5.5, 0.22, 0.00);
  _addInteriorLight(0x451070, -3.4, 1.95, -1.5, 5.5, 0.18, 0.00);
  _addInteriorLight(0xC400E8, -3.4, 1.95, -3.0, 5.5, 0.20, 0.00);

  // Right wall seam — purple/magenta accent (low)
  _addInteriorLight(0x451070,  3.4, 1.95,  0.1, 5.5, 0.18, 0.00);
  _addInteriorLight(0xC400E8,  3.4, 1.95, -1.5, 5.5, 0.22, 0.00);
  _addInteriorLight(0x451070,  3.4, 1.95, -3.0, 5.5, 0.18, 0.00);

  // Counter edge — very subtle magenta underfill
  _addInteriorLight(0xC400E8,  0.3, 0.55, -0.8, 4.5, 0.18, 0.00);
  _addInteriorLight(0x451070,  0.3, 0.55, -2.0, 4.5, 0.15, 0.00);

  // Warm practical fill — booth / table / counter areas (rain only, horror contrast 완화)
  _addInteriorLight(0xFFD0A0, -2.8, 0.55, -1.2, 5.5, 0.18, 0.00);
  _addInteriorLight(0xF2B16D, -2.8, 0.55, -2.8, 5.5, 0.16, 0.00);
  _addInteriorLight(0xFFC08A,  0.0, 0.60, -1.8, 5.0, 0.17, 0.00);
  _addInteriorLight(0xFFD0A0,  2.4, 0.55, -0.8, 5.0, 0.14, 0.00);
  _addInteriorLight(0xFFC08A,  0.0, 0.60, -0.6, 4.5, 0.15, 0.00);
}

// ── Rain material system ───────────────────────────────────────────────────
function _saveMaterialOriginals(root) {
  root.traverse(obj => {
    if (!obj.isMesh) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.forEach(mat => {
      if (!mat || _matOriginals.has(mat.uuid)) return;
      _matOriginals.set(mat.uuid, {
        emissiveIntensity:  mat.emissiveIntensity ?? 0,
        emissive:           mat.emissive  ? mat.emissive.clone()  : null,
        roughness:          mat.roughness ?? 1,
        metalness:          mat.metalness ?? 0,
        color:              mat.color     ? mat.color.clone()     : null,
        envMapIntensity:    mat.envMapIntensity ?? 1,
        map:                mat.map       ?? null,
      });
    });
  });
}

function _applyRainMaterials(root) {
  root.traverse(obj => {
    if (!obj.isMesh) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.forEach(mat => {
      if (!mat) return;
      const orig = _matOriginals.get(mat.uuid);
      if (!orig) return;
      const n = ((mat.name || '') + ' ' + (obj.name || '')).toLowerCase();

      // Toilet sign — always restore original, never tint
      if (/toilet/.test(n)) {
        mat.emissiveIntensity = orig.emissiveIntensity;
        if (orig.emissive && mat.emissive) mat.emissive.copy(orig.emissive);
        mat.roughness = orig.roughness;
        mat.metalness = orig.metalness;
        mat.needsUpdate = true;
        return;
      }

      // Armchair/booth seating — cherry red vinyl, rain only
      if (/armchair/.test(n)) {
        if (mat.color) mat.color.setHex(0xD14A43);
        mat.roughness = 0.24;
        mat.metalness = 0.04;
        mat.envMapIntensity = 1.8;
        mat.emissiveIntensity = 0;
        if (mat.emissive) mat.emissive.set(0, 0, 0);
        mat.needsUpdate = true;
        return;
      }

      // ── Actual ceiling mesh — emissive red glow panel, rain only ──
      const _isCeil = (() => {
        if (/sign|sing|emissor|emissive|neon|menu|letter|logo|billboard|light|glass|window|door|metal|chrome|exterior|outside|stool|chair|booth|floor|tile|counter|railing|trim|frame/.test(n)) return false;
        const box = new THREE.Box3().setFromObject(obj);
        const sz  = new THREE.Vector3(); box.getSize(sz);
        const ct  = new THREE.Vector3(); box.getCenter(ct);
        return ct.y > 1.2 && sz.y < 0.5 && sz.x > 1.5 && sz.z > 1.5
            && sz.y < sz.x * 0.4 && sz.y < sz.z * 0.4;
      })();
      if (_isCeil) {
        mat.map   = null;
        mat.aoMap = null;
        obj.receiveShadow = false;
        if (mat.color)    mat.color.setHex(0xE7B9B2);
        if (mat.emissive) mat.emissive.setHex(0xB84A42);
        mat.emissiveIntensity = 0.45;
        mat.roughness = 0.90;
        mat.metalness = 0;
        mat.needsUpdate = true;
        return;
      }

      // Lights_12~17 — white fixtures (창고/후방 구역)
      if (/^lights_1[2-7]_/i.test(obj.name)) {
        mat.emissiveIntensity = 6.5;
        if (mat.emissive) mat.emissive.setHex(0xF0F4FF);
        mat.needsUpdate = true;
        return;
      }

      const isFixture = /light|lamp|bulb|fixture|emissor|fluor|tube/.test(n)
                     || orig.emissiveIntensity >= 1.0;
      const isSign    = /\bneon\b|sing_/.test(n);
      const isGlass   = /glass|window|pane/.test(n)
                     || (mat.transparent && (mat.opacity ?? 1) < 0.7);
      const isChrome  = /chrome|metal|steel|stainless|aluminum|trim|edge/.test(n)
                     || (orig.metalness > 0.45 && orig.roughness < 0.40);
      const isFloor   = /floor|tile|linoleum/.test(n) && !/wood|chair|table|booth|seat|cabinet|wall|ceil/.test(n);
      const isCounter = /counter|tabletop|diner_top|bar_top/.test(n);

      if (isFixture) {
        const isRedTube = /^lights(_01)?$/i.test(mat.name || '');
        mat.emissiveIntensity = isRedTube ? 6.5 : 5.0;
        if (mat.emissive) mat.emissive.setHex(isRedTube ? 0xFF3838 : 0x48C8D8);
      } else if (isSign) {
        // Cherry red neon accent only
        mat.emissiveIntensity = Math.min(orig.emissiveIntensity * 1.3, 1.1);
        if (mat.emissive) mat.emissive.setHex(0xFF2A3D);
      } else if (isGlass) {
        mat.roughness = 0.06;
        mat.metalness = 0.10;
        mat.emissiveIntensity = 0.02;
        if (mat.emissive) mat.emissive.setHex(0x02060c);
      } else if (isChrome) {
        mat.roughness = Math.min(orig.roughness, 0.03);
        mat.metalness = Math.max(orig.metalness, 0.96);
        mat.envMapIntensity = 4.0;
        mat.emissiveIntensity = 0;
      } else if (isFloor) {
        if (orig.color && mat.color) {
          mat.color.copy(orig.color).multiplyScalar(0.72).lerp(new THREE.Color(0x8898AA), 0.18);
        }
        mat.roughness = Math.min(orig.roughness, 0.24);
        mat.metalness = Math.max(orig.metalness, 0.06);
        mat.envMapIntensity = (orig.envMapIntensity ?? 1) * 1.9;
        if (mat.emissive) mat.emissive.setHex(0x050810);
        mat.emissiveIntensity = 0.0;
      } else if (isCounter) {
        mat.roughness = Math.min(orig.roughness, 0.12);
        mat.metalness = Math.max(orig.metalness, 0.22);
        mat.envMapIntensity = 2.6;
        if (orig.color && mat.color) mat.color.copy(orig.color).multiplyScalar(1.30);
      } else {
        // Interior walls, ceiling, booths — lift albedo, slight polish
        mat.emissiveIntensity = orig.emissiveIntensity * 0.90;
        if (orig.emissive && mat.emissive) mat.emissive.copy(orig.emissive);
        if (orig.color && mat.color)
          mat.color.copy(orig.color).multiplyScalar(1.38).lerp(new THREE.Color(0xfff6ee), 0.07);
        mat.roughness = Math.max((orig.roughness ?? 1) * 0.82, 0.10);
        mat.envMapIntensity = (orig.envMapIntensity ?? 1) * 1.2;
      }

      mat.needsUpdate = true;
    });
  });
}

function _applySunnyMaterials(root) {
  root.traverse(obj => {
    if (!obj.isMesh) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.forEach(mat => {
      if (!mat) return;
      const orig = _matOriginals.get(mat.uuid);
      if (!orig) return;
      mat.emissiveIntensity = orig.emissiveIntensity;
      if (orig.emissive && mat.emissive) mat.emissive.copy(orig.emissive);
      if (orig.color && mat.color) mat.color.copy(orig.color);
      mat.roughness = orig.roughness;
      mat.metalness = orig.metalness;
      mat.envMapIntensity = orig.envMapIntensity ?? 1;
      mat.map = orig.map ?? null;
      mat.needsUpdate = true;
    });
  });
}


function loadDiner() {
  showLoading("Loading...");
  loadFirstGltf([STT_DINER_PATH, DINER_PATH], "diner")
    .then(gltf => {
      const diner = gltf.scene;
      prepareMaterials(diner, { dimEmissive: true, makeGlassReadable: true });
      centerModel(diner);
      diner.position.z += 11.1;
      scene.add(diner);
      diner.updateMatrixWorld(true);


      _dinerRoot = diner;
      _saveMaterialOriginals(diner); // snapshot after prepareMaterials = sunny baseline
      addDinerInteriorGlow();
      addCeilingLightFixtures(diner);
      addFixtureLights(diner);
      createCityBackdrop(scene);
      createFrontBackdrop(scene);
      setWeatherMode(weatherMode);
      setGroundWet(weatherMode === "rain");
      rainSystem = createExteriorRain(scene, camera);
      rainSystem.setActive(weatherMode === "rain");
      applyCameraFromProgress(0);
      if (loadingEl) loadingEl.style.display = "none";
      loadRabbid();
    })
    .catch(err => showLoading("LOAD FAILED<br>" + String(err.message || err)));
}

// ?? Resize ????????????????????????????????????????????????????????
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  composer.setSize(window.innerWidth, window.innerHeight);
  applyScrollHeight();
});

// ?? Render loop ???????????????????????????????????????????????????
function animate() {
  requestAnimationFrame(animate);
  const realDelta = clock.getDelta();
  const delta = Math.min(realDelta, 1 / 30); // clamp: prevents jump after tab-switch
  scrollSmooth += (scrollTarget - scrollSmooth) * Math.min(delta * SMOOTH_SPEED, 1);
  scrollSmooth = Math.max(0, Math.min(1, scrollSmooth));
  applyCameraFromProgress(scrollSmooth);
  updateProgressUI(scrollSmooth);
  rainSystem.update(delta);

  _syncAudioLocation(); // position-based inside/outside check
  if (rabbidMixer) {
    rabbidMixer.update(Math.min(realDelta, RABBID_MIXER_MAX_STEP));

    const now = performance.now();
    if (!rabbidNextPlayAt) rabbidNextPlayAt = now + RABBID_PLAY_INTERVAL_MS;

    if (rabbidEventAction && now >= rabbidNextPlayAt && !rabbidEventPlaying) {
      rabbidNextPlayAt = now + RABBID_PLAY_INTERVAL_MS;
      playRabbidOnce();
    }
  }

  updateRabbidProceduralBreathing();
  composer.render();
}

createUI();
audioSystem = initAudio(setWeatherMode);
loadDiner();
animate();
