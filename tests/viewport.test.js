import assert from 'node:assert/strict';
import test from 'node:test';
import { ViewportFrame } from '../src/viewport.js';

const EPSILON = 1e-7;

function scaleOf(input, output) {
  return output.sc / input.sc;
}

function boundsOf(input, output) {
  const visible = output.flatMap((point, index) => {
    if (input[index].visible === false) return [];
    const radius = (input[index].radius ?? 0) * scaleOf(input[index], point);
    return [
      {
        left: point.sx - radius,
        right: point.sx + radius,
        top: point.sy - radius,
        bottom: point.sy + radius,
      },
    ];
  });
  return {
    left: Math.min(...visible.map((point) => point.left)),
    right: Math.max(...visible.map((point) => point.right)),
    top: Math.min(...visible.map((point) => point.top)),
    bottom: Math.max(...visible.map((point) => point.bottom)),
  };
}

function assertContained(input, output, bounds) {
  const actual = boundsOf(input, output);
  assert.ok(actual.left >= bounds.left - EPSILON, 'left extent is visible');
  assert.ok(actual.right <= bounds.right + EPSILON, 'right extent is visible');
  assert.ok(actual.top >= bounds.top - EPSILON, 'top extent is visible');
  assert.ok(
    actual.bottom <= bounds.bottom + EPSILON,
    'bottom extent is visible',
  );
}

function assertUniform(input, output) {
  const scale = scaleOf(input[0], output[0]);
  assert.ok(scale > 0 && scale <= 1 + EPSILON);
  for (let index = 0; index < input.length; index += 1) {
    assert.ok(Number.isFinite(output[index].sx));
    assert.ok(Number.isFinite(output[index].sy));
    assert.ok(Number.isFinite(output[index].sc));
    assert.ok(Math.abs(scaleOf(input[index], output[index]) - scale) < EPSILON);
    assert.ok(
      Math.abs(
        output[index].sx -
          output[0].sx -
          (input[index].sx - input[0].sx) * scale,
      ) < EPSILON,
    );
    assert.ok(
      Math.abs(
        output[index].sy -
          output[0].sy -
          (input[index].sy - input[0].sy) * scale,
      ) < EPSILON,
    );
    assert.equal(output[index].depth, input[index].depth);
  }
}

test('a graph that already fits keeps its position, size, and metadata', () => {
  const frame = new ViewportFrame();
  const points = [
    { sx: 180, sy: 130, sc: 1.5, depth: -40, radius: 18, id: 'recent' },
    { sx: 740, sy: 540, sc: 0.4, depth: 500, radius: 6, id: 'older' },
  ];
  const original = structuredClone(points);
  const fitted = frame.update(points, { width: 1000, height: 700 });
  assert.deepEqual(fitted, points);
  assert.deepEqual(points, original);
});

test('sudden movement fits every visible node in the same frame', () => {
  const frame = new ViewportFrame();
  const viewport = { width: 1280, height: 800, top: 88 };
  const bounds = { left: 24, right: 1256, top: 88, bottom: 776 };
  const positions = [
    [400, 300, 700, 500],
    [-1800, 120, 900, 2100],
    [13000, -4000, 16000, -2000],
    [-90000, -50000, 80000, 70000],
    [500, 300, 600, 400],
  ];
  for (const [x1, y1, x2, y2] of positions) {
    const points = [
      { sx: x1, sy: y1, sc: 2.5, depth: -90, radius: 45 },
      { sx: x2, sy: y2, sc: 0.6, depth: 800, radius: 14 },
    ];
    const fitted = frame.update(points, viewport, 1 / 60);
    assertUniform(points, fitted);
    assertContained(points, fitted, bounds);
  }
});

test('a giant projected node fits its full radius, not only its center', () => {
  const points = [{ sx: 190, sy: 400, sc: 80, depth: -870, radius: 12000 }];
  const fitted = new ViewportFrame().update(points, {
    width: 390,
    height: 844,
    top: 112,
  });
  assertUniform(points, fitted);
  assert.ok(fitted[0].sc < points[0].sc);
  assertContained(points, fitted, {
    left: 24,
    right: 366,
    top: 112,
    bottom: 820,
  });
});

test('fitting preserves perspective ratios and applies one spatial transform', () => {
  const points = [
    { sx: -600, sy: -900, sc: 3.2, depth: -720, radius: 55 },
    { sx: 1700, sy: 1200, sc: 0.8, depth: 900, radius: 12 },
    { sx: 280, sy: 620, sc: 1.4, depth: 15, radius: 22 },
  ];
  const original = structuredClone(points);
  const fitted = new ViewportFrame().update(points, {
    width: 1024,
    height: 768,
  });
  assertUniform(points, fitted);
  assertContained(points, fitted, {
    left: 24,
    right: 1000,
    top: 64,
    bottom: 744,
  });
  assert.deepEqual(points, original);
});

test('the full graph avoids a bottom-right controls rectangle', () => {
  const obstacle = { left: 1000, right: 1280, top: 620, bottom: 800 };
  const points = [
    { sx: 820, sy: 500, sc: 1, radius: 28 },
    { sx: 1190, sy: 710, sc: 1.6, radius: 42 },
  ];
  const fitted = new ViewportFrame().update(points, {
    width: 1280,
    height: 800,
    obstacles: [obstacle],
  });
  assertUniform(points, fitted);
  assertContained(points, fitted, {
    left: 24,
    right: 1256,
    top: 64,
    bottom: 776,
  });
  const graph = boundsOf(points, fitted);
  assert.ok(
    graph.right <= obstacle.left + EPSILON ||
      graph.left >= obstacle.right - EPSILON ||
      graph.bottom <= obstacle.top + EPSILON ||
      graph.top >= obstacle.bottom - EPSILON,
    'the selected free rectangle does not overlap the controls',
  );
});

test('faded nodes do not shrink or displace a visible graph', () => {
  const points = [
    { sx: 300, sy: 250, sc: 1, radius: 20, visible: true },
    { sx: 700, sy: 480, sc: 0.5, radius: 8 },
    { sx: 1e8, sy: -1e8, sc: 20, radius: 3000, visible: false },
  ];
  const fitted = new ViewportFrame().update(points, {
    width: 1000,
    height: 700,
  });
  assert.deepEqual(fitted, points);
});

test('framing releases gradually and reset restores the identity', () => {
  const frame = new ViewportFrame();
  const viewport = { width: 1000, height: 700 };
  const extreme = [
    { sx: -2000, sy: -1000, sc: 1, radius: 20 },
    { sx: 3000, sy: 2000, sc: 1, radius: 20 },
  ];
  const fittedExtreme = frame.update(extreme, viewport);
  const originalScale = scaleOf(extreme[0], fittedExtreme[0]);
  const compact = [
    { sx: 400, sy: 300, sc: 1, radius: 20 },
    { sx: 600, sy: 400, sc: 0.5, radius: 10 },
  ];
  let fitted = frame.update(compact, viewport, 1 / 60);
  assert.ok(
    Math.abs(Math.log(scaleOf(compact[0], fitted[0]) / originalScale)) < 0.01,
    'retained zoom momentum changes scale gradually before recovering',
  );
  assert.ok(scaleOf(compact[0], fitted[0]) < 1);
  for (let index = 0; index < 1200; index += 1) {
    fitted = frame.update(compact, viewport, 1 / 60);
    assertContained(compact, fitted, {
      left: 24,
      right: 976,
      top: 64,
      bottom: 676,
    });
  }
  assert.ok(scaleOf(compact[0], fitted[0]) > 0.99);
  frame.reset();
  assert.deepEqual(frame.update(compact, viewport), compact);
});

test('a resize contains the graph immediately in portrait and landscape views', () => {
  const frame = new ViewportFrame();
  const points = [
    { sx: -300, sy: 50, sc: 1.4, radius: 38 },
    { sx: 1100, sy: 800, sc: 0.6, radius: 16 },
  ];
  for (const viewport of [
    { width: 1440, height: 900, top: 64 },
    { width: 390, height: 844, top: 108 },
    { width: 844, height: 260, top: 58 },
    { width: 320, height: 568, top: 108 },
  ]) {
    const fitted = frame.update(points, viewport);
    assertUniform(points, fitted);
    assertContained(points, fitted, {
      left: 24,
      right: viewport.width - 24,
      top: viewport.top,
      bottom: viewport.height - 24,
    });
  }
});

test('empty, all-faded, single-node, and tiny views remain finite', () => {
  const frame = new ViewportFrame();
  assert.deepEqual(frame.update([], { width: 390, height: 844 }), []);
  const invisible = [{ sx: 2000, sy: -500, sc: 1, visible: false }];
  assert.deepEqual(
    frame.update(invisible, { width: 390, height: 844 }),
    invisible,
  );
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 36, height: 40 },
    { width: 1, height: 1 },
  ]) {
    const points = [{ sx: 2000, sy: -500, sc: 1, radius: 300 }];
    const fitted = frame.update(points, viewport);
    assertUniform(points, fitted);
    assertContained(points, fitted, {
      left: 0,
      right: viewport.width,
      top: 0,
      bottom: viewport.height,
    });
  }
});

test('a smoothly changing graph does not jump between areas beside the controls', () => {
  const frame = new ViewportFrame();
  const obstacle = { left: 1000, right: 1280, top: 620, bottom: 800 };
  const viewport = { width: 1280, height: 800, obstacles: [obstacle] };
  let previousCenter;
  let maximumStep = 0;
  for (let index = 0; index <= 360; index += 1) {
    const angle = (index / 360) * Math.PI * 2;
    const x = 640 - 400 * Math.sin(angle);
    const y = 400 + 350 * Math.sin(angle * 0.7);
    const graphWidth = 850 + 300 * Math.sin(angle * 2);
    const graphHeight = 450 + 140 * Math.cos(angle * 2);
    const points = [
      { sx: x - graphWidth / 2, sy: y - graphHeight / 2, sc: 1, radius: 12 },
      { sx: x + graphWidth / 2, sy: y + graphHeight / 2, sc: 1, radius: 12 },
    ];
    const fitted = frame.update(points, viewport, 1 / 60);
    assertUniform(points, fitted);
    assertContained(points, fitted, {
      left: 24,
      right: 1256,
      top: 64,
      bottom: 776,
    });
    const graph = boundsOf(points, fitted);
    assert.ok(
      graph.right <= obstacle.left + EPSILON ||
        graph.left >= obstacle.right - EPSILON ||
        graph.bottom <= obstacle.top + EPSILON ||
        graph.top >= obstacle.bottom - EPSILON,
      'the graph stays clear of the controls throughout the movement',
    );
    const center = {
      x: (fitted[0].sx + fitted[1].sx) / 2,
      y: (fitted[0].sy + fitted[1].sy) / 2,
    };
    if (previousCenter) {
      maximumStep = Math.max(
        maximumStep,
        Math.hypot(center.x - previousCenter.x, center.y - previousCenter.y),
      );
    }
    previousCenter = center;
  }
  assert.ok(
    maximumStep < 20,
    `smooth input must not cause a framing jump (${maximumStep.toFixed(2)}px)`,
  );
});

test('a slowly drifting graph eases into the screen boundary', () => {
  const frame = new ViewportFrame();
  const viewport = { width: 1280, height: 800 };
  const pointsAt = (offset) => [
    { sx: 100 + offset, sy: 300, sc: 1, radius: 16 },
    { sx: 1100 + offset, sy: 500, sc: 1, radius: 16 },
  ];
  for (let index = 0; index < 120; index += 1) {
    frame.update(pointsAt(0), viewport, 1 / 60);
  }
  let previousX;
  let previousVelocity;
  let maximumAcceleration = 0;
  for (let index = 0; index < 300; index += 1) {
    const points = pointsAt(index * 1.5);
    const fitted = frame.update(points, viewport, 1 / 60);
    assertContained(points, fitted, {
      left: 24,
      right: 1256,
      top: 64,
      bottom: 776,
    });
    if (previousX !== undefined) {
      const velocity = fitted[0].sx - previousX;
      if (previousVelocity !== undefined) {
        maximumAcceleration = Math.max(
          maximumAcceleration,
          Math.abs(velocity - previousVelocity),
        );
      }
      previousVelocity = velocity;
    }
    previousX = fitted[0].sx;
  }
  assert.ok(
    maximumAcceleration < 0.6,
    `framing must ease before reaching the edge (${maximumAcceleration.toFixed(2)}px/frame²)`,
  );
});

test('framing follows the same smooth path at 30 and 60 frames per second', () => {
  const viewport = {
    width: 1280,
    height: 800,
    obstacles: [{ left: 1000, right: 1280, top: 620, bottom: 800 }],
  };
  function followPath(fps) {
    const frame = new ViewportFrame();
    let fitted;
    for (let index = 0; index <= fps * 6; index += 1) {
      const seconds = index / fps;
      const angle = seconds * 0.6;
      const x = 640 - 240 * Math.sin(angle);
      const y = 400 + 180 * Math.sin(angle * 0.7);
      const graphWidth = 850 + 200 * Math.sin(angle * 2);
      const graphHeight = 450 + 110 * Math.cos(angle * 2);
      const points = [
        { sx: x - graphWidth / 2, sy: y - graphHeight / 2, sc: 1, radius: 16 },
        { sx: x + graphWidth / 2, sy: y + graphHeight / 2, sc: 1, radius: 16 },
      ];
      fitted = frame.update(points, viewport, index === 0 ? 0 : 1 / fps);
      assertContained(points, fitted, {
        left: 24,
        right: 1256,
        top: 64,
        bottom: 776,
      });
    }
    return fitted;
  }
  const at30 = followPath(30);
  const at60 = followPath(60);
  for (let index = 0; index < at30.length; index += 1) {
    assert.ok(Math.abs(at30[index].sx - at60[index].sx) < 4);
    assert.ok(Math.abs(at30[index].sy - at60[index].sy) < 4);
    assert.ok(Math.abs(at30[index].sc - at60[index].sc) < 0.015);
  }
});
