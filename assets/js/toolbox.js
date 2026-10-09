/* Home page toolbox: hover (or click / Enter) opens the lid and fans a few tools out of it. */
import { getTool, toolUrl } from './tools.js';

// Edit this list to change what comes out of the box (labels + registry tool ids)
const TOOLS = [
  { label: 'Remove background', id: 'background-remover' },
  { label: 'Generate CSS', id: 'css' },
];

const FAN_SPREAD = 50; // degrees either side of straight up
const FAN_RADIUS = 100; // px from the box opening
const STAGGER = 0.1; // seconds between each tool
const TOOL_DURATION = 450; // ms, matches the transform transition
const EDGE = 12; // px, minimum gap between a tool and the left edge of the window

const toolbox = document.querySelector('.toolbox');
if (toolbox) init(toolbox);

function init(toolbox) {
  const art = toolbox.querySelector('.toolbox-art');
  const svg = toolbox.querySelector('.toolbox-svg');
  const lid = toolbox.querySelector('.toolbox-lid');
  const hoverable = matchMedia('(hover: hover)').matches;
  let outTimers = [];

  // Lay the tools out on an arc above the box
  const list = TOOLS.filter((t) => getTool(t.id));
  const tools = list.map((tool, i) => {
    const t = list.length === 1 ? 0.5 : i / (list.length - 1);
    const angle = (t * 2 - 1) * FAN_SPREAD;
    const rad = (angle * Math.PI) / 180;

    const el = document.createElement('a');
    el.className = 'toolbox-tool';
    el.href = toolUrl(getTool(tool.id));
    el.textContent = tool.label;
    el.tabIndex = -1;
    el.dataset.x = Math.sin(rad) * FAN_RADIUS;
    el.style.setProperty('--x', `${el.dataset.x}px`);
    el.style.setProperty('--y', `${-Math.cos(rad) * FAN_RADIUS - 20}px`);
    el.style.setProperty('--r', `${angle * 0.15}deg`);
    el.addEventListener('click', (e) => e.stopPropagation());
    art.insertBefore(el, svg);
    return el;
  });

  const isOpen = () => toolbox.classList.contains('is-open');

  // The box sits at the left edge, so nudge any tool that would fan out past the screen edge.
  function keepOnScreen() {
    const centre = art.getBoundingClientRect().left + art.offsetWidth / 2;
    for (const el of tools) {
      const x = Number(el.dataset.x);
      const left = centre + x - el.offsetWidth / 2;
      el.style.setProperty('--x', `${x + Math.max(0, EDGE - left)}px`);
    }
  }

  function setOpen(open) {
    if (open === isOpen()) return;
    if (open) keepOnScreen();
    outTimers.forEach(clearTimeout);
    outTimers = [];

    tools.forEach((el, i) => {
      // Open: first tool out first. Close: last tool back in first.
      const order = open ? i : tools.length - 1 - i;
      const delay = order * STAGGER + (open ? 0.1 : 0);
      el.style.setProperty('--delay', `${delay}s`);
      el.tabIndex = open ? 0 : -1;

      if (open) {
        // Only jump in front of the box once it's past the lid
        outTimers.push(setTimeout(() => el.classList.add('is-out'), delay * 1000 + TOOL_DURATION * 0.4));
      } else {
        el.classList.remove('is-out');
      }
    });

    lid.style.setProperty('--lid-delay', open ? '0s' : `${tools.length * STAGGER + 0.15}s`);
    toolbox.classList.toggle('is-open', open);
    toolbox.setAttribute('aria-expanded', String(open));
  }

  const toggle = () => setOpen(!isOpen());

  // With hover, the mouse already opened it, so a click shouldn't shut it
  toolbox.addEventListener('click', () => (hoverable ? setOpen(true) : toggle()));
  toolbox.addEventListener('keydown', (e) => {
    if (e.target !== toolbox) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  });

  if (hoverable) {
    toolbox.addEventListener('mouseenter', () => setOpen(true));
    toolbox.addEventListener('mouseleave', () => setOpen(false));
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) {
      setOpen(false);
      toolbox.focus();
    }
  });

  document.addEventListener('click', (e) => {
    if (!toolbox.contains(e.target)) setOpen(false);
  });
}
