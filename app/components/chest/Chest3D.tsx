"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import React, { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

type Phase = "idle" | "opening" | "reveal";

/**
 * Centers object by its bounds and auto-frames camera once.
 * IMPORTANT: do it once per model instance (avoid accumulating offsets).
 */
function FitAndCenter({ object }: { object: THREE.Object3D }) {
  const { camera } = useThree();
  const didFitRef = useRef(false);

  useEffect(() => {
    if (!object) return;
    if (didFitRef.current) return;
    didFitRef.current = true;

    // compute bounds
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    // ✅ correct centering (move by -center)
    object.position.x -= center.x;
    object.position.y -= center.y;
    object.position.z -= center.z;

    // recompute bounds after centering (optional but safe)
    const box2 = new THREE.Box3().setFromObject(object);
    const size2 = box2.getSize(new THREE.Vector3());

    // auto camera distance based on fov
    const maxDim = Math.max(size2.x, size2.y, size2.z);
    const cam = camera as THREE.PerspectiveCamera;
    const fovRad = THREE.MathUtils.degToRad(cam.fov);

    let dist = maxDim / (2 * Math.tan(fovRad / 2));
    dist *= 1.25; // padding

    cam.position.set(0, maxDim * 0.12, dist);
    cam.near = Math.max(0.01, dist / 100);
    cam.far = dist * 100;
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
  }, [object, camera]);

  return null;
}

function ChestModel({ phase }: { phase: Phase }) {
  const { scene } = useGLTF("/models/chest.glb");

  // clone so we can modify safely (bounds/position/material tweaks)
  const model = useMemo(() => scene.clone(true), [scene]);

  const groupRef = useRef<THREE.Group>(null);

  // fake lid (variant 1)
  const lidRef = useRef<THREE.Mesh>(null);
  const lidMat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      transparent: true,
      opacity: 0,
      color: new THREE.Color("#ffffff"),
      emissive: new THREE.Color("#9ffcff"),
      emissiveIntensity: 0,
      depthWrite: false,
    });
    return m;
  }, []);

  // cache materials once (avoid traverse per frame)
  const cachedMatsRef = useRef<THREE.MeshStandardMaterial[]>([]);
  const cachedRefReady = useRef(false);

  // cache base emissive + base intensity so we can restore after idle
  const baseEmissiveRef = useRef<THREE.Color[]>([]);
  const baseEmissiveIntensityRef = useRef<number[]>([]);

  // animation state
  const revealT = useRef(0);
  const prevPhase = useRef<Phase>("idle");

  // constants (no allocations per frame)
  const premiumEmissiveColor = useMemo(() => new THREE.Color("#86cdf8"), []);
  const idleResetEmissiveColor = useMemo(() => new THREE.Color("#19191d"), []);

  useEffect(() => {
    // Cache materials ONCE per model clone
    if (!cachedRefReady.current) {
      const mats: THREE.MeshStandardMaterial[] = [];
      const baseColors: THREE.Color[] = [];
      const baseInts: number[] = [];

      model.traverse((child) => {
        const mesh = child as THREE.Mesh;
        const mat = (mesh as any)?.material;

        if (mat && mat instanceof THREE.MeshStandardMaterial) {
          mats.push(mat);
          baseColors.push(mat.emissive ? mat.emissive.clone() : new THREE.Color("#000000"));
          baseInts.push(typeof mat.emissiveIntensity === "number" ? mat.emissiveIntensity : 0);
        }
      });

      cachedMatsRef.current = mats;
      baseEmissiveRef.current = baseColors;
      baseEmissiveIntensityRef.current = baseInts;
      cachedRefReady.current = true;
    }

    return () => {
      lidMat.dispose();
    };
  }, [model, lidMat]);

  // helper: restore base mats
  const restoreBaseMats = () => {
    const mats = cachedMatsRef.current;
    const baseColors = baseEmissiveRef.current;
    const baseInts = baseEmissiveIntensityRef.current;

    for (let i = 0; i < mats.length; i++) {
      mats[i].emissive.copy(baseColors[i]);
      mats[i].emissiveIntensity = baseInts[i];
    }
  };

  useFrame((state, delta) => {
    // --- Rotation logic ---
    if (groupRef.current) {
      if (phase === "opening") {
        groupRef.current.rotation.y += delta * 2.2;
      } else if (phase !== "idle") {
        groupRef.current.rotation.y *= 0.92;
      }
      // in idle we don't touch rotation.y
    }

    // --- Premium idle animation (optimized) ---
    if (groupRef.current) {
      if (phase === "idle") {
        const t = state.clock.getElapsedTime();

        // float
        const floatY = Math.sin((t * 2 * Math.PI) / 3.6) * 0.08;
        const y = THREE.MathUtils.clamp(floatY, -0.11, 0.11);
        groupRef.current.position.y = y;

        // gentle breathing
        const scale = 1.0 + Math.sin((t * 2 * Math.PI) / 4.8) * 0.015 + 0.015;
        groupRef.current.scale.setScalar(THREE.MathUtils.clamp(scale, 0.98, 1.035));

        // emissive pulse (only intensity changes per frame)
        const emissivePulse = 0.18 + Math.sin((t * 2 * Math.PI) / 5.6) * 0.10;
        const intensity = 0.20 + emissivePulse;

        const mats = cachedMatsRef.current;
        for (let i = 0; i < mats.length; i++) {
          mats[i].emissive.copy(premiumEmissiveColor);
          mats[i].emissiveIntensity = intensity;
        }
      } else {
        // reset transforms immediately on non-idle
        groupRef.current.position.y = 0;
        groupRef.current.scale.setScalar(1);

        // restore original materials (best) OR fallback dim emissive
        if (cachedRefReady.current) {
          restoreBaseMats();
        } else {
          const mats = cachedMatsRef.current;
          for (let i = 0; i < mats.length; i++) {
            mats[i].emissive.copy(idleResetEmissiveColor);
            mats[i].emissiveIntensity = 0.03;
          }
        }
      }
    }

    // --- Phase change detection ---
    if (prevPhase.current !== phase) {
      prevPhase.current = phase;

      if (phase === "reveal") {
        revealT.current = 0;
        if (lidRef.current) {
          lidRef.current.visible = true;
          lidRef.current.position.set(0, 0.55, 0);
          lidRef.current.scale.set(1, 1, 1);
        }
        lidMat.opacity = 0.42;
        lidMat.emissiveIntensity = 3.2;
      }

      if (phase === "idle") {
        if (lidRef.current) lidRef.current.visible = false;
        lidMat.opacity = 0;
        lidMat.emissiveIntensity = 0;
      }
    }

    // --- Lid behavior ---
    if (phase === "opening") {
      if (lidRef.current) {
        lidRef.current.visible = true;
        lidRef.current.position.set(0, 0.55, 0);
        lidRef.current.scale.setScalar(1.0);
      }
      lidMat.opacity = 0.34;
      lidMat.emissiveIntensity = 3.0;
    }

    if (phase === "reveal") {
      revealT.current += delta;
      const tt = revealT.current;

      if (lidRef.current) {
        const y = 0.55 + tt * 2.6;
        lidRef.current.position.y = y;

        const s = 1.0 + tt * 0.9;
        lidRef.current.scale.setScalar(s);

        if (y > 1.55) lidRef.current.visible = false;
      }

      const fade = Math.max(0, 1 - tt * 2.2);
      lidMat.opacity = 0.45 * fade;
      lidMat.emissiveIntensity = 3.4 * fade;
    }
  });

  return (
    <group ref={groupRef}>
      <FitAndCenter object={model} />
      <primitive object={model} />

      {/* fake lid */}
      <mesh
        ref={lidRef}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.55, 0]}
        visible={phase !== "idle"}
      >
        <planeGeometry args={[1.25, 1.0]} />
        <primitive object={lidMat} attach="material" />
      </mesh>
    </group>
  );
}

/**
 * PhaseLights
 * - All light refs here, animated by phase
 * - Adds: reveal flash + rim light + underglow + subtle camera shake on reveal
 */
function PhaseLights({ phase }: { phase: Phase }) {
  const { camera } = useThree();

  const ambRef = useRef<THREE.AmbientLight>(null);
  const keyRef = useRef<THREE.DirectionalLight>(null);
  const rimRef = useRef<THREE.DirectionalLight>(null);
  const fillRef = useRef<THREE.PointLight>(null);
  const underRef = useRef<THREE.PointLight>(null);
  const flashRef = useRef<THREE.PointLight>(null);

  const prevPhase = useRef<Phase>("idle");
  const revealT = useRef(0);

  // camera shake state (no allocations)
  const camBase = useRef(new THREE.Vector3());
  const camInit = useRef(false);

  // constant colors (no allocations per frame)
  const cCyan = useMemo(() => new THREE.Color("#58f0ff"), []);
  const cViolet = useMemo(() => new THREE.Color("#b85cff"), []);
  const cWarm = useMemo(() => new THREE.Color("#ffd36d"), []);

  useEffect(() => {
    // capture base camera position once
    if (!camInit.current) {
      camBase.current.copy(camera.position);
      camInit.current = true;
    }
  }, [camera]);

  useFrame((state, delta) => {
    const t = state.clock.getElapsedTime();

    // phase transition detect
    if (prevPhase.current !== phase) {
      prevPhase.current = phase;

      if (phase === "reveal") {
        revealT.current = 0;
        // reset camera base (so shake is always relative to current framing)
        camBase.current.copy(camera.position);
      }
      if (phase === "idle") {
        // restore camera immediately
        camera.position.copy(camBase.current);
      }
    }

    // REVEAL timer
    if (phase === "reveal") revealT.current += delta;
    const rt = revealT.current;

    // Targets (cheap numeric)
    // idle: showroom soft
    // opening: energetic spin + more cyan
    // reveal: flash spike + short shake
    let amb = 0.92;
    let key = 1.25;
    let rim = 0.55;
    let fill = 0.55;
    let under = 0.38;

    if (phase === "opening") {
      amb = 0.86;
      key = 1.55;
      rim = 0.78;
      fill = 0.72;
      under = 0.55;
    }

    if (phase === "reveal") {
      // flash curve (fast up, fast down)
      // 0..~0.35s main punch
      const punch = Math.max(0, 1 - rt * 5.2);
      amb = 0.95;
      key = 1.65 + punch * 0.35;
      rim = 0.95 + punch * 0.65;
      fill = 0.85 + punch * 0.45;
      under = 0.70 + punch * 0.25;

      // camera micro shake (first ~0.22s)
      const shake = Math.max(0, 1 - rt * 4.6); // fades quickly
      if (shake > 0.0001) {
        const s = shake * 0.045; // amplitude
        const ox = Math.sin(t * 62.0) * s;
        const oy = Math.cos(t * 57.0) * s * 0.65;
        const oz = Math.sin(t * 49.0) * s * 0.35;
        camera.position.set(camBase.current.x + ox, camBase.current.y + oy, camBase.current.z + oz);
      } else {
        camera.position.copy(camBase.current);
      }
    }

    // smooth intensity lerp (avoid pops)
    const lerpI = (cur: number, target: number) => cur + (target - cur) * (1 - Math.pow(0.001, delta));

    if (ambRef.current) ambRef.current.intensity = lerpI(ambRef.current.intensity, amb);
    if (keyRef.current) keyRef.current.intensity = lerpI(keyRef.current.intensity, key);
    if (rimRef.current) rimRef.current.intensity = lerpI(rimRef.current.intensity, rim);
    if (fillRef.current) fillRef.current.intensity = lerpI(fillRef.current.intensity, fill);
    if (underRef.current) underRef.current.intensity = lerpI(underRef.current.intensity, under);

    // subtle animated color mixing (Fortnite vibe)
    // opening: more cyan/violet breathing
    // idle: cooler, stable
    if (keyRef.current) {
      if (phase === "opening") {
        const mix = 0.5 + Math.sin(t * 1.4) * 0.22;
        keyRef.current.color.copy(cCyan).lerp(cViolet, mix * 0.35);
      } else {
        keyRef.current.color.copy(cCyan).lerp(cWarm, 0.14);
      }
    }

    if (rimRef.current) {
      if (phase === "reveal") {
        rimRef.current.color.copy(cWarm).lerp(cCyan, 0.25);
      } else {
        rimRef.current.color.copy(cViolet).lerp(cCyan, 0.25);
      }
    }

    if (fillRef.current) {
      fillRef.current.color.copy(cCyan).lerp(cViolet, 0.18);
    }
    if (underRef.current) {
      underRef.current.color.copy(cCyan).lerp(cViolet, 0.22);
    }

    // reveal flash light (short, strong, then gone)
    if (flashRef.current) {
      if (phase === "reveal") {
        const spike = Math.max(0, 1 - rt * 7.8);
        flashRef.current.intensity = 3.2 * spike;
        flashRef.current.distance = 7.5;
      } else {
        flashRef.current.intensity = 0;
      }
    }
  });

  return (
    <>
      <ambientLight ref={ambRef} intensity={0.95} />

      {/* Key */}
      <directionalLight
        ref={keyRef}
        position={[3, 6, 5]}
        intensity={1.35}
        color={"#58f0ff"}
      />

      {/* Rim / back light */}
      <directionalLight
        ref={rimRef}
        position={[-4, 3.2, -3.6]}
        intensity={0.55}
        color={"#b85cff"}
      />

      {/* Fill */}
      <pointLight ref={fillRef} position={[-3, 2, 3]} intensity={0.75} distance={8} />

      {/* Underglow */}
      <pointLight ref={underRef} position={[0, -1.2, 0.5]} intensity={0.42} distance={6} />

      {/* Reveal flash punch */}
      <pointLight ref={flashRef} position={[0, 1.2, 2.2]} intensity={0} distance={7.5} />
    </>
  );
}

export function Chest3D({ phase }: { phase: Phase }) {
  return (
    <Canvas camera={{ position: [0, 1.2, 4], fov: 35 }} gl={{ antialias: true, alpha: true }}>
      <PhaseLights phase={phase} />

      <Suspense fallback={null}>
        <ChestModel phase={phase} />
      </Suspense>

      {/* витрина — управление блокируем */}
      <OrbitControls enableZoom={false} enablePan={false} enableRotate={false} />
    </Canvas>
  );
}

useGLTF.preload("/models/chest.glb");
