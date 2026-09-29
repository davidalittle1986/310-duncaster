// Top bar wiring: mode switch, floor switch, rooms menu, light/dark toggle.
export function initUI({ onMode, onFloor, onRoom, onTheme }) {
  const modeSeg = document.getElementById('mode-seg');
  const floorSeg = document.getElementById('floor-seg');
  const select = document.getElementById('rooms-select');
  const hint = document.getElementById('hint');

  const setOn = (seg, attr, val) =>
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset[attr] === String(val)));

  modeSeg.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    setOn(modeSeg, 'mode', b.dataset.mode); onMode(b.dataset.mode);
  });
  floorSeg.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    setOn(floorSeg, 'floor', b.dataset.floor); onFloor(Number(b.dataset.floor));
  });
  select.addEventListener('change', () => {
    const v = select.value;
    select.value = '';
    if (v) onRoom(v);
  });
  document.getElementById('theme-btn').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('viewerTheme', next); } catch (e) { /* ignore */ }
    document.querySelector('meta[name="theme-color"]').content = next === 'dark' ? '#111111' : '#f4f1ea';
    onTheme(next);
  });

  return {
    setRooms(rooms) {
      select.innerHTML = '';
      const ph = new Option('Rooms', '', true, true); ph.disabled = true; ph.hidden = true;
      select.add(ph);
      select.add(new Option('Whole floor', '__all'));
      for (const r of rooms) select.add(new Option(r.name, r.id));
      select.value = '';
    },
    showHint(on) { hint.hidden = !on; },
  };
}
