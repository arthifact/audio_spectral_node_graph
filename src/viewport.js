const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function damp(value, velocity, target, seconds, dt) {
  const omega = 2 / seconds;
  const error = value - target;
  const step = (velocity + omega * error) * dt;
  const decay = Math.exp(-omega * dt);
  return {
    value: target + (error + step) * decay,
    velocity: (velocity - omega * step) * decay,
  };
}

function fitExtent(extent, rect, cx, cy, preferredScale = 1, x = 0, y = 0) {
  const scale = Math.min(
    preferredScale,
    (rect.right - rect.left) / Math.max(1, extent.right - extent.left),
    (rect.bottom - rect.top) / Math.max(1, extent.bottom - extent.top),
  );
  return {
    scale,
    x: clamp(
      x,
      rect.left - (cx + (extent.left - cx) * scale),
      rect.right - (cx + (extent.right - cx) * scale),
    ),
    y: clamp(
      y,
      rect.top - (cy + (extent.top - cy) * scale),
      rect.bottom - (cy + (extent.bottom - cy) * scale),
    ),
  };
}

function freeRectangles(bounds, obstacles, gap) {
  return obstacles.reduce(
    (rectangles, obstacle) => {
      const blocked = {
        left: obstacle.left - gap,
        right: obstacle.right + gap,
        top: obstacle.top - gap,
        bottom: obstacle.bottom + gap,
      };
      return rectangles.flatMap((rect) => {
        if (
          blocked.right <= rect.left ||
          blocked.left >= rect.right ||
          blocked.bottom <= rect.top ||
          blocked.top >= rect.bottom
        )
          return [rect];
        return [
          { ...rect, right: Math.min(rect.right, blocked.left) },
          { ...rect, left: Math.max(rect.left, blocked.right) },
          { ...rect, bottom: Math.min(rect.bottom, blocked.top) },
          { ...rect, top: Math.max(rect.top, blocked.bottom) },
        ].filter((part) => part.right > part.left && part.bottom > part.top);
      });
    },
    [bounds],
  );
}

// Ease one stable view before nodes reach its outer boundary.
export class ViewportFrame {
  constructor() {
    this.reset();
  }

  reset() {
    this.scale = 1;
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.zoomVelocity = 0;
    this.layout = '';
    this.rectangle = null;
    this.envelope = null;
    this.edgeVelocity = { left: 0, right: 0, top: 0, bottom: 0 };
  }

  update(
    points,
    { width, height, top = 64, obstacles = [] },
    elapsed = 1 / 60,
  ) {
    const visible = points.filter((point) => point.visible !== false);
    if (visible.length === 0) {
      this.reset();
      return points;
    }
    const padding = Math.min(24, width * 0.2, height * 0.2);
    const bounds = {
      left: padding,
      right: width - padding,
      top: Math.min(Math.max(padding, top), height - padding * 2),
      bottom: height - padding,
    };
    const rectangles = freeRectangles(bounds, obstacles, padding);
    // Fully covered windows still need finite camera coordinates.
    if (rectangles.length === 0) rectangles.push(bounds);
    const extent = {
      left: Math.min(...visible.map((p) => p.sx - Math.max(0, p.radius || 0))),
      right: Math.max(...visible.map((p) => p.sx + Math.max(0, p.radius || 0))),
      top: Math.min(...visible.map((p) => p.sy - Math.max(0, p.radius || 0))),
      bottom: Math.max(
        ...visible.map((p) => p.sy + Math.max(0, p.radius || 0)),
      ),
    };
    const dt = Number.isFinite(elapsed) ? clamp(elapsed, 0, 0.08) : 0;
    const cx = width / 2;
    const cy = height / 2;
    const layout = JSON.stringify(rectangles);
    if (layout !== this.layout) {
      // Keep one framing region until the UI or viewport actually changes.
      let best;
      for (const rect of rectangles) {
        const fitted = fitExtent(extent, rect, cx, cy);
        const score =
          fitted.scale -
          (Math.hypot(fitted.x - this.x, fitted.y - this.y) /
            Math.max(width, height)) *
            0.08;
        if (!best || score > best.score) best = { rect, score };
      }
      this.rectangle = best.rect;
      this.layout = layout;
      this.envelope = { ...extent };
      this.edgeVelocity = { left: 0, right: 0, top: 0, bottom: 0 };
    }
    const predicted = {};
    for (const [edge, direction] of [
      ['left', -1],
      ['right', 1],
      ['top', -1],
      ['bottom', 1],
    ]) {
      const previous = this.envelope[edge];
      const outward = (extent[edge] - previous) * direction > 0;
      this.envelope[edge] = outward
        ? extent[edge]
        : previous + (extent[edge] - previous) * (1 - Math.exp(-dt / 0.8));
      const speed = dt > 0 ? (this.envelope[edge] - previous) / dt : 0;
      this.edgeVelocity[edge] +=
        (speed - this.edgeVelocity[edge]) * (1 - Math.exp(-dt / 0.2));
      const lead = Math.min(
        80,
        Math.max(0, this.edgeVelocity[edge] * direction) * 0.35,
      );
      predicted[edge] = this.envelope[edge] + lead * direction;
    }
    const rect = this.rectangle;
    const runway = Math.min(
      32,
      (rect.right - rect.left) * 0.08,
      (rect.bottom - rect.top) * 0.08,
    );
    const target = fitExtent(
      predicted,
      {
        left: rect.left + runway,
        right: rect.right - runway,
        top: rect.top + runway,
        bottom: rect.bottom - runway,
      },
      cx,
      cy,
    );
    const panX = damp(this.x, this.vx, target.x, 0.28, dt);
    const panY = damp(this.y, this.vy, target.y, 0.28, dt);
    const zoom = damp(
      Math.log(this.scale),
      this.zoomVelocity,
      Math.log(target.scale),
      target.scale < this.scale ? 0.3 : 2.5,
      dt,
    );
    // The outer boundary remains a hard limit for an unexpected new outlier.
    const safe = fitExtent(
      extent,
      rect,
      cx,
      cy,
      Math.min(1, Math.exp(zoom.value)),
      panX.value,
      panY.value,
    );
    this.vx = safe.x === panX.value ? panX.velocity : 0;
    this.vy = safe.y === panY.value ? panY.velocity : 0;
    this.zoomVelocity = safe.scale === Math.exp(zoom.value) ? zoom.velocity : 0;
    Object.assign(this, safe);
    return points.map((point) => ({
      ...point,
      sx: cx + (point.sx - cx) * this.scale + this.x,
      sy: cy + (point.sy - cy) * this.scale + this.y,
      sc: point.sc * this.scale,
    }));
  }
}
