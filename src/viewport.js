// Reserve space for the actual controls, including short landscape windows.
export function sceneViewport({ width, height, controlsTop, controlsLeft }) {
  const stacked = width < 800 && height >= 500;
  const left = stacked ? 32 : width < 800 ? 32 : 100;
  const right = stacked ? width - 32 : Math.max(left + 120, controlsLeft - 32);
  const top = width < 800 ? 120 : 88;
  const bottom = stacked ? Math.max(top + 70, controlsTop - 40) : height - 48;
  return {
    x: (left + right) / 2,
    y: (top + bottom) / 2,
    width: Math.max(80, right - left),
    height: Math.max(70, bottom - top),
  };
}

export function projectPoint(point, rotation, perspective) {
  const cosY = Math.cos(rotation.y),
    sinY = Math.sin(rotation.y);
  const cosX = Math.cos(rotation.x),
    sinX = Math.sin(rotation.x);
  const x = point.x * cosY - point.z * sinY;
  const z = point.x * sinY + point.z * cosY;
  const y = point.y * cosX - z * sinX;
  const depth = point.y * sinX + z * cosX;
  const scale = perspective / Math.max(perspective * 0.6, perspective + depth);
  return { x: x * scale, y: y * scale, depth, scale };
}
