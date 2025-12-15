"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import React, { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

type Phase = "idle" | "opening" | "reveal";

function FitAndCenter({ object }: { object: THREE.Object3D }) {
  const { camera } = useThree();

  useEffect(() => {
    if (!object) return;

    // считаем bounds
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    // центрируем объект в (0,0,0)
    object.position.x += object.position.x - center.x;
    object.position.y += object.position.y - center.y;
    object.position.z += object.position.z - center.z;

    // авто-камера под текущий fov
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = (camera as THREE.PerspectiveCamera).fov;
    const fovRad = THREE.MathUtils.degToRad(fov);

    let dist = maxDim / (2 * Math.tan(fovRad / 2));
    dist *= 1.25; // запас

    const cam = camera as THREE.PerspectiveCamera;
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

  // clone чтобы не ломать исходный scene (важно для bounds/позиции)
  const model = useMemo(() => scene.clone(true), [scene]);

  const groupRef = useRef<THREE.Group>(null);

  // fake lid (вариант 1)
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

  const revealT = useRef(0);
  const prevPhase = useRef<Phase>("idle");

  useEffect(() => {
    return () => {
      lidMat.dispose();
    };
  }, [lidMat]);

  useFrame((_, delta) => {
    // вращение
    if (groupRef.current) {
      if (phase === "opening") groupRef.current.rotation.y += delta * 2.2;
      else groupRef.current.rotation.y *= 0.92;
    }

    // смена фаз
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

    // поведение крышки
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
      const t = revealT.current;

      if (lidRef.current) {
        const y = 0.55 + t * 2.6;
        lidRef.current.position.y = y;

        const s = 1.0 + t * 0.9;
        lidRef.current.scale.setScalar(s);

        if (y > 1.55) lidRef.current.visible = false;
      }

      const fade = Math.max(0, 1 - t * 2.2);
      lidMat.opacity = 0.45 * fade;
      lidMat.emissiveIntensity = 3.4 * fade;
    }
  });

  return (
    <group ref={groupRef}>
      {/* автоцентр+автокамера */}
      <FitAndCenter object={model} />

      <primitive object={model} />

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

export function Chest3D({ phase }: { phase: Phase }) {
  return (
    <Canvas camera={{ position: [0, 1.2, 4], fov: 35 }} gl={{ antialias: true, alpha: true }}>
      <ambientLight intensity={0.95} />
      <directionalLight position={[3, 6, 5]} intensity={1.35} />
      <pointLight position={[-3, 2, 3]} intensity={0.75} />

      <Suspense fallback={null}>
        <ChestModel phase={phase} />
      </Suspense>

      <OrbitControls enableZoom={false} enablePan={false} enableRotate={false} />
    </Canvas>
  );
}

useGLTF.preload("/models/chest.glb");
