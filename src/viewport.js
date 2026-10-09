const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

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

// Correct only overflow, with one uniform transform after perspective projection.
export class ViewportFrame {
  constructor() {
    this.reset();
  }

  reset() {
    this.scale = 1;
    this.x = 0;
    this.y = 0;
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
    const recovery = 1 - Math.exp(-dt / 2.5);
    const recoveringScale = this.scale + (1 - this.scale) * recovery;
    const recoveringX = this.x * (1 - recovery);
    const recoveringY = this.y * (1 - recovery);
    const cx = width / 2;
    const cy = height / 2;
    let best;
    for (const rect of rectangles) {
      const scale = Math.min(
        recoveringScale,
        (rect.right - rect.left) / Math.max(1, extent.right - extent.left),
        (rect.bottom - rect.top) / Math.max(1, extent.bottom - extent.top),
      );
      const x = clamp(
        recoveringX,
        rect.left - (cx + (extent.left - cx) * scale),
        rect.right - (cx + (extent.right - cx) * scale),
      );
      const y = clamp(
        recoveringY,
        rect.top - (cy + (extent.top - cy) * scale),
        rect.bottom - (cy + (extent.bottom - cy) * scale),
      );
      const score =
        scale -
        (Math.hypot(x - this.x, y - this.y) / Math.max(width, height)) * 0.08;
      if (!best || score > best.score) best = { scale, x, y, score };
    }
    Object.assign(this, { scale: best.scale, x: best.x, y: best.y });
    return points.map((point) => ({
      ...point,
      sx: cx + (point.sx - cx) * this.scale + this.x,
      sy: cy + (point.sy - cy) * this.scale + this.y,
      sc: point.sc * this.scale,
    }));
  }
}
