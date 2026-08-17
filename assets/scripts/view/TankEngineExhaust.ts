export interface TankExhaustPort {
  forward: number;
  right: number;
}

export interface TankExhaustPoint {
  x: number;
  y: number;
}

export interface TankExhaustParticle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  lifetime: number;
  startRadius: number;
  endRadius: number;
  shade: number;
  moving: boolean;
}

export const TANK_EXHAUST_MAX_PARTICLES = 384;
/** Idle keeps the original restrained cadence; movement uses a dense trail cadence. */
export const TANK_EXHAUST_IDLE_RATE = 2.75;
export const TANK_EXHAUST_MOVING_RATE = 45;
/** Smoke radius relative to the original exhaust implementation. */
export const TANK_EXHAUST_RADIUS_SCALE = 2.5;
/** Puff lifetime relative to the original exhaust implementation. */
export const TANK_EXHAUST_LIFETIME_SCALE = 1.5;

/** Convert a hull-local forward/right coordinate into map-local screen space. */
export function tankExhaustPortWorldPosition(
  centerX: number,
  centerY: number,
  forwardX: number,
  forwardY: number,
  port: TankExhaustPort,
  offsetUnit: number,
): TankExhaustPoint {
  const rightX = forwardY;
  const rightY = -forwardX;
  return {
    x: centerX + (forwardX * port.forward + rightX * port.right) * offsetUnit,
    y: centerY + (forwardY * port.forward + rightY * port.right) * offsetUnit,
  };
}

/** Stable, inexpensive pseudo-random value for presentation-only particle variation. */
export function tankExhaustRandom01(serial: number, channel: number): number {
  let x = Math.imul((serial + 1) | 0, 0x45d9f3b) ^ Math.imul((channel + 7) | 0, 0x119de1f3);
  x ^= x >>> 16;
  x = Math.imul(x, 0x45d9f3b);
  x ^= x >>> 16;
  return (x >>> 0) / 0xffffffff;
}

export function resetTankExhaustParticle(
  particle: TankExhaustParticle,
  origin: TankExhaustPoint,
  forwardX: number,
  forwardY: number,
  hexSize: number,
  moving: boolean,
  serial: number,
): void {
  const rightX = forwardY;
  const rightY = -forwardX;
  const speed = hexSize * (moving ? 0.22 : 0.10);
  const sideways = (tankExhaustRandom01(serial, 0) - 0.5) * hexSize * (moving ? 0.09 : 0.05);
  const lifetimeJitter = tankExhaustRandom01(serial, 1);
  const radiusJitter = tankExhaustRandom01(serial, 2);
  particle.active = true;
  particle.x = origin.x;
  particle.y = origin.y;
  particle.vx = -forwardX * speed + rightX * sideways;
  particle.vy = -forwardY * speed + rightY * sideways + hexSize * 0.015;
  particle.age = 0;
  particle.lifetime = (moving
    ? 0.68 + lifetimeJitter * 0.26
    : 0.88 + lifetimeJitter * 0.30) * TANK_EXHAUST_LIFETIME_SCALE;
  particle.startRadius = hexSize * (moving ? 0.020 : 0.016)
    * (0.88 + radiusJitter * 0.24)
    * TANK_EXHAUST_RADIUS_SCALE;
  particle.endRadius = particle.startRadius * (moving ? 2.45 : 2.75);
  particle.shade = Math.round(69 + tankExhaustRandom01(serial, 3) * 15);
  particle.moving = moving;
}

export function advanceTankExhaustParticle(particle: TankExhaustParticle, dt: number): void {
  if (!particle.active) return;
  const step = Math.max(0, dt);
  particle.age += step;
  if (particle.age >= particle.lifetime) {
    particle.active = false;
    return;
  }
  particle.x += particle.vx * step;
  particle.y += particle.vy * step;
  const drag = Math.pow(0.82, step);
  particle.vx *= drag;
  particle.vy *= drag;
}

export function tankExhaustParticleProgress(particle: TankExhaustParticle): number {
  if (particle.lifetime <= 0) return 1;
  return Math.max(0, Math.min(1, particle.age / particle.lifetime));
}

export function tankExhaustParticleAlpha(particle: TankExhaustParticle): number {
  const progress = tankExhaustParticleProgress(particle);
  const appear = Math.min(1, progress / 0.08);
  const fade = Math.pow(Math.max(0, 1 - progress), 1.35);
  return Math.round((particle.moving ? 126 : 92) * appear * fade);
}

export function tankExhaustParticleRadius(particle: TankExhaustParticle): number {
  const progress = tankExhaustParticleProgress(particle);
  const eased = 1 - Math.pow(1 - progress, 2);
  return particle.startRadius + (particle.endRadius - particle.startRadius) * eased;
}
