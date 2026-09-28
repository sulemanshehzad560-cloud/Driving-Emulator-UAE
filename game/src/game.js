// A driving session: builds the world for a map, runs physics, AI traffic,
// traffic-law enforcement, cameras (incl. live mirrors), HUD and missions.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoadGraph } from './world/roadGraph.js';
import { World } from './world/worldBuilder.js';
import { Signals } from './world/signals.js';
import { Enforcement } from './world/enforcement.js';
import { Environment, QUALITY, TIMES, SEASONS } from './render/env.js';
import { buildCar, styleDims } from './cars/carFactory.js';
import { buildInterior } from './cars/interior.js';
import { carById } from './cars/catalog.js';
import { Vehicle } from './sim/vehicle.js';
import { Traffic } from './sim/traffic.js';
import { Input } from './sim/input.js';
import { Hud } from './hud/hud.js';
import { saveProfile } from './storage.js';

const CAMERAS = ['chase', 'far', 'cockpit', 'hood', 'cinematic'];
const OUTSIDE_TEMP = { summer: [44, 35], winter: [25, 16], rain: [19, 15], sandstorm: [39, 31], fog: [23, 19] };

export class Game {
  constructor({ renderer, map, profile, qualityKey, audio, radio, mode = 'free', onExit }) {
    this.renderer = renderer;
    this.profile = profile;
    this.settings = profile.settings;
    this.q = QUALITY[qualityKey] || QUALITY.medium;
    this.qualityKey = qualityKey;
    this.audio = audio;
    this.radio = radio;
    this.mode = mode;
    this.onExit = onExit;
    this.paused = false;
    this.time = 0;
    this.frame = 0;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, this.q.far + 400);
    this.env = new Environment(this.scene, renderer, this.q);

    this.graph = new RoadGraph(map);
    this.world = new World(this.graph, this.q);
    this.scene.add(this.world.group);
    this.signals = new Signals(this.graph, this.world);
    this.scene.add(this.signals.group);
    this.enforcement = new Enforcement(this.graph, this.world);
    this.scene.add(this.enforcement.group);

    // player car
    this.spec = carById(profile.selected);
    const paint = profile.paints[this.spec.id] ?? this.spec.paints[0];
    this.car = buildCar({ style: this.spec.style, color: paint, detail: true, quality: qualityKey === 'low' ? 'low' : 'high' });
    this.scene.add(this.car);
    this.player = new Vehicle(this.spec);
    this.addLights();
    this.spawnPlayer();

    const density = this.settings.trafficDensity ?? 1;
    this.traffic = new Traffic(this.graph, this.signals, this.scene, Math.round(this.q.traffic * density));

    // UI
    this.uiRoot = document.getElementById('game-ui');
    this.uiRoot.innerHTML = '<div id="hud"></div><div id="controls"></div><div id="mirror-frames"></div><div id="pause" class="hidden"></div>';
    this.hud = new Hud(document.getElementById('hud'), this);
    this.hud.prepareMap(this.graph, this.enforcement);
    this.input = new Input(document.getElementById('controls'), this.settings.controls, this.settings.sensitivity);
    for (const a of ['lights', 'indLeft', 'indRight', 'hazard', 'camera', 'map', 'radio', 'pause']) this.input.actions[a] = () => this.action(a);
    this.input.actions.horn = () => {
      this.audio.horn(true);
      setTimeout(() => this.audio.horn(false), 400);
    };

    // interior with live map on the centre screen
    this.screenCanvas = document.createElement('canvas');
    this.screenCanvas.width = 256;
    this.screenCanvas.height = 150;
    this.interior = buildInterior(this.spec.style, this.screenCanvas);
    this.car.add(this.interior);

    this.setupMirrors();
    this.setupPost();

    // state
    this.lights = 0; // 0 off, 1 low, 2 high
    this.ind = { left: false, right: false, hazard: false, since: 0, heading: 0 };
    this.cameraMode = this.settings.camera || 'chase';
    this.mirrorMode = this.settings.mirrors || 'all';
    const season = this.settings.season;
    const temps = OUTSIDE_TEMP[season] || OUTSIDE_TEMP.summer;
    this.climate = { on: true, auto: true, fan: 3, target: 22, recirc: false, cabin: temps[0] + 6, outside: temps[0] };
    this.fuel = profile.fuel ?? 0.8;
    this.sessionEarned = 0;
    this.profile.sessionFines = 0;
    this.lastPos = [this.player.x, this.player.z];
    this.distAcc = 0;
    this.nightNoLights = 0;
    this.hour = TIMES[this.settings.time]?.hour ?? 12.5;
    this.applyEnvironment();
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.cinematicSpot = null;
    this.route = null;
    this.dest = null;
    this.mission = null;
    this.startMode(mode);
    this.hud.toast(`Welcome to <b>${map.name}</b>${map.source === 'osm' ? ' · map data © OpenStreetMap contributors' : ''}`, 'info', 4500);
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
    this.resize();
    this.renderPause();
  }

  // ---------- setup ----------
  addLights() {
    const st = styleDims(this.spec.style);
    this.headlight = new THREE.SpotLight(0xfff4e0, 0, 70, 0.5, 0.45, 1.2);
    this.headlight.position.set(0, 0.8, -st.L / 2);
    this.headlight.target.position.set(0, 0, -st.L / 2 - 25);
    this.car.add(this.headlight, this.headlight.target);
    // indicator lamps at the four corners
    const amber = () => new THREE.MeshStandardMaterial({ color: 0x663300, emissive: 0xff9500, emissiveIntensity: 0 });
    this.indMats = { left: amber(), right: amber() };
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.1), sx < 0 ? this.indMats.left : this.indMats.right);
      m.position.set(sx * (st.W / 2 - 0.08), 0.62, sz * (st.L / 2 - 0.02));
      this.car.add(m);
    }
    // reverse lights
    this.reverseMat = new THREE.MeshStandardMaterial({ color: 0x999999, emissive: 0xffffff, emissiveIntensity: 0 });
    for (const sx of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.06), this.reverseMat);
      m.position.set(sx * 0.5, 0.5, st.L / 2 - 0.01);
      this.car.add(m);
    }
  }

  spawnPlayer() {
    const g = this.graph;
    // start on a big road near the centre
    let best = null, bd = Infinity;
    for (const e of g.edges) {
      if (e.len < 40 || e.road.rank < 5) continue;
      const a = g.pts[e.a];
      const d = Math.hypot(a[0], a[1]) - e.road.rank * 40;
      if (d < bd) { bd = d; best = e; }
    }
    if (!best) best = g.edges.reduce((m, e) => (e.len > (m?.len || 0) ? e : m), null);
    if (!best) {
      this.player.place(0, 0, 0);
      return;
    }
    const a = g.pts[best.a];
    const road = best.road;
    const off = road.oneway ? road.width / 2 - 1.9 : road.width / 4;
    const x = a[0] + best.dx * 12 - best.dz * off;
    const z = a[1] + best.dz * 12 + best.dx * off;
    this.player.place(x, z, Math.atan2(-best.dx, -best.dz));
    this.spawnPoint = [x, z, this.player.heading];
  }

  setupMirrors() {
    const scale = this.q.mirrorScale;
    const mk = (w, h) => new THREE.WebGLRenderTarget(Math.round(w * scale), Math.round(h * scale), { samples: 0 });
    const st = styleDims(this.spec.style);
    const eye = this.interior.userData.eye;
    this.mirrors = [
      { key: 'rear', rt: mk(512, 160), cam: new THREE.PerspectiveCamera(38, 512 / 160, 0.3, 600), pos: new THREE.Vector3(0, eye.y + 0.15, 0.3), yaw: 0, rect: [0.36, 0.02, 0.28, 0.1] },
      { key: 'left', rt: mk(300, 200), cam: new THREE.PerspectiveCamera(42, 1.5, 0.3, 500), pos: new THREE.Vector3(-st.W / 2 - 0.15, eye.y - 0.1, -0.7), yaw: -0.18, rect: [0.01, 0.34, 0.17, 0.16] },
      { key: 'right', rt: mk(300, 200), cam: new THREE.PerspectiveCamera(42, 1.5, 0.3, 500), pos: new THREE.Vector3(st.W / 2 + 0.15, eye.y - 0.1, -0.7), yaw: 0.18, rect: [0.82, 0.34, 0.17, 0.16] },
    ];
    // overlay scene draws the mirror images (flipped horizontally like real mirrors)
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
    this.composer = null;
    if (!this.q.bloom) return;
    try {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.5, 0.92);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    } catch (e) {
      this.composer = null;
    }
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
  }

  applyEnvironment() {
    const { night, wet } = this.env.set(this.hour, this.settings.season);
    this.night = night;
    this.wet = wet;
    this.world.setNight(night);
    if (this.bloom) this.bloom.strength = 0.25 + night * 0.6;
    const temps = OUTSIDE_TEMP[this.settings.season] || OUTSIDE_TEMP.summer;
    const dayF = Math.max(0, Math.sin(((this.hour - 6) / 12) * Math.PI));
    if (this.climate) this.climate.outside = Math.round(temps[1] + (temps[0] - temps[1]) * dayF);
    if (night > 0.5 && this.lights === 0 && this.frame === 0) this.lights = 1;
  }

  // ---------- modes & missions ----------
  startMode(mode) {
    this.mission = null;
    if (mode === 'free') {
      this.hud.mission(null);
      return;
    }
    const g = this.graph;
    const nodes = [...g.out.keys()].filter((n) => {
      const p = g.pts[n];
      return (g.out.get(n) || []).some((e) => e.road.rank >= 3);
    });
    const pick = (fromX, fromZ, min, max) => {
      for (let i = 0; i < 400; i++) {
        const n = nodes[Math.floor(Math.random() * nodes.length)];
        const p = g.pts[n];
        const d = Math.hypot(p[0] - fromX, p[1] - fromZ);
        if (d > min && d < max) return n;
      }
      return nodes[Math.floor(Math.random() * nodes.length)];
    };
    const px = this.player.x, pz = this.player.z;
    if (mode === 'taxi') {
      const a = pick(px, pz, 150, 500);
      const b = pick(g.pts[a][0], g.pts[a][1], 600, 1600);
      this.mission = { type: 'taxi', title: 'Chauffeur run', stops: [a, b], labels: ['Pick up VIP passenger', 'Drop off passenger'], idx: 0, start: this.time, violations: 0, needStop: true };
    } else if (mode === 'test') {
      const pts = [];
      let cx = px, cz = pz;
      for (let i = 0; i < 4; i++) {
        const n = pick(cx, cz, 200, 450);
        pts.push(n);
        [cx, cz] = g.pts[n];
      }
      this.mission = { type: 'test', title: 'RTA-style driving test', stops: pts, labels: pts.map((_, i) => `Checkpoint ${i + 1} of ${pts.length}`), idx: 0, start: this.time, violations: 0, needStop: false };
      this.hud.toast('Driving test: obey every limit and light. <b>Any violation fails the test.</b>', 'warn', 6000);
    }
    this.makeMarker();
    this.routeTo(this.mission.stops[0]);
  }

  makeMarker() {
    if (!this.marker) {
      const geo = new THREE.CylinderGeometry(4, 4, 30, 24, 1, true);
      const mat = new THREE.MeshBasicMaterial({ color: 0x3aa0ff, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false });
      this.marker = new THREE.Mesh(geo, mat);
      this.marker.position.y = 15;
      this.scene.add(this.marker);
    }
    const n = this.mission.stops[this.mission.idx];
    const p = this.graph.pts[n];
    this.marker.position.set(p[0], 15, p[1]);
    this.marker.visible = true;
  }

  routeTo(node) {
    const g = this.graph;
    const from = g.nearestNode(this.player.x, this.player.z);
    const path = g.route(from, node);
    this.route = path ? path.map((n) => g.pts[n]) : null;
    this.dest = g.pts[node];
    this.destNode = node;
  }

  setDestination(x, z) {
    const n = this.graph.nearestNode(x, z);
    if (n < 0) return;
    this.routeTo(n);
    if (!this.route) {
      this.hud.toast('No route found to that point', 'warn');
      return;
    }
    let len = 0;
    for (let i = 1; i < this.route.length; i++) len += Math.hypot(this.route[i][0] - this.route[i - 1][0], this.route[i][1] - this.route[i - 1][1]);
    this.hud.toast(`GPS route set · ${(len / 1000).toFixed(1)} km`, 'good');
    this.audio.chime();
  }

  updateMission() {
    const m = this.mission;
    if (!m) {
      if (this.dest) {
        const d = Math.hypot(this.dest[0] - this.player.x, this.dest[1] - this.player.z);
        this.hud.mission('GPS destination', `${d > 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m'}`);
        if (d < 15) {
          this.hud.toast('You have arrived at your destination', 'good');
          this.audio.chime();
          this.dest = null;
          this.route = null;
          this.hud.mission(null);
        }
      }
      return;
    }
    const p = this.graph.pts[m.stops[m.idx]];
    const d = Math.hypot(p[0] - this.player.x, p[1] - this.player.z);
    this.hud.mission(`${m.title}: ${m.labels[m.idx]}`, `${d > 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m'}${m.needStop && d < 40 ? ' · stop in the zone' : ''}`);
    this.marker.material.opacity = 0.18 + Math.sin(this.time * 4) * 0.08;
    if (d < 9 && (!m.needStop || this.player.kmh < 5)) {
      this.audio.chime();
      m.idx++;
      if (m.idx >= m.stops.length) return this.finishMission(true);
      this.hud.toast(`✔ ${m.labels[m.idx - 1]} done`, 'good');
      this.makeMarker();
      this.routeTo(m.stops[m.idx]);
    }
    // re-route occasionally if we drift off the route
    if (this.frame % 180 === 0) this.routeTo(m.stops[m.idx]);
  }

  finishMission(ok, reason) {
    const m = this.mission;
    this.mission = null;
    this.marker.visible = false;
    this.route = null;
    this.dest = null;
    this.hud.mission(null);
    if (!ok) {
      this.hud.toast(`✖ ${m.title} failed${reason ? ': ' + reason : ''}`, 'bad', 6000);
      return;
    }
    const mins = (this.time - m.start) / 60;
    let reward = m.type === 'test' ? 2000 : Math.round(250 + 400 / Math.max(1, mins));
    reward = Math.max(50, reward - m.violations * 150);
    this.profile.balance += reward;
    this.profile.stats.missions++;
    if (m.type === 'test') this.profile.stats.tests++;
    saveProfile();
    this.hud.toast(`🏆 ${m.title} complete! +AED ${reward}`, 'good', 6000);
  }

  // ---------- actions from HUD / keyboard ----------
  action(a) {
    const ind = this.ind;
    switch (a) {
      case 'pause': return this.setPaused(!this.paused);
      case 'lights':
        this.lights = (this.lights + 1) % 3;
        this.hud.toast(['Headlights off', 'Low beam on', 'High beam on'][this.lights], 'info', 1200);
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
      case 'zoomIn': this.hud.mapZoom = Math.min(8, this.hud.mapZoom * 1.4); break;
      case 'zoomOut': this.hud.mapZoom = Math.max(0.3, this.hud.mapZoom / 1.4); break;
      case 'clearRoute': this.route = null; this.dest = null; this.hud.mission(null); break;
      case 'refuel': this.refuel(); break;
      default: break;
    }
  }

  setPaused(p) {
    this.paused = p;
    document.getElementById('pause').classList.toggle('hidden', !p);
    if (p) this.renderPause();
  }

  renderPause() {
    const el = document.getElementById('pause');
    const s = this.settings;
    const opt = (obj, cur) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${v.name}</option>`).join('');
    el.innerHTML = `
      <div class="pause-card">
        <h2>Paused</h2>
        <label>Time of day<select data-s="time">${opt(TIMES, s.time)}</select></label>
        <label>Season / weather<select data-s="season">${opt(SEASONS, s.season)}</select></label>
        <label>Steering<select data-s="controls">
          <option value="arrows" ${s.controls === 'arrows' ? 'selected' : ''}>Arrow buttons</option>
          <option value="wheel" ${s.controls === 'wheel' ? 'selected' : ''}>Steering wheel</option>
          <option value="tilt" ${s.controls === 'tilt' ? 'selected' : ''}>Gyroscope (tilt phone)</option></select></label>
        <label class="row"><input type="checkbox" data-s="dynamicTime" ${s.dynamicTime ? 'checked' : ''}> Day/night cycle (1 min = 1 hour)</label>
        <div class="pause-btns">
          <button data-p="resume" class="primary">Resume</button>
          <button data-p="respawn">Reset car to road</button>
          <button data-p="quit">Quit to garage</button>
        </div>
      </div>`;
    el.onchange = (e) => {
      const k = e.target.dataset.s;
      if (!k) return;
      s[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      if (k === 'time') this.hour = TIMES[s.time].hour;
      if (k === 'time' || k === 'season') this.applyEnvironment();
      if (k === 'controls') this.input.setMode(s.controls);
      saveProfile();
    };
    el.onclick = (e) => {
      const b = e.target.closest('[data-p]');
      if (!b) return;
      if (b.dataset.p === 'resume') this.setPaused(false);
      if (b.dataset.p === 'respawn') { this.respawn(); this.setPaused(false); }
      if (b.dataset.p === 'quit') this.exit();
    };
  }

  respawn() {
    if (this.fuel <= 0.02) {
      this.fuel = 0.2;
      this.fuelWarned = false;
      this.profile.balance -= 200;
      this.hud.toast('🚚 Tow truck called · AED 200 · 14 L of fuel added', 'info');
    }
    const nr = this.graph.nearest(this.player.x, this.player.z, 200);
    if (nr) {
      const l = Math.hypot(nr.dx, nr.dz) || 1;
      this.player.place(nr.px, nr.pz, Math.atan2(-nr.dx / l, -nr.dz / l));
    } else if (this.spawnPoint) this.player.place(...this.spawnPoint);
  }

  refuel() {
    const litres = Math.round((1 - this.fuel) * 70);
    if (litres < 1) return this.hud.toast('Tank already full', 'info');
    const cost = Math.round(litres * 2.85);
    this.profile.balance -= cost;
    this.fuel = 1;
    this.hud.toast(`⛽ Filled ${litres} L · AED ${cost}`, 'good');
    this.audio.chime();
  }

  fine(aed, points, text) {
    this.profile.balance -= aed;
    this.profile.sessionFines += aed;
    this.profile.blackPoints += points;
    this.profile.stats.fines += aed;
    this.profile.stats.finesCount++;
    this.hud.toast(`🚨 ${text}<br><b>Fine AED ${aed}${points ? ` · ${points} black points` : ''}</b>`, 'bad', 5000);
    if (this.mission) {
      this.mission.violations++;
      if (this.mission.type === 'test') this.finishMission(false, text);
    }
    saveProfile();
  }

  // ---------- main loop ----------
  update(dt) {
    if (this.paused) return;
    dt = Math.min(dt, 0.05);
    this.time += dt;
    this.frame++;
    const p = this.player;
    const input = this.input.update(dt);
    const outOfFuel = this.fuel <= 0;
    const eff = { ...input, throttle: outOfFuel ? 0 : input.throttle };

    // which road are we on?
    const [fx, fz] = p.forward;
    const nr = this.graph.nearest(p.x, p.z, 40, [fx, fz]);
    p.offroad = !nr || nr.dist > nr.road.width / 2 + 3;
    this.currentRoad = nr && !p.offroad ? nr.road : null;

    const x0 = p.x, z0 = p.z;
    p.update(dt, eff);

    // collisions with buildings (two circles along the car)
    for (const k of [1.4, -1.4]) {
      const cx = p.x + fx * k, cz = p.z + fz * k;
      const res = this.world.collideCircle(cx, cz, 1.05);
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
    // keep inside the loaded map
    const R = (this.graph.map.radius || 1500) * 1.02;
    const dc = Math.hypot(p.x, p.z);
    if (dc > R) {
      p.x *= R / dc;
      p.z *= R / dc;
      p.bounce(-p.x / dc, -p.z / dc, 0.1);
      if (!this.edgeWarned || this.time - this.edgeWarned > 6) {
        this.edgeWarned = this.time;
        this.hud.toast('Edge of the loaded area – load another area from the Map menu', 'warn');
      }
    }

    // traffic laws
    const ap = this.signals.checkCrossing(x0, z0, p.x, p.z);
    if (ap && ap.state === 'red' && p.kmh > 8) this.fine(1000, 12, 'Jumped a red light');
    const limit = this.currentRoad ? this.currentRoad.maxspeed : 40;
    for (const ev of this.enforcement.update(dt, p, limit, this.time)) {
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
      else this.hud.toast(`${station.name} – rest area`, 'info');
    }
    if (!station) this.lastStation = null;
    this.checkIndicators(dt);
    if (this.night > 0.6 && this.lights === 0 && p.kmh > 20) {
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
      this.fuel -= moved * (0.00002 + input.throttle * 0.00003);
    }
    if (this.distAcc > 250) {
      this.distAcc = 0;
      this.profile.balance += 2; // AED 8 per km of driving
    }
    if (p.kmh > this.profile.stats.topSpeed) this.profile.stats.topSpeed = Math.round(p.kmh);
    if (outOfFuel && !this.fuelWarned) {
      this.fuelWarned = true;
      this.hud.toast('⛽ Out of fuel! Coast to a fuel station or reset from the pause menu (AED 200 tow).', 'bad', 6000);
    }
    if (this.fuel < 0.12 && !this.lowFuelWarned) {
      this.lowFuelWarned = true;
      this.hud.toast('Low fuel – look for a green fuel icon on the map', 'warn');
    }

    if (this.settings.dynamicTime) {
      this.hour = (this.hour + dt / 60) % 24;
      if (this.frame % 120 === 0) this.applyEnvironment();
    }
    this.updateClimate(dt);
    this.signals.update(this.time);
    this.traffic.update(dt, p, this.time);
    this.updateMission();
    this.syncCar(dt, input);
    this.env.update(dt, p);
    this.updateCamera(dt);
    this.audio.update(p, eff.throttle, { cockpit: this.cameraMode === 'cockpit', rain: this.settings.season === 'rain', acFan: this.climate.on ? (this.climate.auto ? 3 : this.climate.fan) : 0 });

    // HUD
    const road = this.currentRoad;
    const h = Math.floor(this.hour), mnt = Math.floor((this.hour % 1) * 60);
    this.hud.update({
      player: p,
      limit,
      roadName: road ? road.name || prettyType(road.type) : '',
      roadSub: road ? `${prettyType(road.type)} · ${road.lanes} lane${road.lanes > 1 ? 's' : ''}${road.oneway ? ' · one way' : ''}` : 'Sand – slow down',
      profile: this.profile,
      lights: this.lights,
      indicators: this.ind,
      climate: this.climate,
      fuel: this.fuel,
      handbrake: input.handbrake,
      clock: `${String(h).padStart(2, '0')}:${String(mnt).padStart(2, '0')} · ${this.climate.outside}°C`,
    });
    if (this.frame % 2 === 0) this.hud.drawMinimap(p, this.route);
    if (this.frame % 3 === 0) this.hud.drawBigMap(p, this.route, this.dest);
    if (this.cameraMode === 'cockpit' && this.frame % 10 === 0) this.drawCarScreen();
  }

  checkIndicators(dt) {
    const ind = this.ind;
    const p = this.player;
    const on = ind.left || ind.right;
    // cancel automatically once a turn is complete (like a real stalk)
    if (on) {
      let turned = p.heading - ind.heading;
      turned = Math.atan2(Math.sin(turned), Math.cos(turned));
      if (Math.abs(turned) > 1.0 && Math.abs(p.steer) < 0.08) {
        ind.left = ind.right = false;
      }
    }
    // failure to indicate: a sharp turn at speed without indicators
    this.turnWindow = (this.turnWindow || []).filter((t) => this.time - t[0] < 3);
    this.turnWindow.push([this.time, p.heading]);
    if (p.kmh > 12 && this.turnWindow.length > 5) {
      let d = p.heading - this.turnWindow[0][1];
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const recentlyIndicated = on || this.time - ind.since < 6;
      if (Math.abs(d) > 1.2 && !recentlyIndicated && !ind.hazard && (!this.lastIndFine || this.time - this.lastIndFine > 20) && this.currentRoad) {
        this.lastIndFine = this.time;
        this.fine(400, 0, 'Turned without using the indicator');
      }
    }
    // blink + tick sound
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
    const drift = (c.outside - c.cabin) * 0.004; // heat soak from outside
    const toward = Math.sign(c.target - c.cabin) * Math.min(Math.abs(c.target - c.cabin), coolRate * dt * 10);
    c.cabin += toward + drift * dt * 10 * (c.on ? 0.3 : 1);
  }

  crash(impact) {
    if (this.lastCrash && this.time - this.lastCrash < 0.6) return;
    this.lastCrash = this.time;
    this.audio.crash(impact);
    this.shake = Math.min(1, impact / 15);
    if (navigator.vibrate) navigator.vibrate(Math.min(200, impact * 15));
  }

  syncCar(dt, input) {
    const p = this.player;
    this.car.position.set(p.x, 0, p.z);
    this.car.rotation.y = p.heading;
    // body roll/pitch for weight feel
    const body = this.car;
    body.rotation.z = THREE.MathUtils.lerp(body.rotation.z, -p.yawRate * p.speed * 0.0025, 0.1);
    const w = this.car.userData.wheels;
    for (let i = 0; i < 4; i++) {
      const wheel = w[i];
      if (i < 2) wheel.rotation.y = -p.steer;
      wheel.children[0].rotation.x = -p.wheelSpin;
    }
    this.car.userData.brakeMat.emissiveIntensity = p.braking || (input.brake && p.speed <= 0.5 && p.speed > -0.5) ? 3 : this.lights ? 0.8 : 0.25;
    this.car.userData.headMat.emissiveIntensity = this.lights ? (this.lights === 2 ? 4 : 2.5) : 0.4;
    this.reverseMat.emissiveIntensity = p.gear === -1 ? 2 : 0;
    this.headlight.intensity = this.lights ? (this.lights === 2 ? 900 : 350) * (0.3 + this.night) : 0;
    this.headlight.distance = this.lights === 2 ? 140 : 70;
    this.headlight.angle = this.lights === 2 ? 0.6 : 0.5;
    this.interior.visible = this.cameraMode === 'cockpit';
    const paintSide = this.interior.visible ? THREE.DoubleSide : THREE.FrontSide;
    if (this.car.userData.paint.side !== paintSide) {
      this.car.userData.paint.side = paintSide;
      this.car.userData.paint.needsUpdate = true;
    }
    if (this.interior.visible) this.interior.userData.wheel.rotation.z = -p.steer * 5;
  }

  drawCarScreen() {
    const c = this.screenCanvas.getContext('2d');
    const src = this.hud.mini;
    c.fillStyle = '#0b1220';
    c.fillRect(0, 0, 256, 150);
    c.drawImage(src, 40, 60, 180, 180, 0, 0, 150, 150);
    c.fillStyle = '#d4af37';
    c.font = 'bold 13px Arial';
    c.fillText('NAVIGATION', 158, 20);
    c.fillStyle = '#fff';
    c.font = '12px Arial';
    const road = this.currentRoad;
    wrapText(c, road ? road.name || prettyType(road.type) : 'Off road', 158, 42, 94, 14);
    c.fillStyle = '#9ecbff';
    c.fillText(this.radio.status === 'Playing' ? '♪ ' + this.radio.nowPlaying.slice(0, 12) : 'Radio off', 158, 100);
    c.fillStyle = '#7ee0a0';
    c.fillText(`A/C ${this.climate.target.toFixed(1)}°C`, 158, 122);
    c.fillText(`${Math.round(this.player.kmh)} km/h`, 158, 140);
    this.interior.userData.screenTex.needsUpdate = true;
  }

  updateCamera(dt) {
    const p = this.player;
    const cam = this.camera;
    const [fx, fz] = p.forward;
    const mode = this.cameraMode;
    const shake = this.shake || 0;
    this.shake = Math.max(0, shake - dt * 2);
    const sx = (Math.random() - 0.5) * shake * 0.3, sy = (Math.random() - 0.5) * shake * 0.3;
    if (mode === 'cockpit' || mode === 'hood') {
      const eye = this.interior.userData.eye;
      const local = mode === 'cockpit' ? eye.clone() : new THREE.Vector3(0, eye.y + 0.05, -1.2);
      const world = local.applyMatrix4(this.car.matrixWorld);
      cam.position.set(world.x + sx, world.y + sy, world.z);
      cam.fov = mode === 'cockpit' ? 68 : 60;
      const look = new THREE.Vector3(0, local.y - 0.25, -30).applyMatrix4(this.car.matrixWorld);
      cam.lookAt(look);
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
      const back = (far ? 11 : 7) + speedK * 2;
      const up = (far ? 4.2 : 2.6) + speedK * 0.4;
      const target = new THREE.Vector3(p.x - fx * back, up, p.z - fz * back);
      if (!this.camInit) {
        this.camPos.copy(target);
        this.camInit = true;
      }
      this.camPos.lerp(target, 1 - Math.exp(-dt * 6));
      cam.position.set(this.camPos.x + sx, this.camPos.y + sy, this.camPos.z);
      cam.fov = 60 + speedK * 12;
      this.camLook.set(p.x + fx * 4, 1.1, p.z + fz * 4);
      cam.lookAt(this.camLook);
    }
    cam.updateProjectionMatrix();
  }

  renderMirrors() {
    const mode = this.mirrorMode;
    const inCar = this.cameraMode === 'cockpit' || this.cameraMode === 'hood';
    const visible = (m) => mode !== 'off' && (m.key === 'rear' ? true : mode === 'all' && inCar);
    const renderer = this.renderer;
    let any = false;
    for (const m of this.mirrors) {
      const v = visible(m);
      m.mesh.visible = v;
      m.frame.style.display = v ? 'block' : 'none';
      if (!v) continue;
      any = true;
      if (this.frame % this.q.mirrorEvery !== 0) continue;
      const world = m.pos.clone().applyMatrix4(this.car.matrixWorld);
      m.cam.position.copy(world);
      m.cam.rotation.set(-0.04, this.player.heading + Math.PI + m.yaw, 0);
      const intVis = this.interior.visible;
      this.interior.visible = false;
      renderer.setRenderTarget(m.rt);
      renderer.render(this.scene, m.cam);
      this.interior.visible = intVis;
    }
    renderer.setRenderTarget(null);
    return any;
  }

  render() {
    const any = this.renderMirrors();
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
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
    saveProfile();
    this.dispose();
    this.onExit && this.onExit();
  }

  dispose() {
    window.removeEventListener('resize', this.onResize);
    this.input.destroy();
    this.audio.horn(false);
    this.uiRoot.innerHTML = '';
    for (const m of this.mirrors) m.rt.dispose();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    if (this.composer) this.composer.dispose?.();
  }
}

function prettyType(t) {
  return {
    motorway: 'Highway', trunk: 'Expressway', primary: 'Main road', secondary: 'Street', tertiary: 'Street',
    residential: 'Residential street', service: 'Service road', living_street: 'Living street', unclassified: 'Road',
  }[t] || (t.endsWith('_link') ? 'Slip road' : 'Road');
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
