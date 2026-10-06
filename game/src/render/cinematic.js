// Image pipeline.
//
// Phones (Low / Medium / High) render straight to the screen with the
// canvas' own multisample anti-aliasing: no off-screen HDR buffer, no extra
// full-screen passes. On tile-based mobile GPUs that is by far the cheapest
// way to get clean edges, and it removes every screen-space effect that used
// to smear or shimmer the picture at speed.
//
// The filmic look is applied inside every material instead: ACES tone mapping
// followed by a gentle colour grade (warm gain, a touch of saturation and
// contrast) through three.js' CustomToneMapping hook. The vignette is a CSS
// overlay, which costs nothing on the GPU.
//
// Ultra keeps an off-screen HDR pipeline for ambient occlusion and bloom
// (scene -> GTAO -> bloom -> tone map + grade), for flagship phones.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';

let installed = false;

/** ACES + colour grade as three.js' CustomToneMapping (call once, before any material compiles). */
export function installGradedToneMapping(renderer) {
  if (!installed) {
    installed = true;
    THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace(
      'vec3 CustomToneMapping( vec3 color ) { return color; }',
      `vec3 CustomToneMapping( vec3 color ) {
	vec3 c = ACESFilmicToneMapping( color );
	// grade: warm desert gain, slightly richer colour, a little more contrast
	c *= vec3( 1.03, 1.0, 0.955 );
	float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
	c = mix( vec3( l ), c, 1.1 );
	c = c * c * ( 3.0 - 2.0 * c ) * 0.18 + c * 0.82;
	return saturate( c );
}`,
    );
  }
  renderer.toneMapping = THREE.CustomToneMapping;
}

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

/** Ultra only: HDR off-screen render with ambient occlusion and bloom. */
export class CinematicPipeline {
  constructor(renderer, scene, camera, quality) {
    this.renderer = renderer;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: quality.msaa || 0 });
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
    if (quality.bloom) {
      // a single NaN/Inf pixel would otherwise be smeared over the frame by bloom
      this.composer.addPass(new ShaderPass(SanitizeShader));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.18, 0.35, 2.5);
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass()); // tone mapping + grade (CustomToneMapping) + sRGB
  }

  setSize(w, h) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
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
