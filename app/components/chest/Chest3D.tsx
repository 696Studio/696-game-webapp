"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

type Phase = "idle" | "opening" | "reveal";

function ChestModel({ phase }: { phase: Phase }) {
  const { scene } = useGLTF("/models/chest.glb");

  // Группы/рефы
  const chestGroupRef = useRef<THREE.Group>(null);

  const lidRef = useRef<THREE.Mesh>(null);
  const lidMatRef = useRef<THREE.MeshStandardMaterial>(null);

  // Таймер и детект смены фазы (чтобы запускать "вылет крышки" ровно 1 раз)
  const revealT = useRef(0);
  const prevPhase = useRef<Phase>("idle");

  // Материал крышки создаём один раз (стабильный объект)
  const lidMaterial = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      transparent: true,
      opacity: 0,
      color: new THREE.Color("#ffffff"),
      emissive: new THREE.Color("#9ffcff"),
      emissiveIntensity: 0,
    });
    return m;
  }, []);

  useEffect(() => {
    // привяжем memo-материал к ref (чтобы в useFrame править параметры)
    lidMatRef.current = lidMaterial;
    return () => {
      lidMaterial.dispose();
    };
  }, [lidMaterial]);

  useFrame((_, delta) => {
    // 1) Вращение сундука
    if (chestGroupRef.current) {
      if (phase === "opening") {
        chestGroupRef.current.rotation.y += delta * 2.6; // скорость вращения
      } else {
        // лёгкое "дозатухание" вращения (чтобы красиво останавливался)
        chestGroupRef.current.rotation.y *= 0.92;
      }
    }

    // 2) Детект смены фазы -> запускаем анимацию "крышки"
    const was = prevPhase.current;
    if (was !== phase) {
      prevPhase.current = phase;

      if (phase === "reveal") {
        revealT.current = 0;

        if (lidRef.current) {
          lidRef.current.visible = true;
          lidRef.current.position.set(0, 0.55, 0);
          lidRef.current.scale.set(1, 1, 1);
        }

        if (lidMatRef.current) {
          lidMatRef.current.opacity = 0.42;
          lidMatRef.current.emissiveIntensity = 3.2;
        }
      }

      if (phase === "idle") {
        if (lidRef.current) lidRef.current.visible = false;
        if (lidMatRef.current) {
          lidMatRef.current.opacity = 0;
          lidMatRef.current.emissiveIntensity = 0;
        }
      }
    }

    // 3) Поведение крышки по фазам
    if (phase === "opening") {
      // во время opening — просто светящаяся "крышка" над сундуком
      if (lidRef.current) {
        lidRef.current.visible = true;
        lidRef.current.position.set(0, 0.55, 0);
        lidRef.current.scale.setScalar(1.0);
      }
      if (lidMatRef.current) {
        lidMatRef.current.opacity = 0.34;
        lidMatRef.current.emissiveIntensity = 3.0;
      }
    }

    if (phase === "reveal") {
      revealT.current += delta;

      // "вылет крышки" вверх + расширение + fade-out
      const t = revealT.current;

      if (lidRef.current) {
        const y = 0.55 + t * 2.6; // скорость улёта
        lidRef.current.position.y = y;

        const s = 1.0 + t * 0.9;
        lidRef.current.scale.setScalar(s);

        // после определённой высоты — прячем
        if (y > 1.55) lidRef.current.visible = false;
      }

      if (lidMatRef.current) {
        // плавное затухание
        const fade = Math.max(0, 1 - t * 2.2);
        lidMatRef.current.opacity = 0.45 * fade;
        lidMatRef.current.emissiveIntensity = 3.4 * fade;
      }
    }
  });

  // --- Center the chest and reduce the scale for best framing ---
  // Moved chest up vertically, reduced scale slightly from 1.6 to 1.25.
  return (
    <group ref={chestGroupRef} position={[0, 0.05, 0]} scale={1.25}>
      {/* сам сундук */}
      <primitive object={scene} />

      {/* FAKE LID (вариант 1): плоскость-свет над сундуком */}
      <mesh
        ref={lidRef}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.55, 0]}
        visible={phase !== "idle"}
      >
        <planeGeometry args={[1.25, 1.0]} />
        <primitive object={lidMaterial} attach="material" />
      </mesh>
    </group>
  );
}

export function Chest3D({ phase }: { phase: Phase }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        minHeight: 0,
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Canvas
        camera={{ position: [0, 1.25, 4.3], fov: 32 }} // Adjusted camera for full chest framing
        gl={{ antialias: true, alpha: true }}
        style={{
          width: "100%",
          height: "100%",
          minHeight: 0,
          position: "absolute",
          top: 0,
          left: 0,
        }}
      >
        <ambientLight intensity={0.9} />
        <directionalLight position={[3, 6, 5]} intensity={1.4} />
        <pointLight position={[-3, 2, 3]} intensity={0.8} />

        <Suspense fallback={null}>
          <ChestModel phase={phase} />
        </Suspense>

        {/* Витрина — управление блокируем */}
        <OrbitControls enableZoom={false} enablePan={false} enableRotate={false} />
      </Canvas>
    </div>
  );
}

// preload
useGLTF.preload("/models/chest.glb");
