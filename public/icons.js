const shapes = {
  plus: 'M12 5v14M5 12h14',
  message:
    'M20.5 14.5a3 3 0 0 1-3 3h-8L4 21v-4.5a3 3 0 0 1-1-2v-9a3 3 0 0 1 3-3h11.5a3 3 0 0 1 3 3z',
  doc: 'M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6',
  terminal: 'M3.5 5h17v14h-17zM7 9l3 3-3 3m5 0h4',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zm-9-5v5l3 2',
  down: 'm8 10 4 4 4-4',
  right: 'm9 6 6 6-6 6',
  menu: 'M4 6h16M4 12h16M4 18h16',
  group:
    'M15 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0zm3-3a4 4 0 0 1 0 7m2 4a4 4 0 0 1 3 4',
  sliders: 'M4 7h7m5 0h4M4 17h2m5 0h9M11 4v6M7 14v6',
  panel: 'M3 4h18v16H3zM9 4v16',
  stack: 'm3 8 9-5 9 5-9 5zM3 12l9 5 9-5M3 16l9 5 9-5',
  link: 'm10 14 4-4m-1-3 2-2a4 4 0 0 1 6 6l-3 3a4 4 0 0 1-5 0m-2 3-2 2a4 4 0 0 1-6-6l3-3a4 4 0 0 1 5 0',
  close: 'm6 6 12 12M6 18 18 6',
  globe:
    'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM3 12h18M12 3a16 16 0 0 1 0 18 16 16 0 0 1 0-18z',
  lock: 'M5 10h14v11H5zM8 10V7a4 4 0 0 1 8 0v3',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  leave: 'M9 4H4v16h5M10 12h11m-4-4 4 4-4 4',
  dot: 'M9 12h6',
  pencil: 'm4 20 1-5L16 4l4 4L9 19zM14 6l4 4',
  help: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM9 9a3 3 0 0 1 6 0c0 2-3 2.5-3 5m0 3h.01',
  cpu: 'M6 6h12v12H6zM10 10h4v4h-4zM9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4',
  folder: 'M3 7V5h6l2 2h10v13H3z',
  check: 'm5 12 4 4L19 6',
  layers: 'M3 6h18M6 12h12m-9 6h6'
};
export function icon(name, size = 18) {
  return (
    '<svg aria-hidden="true" width="' +
    size +
    '" height="' +
    size +
    '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="' +
    shapes[name] +
    '"/></svg>'
  );
}
