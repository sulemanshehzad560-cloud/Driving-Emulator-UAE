// Cinematic post-processing written in GLSL (runs on the phone GPU through
// WebGL 2 / OpenGL ES 3 – on most modern Android devices the WebView
// translates this to Vulkan via ANGLE).
//
// Pipeline (quality dependent):
//   scene (4x MSAA, HDR half-float) -> GTAO ambient occlusion (Ultra)
//   -> bloom (High+) -> ACES tone map + sRGB (OutputPass)
//   -> CinematicShader: gentle edge speed blur,
//      filmic colour grade, vignette, film grain, rain/dust lens tint.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';

export const CinematicShader = {
  name: 'CinematicShader',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uSpeed: { value: 0 }, // 0..1 motion blur amount
    uVignette: { value: 0.35 },
    uGrain: { value: 0.012 },
    uLift: { value: new THREE.Vector3(0.0, 0.0, 0.01) },
    uGamma: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
    uGain: { value: new THREE.Vector3(1.04, 1.0, 0.95) },
    uSaturation: { value: 1.08 },
    uContrast: { value: 1.06 },
    uTint: { value: new THREE.Vector3(1, 1, 1) },
    uTintAmount: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uTime, uSpeed, uVignette, uGrain;
    uniform float uSaturation, uContrast, uTintAmount;
    uniform vec2 uResolution;
    uniform vec3 uLift, uGamma, uGain, uTint;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    void main() {
      vec2 uv = vUv;
      vec2 fromCentre = uv - 0.5;
      float dist = length(fromCentre);

      // 1. gentle speed blur, only towards the screen edges and only at high speed
      vec3 col = texture2D(tDiffuse, uv).rgb;
      if (uSpeed > 0.01) {
        vec2 dir = fromCentre * uSpeed * 0.02 * smoothstep(0.3, 0.6, dist);
        float wsum = 1.0;
        for (int i = 1; i < 4; i++) {
          float t = float(i) / 3.0;
          float w = 1.0 - t * 0.7;
          col += texture2D(tDiffuse, uv - dir * t).rgb * w;
          wsum += w;
        }
        col /= wsum;
      }

      // 2. filmic grade (lift / gamma / gain, contrast, saturation)
      col = pow(max(col * uGain + uLift * (1.0 - col), 0.0), 1.0 / uGamma);
      col = (col - 0.5) * uContrast + 0.5;
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, uSaturation);
      col = mix(col, col * uTint, uTintAmount);

      // 3. vignette + film grain
      col *= 1.0 - uVignette * smoothstep(0.35, 0.85, dist);
      float g = hash(uv * uResolution + fract(uTime * 13.7) * 100.0) - 0.5;
      col += g * uGrain;

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      bvec4 bad = bvec4(c.r != c.r || c.r > 6.0e4, c.g != c.g || c.g > 6.0e4, c.b != c.b || c.b > 6.0e4, c.a != c.a);
      if (any(bad)) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = vec4(min(c.rgb, vec3(512.0)), c.a);
    }`,
};

/** Colour grades for the time of day / weather (applied after tone mapping). */
export function gradeFor({ night, sunsetAmount, season }) {
  const g = {
    lift: [0, 0, 0.01], gamma: [1, 1, 1], gain: [1.04, 1.0, 0.95], sat: 1.08, contrast: 1.06, tint: [1, 1, 1], tintAmount: 0,
  };
  if (season === 'sandstorm') Object.assign(g, { gain: [1.12, 0.98, 0.82], sat: 0.85, tint: [1.1, 0.92, 0.72], tintAmount: 0.35, contrast: 0.96 });
  if (season === 'rain') Object.assign(g, { gain: [0.96, 1.0, 1.06], lift: [0, 0.01, 0.03], sat: 0.85, contrast: 1.1 });
  if (season === 'fog') Object.assign(g, { sat: 0.8, contrast: 0.92, lift: [0.03, 0.03, 0.035] });
  if (season === 'winter') Object.assign(g, { gain: [1.0, 1.01, 1.04], sat: 1.12 });
  if (sunsetAmount > 0) {
    g.gain = g.gain.map((v, i) => v * [1 + sunsetAmount * 0.12, 1 - sunsetAmount * 0.02, 1 - sunsetAmount * 0.12][i]);
    g.sat += sunsetAmount * 0.1;
  }
  if (night > 0) {
    g.lift = g.lift.map((v, i) => v + night * [0.0, 0.01, 0.035][i]);
    g.gain = g.gain.map((v, i) => v * [1 - night * 0.05, 1, 1 + night * 0.06][i]);
    g.sat -= night * 0.15;
  }
  return g;
}

export class CinematicPipeline {
  constructor(renderer, scene, camera, quality) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    // HDR scene buffer with 4x MSAA (WebGL 2) keeps edges clean without FXAA blur
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: quality.msaa || 0,
    });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    if (quality.ao) {
      try {
        this.gtao = new GTAOPass(scene, camera, size.x, size.y);
        this.gtao.output = GTAOPass.OUTPUT.Default;
        this.gtao.blendIntensity = 0.85;
        this.gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.2, thickness: 1.2, scale: 1 });
        this.composer.addPass(this.gtao);
      } catch (e) {
        this.gtao = null;
      }
    }
    // guard: a single NaN/Inf pixel (degenerate normals in a detailed model, half-float
    // overflow on a hot emissive) would otherwise be smeared over the frame by bloom
    if (quality.bloom) {
      this.composer.addPass(new ShaderPass(SanitizeShader));
      // HDR scene: only genuinely bright things (lamps, sun glints) should bloom
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.18, 0.35, 2.5);
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(CinematicShader);
    this.composer.addPass(this.grade);
  }

  setSize(w, h) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.grade.uniforms.uResolution.value.copy(size);
  }

  setGrade(g) {
    const u = this.grade.uniforms;
    u.uLift.value.set(...g.lift);
    u.uGamma.value.set(...g.gamma);
    u.uGain.value.set(...g.gain);
    u.uSaturation.value = g.sat;
    u.uContrast.value = g.contrast;
    u.uTint.value.set(...g.tint);
    u.uTintAmount.value = g.tintAmount;
  }

  update(time, { speed = 0, cinematic = false } = {}) {
    const u = this.grade.uniforms;
    u.uTime.value = time;
    u.uSpeed.value += (speed - u.uSpeed.value) * 0.1;
    u.uVignette.value = cinematic ? 0.45 : 0.2;
  }

  render() {
    this.composer.render();
  }

  dispose() {
    this.composer.renderTarget1.dispose();
    this.composer.renderTarget2.dispose();
    if (this.gtao) this.gtao.dispose();
  }
}
