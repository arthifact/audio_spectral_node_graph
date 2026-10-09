const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function easeVelocity(current, target, seconds, dt) {
  const decay = Math.exp(-dt / seconds);
  return {
    velocity: target + (current - target) * decay,
    distance: target * dt + (current - target) * seconds * (1 - decay),
  };
}

function limitVector(x, y, maximum) {
  const length = Math.hypot(x, y);
  const factor = length > maximum ? maximum / length : 1;
  return { x: x * factor, y: y * factor };
}

// Ease both camera position and velocity so new outliers cannot snap the view.
export class SmoothCamera {
  constructor({ panSpeed = 65, maxZoomRate = 0.35 } = {}) {
    this.panSpeed = panSpeed;
    this.maxZoomRate = maxZoomRate;
    this.reset();
  }

  reset() {
    this.x = 0;
    this.y = 0;
    this.scale = null;
    this.vx = 0;
    this.vy = 0;
    this.zoomVelocity = 0;
  }

  update(target, elapsed) {
    const x = Number.isFinite(target.x) ? target.x : this.x;
    const y = Number.isFinite(target.y) ? target.y : this.y;
    const scale =
      Number.isFinite(target.scale) && target.scale > 0
        ? clamp(target.scale, 0.000001, 1000000)
        : (this.scale ?? 1);
    const dt = Number.isFinite(elapsed) ? clamp(elapsed, 0, 0.08) : 0;

    if (this.scale === null) {
      this.scale = scale;
      return { x: this.x, y: this.y, scale: this.scale };
    }

    const zoomError = Math.log(scale / this.scale);
    const zoomTime = zoomError < 0 ? 0.9 : 2;
    const zoom = easeVelocity(
      this.zoomVelocity,
      clamp(zoomError / zoomTime, -this.maxZoomRate, this.maxZoomRate),
      0.18,
      dt,
    );
    this.zoomVelocity = zoom.velocity;
    this.scale *= Math.exp(zoom.distance);

    const desired = limitVector(
      (x - this.x) / 1.2,
      (y - this.y) / 1.2,
      this.panSpeed,
    );
    const velocity = limitVector(this.vx, this.vy, this.panSpeed);
    const panX = easeVelocity(velocity.x, desired.x, 0.2, dt);
    const panY = easeVelocity(velocity.y, desired.y, 0.2, dt);
    this.vx = panX.velocity;
    this.vy = panY.velocity;
    this.x += panX.distance;
    this.y += panY.distance;

    return { x: this.x, y: this.y, scale: this.scale };
  }
}
