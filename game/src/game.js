// A driving session in the streamed UAE world: physics, AI traffic, traffic
// law, cameras (incl. live mirrors), navigation, HUD, missions and the
// cinematic render pipeline.
import * as THREE from 'three';
import { CinematicPipeline, gradeFor } from './render/cinematic.js';
import { Environment, QUALITY, TIMES, SEASONS } from './render/env.js';
import { ReflectionProbe } from './render/probe.js';
import { DynamicGraph } from './world/graph.js';
import { Streamer } from './world/streamer.js';
import { TrafficLights } from './world/signals.js';
import { Enforcement } from './world/enforcement.js';
import { Props } from './world/props.js';
import { farTerrain } from './world/overview.js';
import { buildCar, styleDims } from './cars/carFactory.js';
import { buildInterior, drawCluster } from './cars/interior.js';
import { loadCarModel, instantiateModelCar } from './cars/modelCars.js';
import { TRAFFIC_TYPES, carById } from './cars/catalog.js';
import { Vehicle } from './sim/vehicle.js';
import { Traffic } from './sim/traffic.js';
import { Input } from './sim/input.js';
import { Hud } from './hud/hud.js';
import { icon } from './ui/icons.js';
import { saveProfile } from './storage.js';
import { nativeCall } from './auth.js';

const CAMERAS = ['chase', 'far', 'cockpit', 'hood', 'cinematic'];
const OUTSIDE_TEMP = { summer: [44, 35], winter: [25, 16], rain: [19, 15], sandstorm: [39, 31], fog: [23, 19] };
const TYPE_LABEL = {
  motorway: 'Highway', trunk: 'Expressway', primary: 'Main road', secondary: 'Street', tertiary: 'Street',
  residential: 'Residential street', service: 'Service road', living_street: 'Living street', unclassified: 'Road',
};
const prettyType = (t) => TYPE_LABEL[t] || (t.endsWith('_link') ? 'Slip road' : 'Road');
const fmtDist = (d) => (d >= 1000 ? `${(d / 1000).toFixed(d >= 10000 ? 0 : 1)} km` : `${Math.round(d / 10) * 10} m`);

export class Game {
  /** Build a session (async: sky, textures and the first tiles are loaded first). */
  static async create(opts, onProgress = () => {}) {
    const g = new Game(opts);
    await g.init(onProgress);
    onProgress('Compiling shaders…');
    try {
      // compile every world / car / cockpit shader up front so the first frame is complete
      g.interior.visible = true;
      g.updateCamera(0);
      await g.renderer.compileAsync(g.scene, g.camera);
      g.cockpitOn = undefined;
    } catch (e) { /* older WebViews: shaders compile on first use instead */ }
    return g;
  }

  constructor({ renderer, world, start, profile, qualityKey, audio, radio, mode = 'free', materials, art, landmask, onExit }) {
    this.renderer = renderer;
    this.world = world; // { overview, base }
    this.overview = world.overview;
    this.start = start;
    this.profile = profile;
    this.settings = profile.settings;
    this.q = QUALITY[qualityKey] || QUALITY.medium;
    this.qualityKey = qualityKey;
    this.audio = audio;
    this.radio = radio;
    this.mode = mode;
    this.mats = materials;
    this.art = art;
    this.landmask = landmask;
    this.onExit = onExit;
    this.paused = false;
    this.time = 0;
    this.frame = 0;
  }

  async init(progress) {
    const q = this.q;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.15, q.far + 1500);
    progress('Lighting the sky…');
    this.env = new Environment(this.scene, this.renderer, q, this.art);
    await this.env.preload();

    this.props = new Props(this.mats.M);
    this.graph = new DynamicGraph();
    this.lights = new TrafficLights(this.scene);
    this.enforcement = new Enforcement(this.scene, this.graph);
    if (this.landmask) this.scene.add((this.terrain = farTerrain(this.landmask.tex, this.landmask.info, this.mats.M.ground.map)));
    this.streamer = new Streamer({
      scene: this.scene,
      materials: this.mats,
      props: this.props,
      quality: q,
      index: this.overview ? new Set(this.overview.tiles) : null,
      base: this.world.base,
      onAdd: (t) => {
        this.graph.addTile(t.key, t.origin, t.data.graph);
        this.lights.addTile(t);
        this.enforcement.addTile(t);
      },
      onRemove: (t) => {
        this.enforcement.removeTile(t);
        this.lights.removeTile(t);
        this.graph.removeTile(t.key);
      },
    });
    progress('Loading streets, buildings and traffic lights…');
    await this.streamer.preload(this.start.X, this.start.Z, Math.min(900, q.tileRadius), (d, n) => progress(`Building the city… ${d}/${n}`));

    // player car
    this.spec = carById(this.profile.selected);
    const paint = this.profile.paints[this.spec.id] ?? this.spec.paints[0];
    this.car = null;
    if (this.spec.model && this.qualityKey !== 'low') {
      const tpl = await loadCarModel(this.spec.model);
      if (tpl) {
        try { this.car = instantiateModelCar(this.spec, tpl, paint); } catch (e) { console.warn('[cars]', e.message); }
      }
    }
    if (!this.car) this.car = buildCar({ style: this.spec.style, color: paint, detail: true, quality: this.qualityKey === 'low' ? 'low' : 'high' });
    this.scene.add(this.car);
    this.player = new Vehicle(this.spec);
    this.addLights();
    this.spawnPlayer(this.start.X, this.start.Z, this.start.heading);

    const density = this.settings.trafficDensity ?? 1;
    const trafficModels = new Map();
    await Promise.all([...new Set(TRAFFIC_TYPES.filter((t) => t.model).map((t) => t.model))].map(async (url) => {
      const tpl = await loadCarModel({ url });
      if (tpl) trafficModels.set(url, tpl);
    }));
    this.traffic = new Traffic(this.graph, this.lights, this.scene, Math.round(q.traffic * density), trafficModels);

    // UI
    this.uiRoot = document.getElementById('game-ui');
    this.uiRoot.innerHTML = '<div id="hud"></div><div id="controls"></div><div id="mirror-frames"></div><div id="pause" class="hidden"></div>';
    this.hud = new Hud(document.getElementById('hud'), this);
    this.input = new Input(document.getElementById('controls'), this.settings.controls, this.settings.sensitivity);
    for (const a of ['lights', 'indLeft', 'indRight', 'hazard', 'camera', 'map', 'radio', 'pause']) this.input.actions[a] = () => this.action(a);
    this.input.actions.horn = () => {
      this.audio.horn(true);
      setTimeout(() => this.audio.horn(false), 400);
    };

    // cockpit with a live map on the centre screen
    this.screenCanvas = document.createElement('canvas');
    this.screenCanvas.width = 256;
    this.screenCanvas.height = 150;
    this.exterior = [...this.car.children];
    this.interior = buildInterior(this.spec.style, this.screenCanvas, this.car.userData.paint);
    this.car.add(this.interior);

    this.setupMirrors();
    this.setupPost();
    if (q.probe) {
      this.probe = new ReflectionProbe(this.renderer, this.scene, this.qualityKey === 'ultra' ? 256 : 128, this.qualityKey === 'ultra' ? 3 : 6);
      this.probe.apply(this.car);
    }

    // state
    this.lightsOn = 0; // 0 off, 1 low, 2 high
    this.ind = { left: false, right: false, hazard: false, since: -99, heading: 0 };
    this.cameraMode = this.settings.camera || 'chase';
    this.mirrorMode = this.settings.mirrors || 'all';
    const temps = OUTSIDE_TEMP[this.settings.season] || OUTSIDE_TEMP.summer;
    this.climate = { on: true, auto: true, fan: 3, target: 22, recirc: false, cabin: temps[0] + 6, outside: temps[0] };
    this.fuel = this.profile.fuel ?? 0.8;
    this.profile.sessionFines = 0;
    this.sessionStats = { km: 0, fines: 0, earned: 0, violations: 0, topSpeed: 0, started: Date.now() };
    this.lastPos = [this.player.x, this.player.z];
    this.distAcc = 0;
    this.nightNoLights = 0;
    this.hour = TIMES[this.settings.time]?.hour ?? 12.5;
    this.applyEnvironment();
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.route = null;
    this.dest = null;
    this.mission = null;
    this.perf = { acc: 0, frames: 0, scale: 1, slow: 0, fast: 0 };
    this.startMode(this.mode);
    const where = this.start.name ? `<b>${this.start.name}</b>` : 'the UAE';
    this.hud.toast(`Welcome to ${where} · map data © OpenStreetMap contributors`, 'info', 4500);
    if (!this.profile.tutorialDone) this.showTutorial();
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
    this.resize();
    this.renderPause();
  }

  // ---------- setup ----------
  addLights() {
    const st = styleDims(this.spec.style);
    this.headlight = new THREE.SpotLight(0xfff4e0, 0, 80, 0.5, 0.45, 1.2);
    this.headlight.position.set(0, 0.8, -st.L / 2);
    this.headlight.target.position.set(0, 0, -st.L / 2 - 25);
    this.car.add(this.headlight, this.headlight.target);
    this.indMats = this.car.userData.indicators;
    this.reverseMat = new THREE.MeshStandardMaterial({ color: 0x999999, emissive: 0xffffff, emissiveIntensity: 0 });
    for (const sx of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.06), this.reverseMat);
      m.position.set(sx * 0.5, 0.5, st.L / 2 - 0.01);
      this.car.add(m);
    }
  }

  /** Put the car on the nearest road to (X, Z), in the right-hand lane. */
  spawnPlayer(X, Z, heading) {
    const nr = this.graph.spawnPoint(X, Z) || this.graph.nearest(X, Z, 400) || this.anyRoad();
    if (!nr) {
      this.player.place(X, Z, heading || 0);
      return;
    }
    const l = Math.hypot(nr.dx, nr.dz) || 1;
    let dx = nr.dx / l, dz = nr.dz / l;
    const road = nr.road;
    const off = road.oneway ? road.width / 2 - 1.9 : road.width / 4;
    if (heading !== undefined && road.oneway === false) {
      const hx = -Math.sin(heading), hz = -Math.cos(heading);
      if (hx * dx + hz * dz < 0) { dx = -dx; dz = -dz; }
    }
    const x = nr.px - dz * off, z = nr.pz + dx * off;
    this.player.place(x, z, Math.atan2(-dx, -dz));
    this.spawnPoint = [x, z, this.player.heading];
  }

  anyRoad() {
    for (const e of this.graph.liveEdges) {
      if (e.road.rank >= 5 && e.len > 30) {
        const a = this.graph.pt(e.a);
        return this.graph.nearest(a.x + e.dx * 10, a.z + e.dz * 10, 20);
      }
    }
    return null;
  }

  setupMirrors() {
    const scale = this.q.mirrorScale;
    const mk = (w, h) => new THREE.WebGLRenderTarget(Math.round(w * scale), Math.round(h * scale), { samples: 0 });
    const st = styleDims(this.spec.style);
    const eye = this.interior.userData.eye;
    this.mirrors = [
      { key: 'rear', rt: mk(512, 160), cam: new THREE.PerspectiveCamera(38, 512 / 160, 0.3, 700), pos: new THREE.Vector3(0, eye.y + 0.15, 0.3), yaw: 0, rect: [0.36, 0.13, 0.28, 0.1] },
      { key: 'left', rt: mk(300, 200), cam: new THREE.PerspectiveCamera(42, 1.5, 0.3, 600), pos: new THREE.Vector3(-st.W / 2 - 0.15, eye.y - 0.1, -0.7), yaw: -0.18, rect: [0.01, 0.28, 0.16, 0.2] },
      { key: 'right', rt: mk(300, 200), cam: new THREE.PerspectiveCamera(42, 1.5, 0.3, 600), pos: new THREE.Vector3(st.W / 2 + 0.15, eye.y - 0.1, -0.7), yaw: 0.18, rect: [0.83, 0.28, 0.16, 0.2] },
    ];
    this.overlay = new THREE.Scene();
    this.overlayCam = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
    const frames = document.getElementById('mirror-frames');
    for (const m of this.mirrors) {
      const geo = new THREE.PlaneGeometry(1, 1);
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: m.rt.texture, depthTest: false, toneMapped: true }));
      const [x, y, w, h] = m.rect;
      mesh.scale.set(w, h, 1);
      mesh.position.set(x + w / 2, 1 - y - h / 2, 0);
      m.mesh = mesh;
      this.overlay.add(mesh);
      const f = document.createElement('div');
      f.className = `mirror-frame mf-${m.key}`;
      Object.assign(f.style, { left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` });
      frames.appendChild(f);
      m.frame = f;
      m.cam.rotation.order = 'YXZ';
    }
  }

  setupPost() {
    this.post = null;
    if (!this.q.post) return;
    try {
      this.post = new CinematicPipeline(this.renderer, this.scene, this.camera, this.q);
      this.bloom = this.post.bloom;
    } catch (e) {
      console.warn('post-processing disabled', e);
      this.post = null;
    }
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.post) this.post.setSize(w, h);
  }

  applyEnvironment() {
    const { night, wet, sunset } = this.env.set(this.hour, this.settings.season);
    this.night = night;
    this.wet = wet;
    this.mats.setNight(night);
    this.mats.setWet(wet);
    if (this.post) this.post.setGrade(gradeFor({ night, sunsetAmount: sunset, season: this.settings.season }));
    if (this.bloom) {
      this.bloom.strength = 0.12 + night * 0.5;
      this.bloom.threshold = night > 0.5 ? 0.85 : 2.5;
    }
    const temps = OUTSIDE_TEMP[this.settings.season] || OUTSIDE_TEMP.summer;
    const dayF = Math.max(0, Math.sin(((this.hour - 6) / 12) * Math.PI));
    if (this.climate) this.climate.outside = Math.round(temps[1] + (temps[0] - temps[1]) * dayF);
    if (night > 0.5 && this.lightsOn === 0 && this.frame === 0) this.lightsOn = 1;
  }

  // ---------- tutorial ----------
  showTutorial() {
    const el = document.createElement('div');
    el.className = 'tutorial';
    el.innerHTML = `
      <div class="tut-card">
        <h3>Ready to drive</h3>
        <div class="tut-grid">
          <div>${icon('left')}${icon('right')}<span>Steer (or tilt / wheel — change in Settings)</span></div>
          <div><b class="pedal-mini">GAS</b><span>Hold to accelerate, BRAKE to stop — hold at a standstill to reverse</span></div>
          <div>${icon('indLeft')}${icon('indRight')}<span>Indicate before every turn (AED 400 fine if you forget)</span></div>
          <div>${icon('map')}<span>Tap the minimap to pick a destination anywhere in the UAE</span></div>
          <div>${icon('camera')}<span>Switch to the cockpit to use the live mirrors</span></div>
          <div>${icon('speedcam')}<span>Radars flash at 20 km/h over the limit — watch the red warning</span></div>
        </div>
        <button class="btn primary big" data-tut>Let's go</button>
      </div>`;
    this.uiRoot.appendChild(el);
    this.paused = true;
    el.querySelector('[data-tut]').onclick = () => {
      el.remove();
      this.paused = false;
      this.profile.tutorialDone = true;
      saveProfile();
    };
  }

  // ---------- modes & missions ----------
  pickNode(fromX, fromZ, min, max) {
    const ids = [...this.graph.out.keys()];
    for (let i = 0; i < 500; i++) {
      const n = ids[Math.floor(Math.random() * ids.length)];
      const outs = this.graph.out.get(n);
      if (!outs || !outs.some((e) => e.road.rank >= 3)) continue;
      const p = this.graph.pt(n);
      const d = Math.hypot(p.x - fromX, p.z - fromZ);
      if (d > min && d < max) return n;
    }
    return ids[Math.floor(Math.random() * ids.length)];
  }

  startMode(mode) {
    this.mission = null;
    if (mode === 'free') {
      this.hud.mission(null);
      return;
    }
    const px = this.player.x, pz = this.player.z;
    const g = this.graph;
    if (mode === 'taxi') {
      const a = this.pickNode(px, pz, 150, 500);
      const pa = g.pt(a);
      const b = this.pickNode(pa.x, pa.z, 500, 1100);
      this.mission = { type: 'taxi', title: 'Chauffeur run', stops: [a, b].map((n) => [g.pt(n).x, g.pt(n).z]), labels: ['Pick up your VIP passenger', 'Drop your passenger off'], idx: 0, start: this.time, violations: 0, needStop: true };
    } else if (mode === 'test') {
      const pts = [];
      let cx = px, cz = pz;
      for (let i = 0; i < 4; i++) {
        const n = this.pickNode(cx, cz, 180, 420);
        const p = g.pt(n);
        pts.push([p.x, p.z]);
        cx = p.x;
        cz = p.z;
      }
      this.mission = { type: 'test', title: 'RTA-style driving test', stops: pts, labels: pts.map((_, i) => `Checkpoint ${i + 1} of ${pts.length}`), idx: 0, start: this.time, violations: 0, needStop: false };
      this.hud.toast('Driving test: obey every limit and light. <b>Any violation fails the test.</b>', 'warn', 6000);
    }
    this.makeMarker();
    this.routeTo(...this.mission.stops[0]);
  }

  makeMarker() {
    if (!this.marker) {
      const g = new THREE.Group();
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 40, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0x2f9bff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
      beam.position.y = 20;
      const ring = new THREE.Mesh(new THREE.RingGeometry(3.5, 4.5, 40), new THREE.MeshBasicMaterial({ color: 0x2f9bff, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.15;
      g.add(beam, ring);
      this.marker = g;
      this.scene.add(g);
    }
    const [x, z] = this.mission.stops[this.mission.idx];
    this.marker.position.set(x, 0, z);
    this.marker.visible = true;
  }

  /** Route to a world point: local road graph if loaded, else nationwide major roads. */
  routeTo(X, Z) {
    this.dest = [X, Z];
    const from = this.graph.nearestNode(this.player.x, this.player.z, 300);
    const to = this.graph.nearestNode(X, Z, 250);
    let path = null;
    if (from != null && to != null) path = this.graph.route(from, to);
    if (path) {
      this.route = path.map((n) => {
        const p = this.graph.pt(n);
        return [p.x, p.z];
      });
      this.routeNodes = path;
      this.routeKind = 'local';
      return true;
    }
    if (this.overview) {
      const r = this.overview.route(this.player.x, this.player.z, X, Z);
      if (r) {
        this.route = [[this.player.x, this.player.z], ...r.points, [X, Z]];
        this.routeNodes = null;
        this.routeKind = 'overview';
        return true;
      }
    }
    this.route = [[this.player.x, this.player.z], [X, Z]];
    this.routeNodes = null;
    this.routeKind = 'direct';
    return false;
  }

  setDestination(X, Z, name) {
    const ok = this.routeTo(X, Z);
    this.destName = name || '';
    const len = this.routeLength(0);
    this.hud.toast(`${icon('flag')} Route set${name ? ` to <b>${name}</b>` : ''} · ${fmtDist(len)}${ok ? '' : ' (approximate)'}`, 'good');
    this.audio.chime();
    this.haptic(20);
  }

  routeLength(from = 0) {
    let len = 0;
    const r = this.route || [];
    for (let i = from + 1; i < r.length; i++) len += Math.hypot(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]);
    return len;
  }

  /** Next manoeuvre along the route for the navigation card. */
  navInfo() {
    const r = this.route;
    if (!r || r.length < 2) return null;
    const p = this.player;
    // closest route vertex ahead of the player
    let best = 0, bd = Infinity;
    for (let i = 0; i < r.length; i++) {
      const d = (r[i][0] - p.x) ** 2 + (r[i][1] - p.z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    this.routeIdx = best;
    let dist = Math.sqrt(bd);
    let turnIcon = 'straight', street = '';
    for (let i = Math.max(1, best); i < r.length - 1; i++) {
      const ax = r[i][0] - r[i - 1][0], az = r[i][1] - r[i - 1][1];
      const bx = r[i + 1][0] - r[i][0], bz = r[i + 1][1] - r[i][1];
      const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
      if (la < 0.5 || lb < 0.5) continue;
      const cross = (ax * bz - az * bx) / (la * lb);
      const dot = (ax * bx + az * bz) / (la * lb);
      if (dot < 0.8) {
        turnIcon = dot < -0.6 ? 'uturn' : cross > 0 ? 'turnRight' : 'turnLeft';
        if (this.routeNodes) {
          const n = this.routeNodes[i], m = this.routeNodes[i + 1];
          for (const road of this.graph.nodeRoads.get(n) || []) {
            if (road.ids.includes(m)) {
              street = road.name || prettyType(road.type);
              break;
            }
          }
        }
        break;
      }
      dist += lb;
      if (i === r.length - 2) turnIcon = 'flag';
    }
    const remain = this.routeLength(best) + Math.sqrt(bd);
    const mins = Math.max(1, Math.round(remain / Math.max(8, p.kmh / 3.6 || 12) / 60));
    const verb = { turnLeft: 'Turn left', turnRight: 'Turn right', uturn: 'Make a U-turn', straight: 'Continue', flag: 'Arrive' }[turnIcon];
    return {
      icon: turnIcon,
      dist: `${verb} · ${fmtDist(dist)}`,
      street: street ? `onto ${street}` : this.destName || '',
      eta: `${fmtDist(remain)} · ${mins} min`,
    };
  }

  updateMission() {
    const m = this.mission;
    if (!m) {
      if (this.dest) {
        const d = Math.hypot(this.dest[0] - this.player.x, this.dest[1] - this.player.z);
        if (d < 18) {
          this.hud.toast(`${icon('flag')} You have arrived${this.destName ? ` at ${this.destName}` : ''}`, 'good');
          this.audio.chime();
          this.dest = null;
          this.route = null;
        } else if (this.frame % 240 === 0) this.routeTo(...this.dest); // re-route as tiles stream in
      }
      this.hud.mission(null);
      return;
    }
    const [x, z] = m.stops[m.idx];
    const d = Math.hypot(x - this.player.x, z - this.player.z);
    this.hud.mission(`${m.title}: ${m.labels[m.idx]}`, `${fmtDist(d)}${m.needStop && d < 40 ? ' · stop in the zone' : ''}`);
    this.marker.children[0].material.opacity = 0.16 + Math.sin(this.time * 4) * 0.08;
    this.marker.children[1].rotation.z += 0.02;
    if (d < 9 && (!m.needStop || this.player.kmh < 5)) {
      this.audio.chime();
      this.haptic(40);
      m.idx++;
      if (m.idx >= m.stops.length) return this.finishMission(true);
      this.hud.toast(`${icon('check')} ${m.labels[m.idx - 1]}`, 'good');
      this.makeMarker();
      this.routeTo(...m.stops[m.idx]);
    }
    if (this.frame % 180 === 0) this.routeTo(...m.stops[m.idx]);
  }

  finishMission(ok, reason) {
    const m = this.mission;
    this.mission = null;
    this.marker.visible = false;
    this.route = null;
    this.dest = null;
    this.hud.mission(null);
    const mins = (this.time - m.start) / 60;
    let reward = 0;
    if (ok) {
      reward = m.type === 'test' ? 2000 : Math.round(250 + 400 / Math.max(1, mins));
      reward = Math.max(50, reward - m.violations * 150);
      this.profile.balance += reward;
      this.profile.stats.missions++;
      if (m.type === 'test') this.profile.stats.tests++;
      this.sessionStats.earned += reward;
      saveProfile();
    }
    this.showResults({ ok, reason, title: m.title, reward, mins, violations: m.violations });
  }

  showResults({ ok, reason, title, reward, mins, violations }) {
    const stars = ok ? Math.max(1, 3 - violations) : 0;
    const el = document.createElement('div');
    el.className = 'results';
    el.innerHTML = `
      <div class="res-card ${ok ? 'ok' : 'fail'}">
        <div class="res-badge">${icon(ok ? 'trophy' : 'warning')}</div>
        <h2>${ok ? 'Mission complete!' : 'Mission failed'}</h2>
        <p>${title}${reason ? ` — ${reason}` : ''}</p>
        <div class="res-stars">${[0, 1, 2].map((i) => `<span class="${i < stars ? 'on' : ''}">${icon('star')}</span>`).join('')}</div>
        <div class="res-grid">
          <div><small>Time</small><b>${Math.floor(mins)}:${String(Math.round((mins % 1) * 60)).padStart(2, '0')}</b></div>
          <div><small>Violations</small><b>${violations}</b></div>
          <div><small>Reward</small><b class="gold">AED ${reward.toLocaleString('en-US')}</b></div>
        </div>
        <div class="res-btns"><button class="btn" data-r="drive">Keep driving</button><button class="btn primary" data-r="again">${ok ? 'Next mission' : 'Try again'}</button></div>
      </div>`;
    this.uiRoot.appendChild(el);
    this.audio.chime();
    el.onclick = (e) => {
      const b = e.target.closest('[data-r]');
      if (!b) return;
      el.remove();
      if (b.dataset.r === 'again') this.startMode(title.includes('test') ? 'test' : 'taxi');
    };
  }

  // ---------- actions ----------
  action(a) {
    const ind = this.ind;
    switch (a) {
      case 'pause': return this.setPaused(!this.paused);
      case 'lights':
        this.lightsOn = (this.lightsOn + 1) % 3;
        this.hud.toast(['Headlights off', 'Low beam on', 'High beam on'][this.lightsOn], 'info', 1200);
        break;
      case 'indLeft':
        ind.left = !ind.left; ind.right = false; ind.since = this.time; ind.heading = this.player.heading;
        break;
      case 'indRight':
        ind.right = !ind.right; ind.left = false; ind.since = this.time; ind.heading = this.player.heading;
        break;
      case 'hazard': ind.hazard = !ind.hazard; break;
      case 'camera': {
        this.cameraMode = CAMERAS[(CAMERAS.indexOf(this.cameraMode) + 1) % CAMERAS.length];
        this.settings.camera = this.cameraMode;
        this.cinematicSpot = null;
        this.hud.toast({ chase: 'Chase camera', far: 'Far chase camera', cockpit: 'Cockpit view', hood: 'Bonnet camera', cinematic: 'Cinematic camera' }[this.cameraMode], 'info', 1000);
        break;
      }
      case 'mirrors': {
        const order = ['all', 'rear', 'off'];
        this.mirrorMode = order[(order.indexOf(this.mirrorMode) + 1) % 3];
        this.settings.mirrors = this.mirrorMode;
        this.hud.toast(`Mirrors: ${{ all: 'rear + side', rear: 'rear-view only', off: 'hidden' }[this.mirrorMode]}`, 'info', 1200);
        break;
      }
      case 'map': this.hud.toggleBigMap(); break;
      case 'radio': this.hud.togglePanel('radio-panel'); break;
      case 'ac': this.hud.togglePanel('ac-panel'); break;
      case 'zoomIn': this.hud.mapZoom = Math.min(8, this.hud.mapZoom * 1.5); break;
      case 'zoomOut': this.hud.mapZoom = Math.max(0.005, this.hud.mapZoom / 1.5); break;
      case 'recenter': this.hud.recenter(); break;
      case 'clearRoute': this.route = null; this.dest = null; break;
      case 'refuel': this.refuel(); break;
      default: break;
    }
  }

  haptic(ms) {
    if (nativeCall('vibrate', ms) === null && navigator.vibrate) navigator.vibrate(ms);
  }

  setPaused(p) {
    this.paused = p;
    document.getElementById('pause').classList.toggle('hidden', !p);
    if (p) this.renderPause();
  }

  renderPause() {
    const el = document.getElementById('pause');
    const s = this.settings;
    const seg = (key, obj) => `<div class="seg wrap" data-seg="${key}">${Object.entries(obj).map(([k, v]) => `<button data-v="${k}" class="${s[key] === k ? 'on' : ''}">${v.name}</button>`).join('')}</div>`;
    el.innerHTML = `
      <div class="pause-card">
        <div class="pause-head"><h2>Paused</h2><span class="muted">${this.sessionSummary()}</span></div>
        <label>Time of day</label>${seg('time', TIMES)}
        <label>Season & weather</label>${seg('season', SEASONS)}
        <label>Steering</label>${seg('controls', { arrows: { name: 'Arrows' }, wheel: { name: 'Steering wheel' }, tilt: { name: 'Tilt (gyroscope)' } })}
        <label class="row"><input type="checkbox" data-s="dynamicTime" ${s.dynamicTime ? 'checked' : ''}> Day/night cycle (1 min = 1 hour)</label>
        <div class="pause-btns">
          <button data-p="resume" class="btn primary">${icon('play')} Resume</button>
          <button data-p="respawn" class="btn">Reset car to road</button>
          <button data-p="quit" class="btn ghost">Quit to garage</button>
        </div>
      </div>`;
    el.onclick = (e) => {
      const sg = e.target.closest('[data-seg] [data-v]');
      if (sg) {
        const key = sg.parentElement.dataset.seg;
        s[key] = sg.dataset.v;
        if (key === 'time') this.hour = TIMES[s.time].hour;
        if (key === 'time' || key === 'season') this.applyEnvironment();
        if (key === 'controls') this.input.setMode(s.controls);
        saveProfile();
        this.renderPause();
        return;
      }
      const b = e.target.closest('[data-p]');
      if (!b) return;
      if (b.dataset.p === 'resume') this.setPaused(false);
      if (b.dataset.p === 'respawn') { this.respawn(); this.setPaused(false); }
      if (b.dataset.p === 'quit') this.exit();
    };
    el.onchange = (e) => {
      if (e.target.dataset.s === 'dynamicTime') {
        s.dynamicTime = e.target.checked;
        saveProfile();
      }
    };
  }

  sessionSummary() {
    const st = this.sessionStats;
    return `${st.km.toFixed(1)} km driven · AED ${st.earned} earned · AED ${st.fines} fines`;
  }

  respawn() {
    if (this.fuel <= 0.02) {
      this.fuel = 0.2;
      this.fuelWarned = false;
      this.profile.balance -= 200;
      this.hud.toast('Tow truck called · AED 200 · 14 L of fuel added', 'info');
    }
    this.spawnPlayer(this.player.x, this.player.z, this.player.heading);
  }

  refuel() {
    const litres = Math.round((1 - this.fuel) * 70);
    if (litres < 1) return this.hud.toast('Tank already full', 'info');
    const cost = Math.round(litres * 2.85);
    this.profile.balance -= cost;
    this.fuel = 1;
    this.hud.toast(`${icon('fuel')} Filled ${litres} L · AED ${cost}`, 'good');
    this.audio.chime();
  }

  fine(aed, points, text) {
    this.profile.balance -= aed;
    this.profile.sessionFines += aed;
    this.profile.blackPoints += points;
    this.profile.stats.fines += aed;
    this.profile.stats.finesCount++;
    this.sessionStats.fines += aed;
    this.sessionStats.violations++;
    this.hud.toast(`${icon('warning')} ${text}<br><b>Fine AED ${aed}${points ? ` · ${points} black points` : ''}</b>`, 'bad', 5000);
    this.haptic(120);
    if (this.mission) {
      this.mission.violations++;
      if (this.mission.type === 'test') this.finishMission(false, text);
    }
    saveProfile();
  }

  // ---------- main loop ----------
  update(dt) {
    this.mats.update(dt);
    if (this.paused) return;
    dt = Math.min(dt, 0.05);
    this.time += dt;
    this.frame++;
    const p = this.player;
    const input = this.input.update(dt);
    const outOfFuel = this.fuel <= 0;
    const eff = { ...input, throttle: outOfFuel ? 0 : input.throttle };

    this.streamer.update(p.x, p.z);
    if (this.terrain) this.terrain.position.set(Math.round(p.x / 100) * 100, -0.3, Math.round(p.z / 100) * 100);

    const [fx, fz] = p.forward;
    const nr = this.graph.nearest(p.x, p.z, 40, [fx, fz]);
    p.offroad = !nr || nr.dist > nr.road.width / 2 + 3;
    this.currentRoad = nr && !p.offroad ? nr.road : null;

    const x0 = p.x, z0 = p.z;
    p.update(dt, eff);

    for (const k of [1.4, -1.4]) {
      const cx = p.x + fx * k, cz = p.z + fz * k;
      const res = this.streamer.collideCircle(cx, cz, 1.05);
      if (res.hit) {
        p.x += res.x - cx;
        p.z += res.z - cz;
        const impact = p.bounce(res.nx, res.nz, 0.15);
        if (impact > 4) this.crash(impact);
      }
    }
    const hit = this.traffic.collide(p);
    if (hit) {
      const impact = p.bounce(hit.nx, hit.nz, 0.3);
      if (impact > 3) {
        this.crash(impact);
        if (impact > 6 && (!this.lastAccident || this.time - this.lastAccident > 8)) {
          this.lastAccident = this.time;
          this.fine(500, 4, 'Collision with another vehicle');
        }
      }
    }

    // traffic law
    const ap = this.lights.checkCrossing(x0, z0, p.x, p.z);
    if (ap && ap.state === 'red' && p.kmh > 8) this.fine(1000, 12, 'Jumped a red light');
    const limit = this.currentRoad ? this.currentRoad.maxspeed : 40;
    for (const ev of this.enforcement.update(dt, p, this.time)) {
      if (ev.type === 'camera') {
        this.hud.flash();
        this.audio.cameraFlash();
        this.fine(ev.fine.aed, ev.fine.points, `Speed camera: ${ev.kmh} km/h in a ${ev.limit} zone`);
      } else if (ev.type === 'toll') {
        this.profile.balance -= ev.aed;
        this.hud.toast(`${ev.name} toll gate · AED ${ev.aed} charged`, 'info');
        this.audio.beep(1600, 0.08, 'sine', 0.08);
      }
    }
    const station = this.enforcement.rest.find((r) => r.near);
    if (station && station !== this.lastStation) {
      this.lastStation = station;
      if (station.kind === 'fuel') this.hud.toast(`${station.name} · <button class="toast-btn" data-a="refuel">Fill up</button>`, 'info', 6000);
    }
    if (!station) this.lastStation = null;
    this.checkIndicators();
    if (this.night > 0.6 && this.lightsOn === 0 && p.kmh > 20) {
      this.nightNoLights += dt;
      if (this.nightNoLights > 12) {
        this.nightNoLights = -600;
        this.fine(500, 4, 'Driving at night without headlights');
      }
    }

    // distance, earnings, fuel
    const moved = Math.hypot(p.x - this.lastPos[0], p.z - this.lastPos[1]);
    this.lastPos = [p.x, p.z];
    if (moved < 20) {
      this.distAcc += moved;
      this.profile.stats.km += moved / 1000;
      this.sessionStats.km += moved / 1000;
      this.fuel -= moved * (0.000016 + input.throttle * 0.000026);
    }
    if (this.distAcc > 250) {
      this.distAcc = 0;
      this.profile.balance += 2;
      this.sessionStats.earned += 2;
    }
    if (p.kmh > this.profile.stats.topSpeed) this.profile.stats.topSpeed = Math.round(p.kmh);
    if (outOfFuel && !this.fuelWarned) {
      this.fuelWarned = true;
      this.hud.toast('Out of fuel! Coast to a fuel station or reset from the pause menu (AED 200 tow).', 'bad', 6000);
    }
    if (this.fuel < 0.12 && !this.lowFuelWarned) {
      this.lowFuelWarned = true;
      this.hud.toast('Low fuel – look for a fuel station on the map', 'warn');
    }
    if (this.settings.dynamicTime) {
      this.hour = (this.hour + dt / 60) % 24;
      if (this.frame % 150 === 0) this.applyEnvironment();
    }
    this.updateClimate(dt);
    this.lights.update(this.time);
    this.traffic.update(dt, p);
    this.updateMission();
    this.syncCar(input);
    this.env.update(dt, p);
    this.updateCamera(dt);
    this.audio.update(p, eff.throttle, { cockpit: this.cameraMode === 'cockpit', rain: this.settings.season === 'rain', acFan: this.climate.on ? (this.climate.auto ? 3 : this.climate.fan) : 0 });

    // HUD
    if (this.frame % 30 === 1) {
      const ov = this.overview;
      const place = ov ? ov.nearestPlace(p.x, p.z) : null;
      const tile = this.streamer.tiles.get(`${Math.floor(p.x / 1000)}_${Math.floor(-p.z / 1000)}`);
      const emirate = tile?.emirate || (ov ? ov.emirateAt(p.x, p.z) : '');
      this.placeLabel = [place?.name, emirate].filter(Boolean).join(' · ');
    }
    const road = this.currentRoad;
    const h = Math.floor(this.hour), mnt = Math.floor((this.hour % 1) * 60);
    const cam = this.enforcement.cameraAhead(p, 600);
    const sig = this.lights.ahead(p.x, p.z, fx, fz, 160);
    if (this.cameraMode === 'cockpit' && this.frame % 3 === 0) {
      const blink = Math.floor(performance.now() / 380) % 2 === 0;
      drawCluster(this.interior.userData, {
        kmh: p.kmh, rpm: p.rpm || 900, gear: p.gear === -1 ? 'R' : p.kmh < 1 ? 'N' : `D${p.gear}`, limit, over: p.kmh > limit + 5,
        temp: Math.round(this.climate.outside), fuel: this.fuel, lights: this.lightsOn,
        left: (this.ind.left || this.ind.hazard) && blink, right: (this.ind.right || this.ind.hazard) && blink,
      });
    }
    this.hud.update({
      player: p,
      limit,
      roadName: road ? road.name || prettyType(road.type) : '',
      roadSub: road ? `${road.ref ? road.ref + ' · ' : ''}${prettyType(road.type)} · ${road.lanes} lane${road.lanes > 1 ? 's' : ''}${road.oneway ? ' · one way' : ''}` : 'Sand – slow down',
      place: this.placeLabel,
      profile: this.profile,
      lights: this.lightsOn,
      indicators: this.ind,
      climate: this.climate,
      fuel: this.fuel,
      handbrake: input.handbrake,
      clock: `${String(h).padStart(2, '0')}:${String(mnt).padStart(2, '0')} · ${this.climate.outside}°C`,
      nav: this.route ? this.navInfo() : null,
      camWarn: cam ? { dist: cam.dist, limit: cam.cam.limit } : null,
      signalAhead: sig ? { state: sig.ap.state, dist: sig.dist } : null,
    });
    if (cam && cam.dist < 300 && !cam.cam.warned) {
      cam.cam.warned = true;
      this.audio.beep(880, 0.12, 'triangle', 0.08);
    }
    if (this.frame % 2 === 0) this.hud.drawMinimap(p, this.route);
    if (this.frame % 3 === 0) this.hud.drawBigMap(p, this.route, this.dest);
    if (this.cameraMode === 'cockpit' && this.frame % 10 === 0) this.drawCarScreen();
  }

  checkIndicators() {
    const ind = this.ind;
    const p = this.player;
    const on = ind.left || ind.right;
    if (on) {
      let turned = p.heading - ind.heading;
      turned = Math.atan2(Math.sin(turned), Math.cos(turned));
      if (Math.abs(turned) > 1.0 && Math.abs(p.steer) < 0.05) ind.left = ind.right = false;
    }
    this.turnWindow = (this.turnWindow || []).filter((t) => this.time - t[0] < 3);
    this.turnWindow.push([this.time, p.heading]);
    if (p.kmh > 12 && this.turnWindow.length > 5 && this.currentRoad && this.currentRoad.rank >= 3 && !this.currentRoad.rb) {
      let d = p.heading - this.turnWindow[0][1];
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const recentlyIndicated = on || this.time - ind.since < 6;
      if (Math.abs(d) > 1.2 && !recentlyIndicated && !ind.hazard && (!this.lastIndFine || this.time - this.lastIndFine > 20)) {
        this.lastIndFine = this.time;
        this.fine(400, 0, 'Turned without using the indicator');
      }
    }
    const blink = Math.floor(performance.now() / 400) % 2 === 0;
    const l = (ind.left || ind.hazard) && blink;
    const r = (ind.right || ind.hazard) && blink;
    this.indMats.left.emissiveIntensity = l ? 3 : 0;
    this.indMats.right.emissiveIntensity = r ? 3 : 0;
    if ((on || ind.hazard) && blink !== this.lastBlink) this.audio.tick(blink);
    this.lastBlink = blink;
  }

  updateClimate(dt) {
    const c = this.climate;
    const fan = c.on ? (c.auto ? Math.min(7, 1 + Math.abs(c.cabin - c.target) / 2) : c.fan) : 0;
    const coolRate = c.on ? fan * 0.06 * (c.recirc ? 1.3 : 1) : 0;
    const drift = (c.outside - c.cabin) * 0.004;
    const toward = Math.sign(c.target - c.cabin) * Math.min(Math.abs(c.target - c.cabin), coolRate * dt * 10);
    c.cabin += toward + drift * dt * 10 * (c.on ? 0.3 : 1);
  }

  crash(impact) {
    if (this.lastCrash && this.time - this.lastCrash < 0.6) return;
    this.lastCrash = this.time;
    this.audio.crash(impact);
    this.shake = Math.min(1, impact / 15);
    this.haptic(Math.min(250, impact * 18));
  }

  syncCar(input) {
    const p = this.player;
    this.car.position.set(p.x, 0, p.z);
    this.car.rotation.y = p.heading;
    this.car.rotation.z = THREE.MathUtils.lerp(this.car.rotation.z, -p.yawRate * p.speed * 0.0025, 0.1);
    this.car.rotation.x = THREE.MathUtils.lerp(this.car.rotation.x, THREE.MathUtils.clamp(-(p.accel || 0) * 0.004, -0.03, 0.03), 0.1);
    const w = this.car.userData.wheels;
    for (let i = 0; i < 4; i++) {
      if (i < 2) w[i].rotation.y = -p.steer;
      if (w[i].userData.spin) w[i].userData.spin.rotation.x = -p.wheelSpin;
    }
    const braking = p.braking || (input.brake > 0 && Math.abs(p.speed) < 0.5);
    this.car.userData.brakeMat.emissiveIntensity = braking ? 3.5 : this.lightsOn ? 0.9 : 0.25;
    this.car.userData.headMat.emissiveIntensity = this.lightsOn ? (this.lightsOn === 2 ? 5 : 3) : 0.4;
    this.reverseMat.emissiveIntensity = p.gear === -1 ? 2 : 0;
    this.headlight.intensity = this.lightsOn ? (this.lightsOn === 2 ? 1400 : 550) * (0.3 + this.night) / Math.max(0.3, this.env.exposure) : 0;
    this.headlight.distance = this.lightsOn === 2 ? 160 : 80;
    this.headlight.angle = this.lightsOn === 2 ? 0.6 : 0.5;
    this.setCockpit(this.cameraMode === 'cockpit');
    if (this.interior.visible) this.interior.userData.wheel.rotation.z = -p.steer * 5;
    if (this.cockpitOn && this.car.userData.steer) this.car.userData.steer(-p.steer * 5);
  }

  setCockpit(on) {
    if (this.cockpitOn === on) return;
    this.cockpitOn = on;
    // real-model cars have a modelled cabin: keep it and skip the generic one
    const own = !!this.car.userData.eye;
    document.getElementById('hud')?.classList.toggle('in-car', on && !own); // generic cabin shows speed + map on the dash
    document.getElementById('hud')?.classList.toggle('cockpit-view', on); // side mirrors take the minimap's place
    this.interior.visible = on && !own;
    for (const o of this.exterior) o.visible = !on || own;
  }

  drawCarScreen() {
    const c = this.screenCanvas.getContext('2d');
    c.fillStyle = '#0b1220';
    c.fillRect(0, 0, 256, 150);
    c.drawImage(this.hud.mini, 45, 80, 210, 210, 0, 0, 150, 150);
    c.fillStyle = '#ffd60a';
    c.font = 'bold 13px Arial';
    c.fillText('NAVIGATION', 158, 20);
    c.fillStyle = '#fff';
    c.font = '12px Arial';
    const road = this.currentRoad;
    wrapText(c, road ? road.name || prettyType(road.type) : 'Off road', 158, 42, 94, 14);
    c.fillStyle = '#9ecbff';
    c.fillText(this.radio.status === 'Playing' ? `♪ ${this.radio.nowPlaying.slice(0, 12)}` : 'Radio off', 158, 100);
    c.fillStyle = '#7ee0a0';
    c.fillText(`A/C ${this.climate.target.toFixed(1)}°C`, 158, 122);
    c.fillText(`${Math.round(this.player.kmh)} km/h`, 158, 140);
    this.interior.userData.screenTex.needsUpdate = true;
  }

  updateCamera(dt) {
    if (this.freezeCamera) return; // debug / photo mode
    const p = this.player;
    const cam = this.camera;
    const [fx, fz] = p.forward;
    const mode = this.cameraMode;
    const shake = this.shake || 0;
    this.shake = Math.max(0, shake - dt * 2);
    const sx = (Math.random() - 0.5) * shake * 0.3, sy = (Math.random() - 0.5) * shake * 0.3;
    this.car.updateMatrixWorld(true);
    if (mode === 'cockpit' || mode === 'hood') {
      const eye = this.car.userData.eye || this.interior.userData.eye;
      const local = mode === 'cockpit' ? eye.clone() : new THREE.Vector3(0, eye.y + 0.05, -1.2);
      const world = local.clone().applyMatrix4(this.car.matrixWorld);
      cam.position.set(world.x + sx, world.y + sy, world.z);
      cam.fov = mode === 'cockpit' ? 64 : 60;
      cam.lookAt(new THREE.Vector3(local.x, local.y - (mode === 'cockpit' ? 2.4 : 1.1), local.z - 30).applyMatrix4(this.car.matrixWorld));
    } else if (mode === 'cinematic') {
      if (!this.cinematicSpot || Math.hypot(this.cinematicSpot.x - p.x, this.cinematicSpot.z - p.z) > 70) {
        const rx = -fz, rz = fx;
        this.cinematicSpot = new THREE.Vector3(p.x + fx * 45 + rx * 9, 2.2 + Math.random() * 3, p.z + fz * 45 + rz * 9);
      }
      cam.position.lerp(this.cinematicSpot, 0.2);
      cam.fov = 45;
      cam.lookAt(p.x, 1, p.z);
    } else {
      const far = mode === 'far';
      const speedK = Math.min(1, p.kmh / 200);
      const back = (far ? 11.5 : 7.4) + speedK * 2;
      const up = (far ? 4.6 : 3.0) + speedK * 0.4;
      const target = new THREE.Vector3(p.x - fx * back, up, p.z - fz * back);
      if (!this.camInit) {
        this.camPos.copy(target);
        this.camInit = true;
      }
      this.camPos.lerp(target, 1 - Math.exp(-dt * 6));
      cam.position.set(this.camPos.x + sx, this.camPos.y + sy, this.camPos.z);
      cam.fov = 58 + speedK * 14;
      this.camLook.set(p.x + fx * 0.8, 1.0, p.z + fz * 0.8);
      cam.lookAt(this.camLook);
    }
    cam.updateProjectionMatrix();
  }

  renderMirrors() {
    const mode = this.mirrorMode;
    const inCar = this.cameraMode === 'cockpit' || this.cameraMode === 'hood';
    const visible = (m) => mode !== 'off' && inCar && (m.key === 'rear' || mode === 'all');
    const renderer = this.renderer;
    let any = false;
    for (const m of this.mirrors) {
      const v = visible(m);
      m.mesh.visible = v;
      m.frame.style.display = v ? 'block' : 'none';
      if (!v) continue;
      any = true;
      if (this.frame % this.q.mirrorEvery !== 0) continue;
      m.cam.position.copy(m.pos.clone().applyMatrix4(this.car.matrixWorld));
      m.cam.rotation.set(-0.04, this.player.heading + Math.PI + m.yaw, 0);
      const cockpit = this.cockpitOn;
      if (cockpit) this.setCockpit(false);
      if (m.key === 'rear') this.car.visible = false;
      renderer.setRenderTarget(m.rt);
      renderer.render(this.scene, m.cam);
      this.car.visible = true;
      if (cockpit) this.setCockpit(true);
    }
    renderer.setRenderTarget(null);
    return any;
  }

  /** Keep the frame rate smooth by trading resolution (Auto resolution only). */
  adaptResolution(dt) {
    if (this.settings.resolution !== 'auto') return;
    const pf = this.perf;
    pf.acc += dt;
    pf.frames++;
    if (pf.acc < 1) return;
    const fps = pf.frames / pf.acc;
    pf.acc = 0;
    pf.frames = 0;
    if (fps < 26) pf.slow++;
    else pf.slow = 0;
    if (fps > 50) pf.fast++;
    else pf.fast = 0;
    const base = this.basePixelRatio || (this.basePixelRatio = this.renderer.getPixelRatio());
    let changed = false;
    if (pf.slow >= 3 && pf.scale > 0.55) {
      pf.scale = Math.max(0.55, pf.scale - 0.1);
      pf.slow = 0;
      changed = true;
    } else if (pf.fast >= 6 && pf.scale < 1) {
      pf.scale = Math.min(1, pf.scale + 0.1);
      pf.fast = 0;
      changed = true;
    }
    if (changed) {
      this.renderer.setPixelRatio(base * pf.scale);
      this.resize();
    }
  }

  render(dt = 0.016) {
    this.adaptResolution(dt);
    if (this.probe) this.probe.update(this.player, [this.car]);
    const any = this.renderMirrors();
    if (this.post) {
      const season = this.settings.season;
      const hotDay = season === 'summer' && this.hour > 9.5 && this.hour < 17 ? 1 : season === 'sandstorm' ? 0.5 : 0;
      this.post.update(this.time, {
        speed: Math.max(0, Math.min(1, (this.player.kmh - 110) / 170)) * (this.cameraMode === 'cockpit' ? 0.5 : 1),
        haze: hotDay,
        cinematic: this.cameraMode === 'cinematic',
      });
      this.post.render();
    } else this.renderer.render(this.scene, this.camera);
    if (any) {
      const ac = this.renderer.autoClear;
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.overlay, this.overlayCam);
      this.renderer.autoClear = ac;
    }
  }

  exit() {
    this.profile.fuel = Math.max(0.05, this.fuel);
    this.profile.lastPosition = { X: this.player.x, Z: this.player.z, heading: this.player.heading };
    saveProfile();
    this.dispose();
    this.onExit && this.onExit(this.sessionStats);
  }

  dispose() {
    window.removeEventListener('resize', this.onResize);
    this.input.destroy();
    this.audio.horn(false);
    this.uiRoot.innerHTML = '';
    for (const m of this.mirrors) m.rt.dispose();
    if (this.probe) this.probe.dispose();
    this.streamer.dispose();
    if (this.post) this.post.dispose();
    // car / prop geometries are cached and shared between sessions; tiles free their own
  }
}

function wrapText(ctx, text, x, y, maxW, lh) {
  const words = text.split(' ');
  let line = '';
  for (const w of words) {
    if (ctx.measureText(line + w).width > maxW && line) {
      ctx.fillText(line, x, y);
      y += lh;
      line = '';
    }
    line += w + ' ';
  }
  ctx.fillText(line, x, y);
}
