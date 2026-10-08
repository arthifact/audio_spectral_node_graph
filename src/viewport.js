// Keep the complete graph inside the space above the controls on narrow screens.
export function fitToViewport(projections, { width, height }) {
  if (projections.length === 0) return projections;
  const left = Math.min(...projections.map((point) => point.sx));
  const right = Math.max(...projections.map((point) => point.sx));
  const top = Math.min(...projections.map((point) => point.sy));
  const bottom = Math.max(...projections.map((point) => point.sy));
  const padding = 40;
  const headerHeight = 116;
  const controlsHeight = 214;
  const availableWidth = Math.max(80, width - padding * 2);
  const availableHeight = Math.max(
    80,
    height - headerHeight - controlsHeight - padding * 2,
  );
  const scale = Math.min(
    1,
    availableWidth / Math.max(1, right - left),
    availableHeight / Math.max(1, bottom - top),
  );
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  return projections.map((point) => ({
    ...point,
    sx: width / 2 + (point.sx - centerX) * scale,
    sy:
      headerHeight +
      padding +
      availableHeight / 2 +
      (point.sy - centerY) * scale,
    sc: point.sc * scale,
  }));
}
